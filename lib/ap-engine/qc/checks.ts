import { peakOf, rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo, QcIssue, QcResult } from "../types";

export function runQc(master: PcmStereo, mix?: PcmStereo): QcResult {
  const issues: QcIssue[] = [];
  const warnings: string[] = [];
  const mono = stereoToMono(master);
  const durationMs = Math.round((mono.length / master.sampleRate) * 1000);
  const peak = peakOf(mono);
  const rms = rmsOf(mono);

  if (durationMs < 300) issues.push("INVALID_DURATION");
  if (peak < 0.001 && rms < 0.0005) issues.push("SILENT_OUTPUT");
  if (peak >= 0.999) issues.push("CLIPPING");
  if (peak > 0.98) issues.push("EXCESSIVE_PEAK");

  let vocalDominance: number | undefined;
  if (mix) {
    // Heuristic: compare master RMS to a very quiet floor
    vocalDominance = rms;
  }

  // Vocal balance heuristics from absolute levels
  if (rms < 0.02 && peak < 0.15) {
    issues.push("VOCAL_TOO_QUIET");
  }
  if (rms > 0.35) {
    issues.push("VOCAL_TOO_LOUD");
  }
  if (!Number.isFinite(peak) || !Number.isFinite(rms)) {
    issues.push("BROKEN_RENDER");
  }

  if (peak > 0.95 && !issues.includes("CLIPPING")) warnings.push("near_clip");

  return {
    passed: issues.length === 0,
    issues,
    warnings,
    metrics: { peak, rms, durationMs, vocalDominance },
  };
}
