/**
 * Vocal bus — all layers become one instrument before meeting the beat.
 */
import {
  applyEqStereo,
  cloneStereo,
  compressStereo,
  applyGainStereo,
  dbToGain,
  peakOf,
} from "../dsp";
import type { PcmStereo } from "../types";
import { parallelVocalDensity } from "../production/parallel-vocal";

export function processVocalBus(
  bus: PcmStereo,
  opts?: { glue?: number; density?: number }
): PcmStereo {
  let out = cloneStereo(bus);
  const glue = opts?.glue ?? 0.45;
  const density = opts?.density ?? 0.3;

  // Gentle bus EQ — slight presence, control mud
  applyEqStereo(out, [
    { type: "highpass", freq: 70, q: 0.7 },
    { type: "peak", freq: 280, gainDb: -1.2, q: 0.9 },
    { type: "peak", freq: 3000, gainDb: 1.0, q: 1.0 },
    { type: "highshelf", freq: 10000, gainDb: 0.6, q: 0.7 },
  ]);

  // Glue compressor
  compressStereo(out, {
    thresholdDb: -16,
    ratio: 1.8 + glue * 1.2,
    attackMs: 15,
    releaseMs: 140,
    makeupDb: 1.5 * glue,
  });

  out = parallelVocalDensity(out, density * 0.85);

  const p = Math.max(peakOf(out.left), peakOf(out.right));
  if (p > 0.95) applyGainStereo(out, 0.92 / p);

  return out;
}
