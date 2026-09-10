/**
 * Lightweight stereo PCM DSP primitives for AP Phase 1.
 * All processing is real (no placeholders).
 */

import type { CompressorParams, EqBand } from "./types";

export type PcmStereo = {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
};

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  if (g <= 1e-12) return -120;
  return 20 * Math.log10(g);
}

export function peakOf(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i] || 0);
    if (a > p) p = a;
  }
  return p;
}

export function rmsOf(buf: Float32Array): number {
  if (buf.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] || 0;
    s += v * v;
  }
  return Math.sqrt(s / buf.length);
}

export function cloneStereo(s: PcmStereo): PcmStereo {
  return {
    left: new Float32Array(s.left),
    right: new Float32Array(s.right),
    sampleRate: s.sampleRate,
  };
}

export function monoToStereo(mono: Float32Array, sampleRate: number): PcmStereo {
  return {
    left: new Float32Array(mono),
    right: new Float32Array(mono),
    sampleRate,
  };
}

export function stereoToMono(s: PcmStereo): Float32Array {
  const n = Math.min(s.left.length, s.right.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.5 * ((s.left[i] || 0) + (s.right[i] || 0));
  return out;
}

export function applyGainStereo(s: PcmStereo, gain: number): void {
  for (let i = 0; i < s.left.length; i++) {
    s.left[i] = (s.left[i] || 0) * gain;
    s.right[i] = (s.right[i] || 0) * gain;
  }
}

/** One-pole high-pass (per sample). */
export function highPassInPlace(buf: Float32Array, sampleRate: number, cutoffHz: number): void {
  const rc = 1 / (2 * Math.PI * Math.max(20, cutoffHz));
  const dt = 1 / sampleRate;
  const a = rc / (rc + dt);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] || 0;
    const y = a * (prevY + x - prevX);
    buf[i] = y;
    prevX = x;
    prevY = y;
  }
}

/** Biquad peak / shelf filter (RBJ cookbook). */
function biquadCoeffs(
  type: EqBand["type"],
  freq: number,
  sampleRate: number,
  gainDb: number,
  q: number
): { b0: number; b1: number; b2: number; a0: number; a1: number; a2: number } {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Math.max(0.1, q));
  let b0 = 1,
    b1 = 0,
    b2 = 0,
    a0 = 1,
    a1 = 0,
    a2 = 0;
  switch (type) {
    case "highpass": {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case "lowpass": {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case "peak": {
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    }
    case "lowshelf": {
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + twoSqrtAAlpha);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - twoSqrtAAlpha);
      a0 = A + 1 + (A - 1) * cos + twoSqrtAAlpha;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - twoSqrtAAlpha;
      break;
    }
    case "highshelf": {
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + twoSqrtAAlpha);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - twoSqrtAAlpha);
      a0 = A + 1 - (A - 1) * cos + twoSqrtAAlpha;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - twoSqrtAAlpha;
      break;
    }
  }
  return { b0, b1, b2, a0, a1, a2 };
}

export function applyBiquadInPlace(
  buf: Float32Array,
  type: EqBand["type"],
  freq: number,
  sampleRate: number,
  gainDb = 0,
  q = 0.7
): void {
  const c = biquadCoeffs(type, Math.max(20, Math.min(freq, sampleRate * 0.45)), sampleRate, gainDb, q);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  const invA0 = 1 / c.a0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] || 0;
    const y = (c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2) * invA0;
    buf[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
}

export function applyEqChain(buf: Float32Array, sampleRate: number, bands: EqBand[]): void {
  for (const b of bands) {
    applyBiquadInPlace(buf, b.type, b.freq, sampleRate, b.gainDb ?? 0, b.q ?? 0.7);
  }
}

export function applyEqStereo(s: PcmStereo, bands: EqBand[]): void {
  applyEqChain(s.left, s.sampleRate, bands);
  applyEqChain(s.right, s.sampleRate, bands);
}

/** Soft knee compressor (sample-peak envelope). */
export function compressInPlace(buf: Float32Array, sampleRate: number, p: CompressorParams): void {
  const thr = dbToGain(p.thresholdDb);
  const atk = Math.exp(-1 / ((p.attackMs / 1000) * sampleRate));
  const rel = Math.exp(-1 / ((p.releaseMs / 1000) * sampleRate));
  const makeup = dbToGain(p.makeupDb);
  let env = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] || 0;
    const a = Math.abs(x);
    env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a;
    let g = 1;
    if (env > thr && env > 1e-9) {
      const overDb = gainToDb(env) - p.thresholdDb;
      const grDb = overDb - overDb / Math.max(1, p.ratio);
      g = dbToGain(-grDb);
    }
    buf[i] = x * g * makeup;
  }
}

export function compressStereo(s: PcmStereo, p: CompressorParams): void {
  compressInPlace(s.left, s.sampleRate, p);
  compressInPlace(s.right, s.sampleRate, p);
}

/** Gentle noise gate / expander. */
export function gateInPlace(buf: Float32Array, sampleRate: number, thresholdDb: number): void {
  const thr = dbToGain(thresholdDb);
  const rel = Math.exp(-1 / (0.05 * sampleRate));
  let env = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] || 0;
    const a = Math.abs(x);
    env = a > env ? a : rel * env + (1 - rel) * a;
    const open = env >= thr ? 1 : Math.max(0.15, env / (thr + 1e-9));
    buf[i] = x * open;
  }
}

