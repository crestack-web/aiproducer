/**
 * Producer Mind — decision map contract.
 * Reasoning layer outputs instructions; DSP executes. Never processes audio bytes in an LLM.
 */

import type { SongSectionKind, VocalRole } from "../roles";

export type EmotionalWeight =
  | "hook"
  | "vulnerable"
  | "aggressive"
  | "intimate"
  | "transitional"
  | "neutral";

export type RestraintLevel = "preserve" | "standard" | "polish";

export type PhraseInstructions = {
  /** Relative fader ride vs base role level (dB) */
  vocalFaderRideDb: number;
  /** 0–1 send scale vs base reverb */
  reverbSendScale: number;
  /** de-ess intensity scale 0–1.5 */
  deEssScale: number;
  /** If true, gate softer / keep breaths */
  preserveBreath: boolean;
  /** Compression ratio scale (lower = more dynamic) */
  compressionScale: number;
  restraint: RestraintLevel;
};

export type PhraseDecision = {
  phraseId: string;
  timeRangeMs: [number, number];
  lyric: string | null;
  emotionalWeight: EmotionalWeight;
  /** What drove classification — lyric meaning, energy, or blend */
  weightSource: "lyric" | "energy" | "blended";
  role: VocalRole;
  section: SongSectionKind;
  instructions: PhraseInstructions;
  rationale: string;
  /** Optional fullness plan (Producer Mind extension) */
  fullness?: {
    doubles: boolean;
    harmony: { interval: string; confidence: string };
    adlibs: boolean;
    reasoning: string;
  };
  pitchTiming?: {
    pitchCorrection: "none" | "light" | "moderate" | "tight";
    timingCorrection: "none" | "light" | "moderate" | "tight";
    preserve: string[];
    reasoning: string;
    pitchStrength: number;
    timingStrength: number;
  };
  /** Stylistic FX — default off; sparse */
  creativeFx?: {
    delayThrow: {
      enabled: boolean;
      target: "last_word";
      type: "eighth_note_echo" | "quarter_echo" | "slap";
    } | null;
    filterAutomation: boolean;
    reverbCharacter: "default" | "ambient_large" | "none";
    stereoMovement: boolean;
    genreFx: string | null;
    reasoning: string;
  };
};

export type SectionDecision = {
  sectionId: string;
  section: SongSectionKind;
  timeRangeMs: [number, number];
  density: "hold" | "build" | "push" | "release";
  vocalFaderRideDb: number;
  reverbSendScale: number;
  rationale: string;
};

export type SongRead = {
  mood: string;
  genre: string;
  restraintVsPolish: number; // 0 = full restraint, 1 = full polish
  overallNotes: string[];
};

export type DecisionMap = {
  version: "1.0";
  engine: "producer-mind";
  song: SongRead;
  sections: SectionDecision[];
  phrases: PhraseDecision[];
  /** Plain-language summary for UI / feedback */
  summary: string[];
};

export type ProducerMindInput = {
  genre?: string | null;
  layers: Array<{
    role: VocalRole;
    section: SongSectionKind;
    startMs: number;
    durationMs: number;
    /** Optional aligned lyric lines for this layer */
    lyrics?: Array<{ text: string; startMs: number; endMs: number; confidence?: number }> | null;
    /** Energy phrase regions in layer-local time (ms from take start) */
    phrasesLocal?: Array<{ startMs: number; endMs: number; energy: number }> | null;
  }>;
  beatDurationMs: number;
  vocalRms?: number;
  beatRms?: number;
};
