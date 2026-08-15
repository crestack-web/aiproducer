import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enqueueProduceSong, tickProduceJob, getPipelineMode } from "@/lib/audio/pipeline";
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await enqueueProduceSong(projectId, user.id);

    // Always advance the job in this request. There is no separate worker.
    // Previously only mock mode was ticked, so real jobs stayed stuck in "queued".
    if (result.status === "queued" || result.status === "processing") {
      try {
        await tickProduceJob(result.job_id);
      } catch (e) {
        console.error("produce tick", e);
        const msg = e instanceof Error ? e.message : "Produce pipeline failed";
        return NextResponse.json(
          {
            job_id: result.job_id,
            status: "failed",
            error: msg,
            mode: getPipelineMode(),
          },
          { status: 500 }
        );
      }
    }

    const service = createServiceClient();
    const { data: job } = await service.from("jobs").select("*").eq("id", result.job_id).maybeSingle();

    return NextResponse.json(
      {
        job_id: result.job_id,
        status: job?.status || result.status,
        deduped: result.deduped,
        mode: getPipelineMode(),
        error: job?.error || null,
      },
      { status: job?.status === "failed" ? 500 : result.deduped ? 200 : 202 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not start produce";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, status")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const service = createServiceClient();
  let { data: job } = await service
    .from("jobs")
    .select("*")
    .eq("project_id", projectId)
    .eq("type", "PRODUCE_SONG")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Advance stuck jobs when the client polls
  if (job && (job.status === "queued" || job.status === "processing")) {
    try {
      await tickProduceJob(job.id);
      const { data: refreshed } = await service.from("jobs").select("*").eq("id", job.id).maybeSingle();
      if (refreshed) job = refreshed;
    } catch (e) {
      console.error("produce poll tick", e);
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
  if (master?.audio_path && !String(master.audio_path).startsWith("mock://")) {
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
  });
}
