# Music Generation Layer

Independent **instrumental / beat generation** before the AI Producer recording → RoEx mix/master pipeline.

```
User concept
  → AI Producer (MusicGenerationPlan)
  → MusicGenerationService
  → MusicGenerationProvider
       ├─ MockMusicProvider
       └─ ReplicateMusicProvider (meta/musicgen)
  → Supabase storage
  → beats (INSTRUMENTAL)
  → Vocals → RoEx mix/master
```

## Environment

| Variable | Description |
|----------|-------------|
| `MUSIC_GENERATION_MODE` | `mock` or `provider` |
| `MUSIC_GENERATION_PROVIDER` | `replicate` |
| `REPLICATE_API_TOKEN` | Server-only |
| `REPLICATE_MUSIC_MODEL_VERSION` | MusicGen version id |
| `REPLICATE_MUSICGEN_MODEL_VERSION` | `stereo-large` (default) |
| `MUSIC_PREVIEW_DURATION_SEC` | default 8 |
| `MUSIC_FULL_DURATION_SEC` | default 24 (≤30) |
| `MAX_GENERATIONS_PER_USER_PER_DAY` | default 20 |

## Model

- **meta/musicgen** version `671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb`
- Endpoints: `GET /v1/account`, `POST /v1/predictions`, `GET /v1/predictions/{id}`
- Input: `prompt`, `duration`, `model_version`, `output_format`, `normalization_strategy`

## API

```
POST /api/music/generate  → { jobId, status }
GET  /api/music/generate/:jobId
POST /api/music/generate/:jobId  (tick)
```

## Billing

`BILLING_REQUIRED` → no retry. Client: credit unavailable message. Never log token.

## Mock

```
MUSIC_GENERATION_MODE=mock
```

## Provider

```
MUSIC_GENERATION_MODE=provider
MUSIC_GENERATION_PROVIDER=replicate
REPLICATE_API_TOKEN=...
```

## Migration

`supabase/migrations/20260815160000_music_generation_jobs.sql`
