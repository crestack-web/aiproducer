/**
 * AP Audio Production Engine — shared types (Phase 1)
 */

export const AP_ENGINE_VERSION = "1.8.0-vocal-edit";

export type ApStage =
  | "queued"
  | "analyzing"
  | "restoring"
  | "polishing"
  | "producing"
  | "mixing"
  | "mastering"
  | "quality_check"
  | "completed"
  | "failed";

export type StageReporter = (stage: ApStage, meta?: Record<string, unknown>) => Promise<void> | void;

export type BandEnergies = {
  low: number; // ~20–250 Hz relative energy 0–1
  mid: number; // ~250–4k
  high: number; // ~4k–nyquist
};

export type VocalCharacter = {
  mud: number;
  box: number;
  nasal: number;
  harsh: number;
  air: number;
  thin: number;
  presence: number;
};

export type VocalAnalysis = {
  durationMs: number;
  sampleRate: number;
  channels: number;
  rms: number;
  peak: number;
  crest: number | null;
  clippingRatio: number;
  noiseFloor: number | null;
  silenceRatio: number;
  bands: BandEnergies;
  /** Fine spectral character 0–1 — drives per-voice EQ */
  character?: VocalCharacter;
};

export type BeatAnalysis = {
  durationMs: number;
  sampleRate: number;
  channels: number;
  rms: number;
  peak: number;
  crest: number | null;
  bands: BandEnergies;
  bpm: number | null;
};

export type CombinedAnalysis = {
  vocal: VocalAnalysis;
  beat: BeatAnalysis;
};

export type EqBand = {
  type: "highpass" | "lowpass" | "peak" | "lowshelf" | "highshelf";
  freq: number;
  gainDb?: number;
  q?: number;
};

export type CompressorParams = {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  makeupDb: number;
};

export type VocalDecision = {
  highPassHz: number;
  gateThresholdDb: number;
  eq: EqBand[];
  compressor: CompressorParams;
  deEsserAmount: number; // 0–1
  saturation: number; // 0–1
  gainDb: number;
  reverbSend: number; // 0–1 wet
  delaySend: number; // 0–1
};

export type MixDecision = {
  vocalGainDb: number;
  beatGainDb: number;
  vocalPan: number; // -1..1
  duckDb: number;
  beatPresenceCutDb: number; // legacy single presence dip
  /** Multi-band beat cuts under vocal (Hz → dB cut, positive = cut) */
  beatMaskBands?: { freq: number; gainDb: number; q: number }[];
  /** Focus duck in mid band (0 = broadband, 1 = mid-focused) */
  duckMidFocus?: number;
};

export type MasterDecision = {
  eq: EqBand[];
  compressor: CompressorParams | null;
  limiterCeilingDb: number;
  targetLufs: number;
  makeupDb: number;
  /** True-peak style ceiling headroom (dB below sample peak target) */
  truePeakMarginDb?: number;
};

export type ProductionDecision = {
  genre: string;
  vocal: VocalDecision;
  mix: MixDecision;
  master: MasterDecision;
  notes: string[];
};

export type QcIssue =
  | "SILENT_OUTPUT"
  | "INVALID_DURATION"
  | "CLIPPING"
  | "EXCESSIVE_PEAK"
  | "VOCAL_TOO_QUIET"
  | "VOCAL_TOO_LOUD"
  | "BROKEN_RENDER";

export type QcResult = {
  passed: boolean;
  issues: QcIssue[];
  warnings: string[];
  metrics: {
    peak: number;
    rms: number;
    durationMs: number;
    vocalDominance?: number;
  };
};

export type PcmStereo = {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
};

export type ApProduceInput = {
  jobId: string;
  projectId: string;
  userId: string;
  vocalBuffer: Buffer;
  beatBuffer: Buffer;
  vocalPathHint?: string;
  beatPathHint?: string;
  genre?: string | null;
  songDurationMs?: number | null;
  vocalStartMs?: number | null;
};

export type ApStageArtifact = {
  stage: string;
  path?: string;
  bytes?: number;
};

export type ApProduceResult = {
  ok: true;
  masterWav: Buffer;
  masterMp3: Buffer | null;
  mixWav: Buffer;
  processedVocalWav: Buffer;
  restoredVocalWav: Buffer;
  decision: ProductionDecision;
  analysis: CombinedAnalysis;
  qc: QcResult;
  retryCount: number;
  durationMs: number;
  engineVersion: string;
};

export type ApProduceFailure = {
  ok: false;
  stage: ApStage;
  error: string;
  detail?: string;
  engineVersion: string;
};
