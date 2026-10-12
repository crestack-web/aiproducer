import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { tickProduceJob } from "@/lib/audio/pipeline";
import { createServiceClient } from "@/lib/supabase/server";
import { getProduceExecutionMode } from "@/lib/produce/execution-mode";

type Ctx = { params: Promise<{ id: string }> };

/** Full AP produce needs multi-minute ticks on Vercel (default limit kills mid-restore). */
export const maxDuration = 300;

/**
 * GET /api/jobs/:id — status + optional progress tick.
 *
 * - inline mode: always tick while queued/processing
 * - worker mode: if job sits in queued > ~8s (worker lag/offline), Vercel advances
 *   it so Produce again is not stuck at 5% forever or "completed" from a stale master
 */
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

  const mode = getProduceExecutionMode();
  const st = String(job.status || "").toLowerCase();
  const isProduce =
    job.type === "PRODUCE_SONG" && (st === "queued" || st === "processing" || st === "running");

  let shouldTick = false;
  let maxWorkMs = 240_000;

  if (isProduce) {
    if (mode === "inline") {
      shouldTick = true;
      maxWorkMs = 240_000;
    } else {
      // Worker mode: only rescue jobs the worker has not claimed yet
      const createdMs = job.created_at ? Date.parse(String(job.created_at)) : 0;
      const ageMs = createdMs ? Date.now() - createdMs : 0;
      if (st === "queued" && ageMs >= 8_000) {
        shouldTick = true;
        // Shorter tick on Vercel — keep moving stages; subsequent polls continue
        maxWorkMs = 90_000;
        console.info(
          "[jobs/get] worker-mode safety tick (queued unclaimed)",
          JSON.stringify({ jobId: id, ageMs, mode })
        );
      }
    }
  }

  if (shouldTick) {
    try {
      await tickProduceJob(job.id, { maxWorkMs });
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
    execution_mode: mode,
    safety_tick: shouldTick,
  });
}
