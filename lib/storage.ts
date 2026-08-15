import { createServiceClient } from "@/lib/supabase/server";

const BUCKET = "studio";

/** Path helpers — never store public URLs; only storage paths. */
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

/** Signed URL for download/playback (short-lived). */
export async function createSignedDownloadUrl(path: string, expiresIn = 3600) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

/** Signed URL for direct client upload (PUT). */
export async function createSignedUploadUrl(path: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { signedUrl: data.signedUrl, token: data.token, path };
}

/** Upload a buffer from the server (e.g. DEV_MODE mock / processed audio). */
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
