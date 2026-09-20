/**
 * Where heavy PRODUCE_SONG work runs.
 *
 * worker — dedicated process (workers/production-worker.ts). Vercel only enqueues + polls status.
 * inline — Vercel GET /api/jobs/:id advances the job (legacy; subject to ~300s limits).
 *
 * Set PRODUCE_EXECUTION=worker on Vercel and run `npm run worker` (or Docker worker service).
 */
export type ProduceExecutionMode = "worker" | "inline";

export function getProduceExecutionMode(): ProduceExecutionMode {
  const raw = (process.env.PRODUCE_EXECUTION || process.env.PRODUCE_WORKER_MODE || "")
    .trim()
    .toLowerCase();
  if (raw === "inline" || raw === "vercel" || raw === "0" || raw === "false") return "inline";
  // Default: worker — quality produce must not rely on Vercel function time limits
  if (raw === "worker" || raw === "external" || raw === "1" || raw === "true" || raw === "") {
    // Empty default: prefer worker when explicitly not set to inline.
    // Use inline only when forced (local dev without worker).
    if (raw === "" && process.env.VERCEL === "1") return "worker";
    if (raw === "") return "worker";
    return "worker";
  }
  return "worker";
}

/** True when this process is the long-running production worker. */
export function isProduceWorkerProcess(): boolean {
  return process.env.PRODUCE_WORKER === "1" || process.env.AP_PRODUCE_WORKER === "1";
}

/**
 * Full-quality path: no deadline-driven ASR cutoffs; more QC retries.
 * Enabled on worker process or when PRODUCE_FULL_QUALITY=1.
 */
export function isFullQualityProduce(): boolean {
  if (process.env.PRODUCE_FULL_QUALITY === "0") return false;
  if (process.env.PRODUCE_FULL_QUALITY === "1") return true;
  return isProduceWorkerProcess();
}

/** Soft wall-clock for a single worker tick (ms). Safety net, not quality-shaping. */
export function produceWorkerTickBudgetMs(): number {
  const n = Number(process.env.WORKER_TICK_MS || process.env.PRODUCE_WORKER_TICK_MS || 1_200_000);
  // default 20 minutes; clamp 5m–45m
  if (!Number.isFinite(n)) return 1_200_000;
  return Math.max(300_000, Math.min(45 * 60_000, Math.floor(n)));
}

/** Absolute job runaway protection (ms wall from first claim). Default 30 minutes. */
export function produceJobHardCeilingMs(): number {
  const n = Number(process.env.PRODUCE_JOB_MAX_MS || 30 * 60_000);
  if (!Number.isFinite(n)) return 30 * 60_000;
  return Math.max(600_000, Math.min(120 * 60_000, Math.floor(n)));
}
