/**
 * Parallel vocal density — expensive “forward” quality without crushing dynamics.
 */
import {
  applyGainStereo,
  cloneStereo,
  compressStereo,
  saturateInPlace,
  applyBiquadInPlace,
  dbToGain,
} from "../dsp";
import type { PcmStereo } from "../types";

export function parallelVocalDensity(
  pcm: PcmStereo,
  amount = 0.28
): PcmStereo {
  const a = Math.max(0, Math.min(0.55, amount));
  if (a < 0.05) return pcm;

  const dry = cloneStereo(pcm);
  const wet = cloneStereo(pcm);

  // Presence lift on wet path only
  applyBiquadInPlace(wet.left, "peak", 3200, wet.sampleRate, 3.5, 1.1);
  applyBiquadInPlace(wet.right, "peak", 3200, wet.sampleRate, 3.5, 1.1);
  applyBiquadInPlace(wet.left, "highshelf", 9000, wet.sampleRate, 1.5, 0.7);
  applyBiquadInPlace(wet.right, "highshelf", 9000, wet.sampleRate, 1.5, 0.7);

  compressStereo(wet, {
    thresholdDb: -22,
    ratio: 4.5,
    attackMs: 6,
    releaseMs: 80,
    makeupDb: 5,
  });
  saturateInPlace(wet.left, 0.22);
  saturateInPlace(wet.right, 0.22);
  applyGainStereo(wet, dbToGain(-1.5));

  const out = cloneStereo(dry);
  const dryG = 1 - a * 0.35;
  for (let i = 0; i < out.left.length; i++) {
    out.left[i] = (out.left[i] || 0) * dryG + (wet.left[i] || 0) * a;
    out.right[i] = (out.right[i] || 0) * dryG + (wet.right[i] || 0) * a;
  }
  return out;
}
