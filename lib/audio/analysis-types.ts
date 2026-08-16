/**
 * Structured evidence from the Audio Analysis layer.
 * Measurements the current pure-TS stack cannot compute must be null — never invented.
 */

export const ANALYZER_VERSION = "v1-pcm-energy";

export type AudioAnalysisQuality = {
  clippingDetected: boolean | null;
  silenceDetected: boolean | null;
  leadingSilenceMs: number | null;
  trailingSilenceMs: number | null;
};

export type AudioAnalysisLoudness = {
  /** Linear RMS of mono samples (0–1 scale), not dB. */
  rms: number | null;
  /** Peak absolute sample. */
  peak: number | null;
  /** Not available without K-weighting / true LUFS meter → always null in v1. */
  integratedLufs: null;
};

export type AudioAnalysisPitch = {
  available: boolean;
  medianHz: number | null;
  minHz: number | null;
  maxHz: number | null;
  confidence: number | null;
};

export type AudioAnalysisTiming = {
  /** First strong energy onset vs sample start (ms). */
  onsetMs: number | null;
  /** onsetMs relative to ideal (0) — simple proxy for late/early start. */
  onsetDeviationMs: number | null;
  confidence: number | null;
};

export type AudioAnalysisTimeline = {
  startTimeMs: number | null;
  endTimeMs: number | null;
  expectedDurationMs: number | null;
  actualDurationMs: number | null;
};

export type AudioAnalysis = {
  recordingId: string | null;
  projectId: string | null;
  sectionId: string | null;
  role: string | null;

  durationMs: number | null;
  sampleRate: number | null;
  channels: number | null;

  timeline: AudioAnalysisTimeline;
  quality: AudioAnalysisQuality;
  loudness: AudioAnalysisLoudness;
  pitch: AudioAnalysisPitch;
  timing: AudioAnalysisTiming;

  analyzerVersion: string;
  method: "pcm_energy_v1" | "metadata_only_v1";
  createdAt: string;
};

/** Production-facing action labels (Mistral chooses; does not invent numbers). */
export type ProducerAction =
  | "KEEP"
  | "RETAKE"
  | "TRIM"
  | "ADD_DOUBLE"
  | "ADD_HARMONY"
  | "ADD_BACKGROUND"
  | "ADD_ADLIB"
  | "NEEDS_REVIEW";

export type ProducerRecommendation = {
  action: ProducerAction;
  message: string;
  targetSectionLabel?: string | null;
  targetRole?: string | null;
  confidence?: number | null;
};
