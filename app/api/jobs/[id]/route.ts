import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { tickProduceJob } from "@/lib/audio/pipeline";
import { createServiceClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/jobs/:id — also advances PRODUCE_SONG jobs while polling. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  let { data: job, error: jErr } = await service.from("jobs").select("*").eq("id", id).maybeSingle();

  if (jErr || !job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", job.project_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (job.type === "PRODUCE_SONG" && (job.status === "queued" || job.status === "processing")) {
    try {
      await tickProduceJob(job.id, { maxWorkMs: 20_000 });
      const { data: refreshed } = await service.from("jobs").select("*").eq("id", id).maybeSingle();
      if (refreshed) job = refreshed;
    } catch (e) {
      console.error("job poll tick", e);
      const { data: refreshed } = await service.from("jobs").select("*").eq("id", id).maybeSingle();
      if (refreshed) job = refreshed;
    }
  }

  return NextResponse.json({
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    error: job.error,
    provider_task_id: job.provider_task_id,
    output_data: job.output_data,
    attempts: job.attempts,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
  });
}
