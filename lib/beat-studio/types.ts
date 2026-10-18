/**
 * Beat Studio arrangement document — versioned, backward-compatible.
 * Stored on projects.metadata.beat_studio (no migration required for v1).
 * Musical time: PPQ ticks (pulses per quarter note). Default 96.
 */

export const BEAT_STUDIO_DOC_VERSION = 1 as const;
export const DEFAULT_PPQ = 96;
export const DEFAULT_TEMPO_BPM = 90;
export const DEFAULT_BARS = 2;
export const DEFAULT_TIME_SIG: [number, number] = [4, 4];

export type InstrumentId = "synth_lead" | "synth_bass" | "drum_kit";

export type BeatStudioNote = {
  id: string;
  /** MIDI pitch 0–127 (60 = middle C) */
  pitch: number;
  /** Start in ticks from pattern start */
  startTick: number;
  /** Duration in ticks */
  durationTicks: number;
  /** 1–127 */
  velocity: number;
};

export type BeatStudioTrack = {
  id: string;
  name: string;
  instrumentId: InstrumentId;
  muted?: boolean;
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
  tracks: BeatStudioTrack[];
  updatedAt?: string;
};

export function emptyBeatStudioDoc(partial?: Partial<BeatStudioDoc>): BeatStudioDoc {
  const leadId = "track_lead";
  return {
    version: BEAT_STUDIO_DOC_VERSION,
    tempoBpm: partial?.tempoBpm ?? DEFAULT_TEMPO_BPM,
    timeSignature: partial?.timeSignature ?? [...DEFAULT_TIME_SIG],
    ppq: partial?.ppq ?? DEFAULT_PPQ,
    bars: partial?.bars ?? DEFAULT_BARS,
    tracks: partial?.tracks ?? [
      {
        id: leadId,
        name: "Lead",
        instrumentId: "synth_lead",
        notes: [],
      },
    ],
    updatedAt: partial?.updatedAt,
  };
}
