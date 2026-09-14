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
  /** Preferred when collect already downloaded the take. */
  buffer?: Buffer;
  /** Storage path or URL — used when buffer is missing. */
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
  lead: 1,
  double: 0.55,
  harmony: 0.45,
  harmony_high: 0.42,
  harmony_mid: 0.45,
  harmony_low: 0.48,
  adlib: 0.4,
  background: 0.35,
  intro: 0.7,
  outro: 0.7,
};

function roleGain(type: string): number {
  const k = (type || "lead").toLowerCase().replace(/\s+/g, "_");
  if (ROLE_GAIN[k] != null) return ROLE_GAIN[k];
  if (k.includes("harmon")) return 0.45;
  if (k.includes("adlib") || k.includes("ad-lib")) return 0.4;
  if (k.includes("double")) return 0.55;
  return 0.7;
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

async function loadVocalBuffer(v: FastVocalLayer): Promise<{ raw: Buffer; hint: string }> {
  if (v.buffer && v.buffer.length > 0) {
    return { raw: v.buffer, hint: v.pathHint || v.audio_path || "vocal.wav" };
  }
  const path = v.audio_path || v.pathHint;
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

  await report("processing_vocals");
  const layers: { pcm: PcmStereo; startMs: number; gain: number; type: string }[] = [];
  for (const v of opts.vocals) {
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
        { type: "peak", freq: 3200, gainDb: 1.2, q: 1.0 },
        { type: "highshelf", freq: 10000, gainDb: 1.0, q: 0.7 },
      ]);
      compressStereo(pcm, {
        thresholdDb: -18,
        ratio: 2.8,
        attackMs: 12,
        releaseMs: 100,
        makeupDb: 1.5,
      });
      const pk = Math.max(peakOf(pcm.left), peakOf(pcm.right), 1e-6);
      if (pk > 0.9) applyGainStereo(pcm, 0.9 / pk);
      const type = String(v.taskType || v.type || v.role || "lead");
      layers.push({
        pcm,
        startMs: Math.max(0, v.startMs || 0),
        gain: roleGain(type),
        type,
      });
    } catch (e) {
      console.warn("[fast-produce] skip layer", v.taskId || v.pathHint || v.audio_path, e);
    }
  }
  if (!layers.length) throw new Error("Could not decode any vocal takes");

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
  applyGainStereo(mix, 0.85);
  for (const L of layers) {
    const start = Math.floor((L.startMs / 1000) * mix.sampleRate);
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
  return { wav, layerCount: layers.length, durationMs };
}
