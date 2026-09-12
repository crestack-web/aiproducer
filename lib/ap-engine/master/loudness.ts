import { applyGainStereo, dbToGain, peakOf, rmsOf, stereoToMono, limitStereo, cloneStereo } from "../dsp";
import type { PcmStereo } from "../types";

/**
 * Estimate integrated loudness proxy (dB) — RMS of mono.
 * Not ITU BS.1770 LUFS, but correlates enough for gain staging in pure TS.
 */
export function estimateLoudnessProxyDb(pcm: PcmStereo): number {
  const r = rmsOf(stereoToMono(pcm));
  if (r < 1e-12) return -120;
  return 20 * Math.log10(r);
}

function truePeakApprox(pcm: PcmStereo): number {
  let tp = 0;
  const n = pcm.left.length;
  for (let i = 0; i < n - 1; i++) {
    const l0 = Math.abs(pcm.left[i] || 0);
    const l1 = Math.abs(pcm.left[i + 1] || 0);
    const r0 = Math.abs(pcm.right[i] || 0);
    const r1 = Math.abs(pcm.right[i + 1] || 0);
    tp = Math.max(tp, l0, l1, r0, r1, (l0 + l1) * 0.5, (r0 + r1) * 0.5);
  }
  return tp;
}

/**
 * True-peak style limiter: inter-sample peak estimate + sample limit.
 */
export function truePeakLimit(pcm: PcmStereo, ceilingDb = -1, marginDb = 0.5): void {
  const ceil = dbToGain(ceilingDb - Math.max(0, marginDb * 0.25));
  const tp = truePeakApprox(pcm);
  if (tp > ceil && tp > 1e-9) {
    applyGainStereo(pcm, ceil / tp);
  }
  limitStereo(pcm, ceilingDb);
}

/**
 * Single-pass RMS normalize with peak headroom guard.
 * Allows up to ±18 dB so quiet mixes can reach streaming levels.
 */
export function normalizeRmsProxy(pcm: PcmStereo, targetRmsDb = -14): void {
  const mono = stereoToMono(pcm);
  const r = rmsOf(mono);
  if (r < 1e-9) return;
  const currentDb = 20 * Math.log10(r);
  let delta = targetRmsDb - currentDb;
  const peak = Math.max(peakOf(pcm.left), peakOf(pcm.right), truePeakApprox(pcm));
  if (peak > 1e-9) {
    // Leave ~1.2 dB for the limiter to work, not 0.95 hard stop
    const headroomDb = 20 * Math.log10(0.88 / peak);
    if (delta > headroomDb && headroomDb > 0) {
      // Take available headroom; limiter pass will catch peaks after iterative boost
      delta = Math.min(delta, Math.max(headroomDb, 6));
    }
  }
  const g = dbToGain(Math.max(-12, Math.min(18, delta)));
  applyGainStereo(pcm, g);
}

export type LoudnessNormalizeResult = {
  beforeDb: number;
  afterDb: number;
  targetDb: number;
  passes: number;
  totalGainDb: number;
};

/**
 * Multi-pass: boost toward target → true-peak limit → remeasure.
 * Designed so a −21 LUFS-ish mix can reach ~−12 to −14 without clipping.
 *
 * targetLufs is the profile streaming target. We map it to an RMS proxy
 * a bit hotter than the LUFS number (music crest) so measured platforms
 * land near the intended integrated range.
 */
export function normalizeToStreamingTarget(
  pcm: PcmStereo,
  targetLufs: number,
  ceilingDb = -1.0,
  marginDb = 0.35
): LoudnessNormalizeResult {
  // RMS proxy vs integrated LUFS: for dense pop/R&B, RMS is often ~1–3 dB
  // hotter than LUFS. Aim RMS slightly above targetLufs so final feels competitive.
  const targetRmsDb = targetLufs + 1.2;
  const beforeDb = estimateLoudnessProxyDb(pcm);
  let totalGainDb = 0;
  let passes = 0;
  const maxPasses = 5;

  for (let i = 0; i < maxPasses; i++) {
    const cur = estimateLoudnessProxyDb(pcm);
    const err = targetRmsDb - cur;
    if (Math.abs(err) < 0.6) break;
    // Progressive boost: don't dump full delta in one go (limiter sounds better)
    const step = Math.max(-6, Math.min(8, err * (i === 0 ? 0.85 : 0.7)));
    if (Math.abs(step) < 0.25) break;
    applyGainStereo(pcm, dbToGain(step));
    totalGainDb += step;
    truePeakLimit(pcm, ceilingDb, marginDb);
    passes++;
  }

  // Final ceiling enforce
  truePeakLimit(pcm, ceilingDb, marginDb);

  return {
    beforeDb,
    afterDb: estimateLoudnessProxyDb(pcm),
    targetDb: targetRmsDb,
    passes,
    totalGainDb,
  };
}
