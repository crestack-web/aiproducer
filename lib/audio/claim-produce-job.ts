/**
 * Safe claim for PRODUCE_SONG jobs so only one worker processes a job at a time.
 * Uses conditional status updates (no Redis). Stale processing locks can be reclaimed.
 */
import { createServiceClient } from "@/lib/supabase/server";

/** Must exceed WORKER_TICK_MS (default 240s). Heartbeat runs between ticks, not during. */
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

function asOut(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Atomically claim a queued job, or reclaim a stale processing job.
 * Returns null if nothing available / race lost.
 */
export async function claimNextProduceJob(workerId: string): Promise<ClaimedJob | null> {
  const supabase = createServiceClient();

  // 1) Prefer queued
  const { data: queued } = await supabase
    .from("jobs")
    .select("id, project_id, status, stage, output_data, attempts, updated_at, started_at")
    .eq("type", "PRODUCE_SONG")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(5);

  for (const row of queued || []) {
    const claimed = await tryClaim(supabase, row, workerId, "queued");
    if (claimed) return claimed;
  }

  // 2) Reclaim stale processing (worker died mid-job)
  const { data: processing } = await supabase
    .from("jobs")
    .select("id, project_id, status, stage, output_data, attempts, updated_at, started_at")
    .eq("type", "PRODUCE_SONG")
    .eq("status", "processing")
    .order("updated_at", { ascending: true })
    .limit(10);

  const now = Date.now();
  for (const row of processing || []) {
    const out = asOut(row.output_data);
    const lockAt = typeof out.tick_lock_at === "string" ? Date.parse(out.tick_lock_at) : 0;
    const updatedAt = row.updated_at ? Date.parse(String(row.updated_at)) : 0;
    const anchor = Math.max(lockAt || 0, updatedAt || 0);
    const stale = !anchor || now - anchor > STALE_MS;
    if (!stale) continue;
    const claimed = await tryClaim(supabase, row, workerId, "processing");
    if (claimed) return claimed;
  }

  return null;
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
