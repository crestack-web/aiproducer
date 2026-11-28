import { applyGainStereo, dbToGain, peakOf, rmsOf, stereoToMono, limitStereo, cloneStereo } from "../dsp";
import type { PcmStereo } from "../types";
import { measureIntegratedLufs, truePeakLinear } from "./lufs";

/**
 * Integrated loudness in LUFS (ITU-R BS.1770-4, gated).
 * Name kept for existing callers; this is now a real LUFS measurement, not an RMS proxy.
 */
export function estimateLoudnessProxyDb(pcm: PcmStereo): number {
  return measureIntegratedLufs(pcm);
}

function truePeakApprox(pcm: PcmStereo): number {
  return truePeakLinear(pcm);
}

/**
 * True-peak limiter: lookahead limiting toward the ceiling, then a final
 * 4x-oversampled true-peak check so nothing exceeds the ceiling after encoding.
 */
export function truePeakLimit(pcm: PcmStereo, ceilingDb = -1, marginDb = 0.5): void {
  const target = ceilingDb - Math.max(0, marginDb * 0.25);
  limitStereo(pcm, target);
  const ceil = dbToGain(ceilingDb);
  const tp = truePeakLinear(pcm);
  if (tp > ceil && tp > 1e-9) {
    applyGainStereo(pcm, ceil / tp);
  }
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
  // Measured in real LUFS. Clamp to a sane streaming range: louder than -8 only adds
  // distortion (platforms turn it down), quieter than -14 sounds weak next to releases.
  const target = Math.max(-14, Math.min(-8, Number.isFinite(targetLufs) ? targetLufs : -11));
  const beforeDb = measureIntegratedLufs(pcm);
  let totalGainDb = 0;
  let passes = 0;
  const maxPasses = 5;
  const maxTotalBoostDb = 14;

  for (let i = 0; i < maxPasses; i++) {
    const cur = i === 0 ? beforeDb : measureIntegratedLufs(pcm);
    if (cur <= -69) break; // silence
    const err = target - cur;
    if (Math.abs(err) < 0.3) break;
    let step = Math.max(-8, Math.min(8, err));
    if (totalGainDb + step > maxTotalBoostDb) step = maxTotalBoostDb - totalGainDb;
    if (Math.abs(step) < 0.1) break;
    applyGainStereo(pcm, dbToGain(step));
    totalGainDb += step;
    truePeakLimit(pcm, ceilingDb, marginDb);
    passes++;
  }

  truePeakLimit(pcm, ceilingDb, marginDb);

  return {
    beforeDb,
    afterDb: measureIntegratedLufs(pcm),
    targetDb: target,
    passes,
    totalGainDb,
  };
}
