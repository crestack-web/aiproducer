/**
 * Client-side session bounce — offline mix of timeline layers + track FX + automation.
 * Traditional DAW export of the current edit (not the AP Produce job).
 *
 * Reliability contract (Phase 1):
 * - Never silently omit a non-muted layer that was requested for export.
 * - Decode failures surface actionable errors (label + reason).
 * - Duration includes effect-tail pad so reverb/delay are not truncated.
 */
"use client";

import { closePhraseGapsMono } from "@/lib/audio/phrase-cleanup";
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
import { cleanVocalChannelInPlace } from "@/lib/audio/preview-clean";

/** Ensure Float32Array is ArrayBuffer-backed for AudioBuffer.copyToChannel (TS 5.x DOM types). */
function toArrayBufferF32(src: Float32Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer(src.byteLength));
  out.set(src);
  return out;
}

export type BounceFx = Record<string, number>;

export type BounceLayer = {
  id: string;
  kind: "beat" | "vocal";
  startMs: number;
  audioUrl: string;
  /** Human-readable name for error messages */
  label?: string;
  /** Same-origin fallback when signed URL fails (CORS / expired) */
  fallbackUrl?: string | null;
  /** Full track FX baseline (gain, pan, reverb, telephone, …) */
  fx?: BounceFx;
  muted?: boolean;
  phraseCleanup?: number;
};

export type BounceResult = {
  blob: Blob;
  /** Layers that decoded and mixed successfully */
  included: string[];
  /** Non-fatal notes (e.g. muted layers skipped intentionally) */
  notes: string[];
  durationMs: number;
  sampleRate: number;
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
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} loading audio`);
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength < 64) {
    throw new Error("Audio file is empty or too small");
  }
  try {
    return await ctx.decodeAudioData(ab.slice(0));
  } catch {
    throw new Error("Browser could not decode this audio format");
  }
}

/** Try primary URL, then same-origin fallback (recording/beat proxy). */
async function decodeLayerAudio(
  ctx: BaseAudioContext,
  layer: BounceLayer
): Promise<AudioBuffer> {
  const candidates = [layer.audioUrl, layer.fallbackUrl].filter(
    (u): u is string => typeof u === "string" && u.length > 0
  );
  // De-dupe
  const seen = new Set<string>();
  const unique = candidates.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
  if (!unique.length) {
    throw new Error("No audio URL");
  }
  const errors: string[] = [];
  for (const url of unique) {
    try {
      return await decodeUrl(ctx, url);
    } catch (e) {
      errors.push(`${url.slice(0, 80)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(errors.join(" | ") || "Could not decode audio");
}

