import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { isStoragePath, resolveAudioUrl } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

async function resolveMasterPath(
  service: ReturnType<typeof createServiceClient>,
  projectId: string,
  jobIdParam: string,
  versionParam: string | null
): Promise<{ audioPath: string | null; source: string; version: number | null }> {
  let audioPath: string | null = null;
  let source = "none";
  let version: number | null = null;

  if (jobIdParam) {
    const { data: job } = await service
      .from("jobs")
      .select("id, status, output_data, created_at")
      .eq("id", jobIdParam)
      .eq("project_id", projectId)
      .eq("type", "PRODUCE_SONG")
      .maybeSingle();
    const out = (job?.output_data || {}) as Record<string, unknown>;
    const path =
      (typeof out.master_storage_path === "string" && out.master_storage_path) ||
      (typeof out.master_path === "string" && out.master_path) ||
      (typeof out.mix_storage_path === "string" && out.mix_storage_path) ||
      null;
    if (path && isStoragePath(path)) {
      audioPath = path;
      source = `job:${jobIdParam}`;
    }
  }

  if (!audioPath && versionParam != null && versionParam !== "") {
    const ver = Number(versionParam);
    if (Number.isFinite(ver)) {
      const { data: av } = await service
        .from("audio_versions")
        .select("audio_path, version")
        .eq("project_id", projectId)
        .eq("kind", "master")
        .eq("version", ver)
        .maybeSingle();
      if (av?.audio_path && isStoragePath(String(av.audio_path))) {
        audioPath = String(av.audio_path);
        version = Number(av.version);
        source = `audio_versions.v${version}`;
      }
    }
  }

  if (!audioPath) {
    const { data: jobs } = await service
      .from("jobs")
      .select("id, status, output_data, created_at")
      .eq("project_id", projectId)
      .eq("type", "PRODUCE_SONG")
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(15);
    for (const job of jobs || []) {
      const out = (job.output_data || {}) as Record<string, unknown>;
      const path =
        (typeof out.master_storage_path === "string" && out.master_storage_path) ||
        (typeof out.master_path === "string" && out.master_path) ||
        null;
      if (path && isStoragePath(path)) {
        audioPath = path;
        source = `job:${job.id}`;
        break;
      }
    }
  }

  if (!audioPath) {
    const { data: av } = await service
      .from("audio_versions")
      .select("audio_path, version")
      .eq("project_id", projectId)
      .eq("kind", "master")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (av?.audio_path && isStoragePath(String(av.audio_path))) {
      audioPath = String(av.audio_path);
      version = Number(av.version);
      source = `audio_versions.v${version}`;
    }
  }

  return { audioPath, source, version };
}

/**
 * GET /api/projects/:id/master
 * Playback for Library Songs. Auth + ownership required.
 * Query: jobId | version; stream=1 → same-origin audio body (avoids R2 CORS on <audio>).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: project } = await service
    .from("projects")
    .select("id, user_id, title, status")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const jobIdParam = (url.searchParams.get("jobId") || url.searchParams.get("job_id") || "").trim();
  const versionParam = url.searchParams.get("version");
  const wantStream =
    url.searchParams.get("stream") === "1" ||
    url.searchParams.get("stream") === "true" ||
    (req.headers.get("accept") || "").includes("audio/");

  const { audioPath, source, version } = await resolveMasterPath(
    service,
    projectId,
    jobIdParam,
    versionParam
  );

  if (!audioPath) {
    return NextResponse.json(
      { error: "No master available for playback yet.", project_status: project.status },
      { status: 404 }
    );
  }

  const signed = await resolveAudioUrl(audioPath, 3600);
  if (!signed) {
    return NextResponse.json(
      { error: "Could not sign master for playback.", path: audioPath },
      { status: 404 }
    );
  }

  const lower = audioPath.toLowerCase();
  const contentType = lower.endsWith(".mp3")
    ? "audio/mpeg"
    : lower.endsWith(".m4a") || lower.endsWith(".mp4")
      ? "audio/mp4"
      : "audio/wav";

  if (wantStream) {
    try {
      const upstream = await fetch(signed);
      if (!upstream.ok || !upstream.body) {
        return NextResponse.json(
          { error: "Could not fetch master from storage", status: upstream.status },
          { status: 502 }
        );
      }
      const headers = new Headers();
      headers.set("Content-Type", contentType);
      headers.set("Cache-Control", "private, max-age=300");
      headers.set("Accept-Ranges", "none");
      const len = upstream.headers.get("content-length");
      if (len) headers.set("Content-Length", len);
      return new NextResponse(upstream.body, { status: 200, headers });
    } catch (e) {
      console.error("[master] stream failed", e);
      return NextResponse.json(
        { error: "Stream failed", message: e instanceof Error ? e.message : String(e) },
        { status: 502 }
      );
    }
  }

  // JSON: prefer same-origin stream URL so <audio> never hits R2 CORS
  const streamUrl = new URL(req.url);
  streamUrl.searchParams.set("stream", "1");
  // strip host to path for relative use
  const stream_path = `${streamUrl.pathname}${streamUrl.search}`;

  return NextResponse.json({
    audio_url: stream_path,
    signed_url: signed,
    stream_url: stream_path,
    path: audioPath,
    source,
    version,
    expires_in: 3600,
    content_type: contentType,
  });
}
