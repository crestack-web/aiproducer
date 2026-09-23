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
 * Public welcome rail: AP-generated beats only.
 * Produced songs (masters with vocals) are intentionally omitted — early
 * phone takes / incomplete blueprints are not representative of the product.
 */
export async function GET() {
  try {
    const service = createServiceClient();
    const tracks: ShowcaseTrack[] = [];
    const seenPaths = new Set<string>();
    const seenProjectBeat = new Set<string>();

    const { data: beatRows, error: bErr } = await service
      .from("project_beats")
      .select(
        "id, project_id, audio_path, title, status, source, provider, created_at, metadata"
      )
      .order("created_at", { ascending: false })
      .limit(40);

    if (bErr) {
      console.warn("[showcase] beats", bErr.message);
      return NextResponse.json({
        tracks: FALLBACK_SHOWCASE_TRACKS.filter((t) => t.kind === "beat"),
        source: "fallback",
        count: FALLBACK_SHOWCASE_TRACKS.filter((t) => t.kind === "beat").length,
      });
    }

    const beatList = (beatRows || []) as Array<{
      id: string;
      project_id?: string | null;
      audio_path?: string | null;
      title?: string | null;
      status?: string | null;
      source?: string | null;
      provider?: string | null;
      metadata?: Record<string, unknown> | null;
    }>;

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
      const path = String(b.audio_path || "");
      if (!path || seenPaths.has(path)) continue;
      const pid = b.project_id ? String(b.project_id) : null;
      if (pid && seenProjectBeat.has(pid)) continue;

      // Prefer AP / AI-generated instrumentals
      const src = String(b.source || b.provider || "").toLowerCase();
      const meta = (b.metadata || {}) as Record<string, unknown>;
      const isAi =
        src.includes("eleven") ||
        src.includes("musicgen") ||
        src.includes("ai") ||
        src.includes("generate") ||
        String(meta.provider || "").toLowerCase().includes("eleven") ||
        path.includes("generated") ||
        path.includes("music_generation");
      if (!isAi) continue;

      const st = String(b.status || "").toLowerCase();
      if (st === "failed" || st === "error") continue;

      const audioUrl = await safeSign(path);
      if (!audioUrl) continue;
      seenPaths.add(path);
      if (pid) seenProjectBeat.add(pid);

      const proj = pid ? projectMap.get(pid) : null;
      const title =
        (b.title && String(b.title).trim()) ||
        (proj?.title && String(proj.title).trim()) ||
        "AP Beat";

      tracks.push({
        id: `beat-${b.id}`,
        kind: "beat",
        title,
        artist: subline(proj?.genre ? String(proj.genre) : null, proj?.mood ? String(proj.mood) : null),
        cover: coverFor(`beat-${b.id}`),
        audioUrl,
        playsLabel: "Beat",
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
  } catch (e) {
    console.error("[showcase]", e);
    return NextResponse.json({
      tracks: FALLBACK_SHOWCASE_TRACKS.filter((t) => t.kind === "beat"),
      source: "fallback",
      count: FALLBACK_SHOWCASE_TRACKS.filter((t) => t.kind === "beat").length,
    });
  }
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

function subline(genre: string | null, mood: string | null): string {
  const bits: string[] = ["Instrumental"];
  if (genre) bits.push(genre);
  if (mood) bits.push(mood);
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
