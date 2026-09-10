import { applyGainStereo, dbToGain, rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";

/** Approximate loudness normalize using RMS proxy (not true LUFS). */
export function normalizeRmsProxy(pcm: PcmStereo, targetRmsDb = -14): void {
  const mono = stereoToMono(pcm);
  const r = rmsOf(mono);
  if (r < 1e-9) return;
  const currentDb = 20 * Math.log10(r);
  const delta = targetRmsDb - currentDb;
  const g = dbToGain(Math.max(-12, Math.min(12, delta)));
  applyGainStereo(pcm, g);
}
