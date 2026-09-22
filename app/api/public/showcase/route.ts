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
const MAX_SONGS = 8;
const MAX_TOTAL = 16;

/**
 * GET /api/public/showcase
 * Public welcome rail: AP-produced masters + AP-generated beats only.
 * User-uploaded instrumentals are never shown (artists' private work).
 *
 * Optional:
 *   SHOWCASE_TRACKS_JSON — full track array
 *   SHOWCASE_PROJECT_IDS — limit to specific project UUIDs
 *   SHOWCASE_USE_FALLBACK=0 — empty list if bucket has nothing
 */
export async function GET() {
  try {
    const rawJson = (process.env.SHOWCASE_TRACKS_JSON || "").trim();
    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson) as ShowcaseTrack[];
        if (Array.isArray(parsed) && parsed.length) {
          return NextResponse.json({ tracks: parsed, source: "env_json" });
        }
      } catch {
        console.warn("[showcase] SHOWCASE_TRACKS_JSON invalid");
      }
    }

    const ids = (process.env.SHOWCASE_PROJECT_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 24);

    const fromBucket = await loadFromBucketCatalog(ids.length ? ids : null);
    if (fromBucket.length) {
      return NextResponse.json({
        tracks: fromBucket,
        source: "bucket",
        count: fromBucket.length,
      });
    }

    if ((process.env.SHOWCASE_USE_FALLBACK || "1").trim() === "0") {
      return NextResponse.json({ tracks: [], source: "empty", count: 0 });
    }

    return NextResponse.json({
      tracks: FALLBACK_SHOWCASE_TRACKS,
      source: "fallback",
      count: FALLBACK_SHOWCASE_TRACKS.length,
    });
  } catch (e) {
    console.error("[showcase]", e);
    return NextResponse.json({
      tracks: FALLBACK_SHOWCASE_TRACKS,
      source: "fallback_error",
      count: FALLBACK_SHOWCASE_TRACKS.length,
    });
  }
}

