/**
 * Live recording path — architecture contract (client).
 *
 * Heavy AP (restoration, Producer Mind, fullness, pitch polish, master)
 * MUST NOT run during capture. Those run offline after the take is saved.
 *
 * @see docs/realtime-recording-pipeline.md
 */

/** Tags attached when a take is saved so offline pipeline can place/comp. */
export type LiveTakeTags = {
  taskId: string;
  sectionLabel?: string | null;
  /** Canonical beat position for vocal t=0 (ms) */
  placementStartMs: number;
  sectionStartMs: number;
  recordingOffsetMs?: number;
  takeNumber?: number;
};

export type LiveRecordingPolicy = {
  /** Never feed beat audio into MediaRecorder */
  isolateCaptureFromReference: true;
  /** Prefer unprocessed monitoring (platform-dependent) */
  preferDirectMonitor: true;
  /** Offline pipeline entry only after stop + upload */
  deferApUntilOffline: true;
  /** Target perceived monitor latency (aspirational; platform-limited) */
  monitorLatencyTargetMs: 15;
};

export const LIVE_RECORDING_POLICY: LiveRecordingPolicy = {
  isolateCaptureFromReference: true,
  preferDirectMonitor: true,
  deferApUntilOffline: true,
  monitorLatencyTargetMs: 15,
};

/**
 * Build form fields / metadata for POST recordings so offline placement works.
 */
export function liveTakeMetadata(tags: LiveTakeTags): Record<string, string> {
  return {
    placement_start_ms: String(Math.round(tags.placementStartMs)),
    section_start_ms: String(Math.round(tags.sectionStartMs)),
    recording_offset_ms: String(Math.round(tags.recordingOffsetMs ?? 0)),
    ...(tags.sectionLabel ? { section_label: tags.sectionLabel } : {}),
    ...(tags.takeNumber != null ? { take_number: String(tags.takeNumber) } : {}),
  };
}

/** Guard: AP stages that must never be invoked from the record hot path. */
export const OFFLINE_ONLY_STAGES = [
  "restoration_front_end",
  "transcription",
  "producer_mind",
  "fullness",
  "pitch_polish",
  "mix",
  "master",
] as const;
