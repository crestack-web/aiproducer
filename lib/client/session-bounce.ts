/**
 * Client-side session bounce — offline mix of timeline layers + track FX + automation.
 * Traditional DAW export of the current edit (not the AP Produce job).
 */
"use client";

import { closePhraseGapsMono } from "@/lib/audio/phrase-cleanup";
import { gateInPlace, spectralNoiseReduceInPlace } from "@/lib/ap-engine/dsp";
import {
  createLiveTrackFxGraph,
  trackFxToLiveParams,
  type LiveFxParams,
} from "@/lib/audio/live-track-fx";
import {
  sampleTrackAutomation,
  emptyAutomation,
  type FxAutomationDoc,
} from "@/lib/ap-engine/fx-automation";

export type BounceFx = Record<string, number>;

export type BounceLayer = {
  id: string;
  kind: "beat" | "vocal";
  startMs: number;
  audioUrl: string;
  /** Full track FX baseline (gain, pan, reverb, telephone, …) */
  fx?: BounceFx;
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

async function decodeUrl(
  ctx: BaseAudioContext,
  url: string
): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load audio for export");
  const ab = await res.arrayBuffer();
  return await ctx.decodeAudioData(ab.slice(0));
}

function mergeFx(
  base: BounceFx,
  auto: Partial<Record<string, number>>
): BounceFx {
  return { ...base, ...auto };
}

function automationBreakpoints(
  doc: FxAutomationDoc,
  trackId: string,
  startMs: number,
  endMs: number
): number[] {
  const times = new Set<number>([startMs, endMs]);
  for (const lane of doc.lanes) {
    if (lane.trackId !== trackId || lane.enabled === false) continue;
    for (const pt of lane.points) {
      if (pt.timeMs >= startMs - 1 && pt.timeMs <= endMs + 1) {
        times.add(Math.max(startMs, Math.min(endMs, pt.timeMs)));
      }
    }
  }
  // Dense sample for smooth curves (~50ms)
  for (let t = startMs; t <= endMs; t += 50) times.add(t);
  return Array.from(times).sort((a, b) => a - b);
}

/**
 * Bounce layers to a stereo WAV blob using the same FX graph as Console live
 * playback, with automation scheduled offline over the song timeline.
 */
export async function bounceSessionToWav(opts: {
  layers: BounceLayer[];
  durationMs: number;
  sampleRate?: number;
  automation?: FxAutomationDoc;
  onProgress?: (p: number) => void;
}): Promise<Blob> {
  const sr = opts.sampleRate || 44100;
  const totalSamples = Math.max(sr, Math.ceil((opts.durationMs / 1000) * sr));
  const durationSec = totalSamples / sr;
  const autoDoc = opts.automation || emptyAutomation();
  const layers = opts.layers.filter((l) => l.audioUrl && !l.muted);

  if (!layers.length) {
    throw new Error("Nothing to export — add a beat or vocal first.");
  }

  // Decode with a temporary Online context (Offline cannot always decode in all browsers)
  const decodeCtx = new AudioContext({ sampleRate: sr });
  const decoded: { layer: BounceLayer; buffer: AudioBuffer }[] = [];
  try {
    let i = 0;
    for (const layer of layers) {
      opts.onProgress?.(0.05 + (i / Math.max(1, layers.length)) * 0.25);
      try {
        let buf = await decodeUrl(decodeCtx, layer.audioUrl);
        if (layer.kind === "vocal") {
          const fx = layer.fx || {};
          const nr = Number(fx.noiseReduce) || 0;
          const gt = Number(fx.gate) || 0;
          const pc = layer.phraseCleanup || Number(fx.phraseCleanup) || 0;
          if (nr > 0.02 || gt > 0.02 || pc > 0.02) {
            const ch0 = buf.getChannelData(0);
            const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
            const left = new Float32Array(ch0);
            const right = new Float32Array(ch1);
            if (nr > 0.02) {
              spectralNoiseReduceInPlace(left, buf.sampleRate, nr);
              spectralNoiseReduceInPlace(right, buf.sampleRate, nr);
            }
            if (gt > 0.02) {
              const thr = -48 + gt * 28; // 0→-48dB, 1→-20dB
              const residual = Math.max(0.05, 0.22 - gt * 0.15);
              gateInPlace(left, buf.sampleRate, thr, residual);
              gateInPlace(right, buf.sampleRate, thr, residual);
            }
            if (pc > 0.02) {
              const mono = new Float32Array(left.length);
              for (let s = 0; s < left.length; s++) {
                mono[s] = 0.5 * ((left[s] || 0) + (right[s] || 0));
              }
              const cleaned = closePhraseGapsMono(mono, buf.sampleRate, { amount: pc });
              const monoBuf = decodeCtx.createBuffer(1, cleaned.length, buf.sampleRate);
              monoBuf.copyToChannel(cleaned, 0);
              buf = monoBuf;
            } else {
              const out = decodeCtx.createBuffer(2, left.length, buf.sampleRate);
              out.copyToChannel(left, 0);
              out.copyToChannel(right, 1);
              buf = out;
            }
          }
        }
        decoded.push({ layer, buffer: buf });
      } catch {
        /* skip failed layer */
      }
      i++;
    }
  } finally {
    try {
      await decodeCtx.close();
    } catch {
      /* */
    }
  }

  if (!decoded.length) {
    throw new Error("Could not load any audio for export.");
  }

  opts.onProgress?.(0.35);
  const offline = new OfflineAudioContext(2, totalSamples, sr);

  for (let li = 0; li < decoded.length; li++) {
    const { layer, buffer } = decoded[li];
    opts.onProgress?.(0.35 + (li / decoded.length) * 0.4);

    const src = offline.createBufferSource();
    src.buffer = buffer;
    const graph = createLiveTrackFxGraph(offline);
    src.connect(graph.input);
    graph.output.connect(offline.destination);

    const baseFx = { ...(layer.fx || {}) };
    const startMs = Math.max(0, layer.startMs || 0);
    const startSec = startMs / 1000;
    const layerEndMs = startMs + (buffer.duration * 1000);
    const endMs = Math.min(opts.durationMs, layerEndMs);

    const times = automationBreakpoints(autoDoc, layer.id, startMs, endMs);
    // Apply at t=0 (graph default) then at each breakpoint in song time
    const baseParams = trackFxToLiveParams(baseFx as LiveFxParams as unknown as Record<string, number>);
    graph.apply(baseParams, true, 0);

    for (const tMs of times) {
      const auto = sampleTrackAutomation(autoDoc, layer.id, tMs);
      const merged = mergeFx(baseFx, auto);
      const params = trackFxToLiveParams(merged as unknown as Record<string, number>);
      // Schedule at absolute offline time = song position
      graph.apply(params, true, tMs / 1000);
    }

    try {
      src.start(startSec);
    } catch {
      /* */
    }
  }

  opts.onProgress?.(0.8);
  const rendered = await offline.startRendering();
  const left = rendered.getChannelData(0);
  const right =
    rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;

  // Soft limit
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);
  let peak = 1e-6;
  for (let s = 0; s < left.length; s++) {
    peak = Math.max(peak, Math.abs(left[s] || 0), Math.abs(right[s] || 0));
  }
  const g = peak > 0.99 ? 0.99 / peak : 1;
  for (let s = 0; s < left.length; s++) {
    outL[s] = (left[s] || 0) * g;
    outR[s] = (right[s] || 0) * g;
  }

  opts.onProgress?.(1);
  return encodeWavStereo(outL, outR, sr);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
