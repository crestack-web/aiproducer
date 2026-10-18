/**
 * Beat Studio arrangement document — versioned, backward-compatible.
 *
 * Timing: PPQ ticks (pulses per quarter note). Default 960.
 * Conversion: seconds = ticks * (60 / tempoBpm / ppq)
 *
 * Stored at projects.metadata.beat_studio (merged via existing PATCH).
 * Audio binaries are never embedded — only MIDI-like note data.
 */

export const BEAT_STUDIO_DOC_VERSION = 1 as const;
/** Standard high-resolution PPQ for future piano-roll / quantize grids */
export const DEFAULT_PPQ = 960;
export const DEFAULT_TEMPO_BPM = 90;
export const DEFAULT_BARS = 2;
export const DEFAULT_TIME_SIG: [number, number] = [4, 4];
export const MAX_VOICES = 16;
export const PITCH_MIN = 0;
export const PITCH_MAX = 127;
export const VELOCITY_MIN = 1;
export const VELOCITY_MAX = 127;

export type InstrumentId = "pluck" | "synth_lead" | "synth_bass" | "drum_kit";

/** Optional instrument parameters (extensible without schema break) */
export type InstrumentParams = {
  attackSec?: number;
  decaySec?: number;
  sustain?: number;
  releaseSec?: number;
  filterHz?: number;
  gain?: number;
};

export type BeatStudioNote = {
  id: string;
  /** MIDI pitch 0–127 (60 = middle C) */
  pitch: number;
  /** Start in ticks from pattern start */
  startTick: number;
  /** Duration in ticks (≥ 1) */
  durationTicks: number;
  /** 1–127 */
  velocity: number;
};

export type BeatStudioTrack = {
  id: string;
  name: string;
  instrumentId: InstrumentId;
  muted?: boolean;
  /** Per-track instrument overrides */
  instrumentParams?: InstrumentParams;
  notes: BeatStudioNote[];
};

export type BeatStudioDoc = {
  version: typeof BEAT_STUDIO_DOC_VERSION;
  tempoBpm: number;
  /** [numerator, denominator] e.g. [4, 4] */
  timeSignature: [number, number];
  ppq: number;
  /** Pattern length in bars */
  bars: number;
  /** When true, pattern playback may loop (UI/engine opt-in) */
  loop?: boolean;
  tracks: BeatStudioTrack[];
  updatedAt?: string;
};

export function emptyBeatStudioDoc(partial?: Partial<BeatStudioDoc>): BeatStudioDoc {
  return {
    version: BEAT_STUDIO_DOC_VERSION,
    tempoBpm: partial?.tempoBpm ?? DEFAULT_TEMPO_BPM,
    timeSignature: partial?.timeSignature
      ? ([...partial.timeSignature] as [number, number])
      : [...DEFAULT_TIME_SIG],
    ppq: partial?.ppq ?? DEFAULT_PPQ,
    bars: partial?.bars ?? DEFAULT_BARS,
    loop: partial?.loop ?? true,
    tracks: partial?.tracks ?? [
      {
        id: "track_lead",
        name: "Lead",
        instrumentId: "pluck",
        notes: [],
      },
    ],
    updatedAt: partial?.updatedAt,
  };
}

export function clampPitch(n: number): number {
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, Math.round(n)));
}

export function clampVelocity(n: number): number {
  return Math.max(VELOCITY_MIN, Math.min(VELOCITY_MAX, Math.round(n)));
}

export function clampTempo(n: number): number {
  return Math.max(20, Math.min(300, Math.round(n)));
}
