export type PipelineMode = "mock" | "roex";

export type StemKind =
  | "INSTRUMENTAL"
  | "LEAD"
  | "DOUBLE"
  | "HARMONY"
  | "ADLIBS"
  | "BACKGROUND"
  | "OTHER";

export type ArrangementPlacement = {
  recording_id: string;
  task_id: string;
  stem_kind: StemKind;
  start_ms: number;
  end_ms: number;
  gain_db: number;
};

export type MixTrackInput = {
  path: string;
  kind: StemKind;
  instrumentGroup: string;
  presenceSetting: "LEAD" | "NORMAL" | "BACKGROUND";
  panPreference: "CENTRE" | "LEFT" | "RIGHT";
  reverbPreference: "NONE" | "LOW" | "MEDIUM" | "HIGH";
};

export type MixResult = {
  provider_task_id: string;
  preview: boolean;
  download_url?: string;
  local_path?: string;
  metadata?: Record<string, unknown>;
};

export type MasterResult = {
  provider_task_id: string;
  preview: boolean;
  download_url?: string;
  local_path?: string;
  metadata?: Record<string, unknown>;
};

export type MixAnalysis = {
  status: "pass" | "fail" | "needs_review";
  metrics: Record<string, unknown>;
  notes?: string;
};

export interface AudioMixProvider {
  readonly name: string;
  uploadStem(localOrBuffer: Buffer, filename: string, contentType: string): Promise<{ readableUrl: string }>;
  startMix(tracks: MixTrackInput[], opts: {
    musicalStyle: string;
    preview: boolean;
    webhookUrl?: string;
    sampleRate?: number;
  }): Promise<MixResult>;
  retrieveMix(providerTaskId: string): Promise<MixResult>;
  analyzeMix(audioUrl: string, opts: { musicalStyle: string; isMaster: boolean }): Promise<MixAnalysis>;
  startMaster(mixUrl: string, opts: {
    musicalStyle: string;
    desiredLoudness: "LOW" | "MEDIUM" | "HIGH";
    preview: boolean;
    webhookUrl?: string;
  }): Promise<MasterResult>;
  retrieveMaster(providerTaskId: string): Promise<MasterResult>;
}
