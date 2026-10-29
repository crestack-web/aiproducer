/**
 * Client-safe vocal cleanup for Console preview + Export.
 * Closer parity with Produce: spectral denoise, de-click, de-ess, HPF, gate.
 */

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
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

/** One-pole high-pass (rumble / proximity). */
export function highPassInPlacePreview(
  buf: Float32Array,
  sampleRate: number,
  cutoffHz: number
): void {
  const fc = Math.max(20, Math.min(cutoffHz, sampleRate * 0.45));
  const x = Math.exp((-2 * Math.PI * fc) / sampleRate);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < buf.length; i++) {
    const xi = buf[i] || 0;
    const yi = x * (prevY + xi - prevX);
    prevX = xi;
    prevY = yi;
    buf[i] = yi;
  }
}

/** Soften tongue clicks / mouth pops (short impulsive spikes). */
export function deClickInPlacePreview(
  buf: Float32Array,
  sampleRate: number,
  amount: number
): void {
  const a = Math.max(0, Math.min(1, amount));
  if (a < 0.05 || buf.length < 32) return;
  const win = Math.max(8, Math.floor(sampleRate * 0.002)); // ~2ms neighborhood
  const thrMul = 3.2 - a * 1.4; // lower = more aggressive
  const out = new Float32Array(buf);
  for (let i = win; i < buf.length - win; i++) {
    let sum = 0;
    for (let k = -win; k <= win; k++) {
      if (k === 0) continue;
      sum += Math.abs(buf[i + k] || 0);
    }
    const mean = sum / (win * 2);
    const abs = Math.abs(buf[i] || 0);
    // Click: sharp sample vs neighbors
    const prev = Math.abs(buf[i - 1] || 0);
    const next = Math.abs(buf[i + 1] || 0);
    const jump = abs - 0.5 * (prev + next);
    if (mean > 1e-6 && abs > mean * thrMul && jump > mean * (1.2 - a * 0.4)) {
      // Interpolate across spike
      const blended = 0.5 * ((buf[i - 1] || 0) + (buf[i + 1] || 0));
      out[i] = (buf[i] || 0) * (1 - a * 0.92) + blended * (a * 0.92);
    }
  }
  // Second pass for double-sample clicks
  for (let i = win; i < buf.length - win - 1; i++) {
    const a0 = Math.abs(out[i] || 0);
    const a1 = Math.abs(out[i + 1] || 0);
    let sum = 0;
    for (let k = -win; k <= win; k++) {
      if (k === 0 || k === 1) continue;
      sum += Math.abs(out[i + k] || 0);
    }
    const mean = sum / (win * 2 - 1);
    if (mean > 1e-6 && a0 > mean * thrMul && a1 > mean * thrMul) {
      const blended = 0.5 * ((out[i - 1] || 0) + (out[i + 2] || 0));
      out[i] = out[i] * (1 - a * 0.85) + blended * (a * 0.85);
      out[i + 1] = out[i + 1] * (1 - a * 0.85) + blended * (a * 0.85);
    }
  }
  buf.set(out);
}

/**
 * De-ess + tame airy mouth noise (5–9 kHz band).
 * Also reduces harsh tongue/air bursts Produce usually softens.
 */
export function deEssInPlacePreview(
  buf: Float32Array,
  sampleRate: number,
  amount: number
): void {
  const a = Math.max(0, Math.min(1, amount));
  if (a < 0.04) return;
  // Extract HF band via one-pole HP @ 5kHz
  const fc = 5000;
  const x = Math.exp((-2 * Math.PI * fc) / sampleRate);
  const band = new Float32Array(buf.length);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < buf.length; i++) {
    const xi = buf[i] || 0;
    const yi = x * (prevY + xi - prevX);
    prevX = xi;
    prevY = yi;
    band[i] = yi;
  }
  // Soft LP on band ~9k so we don't only hit extreme HF
  const fc2 = 9000;
  const x2 = Math.exp((-2 * Math.PI * fc2) / sampleRate);
  let lp = 0;
  const atk = Math.exp(-1 / (0.0025 * sampleRate));
  const rel = Math.exp(-1 / (0.045 * sampleRate));
  let env = 0;
  for (let i = 0; i < buf.length; i++) {
    lp = lp + (1 - x2) * ((band[i] || 0) - lp);
    const s = Math.abs(lp);
    env = s > env ? atk * env + (1 - atk) * s : rel * env + (1 - rel) * s;
    // Stronger duck than old export path (Produce-like)
    const duck = 1 - Math.min(0.72, env * a * 5.2);
    buf[i] = (buf[i] || 0) * duck;
  }
}

