/**
 * Preserve take timing and intentional quiet (space, hum, breaths).
 *
 * We do NOT zero lead/tail or apply musical fades here — that was eating
 * empty space, room hum, and phrase attacks. Timing vs the beat stays intact.
 *
 * Optional micro click-guard only at absolute buffer edges (a few ms).
 */
import { cloneStereo } from "../dsp";
import type { PcmStereo } from "../types";

export type SilenceTrimQC = {
  applied: boolean;
  leadTrimMs: number;
  tailTrimMs: number;
  internalGaps: number;
  internalSilentMs: number;
};

/**
 * Pass-through with optional micro edge fade (click guard only).
 * No content-bound detection, no silence zeroing.
 */
export function trimVocalSilence(
  pcm: PcmStereo,
  _intensity: "normal" | "aggressive" = "normal"
): { pcm: PcmStereo; qc: SilenceTrimQC } {
  const out = cloneStereo(pcm);
  const sr = out.sampleRate;
  // ~3 ms only — prevent hard buffer discontinuity, not a musical fade
  const micro = Math.max(1, Math.floor((3 / 1000) * sr));
  const n = out.left.length;
  for (let i = 0; i < micro && i < n; i++) {
    const g = i / micro;
    out.left[i] *= g;
    out.right[i] *= g;
  }
  for (let i = 0; i < micro && i < n; i++) {
    const idx = n - 1 - i;
    const g = i / micro;
    out.left[idx] *= g;
    out.right[idx] *= g;
  }

  return {
    pcm: out,
    qc: {
      applied: false,
      leadTrimMs: 0,
      tailTrimMs: 0,
      internalGaps: 0,
      internalSilentMs: 0,
    },
  };
}

/** @deprecated Internal gap mute removed — kept as no-op for any old callers. */
export function silenceInternalGaps(
  pcm: PcmStereo
): { pcm: PcmStereo; gaps: number; silentMs: number } {
  return { pcm, gaps: 0, silentMs: 0 };
}
