# Option B spike — Voice-to-Song / Vocals (not implemented)

## Findings (2026-09-22)

### Documented public API (`POST /v1/music`)
- Supports `prompt` OR `composition_plan`, `model_id` (`music_v1` | `music_v2` | `music_v2_5`).
- `force_instrumental` only with `prompt`.
- **No** `voice_id`, `vocal_id`, or IVC reference field on compose in public API docs.
- Composition plans drive section structure + lyrics; vocals are model-generated, not IVC-tied.

### ElevenMusic product (Vocals / Voice-to-Song)
- Product launch (Jul 2026): Voice-to-Song and reusable Vocals for consistent identity on ElevenMusic.
- Oriented at ElevenMusic UI / Creative; **not clearly exposed** as a stable REST equivalent of “upload sample → short track in that singing identity” on the same path we use for `/v1/music`.
- Third-party notes often split: Suno/Mureka for singing identity; ElevenLabs IVC for speech.

### Cost (rough)
- Music generations bill per music seconds on the ElevenLabs music plan (higher than Flash TTS).
- Try It already caps at ~18s and 2 gens/account — keep those if moving to B.

### Recommendation
- Ship Option A (composition-plan section) for production-quality demos.
- Treat B as blocked until ElevenLabs documents an API parameter that binds a Vocal/Voice-to-Song identity to `/v1/music` (or a dedicated endpoint). Re-check API changelog before building B.
