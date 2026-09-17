/**
 * AP production worker — owns long-running PRODUCE_SONG ticks.
 * Not exposed over HTTP. Polls Supabase jobs and calls existing tickProduceJob().
 *
 * Start: npm run worker
 */
import { claimNextProduceJob, heartbeatProduceJob } from "../lib/audio/claim-produce-job";
import { tickProduceJob } from "../lib/audio/pipeline";
import { createServiceClient } from "../lib/supabase/server";

const POLL_MS = Number(process.env.WORKER_POLL_MS || 2500);
const TICK_MS = Number(process.env.WORKER_TICK_MS || 240_000);
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
  // HEARTBEAT NOTE: lock is refreshed before each tick and at tick start (tickProduceJob).
  // It is NOT updated mid-tick. STALE_MS (15m) must stay > WORKER_TICK_MS (default 4m).

  log("JOB_CLAIMED", { jobId });
  const supabase = createServiceClient();
  const maxRounds = 40;

  for (let round = 0; round < maxRounds; round++) {
    await heartbeatProduceJob(jobId, WORKER_ID);
    log("JOB_TICK", { jobId, round });

    try {
      await tickProduceJob(jobId, { maxWorkMs: TICK_MS });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("JOB_TICK_ERROR", { jobId, round, error: message });
      // tickProduceJob usually marks failed; ensure we don't die
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
      log("JOB_COMPLETE", { jobId, stage: job.stage });
      return;
    }
    if (job.status === "failed") {
      log("JOB_FAILED", { jobId, stage: job.stage, error: job.error });
      return;
    }

    log("CHECKPOINT", { jobId, stage: job.stage, status: job.status });
    // Brief pause between ticks if engine returned early
    await sleep(500);
  }

  log("JOB_MAX_ROUNDS", { jobId, maxRounds });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loop() {
  log("WORKER_STARTED", { pollMs: POLL_MS, tickMs: TICK_MS });

  // Validate env early
  const hasUrl =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) ||
    Boolean(process.env.SUPABASE_URL?.trim());
  const hasService =
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) ||
    Boolean(process.env.SUPABASE_SECRET_KEY?.trim());
  if (!hasUrl || !hasService) {
    log("WORKER_FATAL", {
      error:
        "Missing Supabase URL (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL) or service key (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY)",
    });
    process.exit(1);
  }

  for (;;) {
    try {
      const claimed = await claimNextProduceJob(WORKER_ID);
      if (claimed) {
        await processJob(claimed.id);
      } else {
        await sleep(POLL_MS);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("WORKER_LOOP_ERROR", { error: message });
      await sleep(POLL_MS);
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
