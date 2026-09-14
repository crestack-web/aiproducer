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

  if (mode === "roex") {
    logProduce({
      event: "tick_roex_not_in_impl",
      jobId,
      projectId,
      note: "RoEx path not in minimal tick; use AP mode",
    });
    await patchJob(supabase, jobId, {
      status: "failed",
      stage: "failed",
      progress: 100,
      error: "RoEx produce path not loaded in this build — use AP mode",
      completed_at: new Date().toISOString(),
    });
    return job;
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
    output_data: { ...out, mode: "ap", provider: "ap-internal" },
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
