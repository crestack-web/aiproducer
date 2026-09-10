/**
 * AP Vocal Polish — pitch / performance types.
 */
export type CorrectionProfile = "natural" | "polished" | "tight" | "creative";

export type PitchFrame = {
  time: number;
  frequencyHz: number | null;
  midiNote: number | null;
  confidence: number;
  voiced: boolean;
};

export type DetectedNote = {
  startTime: number;
  endTime: number;
  frequencyHz: number;
  midiNote: number;
  confidence: number;
  pitchDeviationCents: number;
  pitchStability: number;
  hasVibrato: boolean;
  isSlide: boolean;
  frameCount: number;
};

export type NotePitchDecision = {
  noteIndex: number;
  targetMidiNote: number | null;
  correctionCents: number;
  correctionStrength: number;
  preserveVibrato: boolean;
  preserveSlide: boolean;
  confidence: number;
  reason: string;
  skip: boolean;
};

export type VocalPolishDecision = {
  enabled: boolean;
  correctionProfile: CorrectionProfile;
  correctionStrength: number;
  preserveSlides: boolean;
  preserveVibrato: boolean;
  timingTightness: number;
  formantPreservation: boolean;
  confidenceThreshold: number;
  maxCorrectionCents: number;
  keyMidiRoot: number | null;
  scale: "major" | "minor" | "chromatic";
  notes: string[];
};

export type PitchQC = {
  analyzedFrames: number;
  voicedFrames: number;
  correctedFrames: number;
  averageCorrectionCents: number;
  maxCorrectionCents: number;
  pitchStabilityBefore: number;
  pitchStabilityAfter: number;
  lowConfidenceRatio: number;
  artifactRisk: number;
  notesDetected: number;
  notesCorrected: number;
  skippedLowConfidence: boolean;
  usedFallback: boolean;
};

export type PitchAnalysisResult = {
  frames: PitchFrame[];
  notes: DetectedNote[];
  keyMidiRoot: number | null;
  scale: "major" | "minor" | "chromatic";
  voicedRatio: number;
  meanConfidence: number;
  meanStability: number;
  likelySpoken: boolean;
};

export type PolishResult = {
  pcm: import("../types").PcmStereo;
  analysis: PitchAnalysisResult;
  decision: VocalPolishDecision;
  noteDecisions: NotePitchDecision[];
  qc: PitchQC;
  applied: boolean;
};
