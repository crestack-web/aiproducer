/**
 * Mix-bus glue — makes vocal + beat feel like one record, not freestyle over a loop.
 */
import {
  applyGainStereo,
  cloneStereo,
  compressStereo,
  dbToGain,
  limitStereo,
  peakOf,
  rmsOf,
  stereoToMono,
  addReverbStereo,
  applyBiquadInPlace,
} from "../dsp";
import type { PcmStereo } from "../types";

/**
 * Parallel bus compression: blend compressed copy under the dry sum.
 * Classic “glue” so elements share dynamics.
 */
export function parallelBusGlue(mix: PcmStereo, amount = 0.35): PcmStereo {
  const out = cloneStereo(mix);
  const wet = cloneStereo(mix);
  compressStereo(wet, {
    thresholdDb: -18,
    ratio: 3.2,
    attackMs: 8,
    releaseMs: 120,
    makeupDb: 3.5,
  });
  const a = Math.max(0, Math.min(0.7, amount));
  const dry = 1 - a * 0.55;
  for (let i = 0; i < out.left.length; i++) {
    out.left[i] = (out.left[i] || 0) * dry + (wet.left[i] || 0) * a;
    out.right[i] = (out.right[i] || 0) * dry + (wet.right[i] || 0) * a;
  }
  return out;
}

/**
 * Shared short room on the full mix — tiny amount so vocal and beat share space.
 * This is the main “sits in the track” cue listeners hear.
 */
export function sharedRoom(mix: PcmStereo, wet = 0.12): PcmStereo {
  if (wet < 0.02) return mix;
  const out = cloneStereo(mix);
  addReverbStereo(out, Math.min(0.22, wet));
  return out;
}

/**
 * Soft stereo mid-side blend: pull vocal-like mids slightly toward center
 * while keeping beat width — reduces “voice floating beside the beat”.
 */
export function centerMidGlue(mix: PcmStereo, amount = 0.25): PcmStereo {
  const out = cloneStereo(mix);
  const a = Math.max(0, Math.min(0.5, amount));
  for (let i = 0; i < out.left.length; i++) {
    const L = out.left[i] || 0;
    const R = out.right[i] || 0;
    const mid = (L + R) * 0.5;
    const side = (L - R) * 0.5;
    // Compress side a bit so image locks
    const sideG = 1 - a * 0.4;
    const m = mid * (1 + a * 0.08);
    const s = side * sideG;
    out.left[i] = m + s;
    out.right[i] = m - s;
  }
  return out;
}

/**
 * Full glue chain after vocal+beat sum.
 */
export function applyMixGlue(mix: PcmStereo, opts?: { parallel?: number; room?: number; center?: number }): PcmStereo {
  let out = parallelBusGlue(mix, opts?.parallel ?? 0.38);
  out = centerMidGlue(out, opts?.center ?? 0.22);
  out = sharedRoom(out, opts?.room ?? 0.11);
  // Soft peak control after glue
  const p = Math.max(peakOf(out.left), peakOf(out.right));
  if (p > 0.98) {
    applyGainStereo(out, 0.95 / p);
  }
  return out;
}
