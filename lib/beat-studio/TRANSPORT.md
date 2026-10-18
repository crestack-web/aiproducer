# Beat Studio ↔ Console transport contract

## Ownership

- **Console DAW** (`components/producer-view.tsx`) owns the primary session
  `AudioContext` used for beat audio clips, vocal playback, and live FX.
- **Beat Studio engine** (`lib/beat-studio/engine.ts`) **must** accept an
  `AudioContext` from its caller. It does not create a second long-lived
  production transport for integration with Console.

## Standalone MVP page

`/app/beat-studio/[id]` may create a **local** `AudioContext` only for the
isolated proof UI. That context is closed on unmount. It is **not** the
Console transport.

## Future Console integration

When MIDI lanes land in Console:

1. Pass `audioCtxRef.current` (or a getter) into `playNote` / `playPattern` /
   `BeatStudioEngine`.
2. Schedule notes with `when = ctx.currentTime + lookAhead` aligned to the
   same playhead formula already used in `lib/console-timeline.ts`:
   `timelineMs = (ctx.currentTime - startedAt) * 1000 + offsetMs`.
3. Convert timeline ms → ticks via `secondsToTicks(timelineMs/1000, tempo, ppq)`.
4. Never start a parallel RAF transport for MIDI; reuse Console play/pause/seek.

## Vocal recording

MIDI capture is separate from `lib/audio/recording-engine.ts`.
Do not route virtual keys through `openRecordingStream` / `MediaRecorder`.

## Voice limits

`MAX_VOICES` (16) — oldest voices are stopped when exceeded.
