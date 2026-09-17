/**
 * AP file storage — Cloudflare R2 (S3-compatible API).
 * Supabase holds Postgres/Auth/RLS only; audio bytes live in R2.
 *
 * Env (server-only, never NEXT_PUBLIC_*):
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME
 *   R2_ENDPOINT  — e.g. https://<accountid>.r2.cloudflarestorage.com
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing required storage env: ${name}`);
  }
  return v;
}

/** R2 / S3 bucket name (private). */
export function getStorageBucket(): string {
  return requireEnv("R2_BUCKET_NAME");
}

function getEndpoint(): string {
  const explicit = process.env.R2_ENDPOINT?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  if (accountId) return `https://${accountId}.r2.cloudflarestorage.com`;
  throw new Error("Missing required storage env: R2_ENDPOINT or R2_ACCOUNT_ID");
}

let _client: S3Client | null = null;

function getR2Client(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: "auto",
    endpoint: getEndpoint(),
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: false,
  });
  return _client;
}

export function beatPath(userId: string, projectId: string, filename = "beat.wav") {
  return `users/${userId}/projects/${projectId}/beats/${filename}`;
}

export function recordingPath(
  userId: string,
  projectId: string,
  taskId: string,
  takeNumber: number,
  ext = "webm"
) {
  return `users/${userId}/projects/${projectId}/recordings/${taskId}/take-${takeNumber}.${ext}`;
}

export function isStoragePath(path: string | null | undefined): boolean {
  if (!path) return false;
  if (path.startsWith("http://") || path.startsWith("https://")) return false;
  if (path.startsWith("mock://")) return false;
  return true;
}

export function songMasterPath(userId: string, projectId: string, version: number) {
  return `users/${userId}/projects/${projectId}/masters/master_v${version}.wav`;
}

export function productionMixPath(userId: string, projectId: string, jobId: string, ext = "wav") {
  return `users/${userId}/projects/${projectId}/production/${jobId}/mix.${ext}`;
}

export function productionMasterPath(userId: string, projectId: string, jobId: string, ext = "wav") {
  return `users/${userId}/projects/${projectId}/production/${jobId}/master.${ext}`;
}

export function samplePath(userId: string, projectId: string, sampleId: string, ext = "wav") {
  return `users/${userId}/projects/${projectId}/samples/${sampleId}.${ext}`;
}

export function customBeatPath(userId: string, projectId: string, ext = "wav") {
  return `users/${userId}/projects/${projectId}/beats/custom.${ext}`;
}

function toUint8Array(body: Buffer | ArrayBuffer | Blob | Uint8Array): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return Promise.resolve(body);
  if (Buffer.isBuffer(body)) return Promise.resolve(new Uint8Array(body));
  if (body instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(body));
  return body.arrayBuffer().then((ab) => new Uint8Array(ab));
}

export async function uploadBuffer(
  path: string,
  body: Buffer | ArrayBuffer | Blob | Uint8Array,
  contentType: string
): Promise<string> {
  const client = getR2Client();
  const bytes = await toUint8Array(body);
  await client.send(
    new PutObjectCommand({
      Bucket: getStorageBucket(),
      Key: path,
      Body: bytes,
      ContentType: contentType || "application/octet-stream",
    })
  );
  return path;
}

export async function createSignedDownloadUrl(path: string, expiresIn = 3600): Promise<string> {
  const client = getR2Client();
  const cmd = new GetObjectCommand({
    Bucket: getStorageBucket(),
    Key: path,
  });
  return getSignedUrl(client, cmd, { expiresIn });
}

export async function resolveAudioUrl(
  path: string | null | undefined,
  expiresIn = 3600
): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("mock://")) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  try {
    return await createSignedDownloadUrl(path, expiresIn);
  } catch {
    return null;
  }
}

export async function createSignedUploadUrl(
  path: string,
  opts?: { upsert?: boolean }
): Promise<{ signedUrl: string; token: string | undefined; path: string }> {
  void opts;
  const client = getR2Client();
  const cmd = new PutObjectCommand({
    Bucket: getStorageBucket(),
    Key: path,
  });
  const signedUrl = await getSignedUrl(client, cmd, { expiresIn: 3600 });
  return { signedUrl, token: undefined, path };
}

export async function downloadStorageObject(path: string): Promise<Buffer> {
  const client = getR2Client();
  const res = await client.send(
    new GetObjectCommand({
      Bucket: getStorageBucket(),
      Key: path,
    })
  );
  if (!res.Body) {
    throw new Error("Storage download returned empty body");
  }
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteStorageObject(path: string): Promise<void> {
  const client = getR2Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: getStorageBucket(),
      Key: path,
    })
  );
}

export async function listStorageObjects(
  prefix: string,
  opts?: { maxKeys?: number }
): Promise<string[]> {
  const client = getR2Client();
  const res = await client.send(
    new ListObjectsV2Command({
      Bucket: getStorageBucket(),
      Prefix: prefix,
      MaxKeys: opts?.maxKeys ?? 1000,
    })
  );
  return (res.Contents || []).map((o) => o.Key!).filter(Boolean);
}

export async function storageObjectExists(path: string): Promise<boolean> {
  try {
    const client = getR2Client();
    await client.send(
      new HeadObjectCommand({
        Bucket: getStorageBucket(),
        Key: path,
      })
    );
    return true;
  } catch {
    return false;
  }
}

export async function persistRemoteAudioToStorage(
  remoteUrl: string,
  storagePath: string,
  opts?: { minBytes?: number }
): Promise<{ path: string; bytes: number; contentType: string }> {
  const minBytes = opts?.minBytes ?? 500;
  const res = await fetch(remoteUrl);
  if (!res.ok) {
    throw new Error(`Failed to download provider audio: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < minBytes) {
    throw new Error(`Provider audio too small or empty (${buffer.length} bytes)`);
  }
  const contentType = res.headers.get("content-type") || "audio/wav";
  await uploadBuffer(storagePath, buffer, contentType);
  return { path: storagePath, bytes: buffer.length, contentType };
}
