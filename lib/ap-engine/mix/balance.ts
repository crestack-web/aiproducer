import { applyGainStereo, dbToGain, peakOf, rmsOf, stereoToMono, applyBiquadInPlace } from "../dsp";
import type { MixDecision, PcmStereo } from "../types";

export function applyMixGains(vocal: PcmStereo, beat: PcmStereo, decision: MixDecision): void {
  applyGainStereo(vocal, dbToGain(decision.vocalGainDb));
  applyGainStereo(beat, dbToGain(decision.beatGainDb));
}

/**
 * Vocal-keyed dynamic EQ on the beat: dips only the 1–5 kHz band (where the voice lives)
 * while the vocal is singing, by at most ~3 dB. Kick, sub and air are untouched, so the
 * beat no longer pumps the way the old broadband sidechain did.
 */
export function duckBeatFromVocal(
  vocal: PcmStereo,
  beat: PcmStereo,
  duckDb: number,
  _midFocus = 0.65
): void {
  const n = Math.min(beat.left.length, beat.right.length);
  const env = new Float32Array(n);
  const vn = Math.min(n, vocal.left.length, vocal.right.length);
  for (let i = 0; i < vn; i++) {
    env[i] = 0.5 * (Math.abs(vocal.left[i] || 0) + Math.abs(vocal.right[i] || 0));
  }
  applyVocalBandDip(beat, env, duckDb);
}

/**
 * Apply the 1–5 kHz dip to `beat` from a precomputed vocal amplitude envelope
 * (same sample index as the beat). Used by the mix engine and fast-produce.
 */
export function applyVocalBandDip(beat: PcmStereo, vocalEnv: Float32Array, duckDb: number): void {
  const maxDb = Math.max(0, Math.min(3, duckDb));
  if (maxDb < 0.2) return;
  const sr = beat.sampleRate;
  const n = Math.min(beat.left.length, beat.right.length, vocalEnv.length);
  // Smooth the key: 10 ms attack, 180 ms release
  const atk = Math.exp(-1 / (0.01 * sr));
  const rel = Math.exp(-1 / (0.18 * sr));
  const key = new Float32Array(n);
  let e = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = vocalEnv[i] || 0;
    e = a > e ? atk * e + (1 - atk) * a : rel * e + (1 - rel) * a;
    key[i] = e;
    if (e > peak) peak = e;
  }
  if (peak < 1e-5) return;
  const depth = 1 - dbToGain(-maxDb); // fraction of the band removed at full dip
  for (const ch of [beat.left, beat.right]) {
    const band = new Float32Array(ch.subarray(0, n));
    applyBiquadInPlace(band, "highpass", 1000, sr, 0, 0.7);
    applyBiquadInPlace(band, "lowpass", 5000, sr, 0, 0.7);
    for (let i = 0; i < n; i++) {
      // Full dip once the vocal is above ~30% of its peak level
      const amt = Math.min(1, key[i] / (peak * 0.3));
      ch[i] = (ch[i] || 0) - band[i] * depth * amt;
    }
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
  // Prefer lifting the vocal over cutting the beat so the instrumental stays steady.
  return {
    vocalGainDb: base.vocalGainDb + adj * 0.85,
    beatGainDb: base.beatGainDb - adj * 0.08,
  };
}

export function measureBusPeak(pcm: PcmStereo): number {
  return Math.max(peakOf(pcm.left), peakOf(pcm.right));
}
