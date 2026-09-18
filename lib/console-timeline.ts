/**
 * Pure Console timeline math — single source of truth for placement / clip geometry.
 * Browser-free so scripts/test-console-timeline.mjs can verify without Web Audio.
 */

/** Project timeline placement for a take (ms from song start). */
export function resolveClipStartMs(input: {
  sectionStartMs?: number | null;
  recordingOffsetMs?: number | null;
  timelineStartMs?: number | null;
  placementStartMs?: number | null;
}): number {
  if (typeof input.placementStartMs === "number" && Number.isFinite(input.placementStartMs)) {
    return Math.max(0, Math.round(input.placementStartMs));
  }
  if (typeof input.timelineStartMs === "number" && Number.isFinite(input.timelineStartMs)) {
    return Math.max(0, Math.round(input.timelineStartMs));
  }
  const section =
    typeof input.sectionStartMs === "number" && Number.isFinite(input.sectionStartMs)
      ? Math.round(input.sectionStartMs)
      : 0;
  const offset =
    typeof input.recordingOffsetMs === "number" && Number.isFinite(input.recordingOffsetMs)
      ? Math.round(input.recordingOffsetMs)
      : 0;
  return Math.max(0, section + offset);
}

/**
 * Clip end on the project timeline.
 * Prefer decoded audio duration so waveform width matches what is heard.
 */
export function resolveClipEndMs(input: {
  startMs: number;
  decodedDurationMs?: number | null;
  planEndMs?: number | null;
  minDurationMs?: number;
}): number {
  const start = Math.max(0, Math.round(input.startMs));
  if (typeof input.decodedDurationMs === "number" && input.decodedDurationMs > 0) {
    return start + Math.round(input.decodedDurationMs);
  }
  const minD = input.minDurationMs ?? 500;
  if (typeof input.planEndMs === "number" && Number.isFinite(input.planEndMs)) {
    return Math.max(start + minD, Math.round(input.planEndMs));
  }
  return start + minD;
}

/** Buffer offset (seconds) when project timeline is at timelineMs. */
export function timelineToSourceOffsetSec(
  timelineMs: number,
  clipStartMs: number
): number {
  return (timelineMs - clipStartMs) / 1000;
}

/** Whether the playhead is inside the clip's audible range. */
export function isPlayheadInClip(
  timelineMs: number,
  clipStartMs: number,
  decodedDurationMs: number
): boolean {
  const local = timelineMs - clipStartMs;
  return local >= 0 && local < decodedDurationMs;
}

/**
 * Playhead from Web Audio transport.
 * timelineMs = (context.currentTime - startedAt) * 1000 + offsetMs
 */
export function playheadFromAudioContext(input: {
  contextCurrentTime: number;
  startedAt: number;
  offsetMs: number;
  totalMs: number;
}): number {
  const elapsed =
    (input.contextCurrentTime - input.startedAt) * 1000 + input.offsetMs;
  return Math.min(input.totalMs, Math.max(0, elapsed));
}

/** Playhead when only HTMLAudioElement is driving the beat. */
export function playheadFromHtmlAudio(currentTimeSec: number, totalMs: number): number {
  return Math.min(totalMs, Math.max(0, currentTimeSec * 1000));
}

/**
 * Soft peak gain for display — boosts quiet takes without turning silence into solid bars.
 * Matches Console WaveformCanvas: 1 / max(peakMax, 0.12)
 */
export function softPeakNorm(peakMax: number): number {
  if (!(peakMax > 1e-4)) return 1;
  return 1 / Math.max(peakMax, 0.12);
}

/**
 * Bucket max-abs peaks from planar channel arrays (test double for AudioBuffer).
 * Combines channels via max abs so stereo isn't under-read from channel 0 alone.
 */
export function computePeaksFromChannels(
  channels: Float32Array[],
  buckets: number
): Float32Array {
  const n = channels[0]?.length || 0;
  const peaks = new Float32Array(Math.max(1, buckets));
  if (!n || !channels.length) return peaks;
  const block = Math.max(1, Math.floor(n / peaks.length));
  for (let i = 0; i < peaks.length; i++) {
    let max = 0;
    const start = i * block;
    const end = Math.min(n, start + block);
    for (let j = start; j < end; j++) {
      for (const ch of channels) {
        const v = Math.abs(ch[j] || 0);
        if (v > max) max = v;
      }
    }
    peaks[i] = max;
  }
  return peaks;
}
