/**
 * AP production worker — owns long-running PRODUCE_SONG work.
 * Not exposed over HTTP. Polls Supabase jobs and runs the full AP pipeline
 * without Vercel function time limits.
 *
 * Start: npm run worker
 * Deploy: Docker Compose `worker` service (see docs/VPS_STAGING.md)
 *
 * Env:
 *   PRODUCE_WORKER=1          (set automatically below)
 *   PRODUCE_FULL_QUALITY=1    full ASR + QC retries
 *   WORKER_TICK_MS            per-tick budget (default 20m)
 *   PRODUCE_JOB_MAX_MS        runaway ceiling (default 30m)
 *   WORKER_POLL_MS            idle poll interval
 */
process.env.PRODUCE_WORKER = "1";
// Full-quality engine is the default. Speed comes from parallel ASR/restore +
// event-loop yields inside runApArrangement — not from demoting to fast mix.
// Fast path is disabled in code — always full-quality engine.
process.env.PRODUCE_FULL_QUALITY = "1";
process.env.PRODUCE_FAST = "0";
process.env.PRODUCE_EXECUTION = process.env.PRODUCE_EXECUTION || "worker";

import { claimNextProduceJobDetailed, heartbeatProduceJob } from "../lib/audio/claim-produce-job";
import { getServiceRoleKeyDiagnostics, getSupabaseEnvDiagnostics } from "../lib/supabase/env";
import { tickProduceJob } from "../lib/audio/pipeline";
import { createServiceClient } from "../lib/supabase/service";
import { getSupabaseUrl, getSupabaseServiceRoleKey } from "../lib/supabase/env";
import {
  produceWorkerTickBudgetMs,
  produceJobHardCeilingMs,
} from "../lib/produce/execution-mode";

const POLL_MS = Number(process.env.WORKER_POLL_MS || 2500);
const TICK_MS = produceWorkerTickBudgetMs();
const JOB_CEILING_MS = produceJobHardCeilingMs();
const WORKER_ID =
  process.env.WORKER_ID ||
  `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

function log(event: string, extra?: Record<string, unknown>) {
  const line = {
    ts: new Date().toISOString(),
    component: "ap-worker",
    worker_id: WORKER_ID,
    event,
    ...extra,
  };
  console.log(JSON.stringify(line));
}

async function processJob(jobId: string): Promise<void> {
  log("JOB_CLAIMED", { jobId, tickMs: TICK_MS, jobCeilingMs: JOB_CEILING_MS });
  const supabase = createServiceClient();
  const maxRounds = Number(process.env.WORKER_MAX_ROUNDS || 60);
  const jobStarted = Date.now();

  for (let round = 0; round < maxRounds; round++) {
    if (Date.now() - jobStarted > JOB_CEILING_MS) {
      log("JOB_HARD_CEILING", { jobId, elapsedMs: Date.now() - jobStarted, ceilingMs: JOB_CEILING_MS });
      await supabase
        .from("jobs")
        .update({
          status: "failed",
          stage: "failed",
          progress: 100,
          error: `Produce exceeded safety ceiling (${Math.round(JOB_CEILING_MS / 60000)} min). Contact support if this song is unusually long.`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .in("status", ["queued", "processing"]);
      return;
    }

    // Warn at 80% of ceiling
    const elapsed = Date.now() - jobStarted;
    if (elapsed > JOB_CEILING_MS * 0.8) {
      log("JOB_NEAR_CEILING", { jobId, elapsedMs: elapsed, ceilingMs: JOB_CEILING_MS });
    }

    await heartbeatProduceJob(jobId, WORKER_ID);
    log("JOB_TICK", { jobId, round, elapsedMs: elapsed });

    try {
      await tickProduceJob(jobId, { maxWorkMs: TICK_MS });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("JOB_TICK_ERROR", { jobId, round, error: message });
    }

    const { data: job } = await supabase
      .from("jobs")
      .select("id, status, stage, error")
      .eq("id", jobId)
      .maybeSingle();

    if (!job) {
      log("JOB_MISSING", { jobId });
      return;
    }

    if (job.status === "complete") {
      log("JOB_COMPLETE", { jobId, stage: job.stage, elapsedMs: Date.now() - jobStarted });
      return;
    }
    if (job.status === "failed") {
      log("JOB_FAILED", { jobId, stage: job.stage, error: job.error });
      return;
    }

    log("CHECKPOINT", { jobId, stage: job.stage, status: job.status });
    await sleep(500);
  }

  log("JOB_MAX_ROUNDS", { jobId, maxRounds });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loop() {
  if (!getSupabaseUrl() || !getSupabaseServiceRoleKey()) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the produce worker");
  }
  log("WORKER_STARTED", {
    pollMs: POLL_MS,
    tickMs: TICK_MS,
    jobCeilingMs: JOB_CEILING_MS,
    fullQuality: process.env.PRODUCE_FULL_QUALITY,
  });

  for (;;) {
    try {
      const claim = await claimNextProduceJobDetailed(WORKER_ID);
      log("CLAIM_QUERY_RESULT", {
        matchCount: claim.queuedMatchCount,
        staleProcessingCount: claim.staleProcessingCount,
        claimed: Boolean(claim.job),
        claimedJobId: claim.job?.id ?? null,
        queryError: claim.queryError,
      });
      if (claim.queryError) {
        log("CLAIM_QUERY_ERROR", { error: claim.queryError });
      }
      if (claim.job) {
        await processJob(claim.job.id);
      } else {
        await sleep(POLL_MS);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("WORKER_LOOP_ERROR", { error: message });
      await sleep(Math.min(POLL_MS * 2, 10000));
    }
  }
}

process.on("SIGTERM", () => {
  log("WORKER_SIGTERM");
  process.exit(0);
});
process.on("SIGINT", () => {
  log("WORKER_SIGINT");
  process.exit(0);
});

loop().catch((err) => {
  log("WORKER_FATAL", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
