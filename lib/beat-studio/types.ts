/**
 * Beat Studio arrangement document — versioned, backward-compatible.
 *
 * Timing: PPQ ticks (pulses per quarter note). Default 960.
 * Conversion: seconds = ticks * (60 / tempoBpm / ppq)
 *
 * Stored at projects.metadata.beat_studio (merged via existing PATCH).
 * Audio binaries are never embedded — only MIDI-like note data.
 *
 * v1: single loop — tracks carry notes inline.
 * v2: patterns + timeline clips + sections (Phase A data foundation).
 */

export const BEAT_STUDIO_DOC_VERSION_V1 = 1 as const;
export const BEAT_STUDIO_DOC_VERSION = 2 as const;
/** @deprecated use BEAT_STUDIO_DOC_VERSION */
export const BEAT_STUDIO_DOC_VERSION_LEGACY = BEAT_STUDIO_DOC_VERSION_V1;

/** Standard high-resolution PPQ for piano-roll / quantize grids */
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

export type PatternKind = "drum" | "melodic";

/** Reusable note container (v2) */
export type BeatStudioPattern = {
  id: string;
  name: string;
  /** Pattern length in ticks */
  lengthTicks: number;
  notes: BeatStudioNote[];
  kind?: PatternKind;
};

/** Timeline placement of a pattern on a track (v2) */
export type BeatStudioClip = {
  id: string;
  patternId: string;
  /** Song-timeline start tick */
  startTick: number;
  /** If omitted, use pattern.lengthTicks */
  durationTicks?: number;
  transpose?: number;
  velocityScale?: number;
  muted?: boolean;
};

export type SongSectionKind =
  | "intro"
  | "verse"
  | "pre_chorus"
  | "chorus"
  | "bridge"
  | "outro"
  | "custom";

export type BeatStudioSection = {
  id: string;
  name: string;
  kind: SongSectionKind;
  startTick: number;
  lengthTicks: number;
  color?: string;
};

/**
 * Arrangement track (v2).
 * `notes` may appear only as a migration residual; canonical notes live in patterns.
 */
export type BeatStudioTrack = {
  id: string;
  name: string;
  instrumentId: InstrumentId;
  muted?: boolean;
  solo?: boolean;
  instrumentParams?: InstrumentParams;
  /** v2: timeline clips referencing patterns */
  clips?: BeatStudioClip[];
  /**
   * v1 inline notes OR ephemeral playback adapter field.
   * Prefer patterns[patternId].notes for edits.
   */
  notes?: BeatStudioNote[];
};

/** Canonical document (v2) */
export type BeatStudioDoc = {
  version: typeof BEAT_STUDIO_DOC_VERSION;
  tempoBpm: number;
  timeSignature: [number, number];
  ppq: number;
  /**
   * Convenience length in bars for the primary loop region (UI / step grid).
   * Derived from songLengthTicks when possible.
   */
  bars: number;
  /** Full song length in ticks */
  songLengthTicks: number;
  loop?: boolean;
  sections: BeatStudioSection[];
  patterns: Record<string, BeatStudioPattern>;
  tracks: BeatStudioTrack[];
  updatedAt?: string;
};

/** Legacy v1 document (tracks hold notes) */
export type BeatStudioDocV1 = {
  version: typeof BEAT_STUDIO_DOC_VERSION_V1 | 1;
  tempoBpm: number;
  timeSignature: [number, number];
  ppq: number;
  bars: number;
  loop?: boolean;
  tracks: Array<{
    id: string;
    name: string;
    instrumentId: InstrumentId;
    muted?: boolean;
    instrumentParams?: InstrumentParams;
    notes: BeatStudioNote[];
  }>;
  updatedAt?: string;
};

export function clampPitch(n: number): number {
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, Math.round(n)));
}

export function clampVelocity(n: number): number {
  return Math.max(VELOCITY_MIN, Math.min(VELOCITY_MAX, Math.round(n)));
}

export function clampTempo(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TEMPO_BPM;
  return Math.max(40, Math.min(240, Math.round(n)));
}

export function newStableId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Empty v2 document with one drum pattern + one melody pattern and matching clips.
 */
export function emptyBeatStudioDoc(partial?: Partial<BeatStudioDoc>): BeatStudioDoc {
  const ppq = partial?.ppq ?? DEFAULT_PPQ;
  const bars = partial?.bars ?? DEFAULT_BARS;
  const timeSignature = partial?.timeSignature
    ? ([...partial.timeSignature] as [number, number])
    : ([...DEFAULT_TIME_SIG] as [number, number]);
  const [num, den] = timeSignature;
  const beatsPerBar = num * (4 / Math.max(1, den));
  const lengthTicks =
    partial?.songLengthTicks ??
    Math.max(1, Math.round(bars * beatsPerBar * ppq));

  const drumPatId = "pat_drums";
  const melPatId = "pat_melody";
  const drumTrackId = "track_drums";
  const melTrackId = "track_lead";

  const patterns: Record<string, BeatStudioPattern> = partial?.patterns ?? {
    [drumPatId]: {
      id: drumPatId,
      name: "Drums",
      lengthTicks,
      notes: [],
      kind: "drum",
    },
    [melPatId]: {
      id: melPatId,
      name: "Melody",
      lengthTicks,
      notes: [],
      kind: "melodic",
    },
  };

  const tracks: BeatStudioTrack[] = partial?.tracks ?? [
    {
      id: drumTrackId,
      name: "Drums",
      instrumentId: "drum_kit",
      clips: [
        {
          id: "clip_drums_0",
          patternId: drumPatId,
          startTick: 0,
          durationTicks: lengthTicks,
        },
      ],
      notes: [],
    },
    {
      id: melTrackId,
      name: "Lead",
      instrumentId: "pluck",
      clips: [
        {
          id: "clip_lead_0",
          patternId: melPatId,
          startTick: 0,
          durationTicks: lengthTicks,
        },
      ],
      notes: [],
    },
  ];

  const sections: BeatStudioSection[] = partial?.sections ?? [
    {
      id: "sec_loop",
      name: "Loop",
      kind: "custom",
      startTick: 0,
      lengthTicks,
    },
  ];

  return {
    version: BEAT_STUDIO_DOC_VERSION,
    tempoBpm: partial?.tempoBpm ?? DEFAULT_TEMPO_BPM,
    timeSignature,
    ppq,
    bars,
    songLengthTicks: lengthTicks,
    loop: partial?.loop ?? true,
    sections,
    patterns,
    tracks,
    updatedAt: partial?.updatedAt,
  };
}
