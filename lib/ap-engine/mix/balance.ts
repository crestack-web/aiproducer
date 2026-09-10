import { applyGainStereo, dbToGain, peakOf, rmsOf, stereoToMono } from "../dsp";
import type { MixDecision, PcmStereo } from "../types";

export function applyMixGains(vocal: PcmStereo, beat: PcmStereo, decision: MixDecision): void {
  applyGainStereo(vocal, dbToGain(decision.vocalGainDb));
  applyGainStereo(beat, dbToGain(decision.beatGainDb));
}

/** Envelope duck on beat from vocal energy. */
export function duckBeatFromVocal(vocal: PcmStereo, beat: PcmStereo, duckDb: number): void {
  if (duckDb < 0.3) return;
  const amount = 1 - Math.pow(10, -duckDb / 20);
  const sr = vocal.sampleRate;
  const atk = Math.exp(-1 / (0.01 * sr));
  const rel = Math.exp(-1 / (0.12 * sr));
  let env = 0;
  const n = Math.min(vocal.left.length, beat.left.length);
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(vocal.left[i] || 0), Math.abs(vocal.right[i] || 0));
    env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a;
    const duck = 1 - Math.min(amount, env * amount * 2.5);
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
