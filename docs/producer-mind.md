# Producer Mind — Reasoning Layer

AP splits **producer** (intent) from **engineer** (DSP).

```
Analysis + phrases (+ optional lyrics)
  → Producer Mind decision map
  → DSP executes per phrase/section
```

## Roles

| Layer | Responsibility |
|-------|----------------|
| **Producer Mind** | What should happen and where (song → section → phrase) |
| **DSP engine** | EQ, compression, reverb, fades, rides — already built |

Producer Mind **never** processes audio in an LLM. Lyrics (when transcribed) may be reasoned over as text only.

## Decision map

- **Song read** — mood, genre, restraint vs polish
- **Section read** — hold / build / push / release
- **Phrase read** — emotional weight + instructions (fader, reverb scale, de-ess, breath, compression)

## Pipeline position

After vocal analysis, before/with layer DSP:

1. Build decision map (`buildDecisionMap`)
2. Modulate layer DSP params (`phraseInfluenceForLayer`)
3. Process & place layers
4. Apply phrase fader rides on timeline (`applyPhraseFaderRides`)
5. Mix / master as before

## Build order (status)

1. **Section-level reasoning** — done (deterministic)
2. **Phrase-level (energy)** — done via `analyzeVocalPhrases`
3. **Phrase-level (lyrics)** — hooks when ASR timestamps exist on layers
4. **Reference decision patterns / multi-take comp** — not yet

## Feedback (future)

Tune weights such as “restraint for vulnerable phrases” rather than only EQ numbers.
