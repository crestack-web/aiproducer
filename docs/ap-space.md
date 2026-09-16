# AP SPACE

Producer-level vocal **placement in the arrangement** — not "add reverb."

## Pipeline position

```
Raw → AP EDIT → restoration → pitch → AP TIME
  → performance analysis (AP SPACE)
  → space decision (character + plan)
  → DSP apply (filtered tails, tempo delay, throws)
  → layer hierarchy / bus → beat integration → mix → master
```

## Decision → DSP

| Layer | Module |
|--------|--------|
| Signals | `lib/ap-engine/space/performance.ts` |
| Decision | `lib/ap-engine/space/decide.ts` → `VocalSpaceDecision` |
| Apply | `lib/ap-engine/space/apply.ts` |
| Existing primitives | `lib/ap-engine/production/musical-space.ts` |

## Characters

- **intimate** — verse / quiet delivery; short ambience; low delay
- **present** — default lead pocket
- **expansive** — chorus / bridge / outro; more width and selective throws
- **background** — harmonies / BGV; more wash, less dry dominance

## Safety

Wet levels, feedback, width, and duck depth are clamped. Low confidence → drier treatment.

## Wiring

- **Full engine:** `mix/stack.ts` after vocal chain
- **Fast path:** `jobs/fast-produce.ts` per layer before bus sum
