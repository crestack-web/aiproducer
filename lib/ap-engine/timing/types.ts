import type { VocalRole, SongSectionKind } from "../roles";

export type TimingStatus =
  | "on_time"
  | "early"
  | "late"
  | "intentional_offbeat"
  | "uncertain";

export type TimingAction =
  | "keep"
  | "move_earlier"
  | "move_later"
  | "tighten_to_lead"
  | "preserve_offbeat";

export type TimingProfileId = "natural" | "polished" | "tight" | "creative";

export type PhraseTimingAnalysis = {
  phraseId: string;
  startSample: number;
  endSample: number;
  detectedOnsetSample: number;
  nearestBeatSample: number | null;
  offsetMs: number;
  confidence: number;
  status: TimingStatus;
  vocalEnergy: number;
  attackStrength: number;
  section: SongSectionKind;
  role: VocalRole;
};

export type TimingDecision = {
  phraseId: string;
  action: TimingAction;
  shiftMs: number;
  confidence: number;
  reason: string;
  transitionStrategy: "micro_crossfade" | "none";
};

export type ApTimeResult = {
  pcm: PcmStereoLike;
  decisions: TimingDecision[];
  analyses: PhraseTimingAnalysis[];
  profile: TimingProfileId;
  beatConfidence: number;
  bpmUsed: number | null;
  notes: string[];
};

/** Avoid circular import of full PcmStereo in types-only consumers */
export type PcmStereoLike = {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
};
