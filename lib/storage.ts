import { createServiceClient } from "@/lib/supabase/server";

const BUCKET = "studio";

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

export async function createSignedDownloadUrl(path: string, expiresIn = 3600) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
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

export function songMasterPath(userId: string, projectId: string, version: number) {
  return `users/${userId}/projects/${projectId}/masters/master_v${version}.wav`;
}

export function samplePath(userId: string, projectId: string, sampleId: string, ext = "wav") {
  return `users/${userId}/projects/${projectId}/samples/${sampleId}.${ext}`;
}

export function customBeatPath(userId: string, projectId: string, ext = "wav") {
  return `users/${userId}/projects/${projectId}/beats/custom.${ext}`;
}

export async function createSignedUploadUrl(path: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { signedUrl: data.signedUrl, token: data.token, path };
}

export async function uploadBuffer(
  path: string,
  body: Buffer | ArrayBuffer | Blob,
  contentType: string
) {
  const supabase = createServiceClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  return path;
}
