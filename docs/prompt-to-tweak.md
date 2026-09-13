# Prompt-to-Tweak Loop

After produce, the artist can request mix changes in plain language.

## Flow

1. Full pipeline → master v0  
2. Artist prompt (“make the chorus louder”)  
3. **Interpreter** → bounded decision-map edits  
4. **Partial re-render** — section gain/presence on master PCM only  
5. Master vN + history (undo supported)

## API

- `POST /api/projects/:id/tweak` `{ action: "tweak", prompt, playbackMs? }`
- `POST /api/projects/:id/tweak` `{ action: "revert", version }`
- `GET /api/projects/:id/tweak` — history

## Safety

- Gain capped ± ~3.5–5 dB per edit path  
- True-peak held near −1 dBTP  
- Original master path stored as `tweak_original_master_path`

## Phase 1 scope

Section + song: loudness, presence, reverb scale. Phrase-level / “this part” via playbackMs when section keywords are missing.
