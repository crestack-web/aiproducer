import { applyGainStereo, dbToGain, peakOf, rmsOf, stereoToMono, limitStereo } from "../dsp";
import type { PcmStereo } from "../types";

/**
 * Loudness normalize using RMS proxy with peak-aware ceiling.
 * Closer to streaming targets than pure RMS push.
 * Not ITU BS.1770 LUFS — honest RMS+peak hybrid for pure TS.
 */
export function normalizeRmsProxy(pcm: PcmStereo, targetRmsDb = -14): void {
  const mono = stereoToMono(pcm);
  const r = rmsOf(mono);
  if (r < 1e-9) return;
  const currentDb = 20 * Math.log10(r);
  let delta = targetRmsDb - currentDb;
  // Peak guard: don't boost into clip
  const peak = Math.max(peakOf(pcm.left), peakOf(pcm.right));
  if (peak > 1e-9) {
    const headroomDb = 20 * Math.log10(0.95 / peak);
    if (delta > headroomDb) delta = headroomDb;
  }
  const g = dbToGain(Math.max(-10, Math.min(10, delta)));
  applyGainStereo(pcm, g);
}

/**
 * Estimate integrated loudness proxy (dB) — for logging / QC.
 */
export function estimateLoudnessProxyDb(pcm: PcmStereo): number {
  const r = rmsOf(stereoToMono(pcm));
  if (r < 1e-12) return -120;
  return 20 * Math.log10(r);
}

/**
 * True-peak style limiter: slight oversample peak estimate + limit.
 * Pure TS approximation (2x linear interp peak hold).
 */
export function truePeakLimit(pcm: PcmStereo, ceilingDb = -1, marginDb = 0.5): void {
  const ceil = dbToGain(ceilingDb - Math.max(0, marginDb));
  // First pass: find inter-sample peaks via linear midpoints
  let tp = 0;
  const n = pcm.left.length;
  for (let i = 0; i < n - 1; i++) {
    const l0 = Math.abs(pcm.left[i] || 0);
    const l1 = Math.abs(pcm.left[i + 1] || 0);
    const r0 = Math.abs(pcm.right[i] || 0);
    const r1 = Math.abs(pcm.right[i + 1] || 0);
    tp = Math.max(tp, l0, l1, r0, r1, (l0 + l1) * 0.5, (r0 + r1) * 0.5);
  }
  if (tp > ceil && tp > 1e-9) {
    applyGainStereo(pcm, ceil / tp);
  }
  limitStereo(pcm, ceilingDb);
}
