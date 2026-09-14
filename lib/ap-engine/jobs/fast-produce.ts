/**
 * Reliable produce path for serverless — timeline assembly + light polish.
 * Vocals are level-matched aggressively so phone takes sit clearly above the beat.
 * Full engine remains available via AP_FULL_ENGINE=1.
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

/** Post level-match fader — lead must own the mix. */
const ROLE_GAIN: Record<string, number> = {
  lead: 1.85,
  double: 1.05,
  harmony: 0.95,
  harmony_high: 0.9,
  harmony_mid: 0.95,
  harmony_low: 0.95,
  adlib: 0.9,
  background: 0.7,
  intro: 1.4,
  outro: 1.4,
};

function roleGain(type: string): number {
  const k = (type || "lead").toLowerCase().replace(/\s+/g, "_");
  if (ROLE_GAIN[k] != null) return ROLE_GAIN[k];
  if (k.includes("harmon")) return 0.95;
  if (k.includes("adlib") || k.includes("ad-lib")) return 0.9;
  if (k.includes("double")) return 1.05;
  if (k.includes("lead") || k.includes("main") || k.includes("verse") || k.includes("chorus")) {
    return 1.85;
  }
  return 1.5;
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

/** Duck instrumental under a vocal region so the take is not buried. */
function duckRegion(
  mix: PcmStereo,
  startSample: number,
  lengthSamples: number,
  amount = 0.32
): void {
  const fade = Math.min(Math.floor(mix.sampleRate * 0.025), Math.floor(lengthSamples / 4));
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

/**
 * Match vocal loudness to the beat so quiet phone mics sit clearly in front.
 * Lead targets ~2.2× beat RMS; supporting roles slightly lower.
 */
function levelMatchToBeat(vocal: PcmStereo, beatRms: number, role: string): void {
  const vRms = Math.max(rmsOf(vocal.left), rmsOf(vocal.right), 1e-8);
  const isLead =
    role.includes("lead") ||
    role.includes("main") ||
    role.includes("verse") ||
    role.includes("chorus") ||
    role === "intro" ||
    role === "outro";
  const targetRatio = isLead ? 2.2 : 1.4;
  // Floor target so even quiet takes get pushed up hard
  const target = Math.max(beatRms * targetRatio, 0.08);
  let g = target / vRms;
  // Allow strong boost for phone mics; still clamp noise explosions
  g = Math.min(20, Math.max(0.5, g));
  applyGainStereo(vocal, g);
  const pk = Math.max(peakOf(vocal.left), peakOf(vocal.right), 1e-6);
  if (pk > 0.95) applyGainStereo(vocal, 0.95 / pk);
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
      // Presence-focused vocal chain
      applyEqStereo(pcm, [
        { type: "highpass", freq: 80, q: 0.7 },
        { type: "peak", freq: 2800, gainDb: 3.5, q: 1.0 },
        { type: "peak", freq: 5000, gainDb: 2.0, q: 1.2 },
        { type: "highshelf", freq: 9000, gainDb: 2.5, q: 0.7 },
      ]);
      compressStereo(pcm, {
        thresholdDb: -20,
        ratio: 3.2,
        attackMs: 8,
        releaseMs: 90,
        makeupDb: 4.5,
      });
      const type = String(v.taskType || v.type || v.role || "lead").toLowerCase();
      levelMatchToBeat(pcm, beatRms, type);
      // Extra presence boost after match so quiet phones still cut
      applyGainStereo(pcm, 1.25);
      const pk2 = Math.max(peakOf(pcm.left), peakOf(pcm.right), 1e-6);
      if (pk2 > 0.95) applyGainStereo(pcm, 0.95 / pk2);

      const startMs = Math.max(0, Number(v.startMs) || 0);
      const vRmsAfter = Math.max(rmsOf(pcm.left), rmsOf(pcm.right));
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
          rmsAfter: Number(vRmsAfter.toFixed(4)),
          roleGain: roleGain(type),
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
  // Instrumental bed down hard so vocals own the foreground
  applyGainStereo(mix, 0.48);

  for (const L of layers) {
    const start = Math.floor((L.startMs / 1000) * mix.sampleRate);
    // Duck beat under each take (0.32 ≈ −10 dB bed under vocals)
    duckRegion(mix, start, L.pcm.left.length, 0.32);
    mixOnto(mix, L.pcm, start, L.gain);
  }

  await report("mastering");
  compressStereo(mix, {
    thresholdDb: -12,
    ratio: 2.4,
    attackMs: 15,
    releaseMs: 120,
    makeupDb: 2.5,
  });
  applyEqStereo(mix, [
    { type: "highpass", freq: 30, q: 0.7 },
    { type: "peak", freq: 3000, gainDb: 1.2, q: 1.0 },
    { type: "highshelf", freq: 11000, gainDb: 1.0, q: 0.7 },
  ]);
  limitStereo(mix, -1.0);
  const peak = Math.max(peakOf(mix.left), peakOf(mix.right), 1e-6);
  if (peak > 0.95) applyGainStereo(mix, 0.95 / peak);

  const wav = encodeStereoWav(mix);
  const durationMs = Math.round((mix.left.length / mix.sampleRate) * 1000);
  console.info(
    "[fast-produce] done",
    JSON.stringify({
      layerCount: layers.length,
      durationMs,
      placements: layers.map((l) => l.startMs),
      roleGains: layers.map((l) => l.gain),
    })
  );
  return { wav, layerCount: layers.length, durationMs };
}
