"use client";

/**
 * Browser: decode supported audio blob → 16-bit mono WAV for produce alignment.
 *
 * - Prefer native sample rate when already 44.1 / 48 kHz.
 * - OfflineAudioContext resampling when conversion is required.
 * - Mono: if already mono, preserve; if stereo, take channel 0 (avoid phase-cancelling average).
 */

export type WavConversionResult = {
  blob: Blob;
  sampleRate: number;
  channels: 1;
  method: "passthrough_decode" | "offline_resample" | "linear_fallback";
  sourceSampleRate: number;
  sourceChannels: number;
};

const PREFERRED_RATES = new Set([44100, 48000]);

function encodePcm16MonoWav(samples: Float32Array, sampleRate: number): Blob {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = 2;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) u8[o + i] = s.charCodeAt(i);
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    const v = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    view.setInt16(o, Math.max(-32768, Math.min(32767, v)), true);
    o += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function toMono(chans: Float32Array[]): Float32Array {
  if (chans.length <= 1) return chans[0] || new Float32Array(0);
  return chans[0];
}

function linearResample(samples: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate || samples.length === 0) return samples;
  const ratio = dstRate / srcRate;
  const next = new Float32Array(Math.max(1, Math.round(samples.length * ratio)));
  for (let i = 0; i < next.length; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const t = src - i0;
    next[i] = (samples[i0] || 0) * (1 - t) + (samples[i1] || 0) * t;
  }
  return next;
}

async function offlineResample(
  samples: Float32Array,
  srcRate: number,
  dstRate: number
): Promise<Float32Array> {
  if (srcRate === dstRate || samples.length === 0) return samples;
  const duration = samples.length / srcRate;
  const Offline =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!Offline) {
    return linearResample(samples, srcRate, dstRate);
  }
  const frames = Math.max(1, Math.ceil(duration * dstRate));
  const offline = new Offline(1, frames, dstRate);
  const buffer = offline.createBuffer(1, samples.length, srcRate);
  buffer.copyToChannel(samples, 0);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice(0);
}

export async function audioBlobToWavDetailed(
  blob: Blob,
  preferredSampleRate?: number
): Promise<WavConversionResult> {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const raw = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw.slice(0));
    const sourceSampleRate = decoded.sampleRate || 44100;
    const sourceChannels = decoded.numberOfChannels || 1;
    const chans: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      chans.push(decoded.getChannelData(c));
    }
    const mono = toMono(chans);

    let samples = mono;
    let sampleRate = sourceSampleRate;
    let method: WavConversionResult["method"] = "passthrough_decode";

    const target =
      preferredSampleRate && preferredSampleRate > 0
        ? preferredSampleRate
        : PREFERRED_RATES.has(sourceSampleRate)
          ? sourceSampleRate
          : 44100;

    if (sourceSampleRate !== target) {
      try {
        samples = await offlineResample(mono, sourceSampleRate, target);
        sampleRate = target;
        method = "offline_resample";
      } catch {
        samples = linearResample(mono, sourceSampleRate, target);
        sampleRate = target;
        method = "linear_fallback";
      }
    }

    return {
      blob: encodePcm16MonoWav(samples, sampleRate),
      sampleRate,
      channels: 1,
      method,
      sourceSampleRate,
      sourceChannels,
    };
  } finally {
    void ctx.close();
  }
}

export async function audioBlobToWav(blob: Blob, targetSampleRate?: number): Promise<Blob> {
  const result = await audioBlobToWavDetailed(blob, targetSampleRate);
  return result.blob;
}
