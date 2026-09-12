import { applyGainStereo, dbToGain, rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";
import { cloneStereo } from "../dsp";

/**
 * Level stabilization toward target RMS using active (non-silent) frames
 * so sparse/quiet sections are not over-boosted by long silence.
 */
export function stabilizeLevel(pcm: PcmStereo, targetRms = 0.1): PcmStereo {
  const out = cloneStereo(pcm);
  const mono = stereoToMono(out);
  const sr = out.sampleRate;
  const frame = Math.max(64, Math.floor(sr * 0.02));
  let sum = 0;
  let n = 0;
  const energies: number[] = [];
  for (let i = 0; i + frame <= mono.length; i += frame) {
    let s = 0;
    for (let j = i; j < i + frame; j++) {
      const x = mono[j] || 0;
      s += x * x;
    }
    energies.push(Math.sqrt(s / frame));
  }
  if (energies.length) {
    const sorted = [...energies].sort((a, b) => a - b);
    const noise = sorted[Math.floor(sorted.length * 0.15)] || 1e-6;
    const thr = Math.max(noise * 3.2, 1e-5);
    for (const e of energies) {
      if (e >= thr) {
        sum += e * e;
        n++;
      }
    }
  }
  const r = n > 2 ? Math.sqrt(sum / n) : rmsOf(mono);
  if (r < 1e-6) return out;
  // Tighter clamp: consistency without rewriting performance dynamics
  const g = Math.max(0.4, Math.min(2.5, targetRms / r));
  applyGainStereo(out, g);
  return out;
}
