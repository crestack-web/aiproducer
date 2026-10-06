/**
 * AP Vocal Arrangement Mind — types
 * Processing map over a continuous vocal (timeline-preserving).
 */

export type VocalSectionType =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "bridge"
  | "break"
  | "outro"
  | "unknown";

export type VocalPhrase = {
  startMs: number;
  endMs: number;
  energy: number;
  confidence: number;
  isBreathLike?: boolean;
};

export type VocalSection = {
  startMs: number;
  endMs: number;
  type: VocalSectionType;
  confidence: number;
  energy: number;
  vocalDensity: number;
  phraseCount: number;
};

/** 0–1 scales unless noted in name */
export type VocalTreatment = {
  gainDb: number;
  width: number;
  reverb: number;
  delay: number;
  compression: number;
  brightnessDb: number;
  double: boolean;
  delayThrow: boolean;
};

export type VocalArrangementMap = {
  phrases: VocalPhrase[];
  sections: VocalSection[];
  treatments: VocalTreatment[];
  confidence: number;
  bpm: number | null;
  method: string;
};

/** @deprecated alias */
export type ArrangementPlan = VocalArrangementMap;
/** @deprecated alias */
export type SectionType = VocalSectionType;
