/**
 * Reliable produce path for serverless — timeline assembly + light polish.
 * Skips heavy Producer Mind / fullness / multi-pass restoration so jobs finish
 * within Vercel time limits. Full engine remains available via AP_FULL_ENGINE=1.
 */
import { downloadStorageOrUrl } from "@/lib/audio/roex-assets";
import {
  encodeStereoWav,
  cloneStereo,
  applyGainStereo,
  peakOf,
  rmsOf,
  limitStereo,
  compressStereo,
  applyEqStereo,
} from "@/lib/ap-engine/dsp";
import { normalizeToInternalPcm } from "@/lib/ap-engine/ingestion/normalize";
import type { PcmStereo } from "@/lib/ap-engine/types";

/**
 * Accepts either preloaded buffers (from collectVocalsForProduce / ApVocalLayerInput)
 * or a storage path to download.
 */
export type FastVocalLayer = {
  buffer?: Buffer;
  audio_path?: string;
  pathHint?: string;
  startMs?: number | null;
  type?: string | null;
  taskType?: string | null;
  role?: string | null;
  taskId?: string;
  sectionLabel?: string | null;
};

const ROLE_GAIN: Record<string, number> = {
  lead: 1.15,
  double: 0.65,
  harmony: 0.55,
  harmony_high: 0.5,
  harmony_mid: 0.55,
  harmony_low: 0.58,
  adlib: 0.5,
  background: 0.4,
  intro: 0.85,
  outro: 0.85,
};

function roleGain(type: string): number {
  const k = (type || "lead").toLowerCase().replace(/\s+/g, "_");
  if (ROLE_GAIN[k] != null) return ROLE_GAIN[k];
  if (k.includes("harmon")) return 0.55;
  if (k.includes("adlib") || k.includes("ad-lib")) return 0.5;
  if (k.includes("double")) return 0.65;
  return 0.9;
}

function mixOnto(
  master: PcmStereo,
  layer: PcmStereo,
  startSample: number,
  gain: number
): void {
  const n = layer.left.length;
  for (let i = 0; i < n; i++) {
    const j = startSample + i;
    if (j < 0 || j >= master.left.length) continue;
    master.left[j] = (master.left[j] || 0) + (layer.left[i] || 0) * gain;
    master.right[j] = (master.right[j] || 0) + (layer.right[i] || 0) * gain;
  }
}

/** Soft duck instrumental under a vocal region so the take is not buried. */
function duckRegion(
  mix: PcmStereo,
  startSample: number,
  lengthSamples: number,
  amount = 0.55
): void {
  const fade = Math.min(Math.floor(mix.sampleRate * 0.02), Math.floor(lengthSamples / 4));
  for (let i = 0; i < lengthSamples; i++) {
    const j = startSample + i;
    if (j < 0 || j >= mix.left.length) continue;
    let g = amount;
    if (i < fade) g = 1 - (1 - amount) * (i / Math.max(1, fade));
    else if (i > lengthSamples - fade) {
      const t = (lengthSamples - i) / Math.max(1, fade);
      g = 1 - (1 - amount) * t;
    }
    mix.left[j] *= g;
    mix.right[j] *= g;
  }
}

/** Match vocal loudness to the beat so quiet phone mics still sit up front. */
function levelMatchToBeat(vocal: PcmStereo, beatRms: number, role: string): void {
  const vRms = Math.max(rmsOf(vocal.left), rmsOf(vocal.right), 1e-8);
  // Lead targets ~1.25× beat RMS; supporting roles a bit lower.
  const targetRatio = role.includes("lead") || role === "intro" || role === "outro" ? 1.25 : 0.85;
  const target = Math.max(beatRms * targetRatio, 0.04);
  let g = target / vRms;
  // Clamp so we don't explode noise floors or clip before limiter
  g = Math.min(8, Math.max(0.35, g));
  applyGainStereo(vocal, g);
  const pk = Math.max(peakOf(vocal.left), peakOf(vocal.right), 1e-6);
  if (pk > 0.92) applyGainStereo(vocal, 0.92 / pk);
}

