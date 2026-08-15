import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enqueueProduceSong, tickProduceJob, getPipelineMode } from "@/lib/audio/pipeline";
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl, isStoragePath } from "@/lib/storage";
import { getRoexEnv } from "@/lib/env";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/produce
 * Authenticates, verifies ownership, enqueues job, returns 202 immediately.
 * Processing continues via poll (GET this route or /status) — does not hold HTTP for RoEx.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: project } = await service
    .from("projects")
    .select("id, user_id, status")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await enqueueProduceSong(projectId, user.id);

    // Fire-and-forget one tick so mock jobs finish quickly and RoEx jobs start.
    // Never await the full mix/master lifecycle here.
    if (result.status === "queued" || result.status === "processing") {
      void tickProduceJob(result.job_id, { maxWorkMs: 20_000 }).catch((e) => {
        console.error("produce background tick", e);
      });
    }

    return NextResponse.json(
      {
        jobId: result.job_id,
        job_id: result.job_id,
        status: result.status,
        deduped: result.deduped,
        mode: getPipelineMode(),
        roex_env: getRoexEnv(),
      },
      { status: result.deduped && result.status === "complete" ? 200 : 202 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not start produce";
    const status = msg.includes("not owned") || msg.includes("Not found") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * GET — status + advance stuck produce jobs (resume/poll provider tasks).
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: project } = await service
    .from("projects")
    .select("id, status")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let { data: job } = await service
    .from("jobs")
    .select("*")
    .eq("project_id", projectId)
    .eq("type", "PRODUCE_SONG")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (job && (job.status === "queued" || job.status === "processing")) {
    try {
      await tickProduceJob(job.id, { maxWorkMs: 20_000 });
      const { data: refreshed } = await service.from("jobs").select("*").eq("id", job.id).maybeSingle();
      if (refreshed) job = refreshed;
    } catch (e) {
      console.error("produce poll tick", e);
      const { data: refreshed } = await service.from("jobs").select("*").eq("id", job.id).maybeSingle();
      if (refreshed) job = refreshed;
    }
  }

  const { data: master } = await service
    .from("audio_versions")
    .select("*")
    .eq("project_id", projectId)
    .eq("kind", "master")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  let master_url: string | null = null;
  if (master?.audio_path && isStoragePath(master.audio_path)) {
    try {
      master_url = await createSignedDownloadUrl(master.audio_path, 3600);
    } catch {
      master_url = null;
    }
  }

  const { data: projNow } = await service.from("projects").select("status").eq("id", projectId).maybeSingle();

  return NextResponse.json({
    project_status: projNow?.status || project.status,
    job,
    master,
    master_url,
    mode: getPipelineMode(),
    roex_env: getRoexEnv(),
  });
}
