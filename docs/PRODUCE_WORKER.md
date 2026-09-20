# Produce worker architecture

## Why

Heavy produce (restore → arrange → ASR → mix → master → QC → export) must not run inside
Vercel’s ~300s serverless ceiling. Quality shortcuts that existed only to beat that clock
are disabled on the worker.

## Recommendation

| Option | Verdict |
|--------|---------|
| **Dedicated Node worker + Supabase job queue (current)** | **Chosen** — already integrated (`workers/production-worker.ts`), same `jobs` table, minimal new infra. Run via Docker Compose / Fly / any VPS. |
| Inngest / Trigger.dev | Strong alternative if you want managed orchestration; adds vendor + rewrite of claim loop. |
| Cloud Run Jobs | Good timeouts; more GCP wiring for little gain over a simple long process. |
| Fly Machines only | Fine host for **this** worker binary. |

## API surface (unchanged for Console / Booth)

1. `POST /api/projects/:id/produce` → enqueues `PRODUCE_SONG` (`queued`)
2. Client polls `GET /api/jobs/:id`
3. When `PRODUCE_EXECUTION=worker` (default on Vercel), poll **only reads** status — does **not** run the engine
4. Worker claims job → `tickProduceJob` → updates `stage` / `progress` / `ap_checkpoint` / `status`

## Env

**Vercel (web)**

```bash
PRODUCE_EXECUTION=worker
```

**Worker process**

```bash
PRODUCE_WORKER=1
PRODUCE_FULL_QUALITY=1
PRODUCE_EXECUTION=worker
WORKER_TICK_MS=1200000          # 20 min per tick (safety, not quality target)
PRODUCE_JOB_MAX_MS=1800000      # 30 min absolute runaway ceiling
WORKER_POLL_MS=2500
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
# + R2 / ffmpeg / ASR keys as in web
```

**Local without worker**

```bash
PRODUCE_EXECUTION=inline
```

## Quality behavior

| Shortcut | Worker (full quality) | Inline / Vercel |
|----------|----------------------|-----------------|
| ASR cutoff near deadline | **Removed** | Still applies |
| ASR on harmony layers | **Yes** | Lead/double only (or ≤3 layers) |
| Skip ASR on ad-lib/background | **Kept** (design: phrase mind for primary stack) | Same |
| Restore once then skip on arrange | **Kept** (correct once-per-layer) | Same |
| QC retries | **Up to 2** | 1 |
| Soft “unusable-only” fatal QC | Kept for delivery safety | Same |

## Run

```bash
npm run worker
# or
docker compose up -d worker
```
