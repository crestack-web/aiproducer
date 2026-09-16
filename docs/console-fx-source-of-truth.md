# Console FX — source of truth

## Invariant

Console must not imply that a **monitor-only** change was printed into the final master.

## Production state (reaches Produce)

These are stored as recordings / plan / arrangement and are inputs to Internal AP:

| Change | How it reaches Produce |
|--------|-------------------------|
| Recorded / uploaded takes | `recordings` rows selected per task |
| Clip trim / timeline placement | Recording metadata / task windows used by the job |
| Task complete + plan selection | `recording_tasks` active / selected / completed |
| Beat | Project beat asset |
| Offline AP tweak on a take | Server `/tweak` rewrites processed take used by produce |

## Monitoring-only (Console Web Audio)

Persisted as `recording_tasks.metadata.track_fx` for UI restore, **not** read by mix/master today:

| Control | Scope |
|---------|--------|
| Gain, pan | Monitor graph + metadata only |
| Reverb, delay, compress, saturation, EQ | Monitor graph + metadata only |
| Mute / solo | Session monitor only |
| AP prompt local DAW commands (mute, pan, “more reverb”, etc.) | Apply monitor FX / transport; **do not** claim they are on the master unless `/tweak` or Produce is involved |

## AP prompt guidance

- Transport / mute / solo / pan / monitor FX → **monitoring** (instant Console feedback).
- Language that requires offline processing (pitch, denoise, “process the take”, song-wide master intent) → **server `/tweak` or Produce**.

Until the production engine consumes `track_fx`, UI copy for local FX should not say the final download was updated—only the session monitor was.
