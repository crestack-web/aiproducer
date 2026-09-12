# Restoration Front-End

First stage for phone/bedroom vocals — **before** analysis, transcription, Producer Mind, and mix.

```
Raw vocal
 → Level normalize
 → Noise reduction (capped)
 → Light de-reverb
 → Click / plosive cleanup
 → Quality gate (artifact risk + confidence)
 → Analysis → ASR → Producer Mind → DSP → Mix → Master
```

## Quality gate

- `artifact_risk_score` (0–1): higher = more chance of audible damage
- If risk is high, restoration is **softened** (blend back toward leveled raw)
- `confidence`: high | medium | low — low confidence tells Producer Mind to stay conservative

## Report (`layer.restoration`)

```ts
{
  noiseFloorBeforeDb, noiseFloorAfterDb,
  reverbReductionApplied, levelGainDb,
  artifactRiskScore, confidence, flags, plainLanguage
}
```

Logs use `restore:` prefix, e.g. `restore: noise -48→-62 dB, risk 0.18, confidence high`.
