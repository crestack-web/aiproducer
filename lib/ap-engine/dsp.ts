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
export function gateInPlace(
  buf: Float32Array,
  sampleRate: number,
  thresholdDb: number,
  residual = 0.15
): void {
  const thr = dbToGain(thresholdDb);
  const floor = Math.max(0.02, Math.min(0.35, residual));
  const rel = Math.exp(-1 / (0.05 * sampleRate));
  let env = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] || 0;
    const a = Math.abs(x);
    env = a > env ? a : rel * env + (1 - rel) * a;
    const open = env >= thr ? 1 : Math.max(floor, env / (thr + 1e-9));
    buf[i] = x * open;
  }
}

/**
 * Spectral noise reduction (Wiener-style STFT).
 * Learns a noise profile from the quietest frames, then attenuates bins
 * that look like that noise while leaving loud vocal energy mostly intact.
 * amount 0–1 (0.35 ≈ moderate, 0.7+ ≈ aggressive traffic/room cleanup).
 */
export function spectralNoiseReduceInPlace(
  buf: Float32Array,
  sampleRate: number,
  amount: number
): void {
  const a = Math.max(0, Math.min(1, amount));
  if (a < 0.03 || buf.length < 2048) return;

  const N = 2048;
  const hop = 512;
  const bins = N / 2;
  const nFrames = Math.max(1, Math.floor((buf.length - N) / hop) + 1);

  // Hann window
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N));

  // Simple real FFT via DFT on even/odd (Radix-2 iterative)
  function fft(re: Float32Array, im: Float32Array) {
    const n = re.length;
    // bit reverse
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wlenRe = Math.cos(ang);
      const wlenIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let wRe = 1;
        let wIm = 0;
        for (let j = 0; j < len / 2; j++) {
          const uRe = re[i + j];
          const uIm = im[i + j];
          const vRe = re[i + j + len / 2] * wRe - im[i + j + len / 2] * wIm;
          const vIm = re[i + j + len / 2] * wIm + im[i + j + len / 2] * wRe;
          re[i + j] = uRe + vRe;
          im[i + j] = uIm + vIm;
          re[i + j + len / 2] = uRe - vRe;
          im[i + j + len / 2] = uIm - vIm;
          const nwRe = wRe * wlenRe - wIm * wlenIm;
          wIm = wRe * wlenIm + wIm * wlenRe;
          wRe = nwRe;
        }
      }
    }
  }
  function ifft(re: Float32Array, im: Float32Array) {
    for (let i = 0; i < re.length; i++) im[i] = -im[i];
    fft(re, im);
    const inv = 1 / re.length;
    for (let i = 0; i < re.length; i++) {
      re[i] *= inv;
      im[i] = -im[i] * inv;
    }
  }

  // Frame energy for noise-profile selection
  const frameRms = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    let s = 0;
    for (let i = 0; i < N; i++) {
      const x = (buf[off + i] || 0) * win[i];
      s += x * x;
    }
    frameRms[f] = Math.sqrt(s / N);
  }
  const sorted = Array.from(frameRms).sort((x, y) => x - y);
  const quietCut = sorted[Math.max(0, Math.floor(nFrames * 0.12))] || 0;
  // Prefer quiet frames, but keep at least a few
  let quietCount = 0;
  for (let f = 0; f < nFrames; f++) if (frameRms[f] <= quietCut * 1.15) quietCount++;
  if (quietCount < 3) quietCount = Math.min(nFrames, Math.max(3, Math.floor(nFrames * 0.08)));

  const noisePow = new Float32Array(bins + 1);
  let noiseFrames = 0;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let f = 0; f < nFrames; f++) {
    if (noiseFrames >= quietCount && frameRms[f] > quietCut * 1.15) continue;
    if (frameRms[f] > quietCut * 1.15 && noiseFrames >= 3) continue;
    const off = f * hop;
    for (let i = 0; i < N; i++) {
      re[i] = (buf[off + i] || 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= bins; k++) {
      const pr = re[k] || 0;
      const pi = im[k] || 0;
      noisePow[k] += pr * pr + pi * pi;
    }
    noiseFrames++;
    if (noiseFrames >= Math.max(quietCount, 8)) break;
  }
  if (noiseFrames < 1) return;
  for (let k = 0; k <= bins; k++) noisePow[k] /= noiseFrames;

  // Over-subtraction grows with amount; spectral floor prevents musical noise
  const alpha = 1.2 + a * 2.8; // 1.2 … 4.0
  const beta = 0.02 + (1 - a) * 0.08; // residual floor 0.02–0.1
  // Protect low-mid speech formants slightly less aggressively
  const out = new Float32Array(buf.length);
  const norm = new Float32Array(buf.length);

  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    for (let i = 0; i < N; i++) {
      re[i] = (buf[off + i] || 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= bins; k++) {
      const pr = re[k] || 0;
      const pi = im[k] || 0;
      const p = pr * pr + pi * pi;
      const np = noisePow[k] || 1e-20;
      // Wiener-ish gain
      let g = (p - alpha * np) / (p + 1e-20);
      if (g < beta) g = beta;
      if (g > 1) g = 1;
      // Taper protection around 300–3500 Hz (speech) when signal >> noise
      if (k > 0) {
        const hz = (k * sampleRate) / N;
        if (hz >= 300 && hz <= 3500 && p > np * 8) {
          g = Math.max(g, 0.55 + 0.45 * (1 - a * 0.35));
        }
      }
      // Blend with dry by amount so low settings stay gentle
      g = 1 - a * (1 - g);
      re[k] = pr * g;
      im[k] = pi * g;
      if (k > 0 && k < bins) {
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
    }
    ifft(re, im);
    for (let i = 0; i < N; i++) {
      const idx = off + i;
      if (idx >= buf.length) break;
      out[idx] += (re[i] || 0) * win[i];
      norm[idx] += win[i] * win[i];
    }
  }
  for (let i = 0; i < buf.length; i++) {
    const nrm = norm[i] || 1e-12;
    buf[i] = out[i] / nrm;
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


/**
 * Grain OLA pitch shift for creative voice changing (wider range than polish).
 * Keeps output length equal to input (may time-warp slightly at extreme ratios).
 */
export function pitchShiftStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  semitones: number
): { left: Float32Array; right: Float32Array } {
  const st = Math.max(-12, Math.min(12, semitones));
  if (Math.abs(st) < 0.05) {
    return { left: new Float32Array(left), right: new Float32Array(right) };
  }
  const ratio = Math.pow(2, st / 12);
  const n = left.length;
  const grainMs = 48;
  const grain = Math.max(256, Math.floor((sampleRate * grainMs) / 1000));
  const hop = Math.max(32, Math.floor(grain / 6));
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const win = new Float32Array(grain);
  for (let i = 0; i < grain; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, grain - 1));
  }
  const norm = new Float32Array(n);

  for (let outPos = 0; outPos < n; outPos += hop) {
    const srcCenter = outPos / ratio;
    const srcStart = srcCenter - grain / 2;
    for (let i = 0; i < grain; i++) {
      const oi = outPos - Math.floor(grain / 2) + i;
      if (oi < 0 || oi >= n) continue;
      const si = srcStart + i;
      let sL = 0;
      let sR = 0;
      if (si >= 0 && si < n - 1) {
        const i0 = Math.floor(si);
        const f = si - i0;
        const i1 = Math.min(n - 1, i0 + 1);
        sL = (left[i0] || 0) * (1 - f) + (left[i1] || 0) * f;
        sR = (right[i0] || 0) * (1 - f) + (right[i1] || 0) * f;
      } else if (si >= 0 && si < n) {
        sL = left[Math.floor(si)] || 0;
        sR = right[Math.floor(si)] || 0;
      }
      const w = win[i];
      outL[oi] += sL * w;
      outR[oi] += sR * w;
      norm[oi] += w;
    }
  }
  for (let i = 0; i < n; i++) {
    const g = norm[i] > 1e-6 ? 1 / norm[i] : 0;
    outL[i] *= g;
    outR[i] *= g;
  }
  return { left: outL, right: outR };
}

