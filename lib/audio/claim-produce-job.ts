/**
 * Safe claim for PRODUCE_SONG jobs so only one worker processes a job at a time.
 * Uses conditional status updates (no Redis). Stale processing locks can be reclaimed.
 */
import { createServiceClient } from "@/lib/supabase/service";

/** Must exceed longest WORKER_TICK_MS (default 20m). Heartbeat between ticks. */
const STALE_MS = Number(process.env.PRODUCE_CLAIM_STALE_MS || 45 * 60 * 1000);

export type ClaimedJob = {
  id: string;
  project_id: string;
  status: string;
  stage: string | null;
  output_data: Record<string, unknown>;
  attempts: number;
};

/** Result of one claim attempt — always includes visibility for Railway logs */
export type ClaimAttemptResult = {
  job: ClaimedJob | null;
  /** Rows returned by status=queued query (before claim update) */
  queuedMatchCount: number;
  /** Stale processing candidates considered */
  staleProcessingCount: number;
  /** Supabase error message if select/update failed */
  queryError: string | null;
};

function asOut(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Atomically claim a queued job, or reclaim a stale processing job.
 * Prefer claimNextProduceJobDetailed when the worker needs CLAIM_QUERY_RESULT logs.
 */
export async function claimNextProduceJob(workerId: string): Promise<ClaimedJob | null> {
  const r = await claimNextProduceJobDetailed(workerId);
  return r.job;
}

/**
 * Same as claimNextProduceJob but always reports how many rows the claim queries saw.
 */
export async function claimNextProduceJobDetailed(workerId: string): Promise<ClaimAttemptResult> {
  const supabase = createServiceClient();
  let queryError: string | null = null;

  // 1) Prefer queued
  const { data: queued, error: qErr } = await supabase
    .from("jobs")
    .select("id, project_id, status, stage, output_data, attempts, updated_at, started_at")
    .eq("type", "PRODUCE_SONG")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(5);

  if (qErr) {
    queryError = qErr.message || String(qErr);
    return {
      job: null,
      queuedMatchCount: 0,
      staleProcessingCount: 0,
      queryError,
    };
  }

  const queuedRows = queued || [];
  for (const row of queuedRows) {
    const claimed = await tryClaim(supabase, row, workerId, "queued");
    if (claimed) {
      return {
        job: claimed,
        queuedMatchCount: queuedRows.length,
        staleProcessingCount: 0,
        queryError: null,
      };
    }
  }

  // 2) Reclaim stale processing (worker died mid-job)
  const { data: processing, error: pErr } = await supabase
    .from("jobs")
    .select("id, project_id, status, stage, output_data, attempts, updated_at, started_at")
    .eq("type", "PRODUCE_SONG")
    .eq("status", "processing")
    .order("updated_at", { ascending: true })
    .limit(10);

  if (pErr) {
    queryError = pErr.message || String(pErr);
    return {
      job: null,
      queuedMatchCount: queuedRows.length,
      staleProcessingCount: 0,
      queryError,
    };
  }

  const now = Date.now();
  let staleProcessingCount = 0;
  for (const row of processing || []) {
    const out = asOut(row.output_data);
    const lockAt = typeof out.tick_lock_at === "string" ? Date.parse(out.tick_lock_at) : 0;
    const updatedAt = row.updated_at ? Date.parse(String(row.updated_at)) : 0;
    const anchor = Math.max(lockAt || 0, updatedAt || 0);
    const stale = !anchor || now - anchor > STALE_MS;
    if (!stale) continue;
    staleProcessingCount += 1;
    const claimed = await tryClaim(supabase, row, workerId, "processing");
    if (claimed) {
      return {
        job: claimed,
        queuedMatchCount: queuedRows.length,
        staleProcessingCount,
        queryError: null,
      };
    }
  }

  return {
    job: null,
    queuedMatchCount: queuedRows.length,
    staleProcessingCount,
    queryError: null,
  };
}

async function tryClaim(
  supabase: ReturnType<typeof createServiceClient>,
  row: {
    id: string;
    project_id: string;
    status: string;
    stage: string | null;
    output_data: unknown;
    attempts: number;
  },
  workerId: string,
  expectedStatus: "queued" | "processing"
): Promise<ClaimedJob | null> {
  const out = {
    ...asOut(row.output_data),
    tick_lock_at: new Date().toISOString(),
    worker_id: workerId,
  };

  const { data, error } = await supabase
    .from("jobs")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
      output_data: out,
    })
    .eq("id", row.id)
    .eq("status", expectedStatus)
    .select("id, project_id, status, stage, output_data, attempts")
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id as string,
    project_id: data.project_id as string,
    status: data.status as string,
    stage: (data.stage as string) || null,
    output_data: asOut(data.output_data),
    attempts: Number(data.attempts) || 0,
  };
}

/** Refresh lock heartbeat so other workers do not reclaim mid-tick. */
export async function heartbeatProduceJob(jobId: string, workerId: string): Promise<void> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("jobs").select("output_data").eq("id", jobId).maybeSingle();
  if (!data) return;
  const out = {
    ...asOut(data.output_data),
    tick_lock_at: new Date().toISOString(),
    worker_id: workerId,
  };
  await supabase.from("jobs").update({ output_data: out }).eq("id", jobId).eq("status", "processing");
}
