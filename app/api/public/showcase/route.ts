import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl, isStoragePath } from "@/lib/storage";
import {
  FALLBACK_SHOWCASE_TRACKS,
  type ShowcaseTrack,
} from "@/lib/welcome-showcase-tracks";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/showcase
 * Public listening rail for the welcome page.
 *
 * Optional env SHOWCASE_PROJECT_IDS=uuid1,uuid2 — loads real beat/master audio.
 * Optional SHOWCASE_TRACKS_JSON — full JSON array of ShowcaseTrack.
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
      .slice(0, 12);

    if (ids.length) {
      const tracks = await loadFromProjects(ids);
      if (tracks.length) {
        return NextResponse.json({ tracks, source: "projects" });
      }
    }

    return NextResponse.json({
      tracks: FALLBACK_SHOWCASE_TRACKS,
      source: "fallback",
    });
  } catch (e) {
    console.error("[showcase]", e);
    return NextResponse.json({
      tracks: FALLBACK_SHOWCASE_TRACKS,
      source: "fallback",
    });
  }
}

async function loadFromProjects(ids: string[]): Promise<ShowcaseTrack[]> {
  const service = createServiceClient();
  const out: ShowcaseTrack[] = [];

  for (const projectId of ids) {
    try {
      const { data: project } = await service
        .from("projects")
        .select("id, title, genre, mood, status")
        .eq("id", projectId)
        .maybeSingle();
      if (!project) continue;

      // Prefer finished master
      const { data: master } = await service
        .from("audio_versions")
        .select("audio_path, kind")
        .eq("project_id", projectId)
        .eq("kind", "master")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let path = master?.audio_path as string | undefined;
      let kind: "beat" | "song" = "song";

      if (!path || !isStoragePath(path)) {
        const { data: beat } = await service
          .from("beats")
          .select("audio_path")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        path = beat?.audio_path as string | undefined;
        kind = "beat";
      }

      if (!path || !isStoragePath(path)) continue;

      let audioUrl: string;
      try {
        audioUrl = await createSignedDownloadUrl(path, 3600 * 6);
      } catch {
        continue;
      }

      const genre = (project.genre as string) || "Studio";
      const mood = (project.mood as string) || "";
      const cover = coverForSeed(String(project.title || projectId));

      out.push({
        id: projectId,
        title: String(project.title || "Untitled"),
        artist: mood ? `AP · ${genre} · ${mood}` : `AP · ${genre}`,
        kind,
        cover,
        audioUrl,
        playsLabel: kind === "song" ? "Produced" : "AP beat",
      });
    } catch (e) {
      console.warn("[showcase] project", projectId, e);
    }
  }

  return out;
}

function coverForSeed(seed: string): [string, string] {
  const palette: [string, string][] = [
    ["#1a0f2e", "#e7a961"],
    ["#0d1b2a", "#7bebd4"],
    ["#1c0a0a", "#f07167"],
    ["#0f1f1a", "#c4a574"],
    ["#1a1208", "#e7a961"],
    ["#0a1628", "#5b8def"],
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
