/** Small, testable Console editing helpers shared by playback and recording. */

export const CLIP_EDGE_FADE_SEC = 0.008;

export type CountInPlan = {
  bpm: number;
  beats: number;
  beatMs: number;
  durationMs: number;
  clickOffsetsMs: number[];
};

/** A tempo-locked count-in. Invalid/missing BPM never invents a tempo. */
export function makeCountInPlan(bpm: number | null | undefined, beats = 4): CountInPlan | null {
  const safeBpm = Number(bpm);
  if (!Number.isFinite(safeBpm) || safeBpm < 30 || safeBpm > 300) return null;
  const safeBeats = Math.max(1, Math.min(8, Math.round(beats)));
  const beatMs = 60_000 / safeBpm;
  return {
    bpm: safeBpm,
    beats: safeBeats,
    beatMs,
    durationMs: beatMs * safeBeats,
    clickOffsetsMs: Array.from({ length: safeBeats }, (_, i) => i * beatMs),
  };
}

/**
 * Equal-power-style short edge ramps (linear gain is sufficient at 8 ms).
 * Every clip gets both ramps, including a clip entered midway through playback.
 */
export function scheduleClipEdgeFades(
  param: AudioParam,
  startSec: number,
  durationSec: number,
  fadeSec = CLIP_EDGE_FADE_SEC
): void {
  const start = Math.max(0, startSec);
  const duration = Math.max(0.001, durationSec);
  const end = start + duration;
  const fade = Math.max(0.001, Math.min(fadeSec, duration / 3));
  param.cancelScheduledValues(start);
  param.setValueAtTime(0, start);
  param.linearRampToValueAtTime(1, start + fade);
  param.setValueAtTime(1, Math.max(start + fade, end - fade));
  param.linearRampToValueAtTime(0, end);
}

export type LyricTimelineLine = {
  text: string;
  startMs: number;
  endMs: number;
  trackId: string;
};

/**
 * Recording instructions contain the section's lyric hint. Divide multi-line hints
 * evenly across that clip so the current words follow the transport without inventing
 * word-level timestamps.
 */
export function buildLyricTimeline(
  layers: Array<{
    id: string;
    startMs: number;
    endMs: number;
    clips?: Array<{ startMs: number; endMs: number }>;
    lyric?: string | null;
  }>
): LyricTimelineLine[] {
  const lines: LyricTimelineLine[] = [];
  for (const layer of layers) {
    const textLines = (layer.lyric || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!textLines.length) continue;
    const regions = layer.clips?.length
      ? layer.clips
      : [{ startMs: layer.startMs, endMs: layer.endMs }];
    for (const region of regions) {
      const start = Math.max(0, region.startMs);
      const end = Math.max(start + 1, region.endMs);
      const lineMs = (end - start) / textLines.length;
      textLines.forEach((text, index) => {
        lines.push({
          text,
          startMs: start + index * lineMs,
          endMs: index === textLines.length - 1 ? end : start + (index + 1) * lineMs,
          trackId: layer.id,
        });
      });
    }
  }
  return lines.sort((a, b) => a.startMs - b.startMs);
}

export function currentLyricLine(
  lines: LyricTimelineLine[],
  positionMs: number
): LyricTimelineLine | null {
  return lines.find((line) => positionMs >= line.startMs && positionMs < line.endMs) || null;
}

export type TakeAssessment = {
  action?: string | null;
  confidence?: number | null;
  clippingDetected?: boolean | null;
  silenceDetected?: boolean | null;
  onsetDeviationMs?: number | null;
};

/** Deterministic ranking for Best take; musical review remains available in the picker. */
export function scoreTakeAssessment(assessment: TakeAssessment | null | undefined): number {
  if (!assessment) return 0;
  const actionScore: Record<string, number> = {
    KEEP: 100,
    TRIM: 72,
    NEEDS_REVIEW: 45,
    ADD_DOUBLE: 60,
    ADD_HARMONY: 60,
    ADD_BACKGROUND: 60,
    ADD_ADLIB: 60,
    RETAKE: 5,
  };
  let score = actionScore[String(assessment.action || "").toUpperCase()] ?? 25;
  score += Math.max(0, Math.min(1, Number(assessment.confidence) || 0)) * 10;
  if (assessment.clippingDetected) score -= 45;
  if (assessment.silenceDetected) score -= 60;
  const deviation = Math.abs(Number(assessment.onsetDeviationMs) || 0);
  score -= Math.min(20, deviation / 100);
  return score;
}
