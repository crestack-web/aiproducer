# Audio Pipeline Architecture

**Goal:** One complete R&B song using the user’s real voice — prepared, arranged, mixed, mastered — without a DAW UI.

## Pipeline

```
SELECT_TAKES → PREPARE_VOCALS → ARRANGE → RENDER_STEMS
  → MIX (RoEx preview-first) → MIX_ANALYSIS → GATE
  → MASTER → FINAL_QC → audio_versions + songs
```

Jobs are async. HTTP never waits on RoEx.

## Mode

- `AUDIO_PIPELINE_MODE=mock` — full state machine, $0 RoEx
- `roex` — Tonn API via `RoExMixProvider` only

## APIs

- `POST /api/projects/:id/produce` — idempotent enqueue
- `GET /api/projects/:id/produce` — status + master
- `POST /api/recording-tasks/:id/recordings/:recordingId/select`
- `POST /api/webhooks/roex`

## SQL

Run `supabase/migrations/20260815140000_audio_pipeline.sql`

## MVP stems (R&B)

INSTRUMENTAL · LEAD · DOUBLE · HARMONY · ADLIBS

User voice is never replaced. Provider does mix/master; we prepare and arrange.