/**
 * Voice changer: pitch + character color, mixed with dry.
 * character: 0 custom, 1 higher, 2 lower, 3 chipmunk, 4 deep, 5 robot, 6 alien
 * mix 0–1 wet amount; pitchSemis used when character is 0 (custom) or as offset.
 */
export function applyVoiceChangerStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  opts: { mix: number; pitchSemis?: number; character?: number }
): void {
  const mix = Math.max(0, Math.min(1, opts.mix));
  if (mix < 0.02) return;

  let semis = typeof opts.pitchSemis === "number" ? opts.pitchSemis : 0;
  const character = Math.round(opts.character || 0);
  // Character packs set a default pitch if user left pitch near 0
  if (character === 1) semis = semis || 4;
  else if (character === 2) semis = semis || -4;
  else if (character === 3) semis = semis || 7;
  else if (character === 4) semis = semis || -6;
  else if (character === 5) semis = semis || 0;
  else if (character === 6) semis = semis || 5;

  const dryL = new Float32Array(left);
  const dryR = new Float32Array(right);

  let wetL = new Float32Array(left);
  let wetR = new Float32Array(right);

  if (Math.abs(semis) >= 0.05) {
    const shifted = pitchShiftStereo(wetL, wetR, sampleRate, semis);
    // Copy into fresh ArrayBuffer-backed views (TS 5.x Float32Array generic)
    wetL = new Float32Array(shifted.left);
    wetR = new Float32Array(shifted.right);
  }

  // Character coloring
  if (character === 5) {
    // Robot: mild ring-mod + bit of grit
    const f = 55;
    for (let i = 0; i < wetL.length; i++) {
      const m = Math.sin((2 * Math.PI * f * i) / sampleRate);
      wetL[i] = (wetL[i] || 0) * (0.55 + 0.45 * m);
      wetR[i] = (wetR[i] || 0) * (0.55 + 0.45 * m);
    }
    saturateInPlace(wetL, 0.35);
    saturateInPlace(wetR, 0.35);
  } else if (character === 3 || character === 1) {
    // Brighter / helium
    applyBiquadInPlace(wetL, "highshelf", 2500, sampleRate, 3.5, 0.7);
    applyBiquadInPlace(wetR, "highshelf", 2500, sampleRate, 3.5, 0.7);
  } else if (character === 4 || character === 2) {
    applyBiquadInPlace(wetL, "lowshelf", 200, sampleRate, 4, 0.7);
    applyBiquadInPlace(wetR, "lowshelf", 200, sampleRate, 4, 0.7);
    applyBiquadInPlace(wetL, "highshelf", 5000, sampleRate, -3, 0.7);
    applyBiquadInPlace(wetR, "highshelf", 5000, sampleRate, -3, 0.7);
  } else if (character === 6) {
    applyBiquadInPlace(wetL, "peak", 1800, sampleRate, 5, 1.2);
    applyBiquadInPlace(wetR, "peak", 1800, sampleRate, 5, 1.2);
    const f = 12;
    for (let i = 0; i < wetL.length; i++) {
      const m = 1 + 0.08 * Math.sin((2 * Math.PI * f * i) / sampleRate);
      wetL[i] = (wetL[i] || 0) * m;
      wetR[i] = (wetR[i] || 0) * m;
    }
  }

  const dry = 1 - mix;
  for (let i = 0; i < left.length; i++) {
    left[i] = dryL[i] * dry + (wetL[i] || 0) * mix;
    right[i] = dryR[i] * dry + (wetR[i] || 0) * mix;
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