/** Soft saturation. */
export function saturateInPlace(buf: Float32Array, amount: number): void {
  const a = Math.max(0, Math.min(1, amount));
  if (a < 0.01) return;
  const drive = 1 + a * 2.5;
  for (let i = 0; i < buf.length; i++) {
    const x = (buf[i] || 0) * drive;
    buf[i] = Math.tanh(x) / Math.tanh(drive);
  }
}

/** Simple de-esser: detect 5–9k energy envelope and duck. */
export function deEssInPlace(buf: Float32Array, sampleRate: number, amount: number): void {
  const a = Math.max(0, Math.min(1, amount));
  if (a < 0.05) return;
  // Band-pass approx via HP then LP
  const tmp = new Float32Array(buf);
  highPassInPlace(tmp, sampleRate, 5000);
  applyBiquadInPlace(tmp, "lowpass", 9000, sampleRate, 0, 0.7);
  const atk = Math.exp(-1 / (0.003 * sampleRate));
  const rel = Math.exp(-1 / (0.04 * sampleRate));
  let env = 0;
  for (let i = 0; i < buf.length; i++) {
    const s = Math.abs(tmp[i] || 0);
    env = s > env ? atk * env + (1 - atk) * s : rel * env + (1 - rel) * s;
    const duck = 1 - Math.min(0.55, env * a * 4);
    buf[i] = (buf[i] || 0) * duck;
  }
}

/** Very short algorithmic reverb (comb + allpass-ish). */
export function addReverbStereo(s: PcmStereo, wet: number): void {
  const w = Math.max(0, Math.min(0.35, wet));
  if (w < 0.02) return;
  const delays = [1117, 1351, 1699, 1871];
  const n = s.left.length;
  const dryL = new Float32Array(s.left);
  const dryR = new Float32Array(s.right);
  const wetL = new Float32Array(n);
  const wetR = new Float32Array(n);
  for (const d of delays) {
    const fb = 0.55;
    let prevL = 0;
    let prevR = 0;
    for (let i = 0; i < n; i++) {
      const iL = i - d;
      const srcL = iL >= 0 ? wetL[iL] : 0;
      const srcR = iL >= 0 ? wetR[iL] : 0;
      const inl = (dryL[i] || 0) + srcL * fb;
      const inr = (dryR[i] || 0) + srcR * fb;
      wetL[i] = (wetL[i] || 0) + inl * 0.25;
      wetR[i] = (wetR[i] || 0) + inr * 0.25;
      prevL = inl;
      prevR = inr;
    }
  }
  for (let i = 0; i < n; i++) {
    s.left[i] = (dryL[i] || 0) * (1 - w) + (wetL[i] || 0) * w;
    s.right[i] = (dryR[i] || 0) * (1 - w) + (wetR[i] || 0) * w;
  }
}

/** Simple slap delay. */
export function addDelayStereo(s: PcmStereo, send: number, delayMs = 120): void {
  const w = Math.max(0, Math.min(0.25, send));
  if (w < 0.02) return;
  const d = Math.floor((delayMs / 1000) * s.sampleRate);
  const n = s.left.length;
  const dryL = new Float32Array(s.left);
  const dryR = new Float32Array(s.right);
  for (let i = 0; i < n; i++) {
    const j = i - d;
    const eL = j >= 0 ? dryL[j] * 0.45 : 0;
    const eR = j >= 0 ? dryR[j] * 0.4 : 0;
    s.left[i] = (dryL[i] || 0) + eL * w;
    s.right[i] = (dryR[i] || 0) + eR * w;
  }
}

/** Brickwall-ish soft limiter. */
export function limitStereo(s: PcmStereo, ceilingDb: number): void {
  const ceil = dbToGain(ceilingDb);
  const atk = Math.exp(-1 / (0.001 * s.sampleRate));
  const rel = Math.exp(-1 / (0.05 * s.sampleRate));
  let env = 0;
  for (let i = 0; i < s.left.length; i++) {
    const a = Math.max(Math.abs(s.left[i] || 0), Math.abs(s.right[i] || 0));
    env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a;
    let g = 1;
    if (env > ceil && env > 1e-9) g = ceil / env;
    s.left[i] = (s.left[i] || 0) * g;
    s.right[i] = (s.right[i] || 0) * g;
  }
}

/** Linear resample mono. */
export function resampleMono(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return new Float32Array(input);
  const ratio = toRate / fromRate;
  const outLen = Math.max(1, Math.floor(input.length * ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = src - i0;
    out[i] = (input[i0] || 0) * (1 - t) + (input[i1] || 0) * t;
  }
  return out;
}

export function bandEnergy(buf: Float32Array, sampleRate: number, lo: number, hi: number): number {
  // crude: filter and RMS
  const tmp = new Float32Array(buf);
  highPassInPlace(tmp, sampleRate, lo);
  applyBiquadInPlace(tmp, "lowpass", hi, sampleRate, 0, 0.7);
  return rmsOf(tmp);
}

export function encodeStereoWav(s: PcmStereo): Buffer {
  const channels = 2;
  const bits = 16;
  const block = (channels * bits) / 8;
  const dataSize = s.left.length * block;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(s.sampleRate, 24);
  buf.writeUInt32LE(s.sampleRate * block, 28);
  buf.writeUInt16LE(block, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  let o = 44;
  for (let i = 0; i < s.left.length; i++) {
    for (const ch of [s.left[i] || 0, s.right[i] || 0]) {
      const c = Math.max(-1, Math.min(1, ch));
      const v = c < 0 ? Math.round(c * 32768) : Math.round(c * 32767);
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, v)), o);
      o += 2;
    }
  }
  return buf;
}
