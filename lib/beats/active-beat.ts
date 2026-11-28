import type { createServiceClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Which beat a project is using right now, and whether it is the user's own upload.
 *
 * Uploaded beats belong to the user: they cost us nothing to generate, so they must
 * never be charged like AP-generated beats (no beat checkout, no beat cost added to
 * the song unlock, no paywall on downloading the file they gave us).
 */
export type ActiveBeatInfo = {
  beatId: string | null;
  isUserUpload: boolean;
};

const UPLOAD_SOURCES = new Set(["upload", "user", "file"]);

export function isUserUploadedBeat(beat: { source?: unknown; metadata?: unknown } | null | undefined): boolean {
  if (!beat) return false;
  const src = String(beat.source || "").toLowerCase();
  if (UPLOAD_SOURCES.has(src)) return true;
  const meta = (beat.metadata || {}) as Record<string, unknown>;
  const metaSrc = String(meta.source || "").toLowerCase();
  return UPLOAD_SOURCES.has(metaSrc);
}

/** Resolve the active beat (metadata.active_beat_id, else newest beat) for a project. */
export async function getActiveBeatInfo(
  service: ServiceClient,
  projectId: string,
  projectMeta?: Record<string, unknown> | null
): Promise<ActiveBeatInfo> {
  const activeId =
    projectMeta && typeof projectMeta.active_beat_id === "string" ? String(projectMeta.active_beat_id) : null;

  let beat: { id?: string; source?: unknown; metadata?: unknown } | null = null;
  if (activeId) {
    const { data } = await service
      .from("beats")
      .select("id, source, metadata")
      .eq("id", activeId)
      .eq("project_id", projectId)
      .maybeSingle();
    beat = data as typeof beat;
  }
  if (!beat) {
    const { data } = await service
      .from("beats")
      .select("id, source, metadata")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    beat = data as typeof beat;
  }
  return { beatId: beat?.id ? String(beat.id) : null, isUserUpload: isUserUploadedBeat(beat) };
}
