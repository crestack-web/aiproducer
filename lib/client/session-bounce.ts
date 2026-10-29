/**
 * Client-side session bounce — offline mix of timeline layers + track FX.
 * Traditional DAW export of the current edit (not the AP Produce job).
 */
"use client";

import { closePhraseGapsMono } from "@/lib/audio/phrase-cleanup";

export type BounceLayer = {
  id: string;
  kind: "beat" | "vocal";
  startMs: number;
  audioUrl: string;
  gainDb?: number;
  pan?: number;
  muted?: boolean;
  phraseCleanup?: number;
};

function encodeWavStereo(left: Float32Array, right: Float32Array, sampleRate: number): Blob {
  const n = Math.min(left.length, right.length);
  const dataSize = n * 4;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) u8[o + i] = s.charCodeAt(i);
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const s of [left[i] || 0, right[i] || 0]) {
      const v = Math.max(-1, Math.min(1, s));
      view.setInt16(o, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
      o += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function decodeUrl(ctx: AudioContext | OfflineAudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load audio for export");
  const ab = await res.arrayBuffer();
  return await ctx.decodeAudioData(ab.slice(0));
}

/**
 * Bounce layers to a stereo WAV blob.
 * Applies phrase cleanup when set; gain/pan from track settings.
 */
export async function bounceSessionToWav(opts: {
  layers: BounceLayer[];
  durationMs: number;
  sampleRate?: number;
  onProgress?: (p: number) => void;
}): Promise<Blob> {
  const sr = opts.sampleRate || 44100;
  const totalSamples = Math.max(sr, Math.ceil((opts.durationMs / 1000) * sr));
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);
  const actx = new AudioContext({ sampleRate: sr });
  try {
    const layers = opts.layers.filter((l) => l.audioUrl && !l.muted);
    let i = 0;
    for (const layer of layers) {
      opts.onProgress?.(i / Math.max(1, layers.length));
      let buf: AudioBuffer;
      try {
        buf = await decodeUrl(actx, layer.audioUrl);
      } catch {
        i++;
        continue;
      }
      const gain = Math.pow(10, ((layer.gainDb || 0) / 20));
      const pan = Math.max(-1, Math.min(1, layer.pan || 0));
      const gL = gain * Math.min(1, 1 - pan);
      const gR = gain * Math.min(1, 1 + pan);
      const start = Math.floor((layer.startMs / 1000) * sr);

      let ch0 = buf.getChannelData(0);
      let ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
      if ((layer.phraseCleanup || 0) > 0.02 && layer.kind === "vocal") {
        const mono = new Float32Array(ch0.length);
        for (let s = 0; s < ch0.length; s++) {
          mono[s] = 0.5 * ((ch0[s] || 0) + (ch1[s] || 0));
        }
        const cleaned = closePhraseGapsMono(mono, buf.sampleRate, {
          amount: layer.phraseCleanup || 0,
        });
        // Resample cleaned to mix rate if needed (simple if rates match)
        if (buf.sampleRate === sr) {
          ch0 = cleaned;
          ch1 = cleaned;
        } else {
          ch0 = cleaned;
          ch1 = cleaned;
        }
      }

      const ratio = sr / buf.sampleRate;
      const n = Math.floor(ch0.length * ratio);
      for (let s = 0; s < n; s++) {
        const srcIdx = Math.min(ch0.length - 1, Math.floor(s / ratio));
        const di = start + s;
        if (di < 0 || di >= totalSamples) continue;
        left[di] += (ch0[srcIdx] || 0) * gL;
        right[di] += (ch1[srcIdx] || 0) * gR;
      }
      i++;
    }
    // Soft limit
    let peak = 1e-6;
    for (let s = 0; s < totalSamples; s++) {
      peak = Math.max(peak, Math.abs(left[s]), Math.abs(right[s]));
    }
    if (peak > 0.99) {
      const g = 0.99 / peak;
      for (let s = 0; s < totalSamples; s++) {
        left[s] *= g;
        right[s] *= g;
      }
    }
    opts.onProgress?.(1);
    return encodeWavStereo(left, right, sr);
  } finally {
    try {
      await actx.close();
    } catch {
      /* */
    }
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
