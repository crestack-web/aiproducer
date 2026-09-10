import { applyGainStereo, dbToGain, rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";
import { cloneStereo } from "../dsp";

/** Simple level stabilization toward target RMS. */
export function stabilizeLevel(pcm: PcmStereo, targetRms = 0.1): PcmStereo {
  const out = cloneStereo(pcm);
  const mono = stereoToMono(out);
  const r = rmsOf(mono);
  if (r < 1e-6) return out;
  const g = Math.max(0.25, Math.min(4, targetRms / r));
  applyGainStereo(out, g);
  return out;
}
