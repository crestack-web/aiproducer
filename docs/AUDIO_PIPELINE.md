# Audio Pipeline Architecture

**Goal:** One complete song using the user’s real voice — prepared, arranged, mixed, mastered — without a DAW UI.

## Pipeline

```
SELECT_TAKES → PREPARE_VOCALS → ARRANGE → RENDER_STEMS
  → MIX (RoEx) → MIX_ANALYSIS → GATE
  → MASTER → FINAL_QC → audio_versions + songs
```

## Mode selection (`getPipelineMode`)

| Condition | Mode |
|-----------|------|
| `AUDIO_PIPELINE_MODE=mock` | mock (explicit) |
| `AUDIO_PIPELINE_MODE=roex` | roex |
| `ROEX_API_KEY` set | **roex** (production default) |
| otherwise | mock |

Production: set `ROEX_API_KEY` on Vercel. Optionally set `AUDIO_PIPELINE_MODE=roex` and `DEV_MODE=false`.

- `ROEX_ALLOW_FULL=false` (default) → preview mix/master endpoints
- `ROEX_ALLOW_FULL=true` → full outputs when your RoEx plan supports them

Stem storage paths are converted to signed HTTPS URLs before RoEx mix starts.

## APIs

- `POST /api/projects/:id/produce` — idempotent enqueue + tick
- `GET /api/projects/:id/produce` — status + master
- `POST /api/recording-tasks/:id/recordings/:recordingId/select`
- `POST /api/webhooks/roex`

## SQL

Run `supabase/migrations/20260815140000_audio_pipeline.sql`

## MVP stems

INSTRUMENTAL · LEAD · DOUBLE · HARMONY · ADLIBS · BACKGROUND

User voice is never replaced. Provider does mix/master; we prepare and arrange.
