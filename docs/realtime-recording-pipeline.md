# Real-Time Recording Pipeline

Live capture is a **fork** of the offline AP pipeline. While recording, the only job is: **low-latency monitoring + phase-locked reference + raw unprocessed capture**.

```
Artist opens session
  → LIVE PATH: direct monitor + beat/click sync + raw MediaRecorder
  → Take saved (storage path + section/placement tags)
  → OFFLINE PATH (after save / Produce):
       Restoration → Analysis → ASR → Producer Mind → Fullness
       → Pitch/Timing → DSP → Mix → Master → QC
```

**Nothing** from the heavy offline chain runs during record (no restoration, Producer Mind, pitch polish, fullness, or mastering).

## Latency principle

Hearing yourself delayed more than ~10–15ms while singing is disorienting. Monitoring prioritizes **speed over polish**. Browser/OS audio stacks cap what is achievable; mobile Safari/Chrome will not match native ASIO desktop.

## Signal path

| Stage | Behavior |
|-------|----------|
| **Direct monitoring** | Input path kept independent; OS echoCancellation/noiseSuppression off when possible so the artist hears “real” input, not a processed double |
| **Reference playback** | Beat (and optional click) via `<audio>` / Web Audio, sink-routed; never mixed into the capture graph |
| **Raw capture** | `MediaRecorder` on the mic stream only — this blob is the source of truth for offline |
| **Live meter** | Peak/clip only — not full song analysis |

## Buffer / fidelity

- Monitoring may use a small buffer for lower latency.
- Saved take fidelity is independent: highest practical bitrate/sample path for the platform (`audioBitsPerSecond` 256k where supported).
- Do not downsample the saved take to match the monitor path.

## Multi-take / punch-in

Each recording is tagged with:

- `task_id` / section
- `timeline_start_ms` / `placement_start_ms` (canonical beat position)
- `recording_offset_ms` when punch-in or late entry applies
- `take_number`, `is_selected`

Offline comp/consistency logic consumes these tags — the artist does not re-tag after the fact.

## Post-take feedback

Optional **rough preview** (level + balance only) can run after stop — not the full Produce chain. Full “produced” sound is offline only.

## Code map

| Concern | Module |
|---------|--------|
| Capture open / constraints | `lib/audio/recording-engine.ts` |
| Beat vs mic isolation + duck | `lib/audio/speaker-monitor-duck.ts` |
| Placement / timeline tags | `lib/audio/session-timeline.ts` |
| Session UI record flow | `components/project-session-ui.tsx` |
| Offline after save | `lib/ap-engine/*` |

## Build order (status)

1. Direct monitoring + raw capture — **in place** (RecordingEngine)
2. Reference sync to section window — **in place** (session timeline + player seek)
3. Multi-take tagging — **in place** (recordings API + placement fields)
4. Fast rough preview after take — optional enhancement (preview players exist; not full AP)
