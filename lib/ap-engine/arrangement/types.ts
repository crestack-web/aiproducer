/**
 * AP Vocal Arrangement Mind — Phase 1 types
 * Section map + treatment plan for a continuous vocal take.
 */

export type SectionType =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "bridge"
  | "outro";

export type VocalSection = {
  startMs: number;
  endMs: number;
  type: SectionType;
  energy: number;
  vocalDensity: number;
  confidence: number;
};

/** 0–1 scales unless noted */
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

export type ArrangementPlan = {
  sections: VocalSection[];
  treatments: VocalTreatment[];
  bpm: number | null;
  method: string;
};
