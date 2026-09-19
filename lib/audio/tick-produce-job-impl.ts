/**
 * Produce job tick — AP engine path (default production path).
 */
import { createServiceClient } from "@/lib/supabase/server";
import {
  getPipelineMode,
  asOutput,
  patchJob,
  logProduce,
} from "@/lib/audio/produce-job";
import { runInternalApProduceJob } from "@/lib/ap-engine/jobs/tick";

export async function tickProduceJob(jobId: string, opts?: { maxWorkMs?: number }) {
  const maxWorkMs = opts?.maxWorkMs ?? 240_000;
  const startedAt = Date.now();
  const supabase = createServiceClient();
  const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single();
  if (!job || job.type !== "PRODUCE_SONG") throw new Error("Invalid produce job");
  if (job.status === "complete" || job.status === "failed") return job;

  const projectId = job.project_id as string;
  const mode = getPipelineMode();
  let out = asOutput(job);
  const userId = (out.user_id as string) || "";

  // RoEx is optional; this build's tick always runs the internal AP engine.
  // Never fail the job solely because AUDIO_PIPELINE_MODE=roex — that produced
  // "AP couldn't finish" with a confusing RoEx-path error in production.
  if (mode === "roex") {
    logProduce({
      event: "tick_roex_fallback_to_ap",
      jobId,
      projectId,
      note: "RoEx tick not bundled; running internal AP engine",
    });
  }

  logProduce({
    event: "tick_start_ap",
    jobId,
    projectId,
    stage: job.stage,
    mode: "ap",
    provider: "ap-internal",
    maxWorkMs,
  });
  await patchJob(supabase, jobId, {
    status: "processing",
    started_at: job.started_at || new Date().toISOString(),
    attempts: (job.attempts || 0) + 1,
    provider: "ap-internal",
    // Refresh claim lock so a long tick is not mistaken for a dead worker
    output_data: {
      ...out,
      mode: "ap",
      provider: "ap-internal",
      tick_lock_at: new Date().toISOString(),
    },
  });
  try {
    const result = await runInternalApProduceJob({
      jobId,
      projectId,
      userId,
    });
    const { data: updated } = await supabase.from("jobs").select("*").eq("id", jobId).single();
    if (result.error && updated?.status !== "complete") {
      logProduce({ event: "ap_tick_error", jobId, projectId, error: result.error });
    }
    logProduce({
      event: "tick_ap_done",
      jobId,
      projectId,
      ms: Date.now() - startedAt,
      complete: result.complete,
    });
    return updated || job;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("tickProduceJob AP", jobId, e);
    await patchJob(supabase, jobId, {
      status: "failed",
      stage: "failed",
      progress: 100,
      error: msg,
      completed_at: new Date().toISOString(),
      output_data: { ...out, mode: "ap", provider: "ap-internal", error: msg },
    });
    throw e;
  }
}
