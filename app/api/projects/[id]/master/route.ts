import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { isStoragePath, resolveAudioUrl } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/master
 * Signed URL for in-app playback only (Library Songs). Auth + ownership required.
 * Not a commercial download path — no paywall / unlock recording.
 *
 * Query: jobId | version (optional) — pick a specific produce take.
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
    // Newest complete PRODUCE_SONG with a master path
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

  if (!audioPath) {
    return NextResponse.json(
      { error: "No master available for playback yet.", project_status: project.status },
      { status: 404 }
    );
  }

  const audio_url = await resolveAudioUrl(audioPath, 3600);
  if (!audio_url) {
    return NextResponse.json(
      { error: "Could not sign master for playback.", path: audioPath },
      { status: 404 }
    );
  }

  return NextResponse.json({
    audio_url,
    path: audioPath,
    source,
    version,
    expires_in: 3600,
  });
}
