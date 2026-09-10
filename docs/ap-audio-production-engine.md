# AP Audio Production Engine (Phase 1)

AP is the AI producer for this product — not an AI singer. The user’s real voice is preserved.

## Architecture

```
USER AUDIO (vocal + beat)
  → Ingestion / validation / normalize
  → Analysis
  → AP Decision Engine (rules + genre profiles)
  → Vocal restoration (DSP)
  → Vocal production chain (DSP)
  → Mix engine
  → Mastering
  → QC (+ one controlled retry)
  → WAV (+ MP3 when ffmpeg available)
```

Default provider: **InternalAPProvider** (`AUDIO_PIPELINE_MODE` unset or `ap`).

Optional: `AUDIO_PIPELINE_MODE=roex` for legacy RoEx.  
Explicit only: `AUDIO_PIPELINE_MODE=mock` (development).

## Modules

| Path | Role |
|------|------|
| `lib/ap-engine/index.ts` | `runApProduction` entry |
| `lib/ap-engine/dsp.ts` | PCM EQ, compress, gate, reverb, limit |
| `lib/ap-engine/ingestion/` | Normalize to 44.1 kHz stereo PCM |
| `lib/ap-engine/analysis/` | RMS, peak, bands, noise floor, silence |
| `lib/ap-engine/production/` | Decision engine + genre profiles + vocal chain |
| `lib/ap-engine/restoration/` | HPF + gate + level stabilize |
| `lib/ap-engine/mix/` | Balance, duck, light masking |
| `lib/ap-engine/master/` | EQ, bus comp, RMS proxy loudness, limiter |
| `lib/ap-engine/qc/` | Checks + single retry |
| `lib/ap-engine/jobs/tick.ts` | Job integration + storage |

## Job stages

`analyzing` → `restoring` → `producing` → `mixing` → `mastering` → `quality_check` → `complete`

## Storage

Under `users/{userId}/projects/{projectId}/production/{jobId}/`:

- `mix.wav`
- `master.wav`
- `master.mp3` (optional)
- `vocal-restored.wav`
- `vocal-processed.wav`

Original recordings and beats are never overwritten.

## Genre profiles (Phase 1)

R&B, Afrobeats, Afropop, Hip-hop, Amapiano, Pop, Ballad, Hausa R&B — influence decisions, not fixed one-click presets.

## Known Phase 1 limits

- One primary lead vocal + one beat (multi-layer later)
- DSP denoise only (no neural models yet)
- Loudness uses RMS proxy, not true LUFS metering
- Pitch correction not included
- Quality depends on input; phone noise is improved gently, not erased

## Local test checklist

1. WAV beat + WAV vocal  
2. MP3 beat + WAV vocal  
3. Quiet / loud / noisy phone vocal  
4. Produce with **no** `ROEX_API_KEY`  
5. Confirm original take still downloadable  
6. Compare restored vs processed vs master by ear  

## Version

`AP_ENGINE_VERSION` in `lib/ap-engine/types.ts`.

## Phase 1+ — Vocal roles & arrangement intelligence

AP maps existing `recording_tasks.type` (via `lib/layer-model` + `lib/ap-engine/roles.ts`) to:

- lead, double, harmony_high/mid/low, adlib, background, intro, outro

Hierarchy: Lead establishes the reference; doubles size; harmonies depth/width; ad-libs expression; backgrounds atmosphere.

Section labels (verse/chorus/…) adjust gain, width, and ambience.

Genre profiles (`lib/ap-engine/profiles/genre-profiles.ts`) describe production *philosophy* (Afrobeats, Afro-R&B, R&B, Hip-Hop, Trap, Pop, Amapiano, Ballad) — not single EQ presets.

Multi-vocal path: `runApArrangement` processes each layer with a role-specific decision, sums a vocal bus, then mixes with the beat.

No schema migration required. Missing layers are simply omitted — never synthesized.


## Edge cleanup (mouth open/close)

Each vocal take runs through `cleanTakeEdges` during restoration:

- Detects where singing energy actually starts/ends (within ~400ms of edges)
- Zeros leading/trailing mouth noise
- Cosine fade-in (~50ms) and fade-out (~100ms)

Goal: only the song parts remain in each section take — not a hard cut that clicks.
