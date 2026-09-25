import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl, isStoragePath } from "@/lib/storage";
import {
  FALLBACK_SHOWCASE_TRACKS,
  type ShowcaseTrack,
} from "@/lib/welcome-showcase-tracks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BEATS = 10;

/**
 * Public welcome rail: AP-generated beats only (source = ai).
 * User uploads are excluded. Produced songs intentionally omitted.
 */
export async function GET() {
  try {
    const service = createServiceClient();
    const tracks: ShowcaseTrack[] = [];
    const seenPaths = new Set<string>();
    const seenProjectBeat = new Set<string>();

    // Table is `beats` (not project_beats). AI rows use source: "ai".
    const { data: beatRows, error: bErr } = await service
      .from("beats")
      .select("id, project_id, audio_path, status, source, generation_prompt, created_at, metadata, bpm, duration_ms")
      .eq("source", "ai")
      .order("created_at", { ascending: false })
      .limit(50);

    if (bErr) {
      console.warn("[showcase] beats query", bErr.message);
      // Soft fallback: try without source filter in case legacy rows lack source
      const { data: anyBeats, error: anyErr } = await service
        .from("beats")
        .select("id, project_id, audio_path, status, source, generation_prompt, created_at, metadata, bpm, duration_ms")
        .order("created_at", { ascending: false })
        .limit(50);
      if (anyErr || !anyBeats?.length) {
        return NextResponse.json({
          tracks: FALLBACK_SHOWCASE_TRACKS.filter((t) => t.kind === "beat"),
          source: "fallback",
          count: FALLBACK_SHOWCASE_TRACKS.filter((t) => t.kind === "beat").length,
          error: bErr.message,
        });
      }
      return await buildResponse(service, anyBeats as BeatRow[], tracks, seenPaths, seenProjectBeat);
    }

    return await buildResponse(
      service,
      (beatRows || []) as BeatRow[],
      tracks,
      seenPaths,
      seenProjectBeat
    );
  } catch (e) {
    console.error("[showcase]", e);
    return NextResponse.json({
      tracks: FALLBACK_SHOWCASE_TRACKS.filter((t) => t.kind === "beat"),
      source: "fallback",
      count: FALLBACK_SHOWCASE_TRACKS.filter((t) => t.kind === "beat").length,
    });
  }
}

type BeatRow = {
  id: string;
  project_id?: string | null;
  audio_path?: string | null;
  status?: string | null;
  source?: string | null;
  generation_prompt?: string | null;
  metadata?: Record<string, unknown> | null;
  bpm?: number | null;
  duration_ms?: number | null;
};

async function buildResponse(
  service: ReturnType<typeof createServiceClient>,
  beatList: BeatRow[],
  tracks: ShowcaseTrack[],
  seenPaths: Set<string>,
  seenProjectBeat: Set<string>
) {
  const beatProjectIds = [
    ...new Set(beatList.map((b) => b.project_id as string).filter(Boolean)),
  ];

  const projectMap = new Map<
    string,
    { title: string; genre: string | null; mood: string | null }
  >();
  if (beatProjectIds.length) {
    const { data: projects } = await service
      .from("projects")
      .select("id, title, genre, mood")
      .in("id", beatProjectIds);
    for (const p of projects || []) {
      projectMap.set(String((p as { id: string }).id), {
        title: String((p as { title?: string }).title || "Untitled"),
        genre: (p as { genre?: string | null }).genre ?? null,
        mood: (p as { mood?: string | null }).mood ?? null,
      });
    }
  }

  for (const b of beatList) {
    if (tracks.length >= MAX_BEATS) break;
    if (!isApGeneratedBeat(b)) continue;

    const path = String(b.audio_path || "");
    if (!path || seenPaths.has(path)) continue;
    const pid = b.project_id ? String(b.project_id) : null;
    if (pid && seenProjectBeat.has(pid)) continue;

    const st = String(b.status || "").toLowerCase();
    if (st === "failed" || st === "error" || st === "pending") continue;

    const audioUrl = await safeSign(path);
    if (!audioUrl) continue;
    seenPaths.add(path);
    if (pid) seenProjectBeat.add(pid);

    const proj = pid ? projectMap.get(pid) : null;
    const title =
      (proj?.title && String(proj.title).trim()) ||
      shortPromptTitle(b.generation_prompt) ||
      "AP Beat";

    const bpm =
      typeof b.bpm === "number" && Number.isFinite(b.bpm) ? Math.round(b.bpm) : null;

    tracks.push({
      id: `beat-${b.id}`,
      kind: "beat",
      title,
      artist: subline(
        proj?.genre ? String(proj.genre) : null,
        proj?.mood ? String(proj.mood) : null,
        bpm
      ),
      cover: coverFor(`beat-${b.id}`),
      audioUrl,
      playsLabel: "AP beat",
    });
  }

  const beatOnly = tracks.filter((tr) => tr.kind === "beat");
  if (!beatOnly.length) {
    return NextResponse.json({
      tracks: FALLBACK_SHOWCASE_TRACKS.filter((t) => t.kind === "beat"),
      source: "fallback",
      count: FALLBACK_SHOWCASE_TRACKS.filter((t) => t.kind === "beat").length,
    });
  }

  return NextResponse.json({
    tracks: beatOnly,
    source: "live",
    count: beatOnly.length,
  });
}

/** True for AP Music generation; false for user uploads. */
function isApGeneratedBeat(b: BeatRow): boolean {
  const src = String(b.source || "").toLowerCase();
  if (src === "upload" || src === "user" || src === "file") return false;
  if (src === "ai" || src === "generated" || src === "elevenlabs") return true;

  const meta = (b.metadata || {}) as Record<string, unknown>;
  const provider = String(meta.provider || meta.model || "").toLowerCase();
  if (provider.includes("eleven") || provider.includes("musicgen") || provider === "ai") {
    return true;
  }
  const path = String(b.audio_path || "");
  if (path.includes("generated") || path.includes("music_generation")) return true;
  // Default: only allow when explicitly AI-tagged
  return false;
}

function shortPromptTitle(prompt: string | null | undefined): string | null {
  if (!prompt || !String(prompt).trim()) return null;
  const line = String(prompt).split(/[.\n]/)[0]?.trim() || "";
  if (line.length < 4) return null;
  return line.length > 36 ? `${line.slice(0, 34)}…` : line;
}

async function safeSign(path: string): Promise<string | null> {
  if (!path) return null;
  if (!isStoragePath(path) && /^https?:\/\//i.test(path)) return path;
  try {
    return await createSignedDownloadUrl(path, 3600 * 4);
  } catch (e) {
    console.warn("[showcase] sign failed", path, e instanceof Error ? e.message : e);
    return null;
  }
}

function subline(genre: string | null, mood: string | null, bpm: number | null): string {
  const bits: string[] = ["AP Beat"];
  if (genre) bits.push(genre);
  if (mood) bits.push(mood);
  if (bpm) bits.push(`${bpm} BPM`);
  return bits.join(" · ");
}

function coverFor(seed: string): [string, string] {
  const palette: [string, string][] = [
    ["#1a1208", "#e7a961"],
    ["#0a1628", "#5b8def"],
    ["#201018", "#d4a0ff"],
    ["#0c1a14", "#6ee7b7"],
    ["#1a0c10", "#f07167"],
    ["#0c1420", "#7dd3fc"],
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
