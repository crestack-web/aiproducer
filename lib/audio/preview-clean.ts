/**
 * Client-safe vocal cleanup for Console preview + Export.
 * Real spectral denoise (STFT) + noise gate — no Node Buffer.
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

/** Downward expansion / noise gate. amount 0–1. */
export function gateInPlacePreview(
  buf: Float32Array,
  sampleRate: number,
  amount: number
): void {
  const a = Math.max(0, Math.min(1, amount));
  if (a < 0.02) return;
  // Higher amount → higher threshold + near-silent floor in gaps
  const thrDb = -52 + a * 34; // ~-52dB … -18dB
  const thr = Math.pow(10, thrDb / 20);
  const floor = Math.max(0.008, 0.16 * (1 - a)); // was ~0.15 residual — too open
  const atk = Math.exp(-1 / (0.003 * sampleRate));
  const rel = Math.exp(-1 / ((0.04 + (1 - a) * 0.06) * sampleRate));
  let env = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] || 0;
    const abs = Math.abs(x);
    env = abs > env ? atk * env + (1 - atk) * abs : rel * env + (1 - rel) * abs;
    let open = 1;
    if (env < thr) {
      open = Math.max(floor, (env / (thr + 1e-12)) ** (1.2 + a * 1.5));
    }
    buf[i] = x * open;
  }
}

/**
 * Real spectral noise reduction (noise profile from quiet frames + over-subtraction).
 * Same approach as Produce offline path.
 */
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

  // Stronger than before so Medium/Strong presets are actually audible on Export
  const alpha = 1.5 + a * 3.5; // 1.5 … 5.0 over-subtraction
  const beta = 0.008 + (1 - a) * 0.05; // residual floor
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
        if (hz >= 300 && hz <= 3500 && p > np * 8) {
          g = Math.max(g, 0.5 + 0.5 * (1 - a * 0.4));
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

/** Process a full AudioBuffer for Console preview / shared cleanup. */
export function processPreviewBuffer(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  opts: { gate?: number; noiseReduce?: number }
): AudioBuffer {
  const gate = opts.gate || 0;
  const nr = opts.noiseReduce || 0;
  if (gate < 0.02 && nr < 0.02) return source;
  const out = ctx.createBuffer(
    source.numberOfChannels,
    source.length,
    source.sampleRate
  );
  for (let c = 0; c < source.numberOfChannels; c++) {
    const data = new Float32Array(source.getChannelData(c));
    if (nr > 0.02) noiseReduceInPlacePreview(data, source.sampleRate, nr);
    if (gate > 0.02) gateInPlacePreview(data, source.sampleRate, gate);
    const ab = new Float32Array(new ArrayBuffer(data.byteLength));
    ab.set(data);
    out.copyToChannel(ab, c);
  }
  return out;
}