function mergeFx(
  base: BounceFx,
  auto: Partial<Record<string, number>>
): BounceFx {
  const out: BounceFx = { ...base };
  for (const [k, v] of Object.entries(auto)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
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
  for (let t = startMs; t <= endMs; t += 50) times.add(t);
  return Array.from(times).sort((a, b) => a - b);
}

/** Estimate reverb/delay tail padding from FX amounts (ms). */
function tailPadMs(fx: BounceFx | undefined): number {
  if (!fx) return 400;
  const rev = Math.max(Number(fx.reverb) || 0, Number(fx.plateReverb) || 0);
  const del = Math.max(Number(fx.delay) || 0, Number(fx.slapDelay) || 0);
  return Math.round(400 + rev * 2800 + del * 1200);
}

/**
 * Bounce layers to a stereo WAV.
 * Throws if any non-muted layer fails to decode — never omits tracks silently.
 */
export async function bounceSessionToWav(opts: {
  layers: BounceLayer[];
  durationMs: number;
  sampleRate?: number;
  automation?: FxAutomationDoc;
  onProgress?: (p: number) => void;
  /** When true (default), fail if any active layer cannot be decoded */
  strict?: boolean;
}): Promise<Blob> {
  const result = await bounceSessionToWavDetailed(opts);
  return result.blob;
}

export async function bounceSessionToWavDetailed(opts: {
  layers: BounceLayer[];
  durationMs: number;
  sampleRate?: number;
  automation?: FxAutomationDoc;
  onProgress?: (p: number) => void;
  strict?: boolean;
}): Promise<BounceResult> {
  const strict = opts.strict !== false;
  const sr = opts.sampleRate || 44100;
  const autoDoc = opts.automation || emptyAutomation();
  const notes: string[] = [];

  const mutedSkipped = opts.layers.filter((l) => l.muted);
  for (const m of mutedSkipped) {
    notes.push(`Skipped muted track: ${m.label || m.id}`);
  }

  const active = opts.layers.filter((l) => !l.muted);
  if (!active.length) {
    throw new Error("Nothing to export — all tracks are muted, or no audio was added.");
  }

  const missingUrl = active.filter((l) => !l.audioUrl && !l.fallbackUrl);
  if (missingUrl.length) {
    const names = missingUrl.map((l) => l.label || l.id).join(", ");
    throw new Error(
      `Cannot export — missing audio for: ${names}. Re-open Console or re-upload those tracks.`
    );
  }

  // Duration: requested length + max FX tail so space is not cut off
  let maxTail = 400;
  let contentEnd = opts.durationMs;
  for (const l of active) {
    maxTail = Math.max(maxTail, tailPadMs(l.fx));
  }
  const durationMs = Math.max(1000, Math.ceil(contentEnd + maxTail));
  const totalSamples = Math.max(sr, Math.ceil((durationMs / 1000) * sr));

  const decodeCtx = new AudioContext({ sampleRate: sr });
  const decoded: { layer: BounceLayer; buffer: AudioBuffer }[] = [];
  const failures: { layer: BounceLayer; reason: string }[] = [];

  try {
    for (let i = 0; i < active.length; i++) {
      const layer = active[i];
      opts.onProgress?.(0.05 + (i / Math.max(1, active.length)) * 0.25);
      try {
        let buf = await decodeLayerAudio(decodeCtx, layer);
        if (layer.kind === "vocal") {
          const fx = layer.fx || {};
          const nr = Number(fx.noiseReduce) || 0;
          const gt = Number(fx.gate) || 0;
          const de = Number(fx.deEss) || 0;
          const pc = layer.phraseCleanup || Number(fx.phraseCleanup) || 0;
          if (nr > 0.02 || gt > 0.02 || de > 0.04 || pc > 0.02) {
            const ch0 = buf.getChannelData(0);
            const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
            const left = new Float32Array(ch0);
            const right = new Float32Array(ch1);
            cleanVocalChannelInPlace(left, buf.sampleRate, {
              noiseReduce: nr,
              gate: gt,
              deEss: de,
            });
            cleanVocalChannelInPlace(right, buf.sampleRate, {
              noiseReduce: nr,
              gate: gt,
              deEss: de,
            });
            if (pc > 0.02) {
              const mono = new Float32Array(left.length);
              for (let s = 0; s < left.length; s++) {
                mono[s] = 0.5 * ((left[s] || 0) + (right[s] || 0));
              }
              const cleaned = closePhraseGapsMono(mono, buf.sampleRate, { amount: pc });
              const monoBuf = decodeCtx.createBuffer(1, cleaned.length, buf.sampleRate);
              monoBuf.copyToChannel(toArrayBufferF32(cleaned), 0);
              buf = monoBuf;
            } else {
              const out = decodeCtx.createBuffer(2, left.length, buf.sampleRate);
              out.copyToChannel(toArrayBufferF32(left), 0);
              out.copyToChannel(toArrayBufferF32(right), 1);
              buf = out;
            }
          }
        }
        decoded.push({ layer, buffer: buf });
      } catch (e) {
        failures.push({
          layer,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    try {
      await decodeCtx.close();
    } catch {
      /* */
    }
  }

  if (failures.length) {
    const detail = failures
      .map((f) => `• ${f.layer.label || f.layer.id}: ${f.reason}`)
      .join("\n");
    if (strict || !decoded.length) {
      throw new Error(
        `Export failed — could not load ${failures.length} track(s):\n${detail}\n\nTry re-opening Console, or re-upload the failed track.`
      );
    }
    notes.push(`Loaded without: ${failures.map((f) => f.layer.label || f.layer.id).join(", ")}`);
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
    const layerEndMs = startMs + buffer.duration * 1000;
    const endMs = Math.min(durationMs, layerEndMs + tailPadMs(baseFx));

    const times = automationBreakpoints(autoDoc, layer.id, startMs, endMs);
    const baseParams = trackFxToLiveParams(
      baseFx as LiveFxParams as unknown as Record<string, number>
    );
    graph.apply(baseParams, true, 0);

    for (const tMs of times) {
      const auto = sampleTrackAutomation(autoDoc, layer.id, tMs);
      const merged = mergeFx(baseFx, auto);
      const params = trackFxToLiveParams(merged as unknown as Record<string, number>);
      graph.apply(params, true, tMs / 1000);
    }

    // Schedule buffer at timeline position; allow full buffer + graph tails
    try {
      if (startSec >= durationMs / 1000) {
        throw new Error("Clip starts after export end");
      }
      src.start(startSec);
    } catch (e) {
      throw new Error(
        `Could not place track "${layer.label || layer.id}" on the timeline: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }

  opts.onProgress?.(0.8);
  let rendered: AudioBuffer;
  try {
    rendered = await offline.startRendering();
  } catch (e) {
    throw new Error(
      `Export render failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const left = rendered.getChannelData(0);
  const right =
    rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;

  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);
  let peak = 1e-6;
  for (let s = 0; s < left.length; s++) {
    peak = Math.max(peak, Math.abs(left[s] || 0), Math.abs(right[s] || 0));
  }
  // Prevent digital clip without changing quiet mixes much
  const g = peak > 0.99 ? 0.99 / peak : 1;
  for (let s = 0; s < left.length; s++) {
    outL[s] = (left[s] || 0) * g;
    outR[s] = (right[s] || 0) * g;
  }

  // Sanity: near-silent export usually means something went wrong
  if (peak < 1e-5) {
    throw new Error(
      "Export produced near-silent audio. Check that tracks are not muted and audio loaded correctly."
    );
  }

  opts.onProgress?.(1);
  const blob = encodeWavStereo(outL, outR, sr);
  if (blob.size < 1000) {
    throw new Error("Export file is invalid (too small). Please try again.");
  }

  return {
    blob,
    included: decoded.map((d) => d.layer.label || d.layer.id),
    notes,
    durationMs,
    sampleRate: sr,
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
