import { stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";
import type { PhraseRegion } from "../edit/phrase-detect";

/**
 * Refine musical onset inside a phrase region.
 * Skips leading breath / soft noise; locks to first strong attack (consonant or vowel).
 */
export function detectPhraseOnset(
  pcm: PcmStereo,
  phrase: PhraseRegion,
  noiseFloor: number
): { onsetSample: number; attackStrength: number; energy: number } {
  const mono = stereoToMono(pcm);
  const sr = pcm.sampleRate;
  const frame = Math.max(16, Math.floor(sr * 0.005)); // 5ms
  const start = Math.max(0, phrase.startSample);
  const end = Math.min(mono.length, phrase.endSample);
  if (end <= start + frame) {
    return { onsetSample: start, attackStrength: 0, energy: 0 };
  }

  const energies: number[] = [];
  for (let i = start; i + frame <= end; i += frame) {
    let s = 0;
    for (let j = i; j < i + frame; j++) {
      const x = mono[j] || 0;
      s += x * x;
    }
    energies.push(Math.sqrt(s / frame));
  }

  const peak = Math.max(...energies, 1e-6);
  const thr = Math.max(noiseFloor * 4, peak * 0.22);

  // Skip soft breath ramp: look for first frame that is above thr AND rising
  let onsetIdx = 0;
  for (let i = 1; i < energies.length; i++) {
    const e = energies[i];
    const prev = energies[i - 1];
    if (e >= thr && e >= prev * 1.05) {
      onsetIdx = i;
      break;
    }
  }

  // If phrase flagged breath lead, allow onset slightly after start
  const onsetSample = start + onsetIdx * frame;
  const attackStrength =
    onsetIdx > 0
      ? Math.min(1, (energies[onsetIdx] - energies[Math.max(0, onsetIdx - 1)]) / peak)
      : Math.min(1, energies[0] / peak);

  let energy = 0;
  for (const e of energies) energy += e;
  energy /= Math.max(1, energies.length);

  return { onsetSample, attackStrength, energy };
}
