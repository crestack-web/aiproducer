/**
 * Resolve the project instrumental/beat for Produce / AP.
 * Accepts storage paths and https URLs (AI providers sometimes store remote URLs).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStoragePath } from "@/lib/storage";

export type ProjectBeat = {
  audio_path: string;
  duration_ms: number | null;
  tempo: number | null;
  bpm: number | null;
  source: string;
};

function isDownloadableBeatPath(path: string | null | undefined): path is string {
  if (!path || typeof path !== "string") return false;
  const p = path.trim();
  if (p.length < 3) return false;
  if (p.startsWith("mock://")) return false;
  if (p.startsWith("http://") || p.startsWith("https://")) return true;
  return isStoragePath(p);
}

type BeatRow = {
  audio_path?: string | null;
  duration_ms?: number | null;
  tempo?: number | null;
  bpm?: number | null;
  path?: string | null;
  storage_path?: string | null;
  file_path?: string | null;
  url?: string | null;
};

function pickPath(row: BeatRow): string | null {
  const candidates = [
    row.audio_path,
    row.path,
    row.storage_path,
    row.file_path,
    row.url,
  ];
  for (const c of candidates) {
    if (isDownloadableBeatPath(c)) return c.trim();
  }
  return null;
}

/**
 * Load the latest usable beat for a project.
 * Tries ordered query, then unordered, then alternate path columns.
 */
export async function resolveProjectBeat(
  service: SupabaseClient,
  projectId: string
): Promise<{ beat: ProjectBeat | null; diagnostics: string[] }> {
  const diagnostics: string[] = [];

  const attempts: { label: string; query: () => PromiseLike<{ data: unknown; error: { message: string } | null }> }[] = [
    {
      label: "beats_ordered",
      query: () =>
        service
          .from("beats")
          .select("audio_path, duration_ms, tempo, bpm, path, storage_path, file_path, url")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(3),
    },
    {
      label: "beats_basic",
      query: () =>
        service
          .from("beats")
          .select("audio_path, duration_ms, tempo, bpm")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(3),
    },
    {
      label: "beats_any",
      query: () =>
        service.from("beats").select("*").eq("project_id", projectId).limit(5),
    },
  ];

  for (const attempt of attempts) {
    try {
      const { data, error } = await attempt.query();
      if (error) {
        diagnostics.push(`${attempt.label}_err:${error.message}`);
        continue;
      }
      const rows = (Array.isArray(data) ? data : data ? [data] : []) as BeatRow[];
      diagnostics.push(`${attempt.label}_rows=${rows.length}`);
      for (const row of rows) {
        const path = pickPath(row);
        if (!path) {
          diagnostics.push(`${attempt.label}_skip_no_path`);
          continue;
        }
        return {
          beat: {
            audio_path: path,
            duration_ms: typeof row.duration_ms === "number" ? row.duration_ms : null,
            tempo: typeof row.tempo === "number" ? row.tempo : null,
            bpm: typeof row.bpm === "number" ? row.bpm : null,
            source: attempt.label,
          },
          diagnostics,
        };
      }
    } catch (e) {
      diagnostics.push(
        `${attempt.label}_throw:${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  diagnostics.push("no_usable_beat");
  return { beat: null, diagnostics };
}
