# AP Studio — AI Choir providers

## Existing implementation (pre-upgrade)

`POST /api/recording-tasks/:id/choir` used `generateStack` in `lib/ap-engine/fullness/generate.ts`:

- Copies the **same** lead recording
- Applies short delays, micro-cent detune, pan, spectral tint
- **Not** new singers or musical interval harmonies from an AI model

That is why stacks could sound phasey/robotic after Produce.

## Provider evaluation (verified)

| Provider | Product capability | Public API for choir? | Notes |
|----------|-------------------|----------------------|--------|
| **Controlla Voice** | Choir Studio: SATB, presets, stems, pitch/timing variance | **No self-serve API** | Professional plan = “Apply for access” + webhooks. Best product reference; integrate when API credentials are issued. |
| **Kits AI** | Harmony Generator + Layers **in product UI** | **Voice conversion API only** | Documented: `POST /voice-conversions` with `voiceModelId`, `pitchShift` (−24..24), poll job, download `outputFileUrl`. No separate “harmony generator” endpoint in public docs. |
| **Soundverse** | Vocal layer / singing gen | Enterprise API | `POST /v1/vocal-layers` adds a layer and returns a **mixed** song, not separate choir stems. Less fit for timeline stems. |

## Selected path

1. **Primary (when configured):** Kits AI multi-job voice conversion → distinct voice models + optional `pitchShift` for harmony intervals → each part stored as its own Console track (`background` / `double`).
2. **Fallback:** Local `generateStack` DSP (unchanged), clearly flagged `choir_provider: local_stack` and `choir_ai: false`.
3. **Controlla:** Reserved provider id; enable when `CONTROLLA_API_KEY` + documented endpoints exist.

## Environment

```bash
KITS_API_KEY=...                 # required for AI path
KITS_VOICE_SOPRANO=123456        # royalty-free model ids from GET /voice-models
KITS_VOICE_ALTO=...
KITS_VOICE_TENOR=...
KITS_VOICE_BASS=...
# optional aliases:
# KITS_VOICE_FEMALE_1 / _2, KITS_VOICE_MALE_1 / _2
```

Without `KITS_API_KEY`, Stack still works via local DSP and warns in the response.

## Request body (additions)

```json
{
  "mode": "choir_full",
  "style": "pop",
  "arrangement": "full",
  "balance": "mixed",
  "harmony_intensity": "moderate",
  "force_local": false
}
```

## Success criterion

AI path: additional parts are **converted performances** from different Kits voice models (not only delayed clones of the lead). Lead task is never overwritten.
