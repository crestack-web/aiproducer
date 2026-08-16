/**
 * Canonical session timeline — single source of truth for WHEN audio happens.
 *
 * CUSTOMIZED PLAN decides WHAT to record (task selection).
 * CANONICAL BEAT TIMELINE (task.start_ms / end_ms) decides musical position.
 * SESSION TIMELINE measures the relationship between musical time, beat playback,
 * and MediaRecorder capture.
 *
 * OFFSET CONVENTION (documented once, used everywhere):
 *   recordingOffsetMs = actualRecorderStartMs - expectedMusicalStartMs
 *
 *   Positive offset  → recorder started AFTER the musical section start
 *                      → vocal file t=0 is "late" on the song timeline.
 *   Negative offset  → recorder started BEFORE the musical section start
 *                      → vocal file contains pre-roll before musical content.
 *
 * Placement on full-song timeline for produce:
 *   placementStartMs = sectionStartMs + recordingOffsetMs
 *   (vocal file sample 0 maps to placementStartMs on the song clock)
 *
 * Review (beat + vocal):
 *   vocal plays from file time 0
 *   beat seeks to (sectionStartMs - recordingOffsetMs)
 *   so musical alignment matches produce.
 */

export const DEFAULT_COUNT_IN_MS = 3000;
export const DEFAULT_PRE_ROLL_MS = 3000;

export type SessionTimeline = {
  taskId: string;
  sectionStartMs: number;
  sectionEndMs: number | null;
  sectionDurationMs: number | null;

  countInMs: number;
  preRollMs: number;

  /** Monotonic marks (performance.now()) */
  sessionInitAt: number;
  countdownStartAt: number | null;
  expectedMusicalStartAt: number | null;
  actualBeatStartAt: number | null;
  actualRecordingStartAt: number | null;
  stoppedAt: number | null;

  /**
   * recordingOffsetMs = actualRecordingStartAt - expectedMusicalStartAt
   */
  recordingOffsetMs: number;
  beatOffsetMs: number;

  recordedDurationMs: number | null;

  audioContextAtBeatStart: number | null;
  audioContextAtRecordStart: number | null;
};

export type SessionTimelineInit = {
  taskId: string;
  sectionStartMs: number;
  sectionEndMs?: number | null;
  countInMs?: number;
  preRollMs?: number;
};

export function createSessionTimeline(init: SessionTimelineInit): SessionTimeline {
  const sectionStartMs = Math.max(0, Math.floor(Number(init.sectionStartMs) || 0));
  const sectionEndMs =
    init.sectionEndMs != null && Number.isFinite(Number(init.sectionEndMs))
      ? Math.floor(Number(init.sectionEndMs))
      : null;
  const sectionDurationMs =
    sectionEndMs != null && sectionEndMs > sectionStartMs ? sectionEndMs - sectionStartMs : null;

  return {
    taskId: init.taskId,
    sectionStartMs,
    sectionEndMs,
    sectionDurationMs,
    countInMs: init.countInMs ?? DEFAULT_COUNT_IN_MS,
    preRollMs: init.preRollMs ?? DEFAULT_PRE_ROLL_MS,
    sessionInitAt: performance.now(),
    countdownStartAt: null,
    expectedMusicalStartAt: null,
    actualBeatStartAt: null,
    actualRecordingStartAt: null,
    stoppedAt: null,
    recordingOffsetMs: 0,
    beatOffsetMs: 0,
    recordedDurationMs: null,
    audioContextAtBeatStart: null,
    audioContextAtRecordStart: null,
  };
}

export function markCountdownStart(tl: SessionTimeline, now = performance.now()): SessionTimeline {
  return {
    ...tl,
    countdownStartAt: now,
    expectedMusicalStartAt: now + tl.countInMs,
  };
}

export function markBeatStart(
  tl: SessionTimeline,
  opts?: { now?: number; audioContextTime?: number | null }
): SessionTimeline {
  const now = opts?.now ?? performance.now();
  const expected = tl.expectedMusicalStartAt ?? now;
  return {
    ...tl,
    actualBeatStartAt: now,
    beatOffsetMs: Math.round(now - expected),
    audioContextAtBeatStart:
      typeof opts?.audioContextTime === "number" ? opts.audioContextTime : tl.audioContextAtBeatStart,
  };
}

export function markRecordingStart(
  tl: SessionTimeline,
  opts?: { now?: number; audioContextTime?: number | null }
): SessionTimeline {
  const now = opts?.now ?? performance.now();
  const expected = tl.expectedMusicalStartAt ?? now;
  const recordingOffsetMs = Math.round(now - expected);
  return {
    ...tl,
    actualRecordingStartAt: now,
    recordingOffsetMs,
    audioContextAtRecordStart:
      typeof opts?.audioContextTime === "number"
        ? opts.audioContextTime
        : tl.audioContextAtRecordStart,
  };
}

