/**
 * Client-side take editing — original audio stays on the server;
 * working buffer is derived, then committed as a new selected recording.
 */
"use client";

const FADE_MS = 4;
const MIN_REGION_MS = 120;

export type TakeRegion = { startMs: number; endMs: number };

export function isValidRegion(
  region: TakeRegion | null,
  durationMs: number,
  minMs = MIN_REGION_MS
): boolean {
  if (!region) return false;
  const a = Math.max(0, Math.min(region.startMs, region.endMs));
  const b = Math.max(region.startMs, region.endMs);
  if (b - a < minMs) return false;
  if (a >= durationMs - 8) return false;
  return true;
}

export function normalizeRegion(region: TakeRegion, durationMs: number): TakeRegion {
  let a = Math.max(0, Math.min(region.startMs, region.endMs));
  let b = Math.min(durationMs, Math.max(region.startMs, region.endMs));
  if (b - a < MIN_REGION_MS) {
    b = Math.min(durationMs, a + MIN_REGION_MS);
  }
  return { startMs: a, endMs: b };
}

function sampleIndex(ms: number, sampleRate: number, length: number): number {
  const i = Math.round((ms / 1000) * sampleRate);
  return Math.max(0, Math.min(length, i));
}

function applyEdgeFades(ch: Float32Array, fadeSamples: number): void {
  const f = Math.min(fadeSamples, Math.floor(ch.length / 4));
  if (f < 2) return;
  for (let i = 0; i < f; i++) {
    const g = i / f;
    ch[i] = (ch[i] || 0) * g;
    ch[ch.length - 1 - i] = (ch[ch.length - 1 - i] || 0) * g;
  }
}

function copyChannels(src: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < src.numberOfChannels; c++) {
    out.push(new Float32Array(src.getChannelData(c)));
  }
  return out;
}

function bufferFromChannels(
  ctx: AudioContext,
  channels: Float32Array[],
  sampleRate: number
): AudioBuffer {
  const n = channels[0]?.length || 0;
  const buf = ctx.createBuffer(Math.max(1, channels.length), Math.max(1, n), sampleRate);
  for (let c = 0; c < channels.length; c++) {
    buf.copyToChannel(channels[c], c);
  }
  return buf;
}

export async function decodeAudioUrl(
  ctx: AudioContext,
  url: string
): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not load take audio");
  const ab = await res.arrayBuffer();
  return await ctx.decodeAudioData(ab.slice(0));
}

/** Remove [startMs, endMs) and close the gap. */
export function deleteRegionFromBuffer(
  ctx: AudioContext,
  source: AudioBuffer,
  region: TakeRegion
): AudioBuffer {
  const sr = source.sampleRate;
  const len = source.length;
  const a = sampleIndex(region.startMs, sr, len);
  const b = sampleIndex(region.endMs, sr, len);
  if (b <= a) return source;
  const outLen = len - (b - a);
  const fade = Math.max(2, Math.floor((FADE_MS / 1000) * sr));
  const channels: Float32Array[] = [];
  for (let c = 0; c < source.numberOfChannels; c++) {
    const src = source.getChannelData(c);
    const dest = new Float32Array(Math.max(1, outLen));
    dest.set(src.subarray(0, a), 0);
    dest.set(src.subarray(b), a);
    // micro-fade at join
    const join = a;
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      const left = join - fade + i;
      const right = join + i;
      if (left >= 0 && left < dest.length) dest[left] = (dest[left] || 0) * (1 - g * 0.15);
      if (right >= 0 && right < dest.length) dest[right] = (dest[right] || 0) * g;
    }
    channels.push(dest);
  }
  return bufferFromChannels(ctx, channels, sr);
}

/** Keep only [startMs, endMs). */
export function keepRegionFromBuffer(
  ctx: AudioContext,
  source: AudioBuffer,
  region: TakeRegion
): AudioBuffer {
  const sr = source.sampleRate;
  const len = source.length;
  const a = sampleIndex(region.startMs, sr, len);
  const b = sampleIndex(region.endMs, sr, len);
  if (b <= a) return source;
  const fade = Math.max(2, Math.floor((FADE_MS / 1000) * sr));
  const channels: Float32Array[] = [];
  for (let c = 0; c < source.numberOfChannels; c++) {
    const slice = new Float32Array(source.getChannelData(c).subarray(a, b));
    applyEdgeFades(slice, fade);
    channels.push(slice);
  }
  return bufferFromChannels(ctx, channels, sr);
}

/**
 * Replace [startMs, endMs) with replacement audio fitted to the region length
 * so surrounding timing stays put (pad or trim replacement).
 */
export function spliceReplacementIntoBuffer(
  ctx: AudioContext,
  source: AudioBuffer,
  region: TakeRegion,
  replacement: AudioBuffer
): AudioBuffer {
  const sr = source.sampleRate;
  const len = source.length;
  const a = sampleIndex(region.startMs, sr, len);
  const b = sampleIndex(region.endMs, sr, len);
  const regionSamples = Math.max(1, b - a);

  // Resample replacement to source rate if needed (simple nearest)
  let repChannels: Float32Array[] = [];
  const repLen = Math.max(1, Math.round(replacement.duration * sr));
  for (let c = 0; c < Math.max(source.numberOfChannels, replacement.numberOfChannels); c++) {
    const srcCh =
      replacement.getChannelData(Math.min(c, replacement.numberOfChannels - 1));
    const out = new Float32Array(repLen);
    const ratio = srcCh.length / repLen;
    for (let i = 0; i < repLen; i++) {
      out[i] = srcCh[Math.min(srcCh.length - 1, Math.floor(i * ratio))] || 0;
    }
    repChannels.push(out);
  }
  while (repChannels.length < source.numberOfChannels) {
    repChannels.push(new Float32Array(repChannels[0]));
  }

  // Fit to region length
  const fitted: Float32Array[] = [];
  for (let c = 0; c < source.numberOfChannels; c++) {
    const fit = new Float32Array(regionSamples);
    const src = repChannels[c] || repChannels[0];
    const copy = Math.min(regionSamples, src.length);
    fit.set(src.subarray(0, copy), 0);
    const fade = Math.max(2, Math.floor((FADE_MS / 1000) * sr));
    applyEdgeFades(fit, fade);
    fitted.push(fit);
  }

  const channels: Float32Array[] = [];
  for (let c = 0; c < source.numberOfChannels; c++) {
    const src = source.getChannelData(c);
    const dest = new Float32Array(len);
    dest.set(src.subarray(0, a), 0);
    dest.set(fitted[c], a);
    dest.set(src.subarray(b), b);
    channels.push(dest);
  }
  return bufferFromChannels(ctx, channels, sr);
}

/** Encode mono/stereo buffer as 16-bit WAV blob */
export function encodeWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const length = buffer.length;
  const dataLength = length * numChannels * 2;
  const ab = new ArrayBuffer(44 + dataLength);
  const view = new DataView(ab);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

export function bufferDurationMs(buffer: AudioBuffer): number {
  return Math.round((buffer.length / buffer.sampleRate) * 1000);
}

/** Build crude peak array for local waveform preview */
export function peaksFromBuffer(buffer: AudioBuffer, buckets = 128): number[] {
  const ch = buffer.getChannelData(0);
  const peaks: number[] = [];
  const step = Math.max(1, Math.floor(ch.length / buckets));
  for (let i = 0; i < buckets; i++) {
    let m = 0;
    const a = i * step;
    const b = Math.min(ch.length, a + step);
    for (let j = a; j < b; j++) m = Math.max(m, Math.abs(ch[j] || 0));
    peaks.push(m);
  }
  return peaks;
}
