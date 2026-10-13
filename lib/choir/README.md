# AP Studio — AI Choir providers

## Pipeline

```
Lead vocal (unchanged)
  → Hybrid provider
      → Unison / multi-timbre parts: ElevenLabs Speech-to-Speech (preferred)
      → Interval harmony parts: Kits voice-conversion + pitchShift (preferred)
      → Fallback: local generateStack (DSP, choir_ai: false)
  → Separate Console tracks (background / double)
```

## Official endpoints used

| Provider | Endpoint | Purpose |
|----------|----------|---------|
| ElevenLabs | `POST /v1/speech-to-speech/{voice_id}` | Convert lead → different singer; timing/emotion preserved as model allows |
| Kits AI | `POST /api/kits/v1/voice-conversions` + poll | Conversion + **pitchShift −24…24** for intervals |
| Local | `generateStack` | Non-AI fallback |

ElevenLabs Music API is **not** used for choir (full-track generation, not aligned stems).

## Environment

```bash
# Already used for beats / TTS
ELEVENLABS_API_KEY=sk_...

# Choir-specific voice IDs (from ElevenLabs voice library)
ELEVENLABS_CHOIR_VOICE_SOPRANO=...
ELEVENLABS_CHOIR_VOICE_ALTO=...
ELEVENLABS_CHOIR_VOICE_TENOR=...
ELEVENLABS_CHOIR_VOICE_BASS=...
ELEVENLABS_CHOIR_VOICE_SUPPORT=...   # optional
ELEVENLABS_STS_MODEL=eleven_multilingual_sts_v2   # optional

# Interval harmonies (recommended with EL)
KITS_API_KEY=...
KITS_VOICE_SOPRANO=...   # numeric model ids
KITS_VOICE_ALTO=...
KITS_VOICE_TENOR=...
KITS_VOICE_BASS=...
```

## Honest limitations

- EL STS alone → **same melody**, different timbres (real multi-singer doubles).
- **Musical intervals** require Kits `pitchShift` (or a future Controlla choir API).
- Without either key → local DSP stack, clearly flagged non-AI.
