import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isStoragePath, resolveAudioUrl } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") || "master") as "master" | "mix" | "preview_mix";
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
  let source: string = version ? `audio_versions.${version.kind}.v${version.version}` : "none";

  if (!audioPath) {
    const { data: song } = await service
      .from("songs")
      .select("*")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (song?.audio_path) {
      audioPath = song.audio_path;
      source = "songs";
    }
  }

  if (!audioPath || audioPath.startsWith("mock://")) {
    const { data: beat } = await service
      .from("beats")
      .select("audio_path")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (beat?.audio_path) {
      audioPath = beat.audio_path;
      source =
        source.startsWith("audio_versions") || source === "songs"
          ? `${source}+beat_fallback`
          : "beat_fallback";
    }
  }

  if (!audioPath) {
    return NextResponse.json(
      { error: "No audio available yet. Finish recording and produce the song first." },
      { status: 404 }
    );
  }

  const downloadUrl = await resolveAudioUrl(audioPath, 3600);
  if (!downloadUrl) {
    return NextResponse.json(
      {
        error: "Audio is not downloadable yet (mock or missing storage object).",
        path: isStoragePath(audioPath) ? audioPath : undefined,
        source,
      },
      { status: 404 }
    );
  }

  const safeTitle = (project.title || "studio-song")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .slice(0, 48)
    .toLowerCase();
  const filename = `${safeTitle}-${kind}-v${version?.version || 1}.wav`;

  if (wantRedirect) {
    return NextResponse.redirect(downloadUrl, 302);
  }

  return NextResponse.json({
    download_url: downloadUrl,
    filename,
    kind: version?.kind || kind,
    version: version?.version || null,
    source,
    expires_in: 3600,
    project_status: project.status,
  });
}
