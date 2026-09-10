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
  vocal: PcmStereo,
  beat: PcmStereo,
  duckDb: number,
  midFocus = 0.65
): void {
  if (duckDb < 0.25) return;
  const amount = 1 - Math.pow(10, -duckDb / 20);
  const sr = vocal.sampleRate;
  const atk = Math.exp(-1 / (0.008 * sr));
  const rel = Math.exp(-1 / (0.14 * sr));
  let env = 0;
  const n = Math.min(vocal.left.length, beat.left.length);
  const focus = Math.max(0, Math.min(1, midFocus));

  let midL: Float32Array | null = null;
  let midR: Float32Array | null = null;
  if (focus > 0.2) {
    midL = new Float32Array(vocal.left);
    midR = new Float32Array(vocal.right);
    applyBiquadInPlace(midL, "peak", 2200, sr, 6, 0.9);
    applyBiquadInPlace(midR, "peak", 2200, sr, 6, 0.9);
  }

  for (let i = 0; i < n; i++) {
    const aBroad = Math.max(Math.abs(vocal.left[i] || 0), Math.abs(vocal.right[i] || 0));
    const aMid = midL
      ? Math.max(Math.abs(midL[i] || 0), Math.abs(midR![i] || 0))
      : aBroad;
    const a = aBroad * (1 - focus) + aMid * focus;
    env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a;
    const duck = 1 - Math.min(amount, env * amount * 2.2);
    beat.left[i] = (beat.left[i] || 0) * duck;
    beat.right[i] = (beat.right[i] || 0) * duck;
  }
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
  return {
    vocalGainDb: base.vocalGainDb + adj * 0.7,
    beatGainDb: base.beatGainDb - adj * 0.25,
  };
}

export function measureBusPeak(pcm: PcmStereo): number {
  return Math.max(peakOf(pcm.left), peakOf(pcm.right));
}