function asNodeBuffer(data: unknown): Buffer | null {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data.length > 0 ? data : null;
  if (data instanceof Uint8Array) return data.length > 0 ? Buffer.from(data) : null;
  if (ArrayBuffer.isView(data as ArrayBufferView)) {
    const view = data as ArrayBufferView;
    if (view.byteLength <= 0) return null;
    return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}

async function loadVocalBuffer(v: FastVocalLayer): Promise<{ raw: Buffer; hint: string }> {
  const fromBuf = asNodeBuffer(v.buffer);
  if (fromBuf) {
    // Strip #comp suffix so format sniffers still see .wav/.webm
    const hint = String(v.pathHint || v.audio_path || "vocal.wav").split("#")[0];
    return { raw: fromBuf, hint };
  }
  const path = (v.audio_path || v.pathHint || "").split("#")[0];
  if (!path) throw new Error("Vocal layer missing buffer and audio_path");
  const raw = await downloadStorageOrUrl(path);
  return { raw, hint: path };
}

export async function runFastArrangement(opts: {
  beatPath: string;
  vocals: FastVocalLayer[];
  onStage?: (stage: string) => Promise<void>;
}): Promise<{ wav: Buffer; layerCount: number; durationMs: number }> {
  const report = opts.onStage || (async () => undefined);
  await report("analyzing");

  const beatRaw = await downloadStorageOrUrl(opts.beatPath);
  const beatNorm = await normalizeToInternalPcm(beatRaw, opts.beatPath);
  let beat: PcmStereo = {
    left: new Float32Array(beatNorm.pcm.left),
    right: new Float32Array(beatNorm.pcm.right),
    sampleRate: beatNorm.pcm.sampleRate,
  };
  if (beat.left.length < beat.sampleRate * 2) {
    throw new Error("Beat is too short or failed to decode");
  }

  const beatRms = Math.max(rmsOf(beat.left), rmsOf(beat.right), 1e-6);

  await report("processing_vocals");
  const layers: { pcm: PcmStereo; startMs: number; gain: number; type: string }[] = [];
  const skipReasons: string[] = [];

  for (const v of opts.vocals) {
    const label = v.taskId || v.sectionLabel || v.pathHint || v.audio_path || "layer";
    try {
      const { raw, hint } = await loadVocalBuffer(v);
      const vocalNorm = await normalizeToInternalPcm(raw, hint);
      const pcm: PcmStereo = {
        left: new Float32Array(vocalNorm.pcm.left),
        right: new Float32Array(vocalNorm.pcm.right),
        sampleRate: vocalNorm.pcm.sampleRate,
      };
      applyEqStereo(pcm, [
        { type: "highpass", freq: 80, q: 0.7 },
        { type: "peak", freq: 3200, gainDb: 2.0, q: 1.0 },
        { type: "highshelf", freq: 10000, gainDb: 1.5, q: 0.7 },
      ]);
      compressStereo(pcm, {
        thresholdDb: -18,
        ratio: 2.8,
        attackMs: 12,
        releaseMs: 100,
        makeupDb: 2.5,
      });
      const type = String(v.taskType || v.type || v.role || "lead").toLowerCase();
      levelMatchToBeat(pcm, beatRms, type);
      const startMs = Math.max(0, Number(v.startMs) || 0);
      layers.push({
        pcm,
        startMs,
        gain: roleGain(type),
        type,
      });
      console.info(
        "[fast-produce] layer",
        JSON.stringify({
          label,
          type,
          startMs,
          durationMs: vocalNorm.durationMs,
          bytes: raw.length,
        })
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      skipReasons.push(`${label}: ${msg}`);
      console.warn("[fast-produce] skip layer", label, msg);
    }
  }

  if (!layers.length) {
    throw new Error(
      `Could not decode any vocal takes${skipReasons.length ? ` (${skipReasons.join("; ")})` : ""}`
    );
  }

  await report("mixing");
  let needSamples = beat.left.length;
  for (const L of layers) {
    const end = Math.floor((L.startMs / 1000) * beat.sampleRate) + L.pcm.left.length;
    needSamples = Math.max(needSamples, end + beat.sampleRate);
  }
  if (needSamples > beat.left.length) {
    const left = new Float32Array(needSamples);
    const right = new Float32Array(needSamples);
    left.set(beat.left);
    right.set(beat.right);
    beat = { left, right, sampleRate: beat.sampleRate };
  }

  const mix = cloneStereo(beat);
  // Overall instrumental bed slightly down so vocals own the foreground
  applyGainStereo(mix, 0.72);

  for (const L of layers) {
    const start = Math.floor((L.startMs / 1000) * mix.sampleRate);
    duckRegion(mix, start, L.pcm.left.length, 0.5);
    mixOnto(mix, L.pcm, start, L.gain);
  }

  await report("mastering");
  compressStereo(mix, {
    thresholdDb: -14,
    ratio: 2.2,
    attackMs: 20,
    releaseMs: 150,
    makeupDb: 2,
  });
  applyEqStereo(mix, [
    { type: "highpass", freq: 30, q: 0.7 },
    { type: "highshelf", freq: 12000, gainDb: 0.8, q: 0.7 },
  ]);
  limitStereo(mix, -1.0);
  const peak = Math.max(peakOf(mix.left), peakOf(mix.right), 1e-6);
  if (peak > 0.95) applyGainStereo(mix, 0.95 / peak);

  const wav = encodeStereoWav(mix);
  const durationMs = Math.round((mix.left.length / mix.sampleRate) * 1000);
  console.info(
    "[fast-produce] done",
    JSON.stringify({ layerCount: layers.length, durationMs, placements: layers.map((l) => l.startMs) })
  );
  return { wav, layerCount: layers.length, durationMs };
}
