import { applyGainStereo, dbToGain, peakOf, rmsOf, stereoToMono, applyBiquadInPlace } from "../dsp";
import type { MixDecision, PcmStereo } from "../types";

export function applyMixGains(vocal: PcmStereo, beat: PcmStereo, decision: MixDecision): void {
  applyGainStereo(vocal, dbToGain(decision.vocalGainDb));
  applyGainStereo(beat, dbToGain(decision.beatGainDb));
}

/**
 * Duck the beat from vocal energy.
 * midFocus ~1: primarily respond to mid vocal energy (keeps sub punchier).
 */
export function duckBeatFromVocal(
  _vocal: PcmStereo,
  _beat: PcmStereo,
  _duckDb: number,
  _midFocus = 0.65
): void {
  // No-op: dynamic sidechain made the beat pump under vocals.
}

export function sumStereo(vocal: PcmStereo, beat: PcmStereo): PcmStereo {
  const n = Math.max(vocal.left.length, beat.left.length);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = (vocal.left[i] || 0) + (beat.left[i] || 0);
    right[i] = (vocal.right[i] || 0) + (beat.right[i] || 0);
  }
  return { left, right, sampleRate: vocal.sampleRate };
}

/** Auto-balance vocal vs beat toward a target energy ratio. */
export function autoBalanceGains(
  vocal: PcmStereo,
  beat: PcmStereo,
  base: MixDecision,
  targetRatio = 0.85
): { vocalGainDb: number; beatGainDb: number } {
  const vr = rmsOf(stereoToMono(vocal));
  const br = rmsOf(stereoToMono(beat));
  if (vr < 1e-8 || br < 1e-8) {
    return { vocalGainDb: base.vocalGainDb, beatGainDb: base.beatGainDb };
  }
  const current = vr / br;
  let adj = 20 * Math.log10(targetRatio / (current + 1e-12));
  adj = Math.max(-6, Math.min(6, adj));
  // Prefer lifting the vocal over cutting the beat so the instrumental stays steady.
  return {
    vocalGainDb: base.vocalGainDb + adj * 0.85,
    beatGainDb: base.beatGainDb - adj * 0.08,
  };
}

export function measureBusPeak(pcm: PcmStereo): number {
  return Math.max(peakOf(pcm.left), peakOf(pcm.right));
}
