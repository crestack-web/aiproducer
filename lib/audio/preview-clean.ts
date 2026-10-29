/**
 * Client-safe preview cleanup (gate + spectral denoise) for Console live playback.
 * No Node Buffer — safe to import from "use client" modules.
 */

export function gateInPlacePreview(
  buf: Float32Array,
  sampleRate: number,
  amount: number
): void {
  const a = Math.max(0, Math.min(1, amount));
  if (a < 0.02) return;
  const thrDb = -48 + a * 28;
  const thr = Math.pow(10, thrDb / 20);
  const floor = Math.max(0.05, 0.22 - a * 0.15);
  const rel = Math.exp(-1 / (0.05 * sampleRate));
  let env = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] || 0;
    const abs = Math.abs(x);
    env = abs > env ? abs : rel * env + (1 - rel) * abs;
    const open = env >= thr ? 1 : Math.max(floor, env / (thr + 1e-9));
    buf[i] = x * open;
  }
}

/** Lightweight spectral / energy denoise for live preview (frame Wiener-ish). */
export function noiseReduceInPlacePreview(
  buf: Float32Array,
  sampleRate: number,
  amount: number
): void {
  const a = Math.max(0, Math.min(1, amount));
  if (a < 0.03 || buf.length < 2048) return;
  const N = 2048;
  const hop = 512;
  const nFrames = Math.max(1, Math.floor((buf.length - N) / hop) + 1);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N));
  const frameRms: { i: number; r: number }[] = [];
  for (let f = 0; f < nFrames; f++) {
    const o = f * hop;
    let s = 0;
    for (let i = 0; i < N; i++) {
      const v = (buf[o + i] || 0) * win[i];
      s += v * v;
    }
    frameRms.push({ i: f, r: Math.sqrt(s / N) });
  }
  frameRms.sort((x, y) => x.r - y.r);
  const nNoise = Math.max(1, Math.floor(nFrames * 0.15));
  const noiseFloor =
    frameRms.slice(0, nNoise).reduce((s, x) => s + x.r, 0) / nNoise + 1e-8;
  const out = new Float32Array(buf.length);
  const norm = new Float32Array(buf.length);
  for (let f = 0; f < nFrames; f++) {
    const o = f * hop;
    let s = 0;
    for (let i = 0; i < N; i++) {
      const v = (buf[o + i] || 0) * win[i];
      s += v * v;
    }
    const rms = Math.sqrt(s / N);
    const snr = rms / noiseFloor;
    const keep = Math.max(0.12, Math.min(1, (snr - 1) / (3 + a * 6)));
    const g = 1 - a * (1 - keep);
    for (let i = 0; i < N; i++) {
      const w = win[i];
      out[o + i] += (buf[o + i] || 0) * w * w * g;
      norm[o + i] += w * w;
    }
  }
  for (let i = 0; i < buf.length; i++) {
    buf[i] = norm[i] > 1e-6 ? out[i] / norm[i] : buf[i];
  }
}

/** Process a full AudioBuffer for Console preview (returns new buffer). */
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
