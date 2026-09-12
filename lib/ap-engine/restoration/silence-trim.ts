/**
 * Gentle empty-edge cleanup only.
 *
 * Internal gap silencing was disabled — it was eating quiet phrases / breaths
 * and creating clicks, pumping, and “weird” vocal artifacts after FX.
 *
 * We only soft-fade obvious head/tail noise. Timing vs the beat is unchanged.
 */
import { rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";
import { cleanTakeEdges } from "./edge-fade";

export type SilenceTrimQC = {
  applied: boolean;
  leadTrimMs: number;
  tailTrimMs: number;
  internalGaps: number;
  internalSilentMs: number;
};

/**
 * Soft lead/tail edge clean only. No internal muting.
 */
export function trimVocalSilence(
  pcm: PcmStereo,
  _intensity: "normal" | "aggressive" = "normal"
): { pcm: PcmStereo; qc: SilenceTrimQC } {
  // Conservative bounds — only clear obvious pre-roll / tail junk
  const edged = cleanTakeEdges(pcm, {
    maxLeadMs: 450,
    maxTailMs: 500,
    fadeInMs: 50,
    fadeOutMs: 100,
    contentRatio: 0.1,
  });

  const mono0 = stereoToMono(pcm);
  const mono1 = stereoToMono(edged);
  const thr = Math.max(rmsOf(mono0) * 0.08, 1e-5);
  let lead = 0;
  let tail = 0;
  for (let i = 0; i < mono1.length; i++) {
    if (Math.abs(mono1[i] || 0) > thr) break;
    lead++;
  }
  for (let i = mono1.length - 1; i >= 0; i--) {
    if (Math.abs(mono1[i] || 0) > thr) break;
    tail++;
  }

  return {
    pcm: edged,
    qc: {
      applied: true,
      leadTrimMs: Math.round((lead / pcm.sampleRate) * 1000),
      tailTrimMs: Math.round((tail / pcm.sampleRate) * 1000),
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
