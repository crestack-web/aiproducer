# Booth · Studio unified architecture

## Product split

| Experience | Route | Role |
|------------|-------|------|
| **Booth** (Create) | `/app/studio/[id]` | Guided section recording, AI plan, retake / layer |
| **Studio** (Control) | `/app/console/[id]` | Multitrack timeline, clips, FX, arrangement |
| **Hub** | `/app/studio` | Beat library & project entry |

## Shared source of truth

Both environments use the **same project id** and:

- `recording_tasks` (sections, timing, status, `console_clips`, `track_fx`)
- recordings / takes storage
- produce jobs & masters
- plan mode / AI production plan

There is **one** live capture pipeline (`openRecordingStream` + `createVocalRecorder`).

## Switching

- Booth → Studio: `Open in Studio` → `/app/console/{projectId}`
- Studio → Booth: `Booth` / close → `/app/studio/{projectId}`

Never create a second project when switching. Do not start a parallel recorder.

## Phase roadmap

1. **Done (this pass):** navigation labels, Booth session header, single progress voice, shared-data documentation
2. **Next:** Booth post-take actions (Listen / Retake / Add layer / Continue), denser Studio mobile layout cues
3. **Later:** optional AI suggestions after takes (real model, no fake copy)
