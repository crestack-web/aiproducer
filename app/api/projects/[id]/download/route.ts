import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isStoragePath, resolveAudioUrl } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

type AudioMeta = {
  master_mp3_path?: string;
  mix_storage_path?: string;
  master_storage_path?: string;
};

function safeFilename(title: string, kind: string, format: string, version?: number | null) {
  const base = (title || "studio-song")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .slice(0, 48)
    .toLowerCase();
  const ver = version ? `-v${version}` : "";
  return `${base}-${kind}${ver}.${format}`;
}

export async function GET(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") || "master") as "master" | "mix" | "preview_mix";
  const format = (url.searchParams.get("format") || "wav").toLowerCase() as "wav" | "mp3";
  const wantRedirect = url.searchParams.get("redirect") === "1";

  const { data: project } = await supabase
    .from("projects")
    .select("id, title, status, user_id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const service = createServiceClient();
  const kindFilter =
    kind === "mix" ? ["mix", "preview_mix"] : kind === "preview_mix" ? ["preview_mix"] : ["master"];

  const { data: version } = await service
    .from("audio_versions")
    .select("*")
    .eq("project_id", projectId)
    .in("kind", kindFilter)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  let audioPath: string | null = version?.audio_path ?? null;
  let source = version ? `audio_versions.${version.kind}.v${version.version}` : "none";
  let meta: AudioMeta = (version?.metadata as AudioMeta) || {};

  const { data: song } = await service
    .from("songs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (song?.metadata && typeof song.metadata === "object") {
    meta = { ...meta, ...(song.metadata as AudioMeta) };
  }

  if ((!audioPath || audioPath.startsWith("mock://")) && song?.audio_path) {
    if (!String(song.audio_path).startsWith("mock://")) {
      audioPath = song.audio_path;
      source = "songs";
    }
  }

  // Job output fallback (AP engine)
  if (!audioPath || audioPath.startsWith("mock://")) {
    const { data: jobs } = await service
      .from("jobs")
      .select("output_data, status, completed_at")
      .eq("project_id", projectId)
      .eq("type", "PRODUCE_SONG")
      .order("created_at", { ascending: false })
      .limit(3);
    const done = (jobs || []).find((j) => j.status === "complete" || j.status === "completed");
    const od = (done?.output_data || {}) as AudioMeta & { master_storage_path?: string };
    if (od.master_storage_path && isStoragePath(od.master_storage_path)) {
      audioPath = od.master_storage_path;
      source = "job_output";
      meta = { ...meta, ...od };
    }
  }

  // Prefer MP3 path when requested
  if (format === "mp3") {
    const mp3Path = meta.master_mp3_path;
    if (mp3Path && isStoragePath(mp3Path) && !mp3Path.startsWith("mock://")) {
      audioPath = mp3Path;
      source = `${source}+mp3`;
    } else if (audioPath && audioPath.toLowerCase().endsWith(".mp3")) {
      // already mp3
    } else {
      // Try sibling .mp3 next to wav master
      if (audioPath && isStoragePath(audioPath)) {
        const candidate = audioPath.replace(/\.wav$/i, ".mp3");
        if (candidate !== audioPath) {
          const signed = await resolveAudioUrl(candidate, 60);
          if (signed) {
            audioPath = candidate;
            source = `${source}+mp3_sibling`;
          } else {
            return NextResponse.json(
              {
                error: "MP3 not available yet for this song. Download WAV instead.",
                available: ["wav"],
                source,
              },
              { status: 404 }
            );
          }
        } else {
          return NextResponse.json(
            {
              error: "MP3 not available yet for this song. Download WAV instead.",
              available: ["wav"],
              source,
            },
            { status: 404 }
          );
        }
      }
    }
  }

  if (!audioPath || audioPath.startsWith("mock://")) {
    return NextResponse.json(
      {
        error: "No mastered audio yet. Finish recording, then produce the song.",
        project_status: project.status,
        source: "none",
      },
      { status: 404 }
    );
  }

  const downloadUrl = await resolveAudioUrl(audioPath, 3600);
  if (!downloadUrl) {
    return NextResponse.json(
      {
        error: "Audio is not downloadable yet (missing storage object).",
        path: isStoragePath(audioPath) ? audioPath : undefined,
        source,
      },
      { status: 404 }
    );
  }

  const ext = format === "mp3" ? "mp3" : audioPath.toLowerCase().endsWith(".mp3") ? "mp3" : "wav";
  const filename = safeFilename(project.title || "studio-song", kind, ext, version?.version);

  if (wantRedirect) {
    const res = NextResponse.redirect(downloadUrl, 302);
    res.headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    return res;
  }

  return NextResponse.json({
    download_url: downloadUrl,
    filename,
    kind: version?.kind || kind,
    format: ext,
    version: version?.version || song?.version || null,
    source,
    expires_in: 3600,
    project_status: project.status,
    available_formats: meta.master_mp3_path || audioPath.toLowerCase().endsWith(".mp3")
      ? ["wav", "mp3"]
      : ["wav"],
  });
}