/** Downward expansion / noise gate for breaths and room in gaps. */
export function gateInPlacePreview(
  buf: Float32Array,
  sampleRate: number,
  amount: number
): void {
  const a = Math.max(0, Math.min(1, amount));
  if (a < 0.02) return;
  const thrDb = -54 + a * 36;
  const thr = Math.pow(10, thrDb / 20);
  const floor = Math.max(0.004, 0.12 * (1 - a));
  const atk = Math.exp(-1 / (0.0025 * sampleRate));
  const rel = Math.exp(-1 / ((0.05 + (1 - a) * 0.08) * sampleRate));
  let env = 0;
  for (let i = 0; i < buf.length; i++) {
    const xi = buf[i] || 0;
    const abs = Math.abs(xi);
    env = abs > env ? atk * env + (1 - atk) * abs : rel * env + (1 - rel) * abs;
    let open = 1;
    if (env < thr) {
      open = Math.max(floor, (env / (thr + 1e-12)) ** (1.35 + a * 1.8));
    }
    buf[i] = xi * open;
  }
}

/** STFT spectral denoise (noise profile from quiet frames). */
export function noiseReduceInPlacePreview(
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

  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N));

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

  const alpha = 1.6 + a * 3.8;
  const beta = 0.006 + (1 - a) * 0.04;
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
      let g = (p - alpha * np) / (p + 1e-20);
      if (g < beta) g = beta;
      if (g > 1) g = 1;
      if (k > 0) {
        const hz = (k * sampleRate) / N;
        // Protect speech formants; allow more cut on airy HF (>6k) for breaths/tongue air
        if (hz >= 300 && hz <= 3500 && p > np * 8) {
          g = Math.max(g, 0.52 + 0.48 * (1 - a * 0.35));
        } else if (hz > 6000) {
          g = Math.min(g, 1 - a * 0.35);
        }
      }
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
      const w = win[i];
      out[off + i] += (re[i] || 0) * w;
      norm[off + i] += w * w;
    }
  }
  for (let i = 0; i < buf.length; i++) {
    buf[i] = norm[i] > 1e-6 ? out[i] / norm[i] : buf[i];
  }
}

/**
 * Produce-like vocal cleanup chain for one channel.
 * When denoise/gate are engaged, also de-click + de-ess so tongue clicks
 * and airy mouth noise are treated (not only broadband room tone).
 */
export function cleanVocalChannelInPlace(
  buf: Float32Array,
  sampleRate: number,
  opts: {
    noiseReduce?: number;
    gate?: number;
    deEss?: number;
    /** 0–1 explicit de-click; defaults from denoise/gate if omitted */
    deClick?: number;
  }
): void {
  const nr = opts.noiseReduce || 0;
  const gt = opts.gate || 0;
  let de = opts.deEss || 0;
  let dc = opts.deClick ?? 0;

  // Auto-engage mouth-noise tools when user asked for cleanup (matches Produce intent)
  if (de < 0.05 && (nr > 0.25 || gt > 0.25)) {
    de = Math.max(de, 0.28 + Math.max(nr, gt) * 0.35);
  }
  if (dc < 0.05 && (nr > 0.2 || gt > 0.2 || de > 0.2)) {
    dc = Math.max(dc, 0.4 + Math.max(nr, gt, de) * 0.4);
  }

  // Produce lightCleanVocal baseline
  highPassInPlacePreview(buf, sampleRate, 85);

  if (nr > 0.02) noiseReduceInPlacePreview(buf, sampleRate, nr);
  if (dc > 0.05) deClickInPlacePreview(buf, sampleRate, Math.min(1, dc));
  if (de > 0.04) deEssInPlacePreview(buf, sampleRate, Math.min(1, de));
  if (gt > 0.02) gateInPlacePreview(buf, sampleRate, gt);
  // Extra light gate when denoise is strong (airy gaps)
  if (nr > 0.45 && gt < 0.15) {
    gateInPlacePreview(buf, sampleRate, 0.22 + (nr - 0.45) * 0.5);
  }
}

/** Process a full AudioBuffer for Console preview / Export. */
export function processPreviewBuffer(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  opts: {
    gate?: number;
    noiseReduce?: number;
    deEss?: number;
    deClick?: number;
  }
): AudioBuffer {
  const gate = opts.gate || 0;
  const nr = opts.noiseReduce || 0;
  const de = opts.deEss || 0;
  const dc = opts.deClick || 0;
  if (gate < 0.02 && nr < 0.02 && de < 0.04 && dc < 0.05) return source;

  const out = ctx.createBuffer(
    source.numberOfChannels,
    source.length,
    source.sampleRate
  );
  for (let c = 0; c < source.numberOfChannels; c++) {
    const data = new Float32Array(source.getChannelData(c));
    cleanVocalChannelInPlace(data, source.sampleRate, {
      gate,
      noiseReduce: nr,
      deEss: de,
      deClick: dc,
    });
    const ab = new Float32Array(data.length);
    ab.set(data);
    out.copyToChannel(ab as unknown as Float32Array<ArrayBuffer>, c);
  }
  return out;
}