export function markRecordingStop(
  tl: SessionTimeline,
  opts?: { now?: number }
): SessionTimeline {
  const now = opts?.now ?? performance.now();
  const start = tl.actualRecordingStartAt ?? tl.sessionInitAt;
  return {
    ...tl,
    stoppedAt: now,
    recordedDurationMs: Math.max(0, Math.round(now - start)),
  };
}

/**
 * Full-song placement for produce / timeline-stem.
 * Vocal file sample 0 maps to placementStartMs on the song timeline.
 */
export function placementStartMs(
  tl: Pick<SessionTimeline, "sectionStartMs" | "recordingOffsetMs">
): number {
  return Math.max(0, Math.round(tl.sectionStartMs + tl.recordingOffsetMs));
}

/** Review beat seek so vocal file t=0 aligns with music. */
export function reviewBeatStartMs(sectionStartMs: number, recordingOffsetMs: number): number {
  return Math.max(0, Math.round(sectionStartMs - recordingOffsetMs));
}

export function reviewVocalDelayMs(recordingOffsetMs: number): number {
  return Math.max(0, Math.round(-recordingOffsetMs));
}

export function sessionTimelineToMeta(tl: SessionTimeline): Record<string, unknown> {
  return {
    session_timeline: {
      task_id: tl.taskId,
      section_start_ms: tl.sectionStartMs,
      section_end_ms: tl.sectionEndMs,
      section_duration_ms: tl.sectionDurationMs,
      count_in_ms: tl.countInMs,
      pre_roll_ms: tl.preRollMs,
      recording_offset_ms: tl.recordingOffsetMs,
      beat_offset_ms: tl.beatOffsetMs,
      recorded_duration_ms: tl.recordedDurationMs,
      placement_start_ms: placementStartMs(tl),
      expected_musical_start_at: tl.expectedMusicalStartAt,
      actual_beat_start_at: tl.actualBeatStartAt,
      actual_recording_start_at: tl.actualRecordingStartAt,
      stopped_at: tl.stoppedAt,
    },
  };
}

export function formatTimelineReport(tl: SessionTimeline): string {
  const lines = [
    `TASK:                ${tl.taskId}`,
    `SECTION:             ${tl.sectionStartMs}ms → ${tl.sectionEndMs ?? "—"}ms`,
    `COUNT-IN:            ${tl.countInMs}ms`,
    `EXPECTED MUSICAL:    ${tl.expectedMusicalStartAt != null ? Math.round(tl.expectedMusicalStartAt) : "—"}`,
    `ACTUAL BEAT START:   ${tl.actualBeatStartAt != null ? Math.round(tl.actualBeatStartAt) : "—"}`,
    `ACTUAL RECORDER:     ${tl.actualRecordingStartAt != null ? Math.round(tl.actualRecordingStartAt) : "—"}`,
    `RECORDING OFFSET:    ${tl.recordingOffsetMs}ms  (recorder - expected)`,
    `BEAT OFFSET:         ${tl.beatOffsetMs}ms`,
    `PLACEMENT START:     ${placementStartMs(tl)}ms`,
    `RECORDED DURATION:   ${tl.recordedDurationMs ?? "—"}ms`,
  ];
  return lines.join("\n");
}

export type CaptureDiagnostics = {
  inputDeviceId?: string;
  inputLabel?: string;
  outputPreference?: string;
  headphonesMonitoring?: boolean;
  constraintsMode?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  sampleRate?: number;
  channelCount?: number;
  mimeType?: string;
  peak?: number | null;
  rms?: number | null;
  clippingCount?: number | null;
  conversionSampleRate?: number | null;
  conversionMethod?: string | null;
  originalMimeType?: string | null;
  originalBytes?: number | null;
  wavBytes?: number | null;
};

export function logSessionDiagnostics(
  tl: SessionTimeline,
  capture?: CaptureDiagnostics,
  label = "session"
): void {
  if (typeof window === "undefined") return;
  try {
    const enabled =
      process.env.NODE_ENV === "development" ||
      (typeof localStorage !== "undefined" && localStorage.getItem("studio_debug_audio") === "1");
    if (!enabled) return;
    // eslint-disable-next-line no-console
    console.info(`[studio-audio:${label}]\n${formatTimelineReport(tl)}`, capture || {});
  } catch {
    /* ignore */
  }
}
