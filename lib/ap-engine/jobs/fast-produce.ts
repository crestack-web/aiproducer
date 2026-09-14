/**
 * Fast produce path (STOPGAP) — timeline assembly + light polish for Vercel time limits.
 *
 * WHY THIS EXISTS (git: f0915f2): full runApArrangement timed out / stalled on Vercel,
 * so Produce was switched to this path by default. Full engine remains via AP_FULL_ENGINE=1.
 *
 * This file is intentionally a temporary quality floor, not the long-term mixer:
 * - Mild musical duck (not rectangular -10 dB gates)
 * - Light HPF + soft gate before any gain boost (noise not scaled up raw)
 * - Conservatively staged gain so peaks stay under 1.0 into the mix bus
 *
 * engineVersion / meta path: "ap-fast-stopgap-2"
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
  highPassInPlace,
  gateInPlace,
} from "@/lib/ap-engine/dsp";
import { normalizeToInternalPcm } from "@/lib/ap-engine/ingestion/normalize";
import type { PcmStereo } from "@/lib/ap-engine/types";

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

/** Post level-match fader — modest; level-match already sits the take. */
const ROLE_GAIN: Record<string, number> = {
  lead: 1.12,
  double: 0.72,
  harmony: 0.65,
  harmony_high: 0.62,
  harmony_mid: 0.65,
  harmony_low: 0.65,
  adlib: 0.62,
  background: 0.5,
  intro: 1.0,
  outro: 1.0,
};

function roleGain(type: string): number {
  const k = (type || "lead").toLowerCase().replace(/\s+/g, "_");
  if (ROLE_GAIN[k] != null) return ROLE_GAIN[k];
  if (k.includes("harmon")) return 0.65;
  if (k.includes("adlib") || k.includes("ad-lib")) return 0.62;
  if (k.includes("double")) return 0.72;
  if (k.includes("lead") || k.includes("main") || k.includes("verse") || k.includes("chorus")) {
    return 1.12;
  }
  return 1.0;
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

/**
 * Envelope-follow duck: reduce beat only where vocal energy is present.
 * Depth ~3–4 dB (amount 0.68), attack/release ~300 ms — not a rectangular gate.
 */
function duckBeatUnderVocalEnvelope(
  mix: PcmStereo,
  vocal: PcmStereo,
  startSample: number,
  depthLinear = 0.68,
  attackMs = 300,
  releaseMs = 350
): void {
  const sr = mix.sampleRate;
  const attack = Math.max(1, Math.floor((attackMs / 1000) * sr));
  const release = Math.max(1, Math.floor((releaseMs / 1000) * sr));
  const n = vocal.left.length;
  let noise = 0;
  const probe = Math.min(n, Math.floor(sr * 0.15));
  for (let i = 0; i < probe; i++) {
    const a = Math.abs(vocal.left[i] || 0);
    const b = Math.abs(vocal.right[i] || 0);
    noise += a + b;
  }
  noise = (noise / Math.max(1, probe * 2)) * 3 + 0.008;

  let env = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.max(Math.abs(vocal.left[i] || 0), Math.abs(vocal.right[i] || 0));
    const target = v > noise ? 1 : 0;
    const coeff = target > env ? 1 / attack : 1 / release;
    env += (target - env) * Math.min(1, coeff * 8);
    if (env < 0) env = 0;
    if (env > 1) env = 1;
    const g = 1 - env * (1 - depthLinear);
    const j = startSample + i;
    if (j < 0 || j >= mix.left.length) continue;
    mix.left[j] *= g;
    mix.right[j] *= g;
  }
}

/**
 * Mild level-match — keep phone takes audible without ×20 noise blow-up.
 * Lead targets ~1.15× beat RMS; max boost ×4.
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
  const targetRatio = isLead ? 1.15 : 0.9;
  const target = Math.max(beatRms * targetRatio, 0.035);
  let g = target / vRms;
  g = Math.min(4, Math.max(0.6, g));
  applyGainStereo(vocal, g);
  const pk = Math.max(peakOf(vocal.left), peakOf(vocal.right), 1e-6);
  if (pk > 0.85) applyGainStereo(vocal, 0.85 / pk);
}

/** Light noise floor control before any boost stack. */
function lightCleanVocal(pcm: PcmStereo): void {
  highPassInPlace(pcm.left, pcm.sampleRate, 80);
  highPassInPlace(pcm.right, pcm.sampleRate, 80);
  gateInPlace(pcm.left, pcm.sampleRate, -42);
  gateInPlace(pcm.right, pcm.sampleRate, -42);
}