async function loadFromBucketCatalog(projectIds: string[] | null): Promise<ShowcaseTrack[]> {
  const service = createServiceClient();
  const tracks: ShowcaseTrack[] = [];
  const seenPaths = new Set<string>();
  const seenProjectSong = new Set<string>();
  const seenProjectBeat = new Set<string>();

  let masterQ = service
    .from("audio_versions")
    .select("id, project_id, audio_path, kind, created_at, metadata")
    .eq("kind", "master")
    .not("audio_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_SONGS * 2);

  if (projectIds?.length) {
    masterQ = masterQ.in("project_id", projectIds);
  }

  const { data: masters, error: mErr } = await masterQ;
  if (mErr) console.warn("[showcase] masters", mErr.message);

  let beatQ = service
    .from("beats")
    .select("id, project_id, audio_path, duration_ms, source, metadata, created_at, status")
    .not("audio_path", "is", null)
    // Prefer generated rows; upload exclusion is enforced again in the loop
    .neq("source", "upload")
    .order("created_at", { ascending: false })
    .limit(MAX_BEATS * 4);

  if (projectIds?.length) {
    beatQ = beatQ.in("project_id", projectIds);
  }

  const { data: beats, error: bErr } = await beatQ;
  if (bErr) console.warn("[showcase] beats", bErr.message);

  const masterProjectIds = [
    ...new Set((masters || []).map((m) => m.project_id as string).filter(Boolean)),
  ];
  const beatProjectIds = [
    ...new Set((beats || []).map((b) => b.project_id as string).filter(Boolean)),
  ];
  const allProjectIds = [...new Set([...masterProjectIds, ...beatProjectIds])];

  const projectMap = new Map<
    string,
    { title: string; genre: string | null; mood: string | null }
  >();

  if (allProjectIds.length) {
    const { data: projects } = await service
      .from("projects")
      .select("id, title, genre, mood")
      .in("id", allProjectIds);
    for (const p of projects || []) {
      projectMap.set(p.id as string, {
        title: String(p.title || "Untitled"),
        genre: (p.genre as string) || null,
        mood: (p.mood as string) || null,
      });
    }
  }

  for (const m of masters || []) {
    if (tracks.filter((t) => t.kind === "song").length >= MAX_SONGS) break;
    const pid = String(m.project_id || "");
    if (pid && seenProjectSong.has(pid)) continue;
    const path = m.audio_path as string;
    if (!path || !isStoragePath(path) || seenPaths.has(path)) continue;
    const audioUrl = await safeSign(path);
    if (!audioUrl) continue;
    seenPaths.add(path);
    if (pid) seenProjectSong.add(pid);
    const proj = projectMap.get(m.project_id as string);
    const title = proj?.title || "Produced song";
    tracks.push({
      id: `song-${m.id}`,
      title,
      artist: artistLine(proj, "song"),
      kind: "song",
      cover: coverForSeed(title),
      audioUrl,
      playsLabel: "Produced",
    });
    if (tracks.length >= MAX_TOTAL) break;
  }

  for (const b of beats || []) {
    if (tracks.filter((t) => t.kind === "beat").length >= MAX_BEATS) break;
    if (tracks.length >= MAX_TOTAL) break;
    const pid = String(b.project_id || "");
    // One showcase card per project — section edits / reworks stay in-app on the Beats tab
    if (pid && seenProjectBeat.has(pid)) continue;
    const path = b.audio_path as string;
    if (!path || !isStoragePath(path) || seenPaths.has(path)) continue;
    const meta = (b.metadata && typeof b.metadata === "object" ? b.metadata : {}) as {
      provider?: string;
      section_edit?: boolean;
      edit_section?: string;
      source?: string;
    };
    const source = String(b.source || meta.source || meta.provider || "").toLowerCase();
    // Public page: never surface user-uploaded instrumentals — only AP-generated beats
    const isUpload =
      source === "upload" ||
      source === "uploaded" ||
      source === "user" ||
      source === "file" ||
      source === "import";
    const isAi =
      !isUpload &&
      (source === "ai" ||
        source === "elevenlabs" ||
        source === "replicate" ||
        source === "musicgen" ||
        source === "generated" ||
        Boolean(meta.provider) ||
        // Path convention for AP-generated beats in R2
        path.includes("/generated/") ||
        path.includes("/ai/") ||
        path.includes("music_generation"));
    if (!isAi) continue;
    const st = String(b.status || "").toLowerCase();
    if (st === "failed" || st === "error") continue;
    const audioUrl = await safeSign(path);
    if (!audioUrl) continue;
    seenPaths.add(path);
    if (pid) seenProjectBeat.add(pid);
    const proj = projectMap.get(b.project_id as string);
    const title = proj?.title || "AP beat";
    tracks.push({
      id: `beat-${b.id}`,
      title,
      artist: artistLine(proj, "beat"),
      kind: "beat",
      cover: coverForSeed(title + String(b.id)),
      audioUrl,
      playsLabel: "AP beat",
    });
  }

  return tracks;
}

async function safeSign(path: string): Promise<string | null> {
  try {
    return await createSignedDownloadUrl(path, 3600 * 4);
  } catch (e) {
    console.warn("[showcase] sign failed", path, e instanceof Error ? e.message : e);
    return null;
  }
}

function artistLine(
  proj: { title: string; genre: string | null; mood: string | null } | undefined,
  kind: "beat" | "song"
): string {
  const bits = ["AP"];
  if (kind === "song") bits.push("Produced");
  if (proj?.genre) bits.push(proj.genre);
  if (proj?.mood) bits.push(proj.mood);
  return bits.join(" · ");
}

function coverForSeed(seed: string): [string, string] {
  const palette: [string, string][] = [
    ["#1a0f2e", "#e7a961"],
    ["#0d1b2a", "#7bebd4"],
    ["#1c0a0a", "#f07167"],
    ["#0f1f1a", "#c4a574"],
    ["#1a1208", "#e7a961"],
    ["#0a1628", "#5b8def"],
    ["#201018", "#d4a0ff"],
    ["#0c1a14", "#6ee7b7"],
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
