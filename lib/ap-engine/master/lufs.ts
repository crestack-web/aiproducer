import type { PcmStereo } from "../types";

/**
 * ITU-R BS.1770-4 loudness + oversampled true peak, pure TS.
 * Used for gain staging, mastering targets and the radio-ready QC gate.
 */

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** K-weighting coefficients (stage 1 shelf + stage 2 RLB high-pass) for any sample rate. */
function kWeighting(sr: number): [Biquad, Biquad] {
  // Stage 1: high shelf (+4 dB @ ~1681 Hz)
  {
    var f0 = 1681.974450955533;
    var G = 3.999843853973347;
    var Q = 0.7071752369554196;
    var K = Math.tan((Math.PI * f0) / sr);
    var Vh = Math.pow(10, G / 20);
    var Vb = Math.pow(Vh, 0.4996667741545416);
    var a0 = 1 + K / Q + K * K;
    var s1: Biquad = {
      b0: (Vh + (Vb * K) / Q + K * K) / a0,
      b1: (2 * (K * K - Vh)) / a0,
      b2: (Vh - (Vb * K) / Q + K * K) / a0,
      a1: (2 * (K * K - 1)) / a0,
      a2: (1 - K / Q + K * K) / a0,
    };
  }
  // Stage 2: RLB high-pass (~38 Hz)
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / sr);
  const a01 = 1 + K1 / Q1 + K1 * K1;
  const s2: Biquad = {
    b0: 1 / a01,
    b1: -2 / a01,
    b2: 1 / a01,
    a1: (2 * (K1 * K1 - 1)) / a01,
    a2: (1 - K1 / Q1 + K1 * K1) / a01,
  };
  return [s1, s2];
}

function filter(input: Float32Array, c: Biquad): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i] || 0;
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/** Integrated loudness in LUFS (gated, 400 ms blocks, 75% overlap). Returns -70 for silence. */
export function measureIntegratedLufs(pcm: PcmStereo): number {
  const sr = pcm.sampleRate;
  const n = Math.min(pcm.left.length, pcm.right.length);
  if (n < sr * 0.4) {
    // Too short for gating — fall back to ungated mean square
    return ungated(pcm);
  }
  const [s1, s2] = kWeighting(sr);
  const l = filter(filter(pcm.left.subarray(0, n), s1), s2);
  const r = filter(filter(pcm.right.subarray(0, n), s1), s2);
  const block = Math.round(sr * 0.4);
  const hop = Math.round(sr * 0.1);
  // Prefix sums of squared samples for O(n) block energies
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + l[i] * l[i] + r[i] * r[i];
  const energies: number[] = [];
  for (let s = 0; s + block <= n; s += hop) {
    energies.push((cum[s + block] - cum[s]) / block);
  }
  const toLufs = (z: number) => (z > 0 ? -0.691 + 10 * Math.log10(z) : -120);
  const abs = energies.filter((z) => toLufs(z) > -70);
  if (!abs.length) return -70;
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const relGate = toLufs(meanAbs) - 10;
  const rel = abs.filter((z) => toLufs(z) > relGate);
  if (!rel.length) return toLufs(meanAbs);
  return toLufs(rel.reduce((a, b) => a + b, 0) / rel.length);
}

function ungated(pcm: PcmStereo): number {
  const n = Math.min(pcm.left.length, pcm.right.length);
  if (!n) return -70;
  const [s1, s2] = kWeighting(pcm.sampleRate);
  const l = filter(filter(pcm.left.subarray(0, n), s1), s2);
  const r = filter(filter(pcm.right.subarray(0, n), s1), s2);
  let z = 0;
  for (let i = 0; i < n; i++) z += l[i] * l[i] + r[i] * r[i];
  z /= n;
  return z > 0 ? Math.max(-70, -0.691 + 10 * Math.log10(z)) : -70;
}

/** 4x oversampling interpolation taps (windowed sinc, 12 taps per phase). */
const OS = 4;
const TAPS = 12;
const PHASES: Float64Array[] = (() => {
  const out: Float64Array[] = [];
  for (let p = 0; p < OS; p++) {
    const frac = p / OS;
    const h = new Float64Array(TAPS);
    let sum = 0;
    for (let k = 0; k < TAPS; k++) {
      const t = k - TAPS / 2 + 1 - frac;
      const sinc = Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / (TAPS / 2));
      h[k] = sinc * w;
      sum += h[k];
    }
    for (let k = 0; k < TAPS; k++) h[k] /= sum;
    out.push(h);
  }
  return out;
})();

/** Peak of one channel after 4x oversampling (linear, not dB). */
export function truePeakOfChannel(buf: Float32Array): number {
  let tp = 0;
  const n = buf.length;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(buf[i] || 0);
    if (a > tp) tp = a;
  }
  // Only oversample around samples that could hide an inter-sample over
  const thresh = tp * 0.7;
  for (let i = 0; i < n - 1; i++) {
    const a = Math.abs(buf[i] || 0);
    const b = Math.abs(buf[i + 1] || 0);
    if (a < thresh && b < thresh) continue;
    for (let p = 1; p < OS; p++) {
      const h = PHASES[p];
      let acc = 0;
      for (let k = 0; k < TAPS; k++) {
        const idx = i + k - TAPS / 2 + 1;
        if (idx >= 0 && idx < n) acc += (buf[idx] || 0) * h[k];
      }
      const v = Math.abs(acc);
      if (v > tp) tp = v;
    }
  }
  return tp;
}

export function truePeakLinear(pcm: PcmStereo): number {
  return Math.max(truePeakOfChannel(pcm.left), truePeakOfChannel(pcm.right));
}

export function truePeakDbtp(pcm: PcmStereo): number {
  const tp = truePeakLinear(pcm);
  return tp > 1e-12 ? 20 * Math.log10(tp) : -120;
}

export function countClippedSamples(pcm: PcmStereo, threshold = 0.9999): number {
  let c = 0;
  for (let i = 0; i < pcm.left.length; i++) {
    if (Math.abs(pcm.left[i] || 0) >= threshold) c++;
    if (Math.abs(pcm.right[i] || 0) >= threshold) c++;
  }
  return c;
}