/** Ensure peak * fader stays under headroom before summing into the beat. */
function headroomForFader(pcm: PcmStereo, fader: number, maxIntoBus = 0.85): void {
  const pk = Math.max(peakOf(pcm.left), peakOf(pcm.right), 1e-6);
  const into = pk * fader;
  if (into > maxIntoBus) {
    applyGainStereo(pcm, maxIntoBus / into);
  }
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
}): Promise<{
  wav: Buffer;
  layerCount: number;
  durationMs: number;
  path: "fast-stopgap";
  diagnostics: Record<string, unknown>;
}> {
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
  const beatPeak = Math.max(peakOf(beat.left), peakOf(beat.right));

  await report("processing_vocals");
  const layers: { pcm: PcmStereo; startMs: number; gain: number; type: string }[] = [];
  const skipReasons: string[] = [];
  const layerDiag: Record<string, unknown>[] = [];

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

      lightCleanVocal(pcm);
      const rmsAfterClean = Math.max(rmsOf(pcm.left), rmsOf(pcm.right));

      applyEqStereo(pcm, [
        { type: "highpass", freq: 80, q: 0.7 },
        { type: "peak", freq: 3000, gainDb: 1.5, q: 1.0 },
        { type: "highshelf", freq: 10000, gainDb: 0.8, q: 0.7 },
      ]);
      compressStereo(pcm, {
        thresholdDb: -18,
        ratio: 2.4,
        attackMs: 15,
        releaseMs: 120,
        makeupDb: 1.5,
      });

      const type = String(v.taskType || v.type || v.role || "lead").toLowerCase();
      levelMatchToBeat(pcm, beatRms, type);
      const fader = roleGain(type);
      headroomForFader(pcm, fader, 0.85);

      const startMs = Math.max(0, Number(v.startMs) || 0);
      const peakPreMix = Math.max(peakOf(pcm.left), peakOf(pcm.right));
      layers.push({ pcm, startMs, gain: fader, type });
      layerDiag.push({
        label,
        type,
        startMs,
        durationMs: vocalNorm.durationMs,
        bytes: raw.length,
        rmsAfterClean: Number(rmsAfterClean.toFixed(5)),
        peakPreMix: Number(peakPreMix.toFixed(4)),
        fader,
        intoBusPeak: Number((peakPreMix * fader).toFixed(4)),
      });
      console.info("[fast-produce-stopgap] layer", JSON.stringify(layerDiag[layerDiag.length - 1]));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      skipReasons.push(`${label}: ${msg}`);
      console.warn("[fast-produce-stopgap] skip layer", label, msg);
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
  applyGainStereo(mix, 0.75);

  for (const L of layers) {
    const start = Math.floor((L.startMs / 1000) * mix.sampleRate);
    duckBeatUnderVocalEnvelope(mix, L.pcm, start, 0.68, 300, 350);
    mixOnto(mix, L.pcm, start, L.gain);
  }

  const peakBeforeLimit = Math.max(peakOf(mix.left), peakOf(mix.right));

  await report("mastering");
  compressStereo(mix, {
    thresholdDb: -14,
    ratio: 2.0,
    attackMs: 25,
    releaseMs: 180,
    makeupDb: 1.2,
  });
  applyEqStereo(mix, [
    { type: "highpass", freq: 30, q: 0.7 },
    { type: "highshelf", freq: 12000, gainDb: 0.5, q: 0.7 },
  ]);
  limitStereo(mix, -1.0);
  const peak = Math.max(peakOf(mix.left), peakOf(mix.right), 1e-6);
  if (peak > 0.95) applyGainStereo(mix, 0.95 / peak);

  const wav = encodeStereoWav(mix);
  const durationMs = Math.round((mix.left.length / mix.sampleRate) * 1000);
  const diagnostics = {
    path: "fast-stopgap" as const,
    engineVersion: "ap-fast-stopgap-2",
    duck: {
      depthLinear: 0.68,
      depthDbApprox: -3.3,
      attackMs: 300,
      releaseMs: 350,
      mode: "vocal_envelope",
    },
    bedGain: 0.75,
    beatRms: Number(beatRms.toFixed(5)),
    beatPeak: Number(beatPeak.toFixed(4)),
    peakBeforeLimit: Number(peakBeforeLimit.toFixed(4)),
    peakAfterLimit: Number(Math.min(peak, 0.95).toFixed(4)),
    layers: layerDiag,
    note: "STOPGAP path for Vercel; enable AP_FULL_ENGINE=1 for full restoration/QC",
  };
  console.info(
    "[fast-produce-stopgap] done",
    JSON.stringify({ layerCount: layers.length, durationMs, diagnostics })
  );
  return { wav, layerCount: layers.length, durationMs, path: "fast-stopgap", diagnostics };
}
