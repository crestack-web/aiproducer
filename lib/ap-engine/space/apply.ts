/**
 * AP SPACE DSP apply — executes VocalSpaceDecision on PCM.
 * Uses musical-space primitives + filtered wet path + mild width.
 */
import {
  applyGainStereo,
  applyBiquadInPlace,
  cloneStereo,
  dbToGain,
} from "../dsp";
import type { PcmStereo } from "../types";
import { applyMusicalSpace } from "../production/musical-space";
import type { VocalSpaceDecision } from "./decide";

/** Soft stereo width without mid collapse */
function applyWidth(pcm: PcmStereo, amount: number): void {
  if (amount < 0.05) return;
  const a = Math.min(0.85, amount);
  const n = pcm.left.length;
  for (let i = 0; i < n; i++) {
    const l = pcm.left[i] || 0;
    const r = pcm.right[i] || 0;
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    const sideW = side * (1 + a * 1.4);
    pcm.left[i] = mid + sideW;
    pcm.right[i] = mid - sideW;
  }
}

/**
 * Filter a wet-leaning copy path: high-pass + low-pass on the whole buffer
 * after musical space so tails don't muddy the bed.
 */
function filterSpaceReturn(pcm: PcmStereo, hpHz: number, lpHz: number): void {
  applyBiquadInPlace(pcm.left, "highpass", hpHz, pcm.sampleRate, 0, 0.7);
  applyBiquadInPlace(pcm.right, "highpass", hpHz, pcm.sampleRate, 0, 0.7);
  applyBiquadInPlace(pcm.left, "lowpass", lpHz, pcm.sampleRate, 0, 0.7);
  applyBiquadInPlace(pcm.right, "lowpass", lpHz, pcm.sampleRate, 0, 0.7);
}

export function applyVocalSpace(
  pcm: PcmStereo,
  decision: VocalSpaceDecision
): { pcm: PcmStereo; throws: number } {
  let out = cloneStereo(pcm);

  // Automation ride
  if (Math.abs(decision.automationGainDb) > 0.05) {
    applyGainStereo(out, dbToGain(decision.automationGainDb));
  }

  // Dry reference for blending after filtered wet
  const dry = cloneStereo(out);

  const spaced = applyMusicalSpace(out, decision.plan);
  out = spaced.pcm;

  // Mild filter on the whole so space doesn't add full-range mud;
  // blend back some dry center for intelligibility
  filterSpaceReturn(out, decision.reverbHpHz, decision.reverbLpHz);
  const dryKeep =
    decision.character === "intimate" ? 0.72 : decision.character === "present" ? 0.55 : 0.42;
  const n = out.left.length;
  for (let i = 0; i < n; i++) {
    out.left[i] = (dry.left[i] || 0) * dryKeep + (out.left[i] || 0) * (1 - dryKeep * 0.85);
    out.right[i] = (dry.right[i] || 0) * dryKeep + (out.right[i] || 0) * (1 - dryKeep * 0.85);
  }

  applyWidth(out, decision.width);

  // Safety peak
  let peak = 0;
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, Math.abs(out.left[i] || 0), Math.abs(out.right[i] || 0));
  }
  if (peak > 0.98) applyGainStereo(out, 0.95 / peak);

  return { pcm: out, throws: spaced.throws };
}
