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
  dbToGain,
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
import {
  normalizeToStreamingTarget,
  truePeakLimit,
  estimateLoudnessProxyDb,
} from "@/lib/ap-engine/master/loudness";
import { analyzePerformance, decideVocalSpace, applyVocalSpace } from "@/lib/ap-engine/space";
import {
  buildArrangementPlan,
  applySectionAutomation,
  type ArrangementPlan,
} from "@/lib/ap-engine/arrangement";
import { resolveGenreProfile } from "@/lib/ap-engine/profiles/genre-profiles";

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

/** Fast path engine id — bump when mix/master separation or loudness changes. */
export const FAST_ENGINE_VERSION = "ap-fast-space-5";

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
  genre?: string | null;
  bpm?: number | null;
}): Promise<{
  /** @deprecated same as masterWav — kept for older callers */
  wav: Buffer;
  mixWav: Buffer;
  masterWav: Buffer;
  layerCount: number;
  durationMs: number;
  path: "fast-space" | "fast-stopgap";
  diagnostics: Record<string, unknown>;
  engineVersion: string;
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
  const sampleRate = beat.sampleRate;
  let totalSamples = beat.left.length;
  const beatGain = 0.92;
  let duckDb = 3.5;
  let spaceCharacter: string | null = null;
  let spaceNotes: string[] = [];


  await report("processing_vocals");
  const layers: { pcm: PcmStereo; startMs: number; gain: number; type: string; duckDb?: number }[] = [];
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

      // —— AP SPACE: performance → space decision → integrate into arrangement ——
      let spaceNotes: string[] = [];
      let spaceCharacter = "present";
      let duckDbLayer = 2.0;
      try {
        const perf = analyzePerformance(pcm);
        const space = decideVocalSpace({
          performance: perf,
          roleType: type,
          sectionLabel: v.sectionLabel || null,
          genre: opts.genre ?? null,
          bpm: opts.bpm ?? null,
        });
        const applied = applyVocalSpace(pcm, space);
        pcm.left = applied.pcm.left;
        pcm.right = applied.pcm.right;
        spaceNotes = space.notes;
        spaceCharacter = space.character;
        duckDbLayer = space.duckDb;
      } catch {
        spaceNotes = ["space_skipped"];
      }

      const startMs = Math.max(0, Number(v.startMs) || 0);
      const peakPreMix = Math.max(peakOf(pcm.left), peakOf(pcm.right));
      layers.push({ pcm, startMs, gain: fader, type, duckDb: duckDbLayer });
      if ((type || "").includes("lead") && duckDbLayer) duckDb = duckDbLayer;
      layerDiag.push({
        label,
        type,
        startMs,
        durationMs: vocalNorm.durationMs,
        bytes: raw.length,
        rmsAfterClean: Number(rmsAfterClean.toFixed(5)),
        peakPreMix: Number(peakPreMix.toFixed(4)),
        fader,
        spaceCharacter,
        spaceNotes: spaceNotes.slice(0, 8),
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

  for (const L of layers) {
    const end = Math.floor((L.startMs / 1000) * sampleRate) + L.pcm.left.length;
    if (end > totalSamples) totalSamples = end;
  }
  if (totalSamples > beat.left.length) {
    const nl = new Float32Array(totalSamples);
    const nr = new Float32Array(totalSamples);
    nl.set(beat.left);
    nr.set(beat.right);
    beat.left = nl;
    beat.right = nr;
  }

  // --- Phase 1: Vocal Arrangement Mind (section map + automation) ---
  const leadLayer = layers.find((L) => (L.type || "").includes("lead")) || layers[0]!;
  let arrangement: ArrangementPlan | null = null;
  try {
    arrangement = buildArrangementPlan({
      beat,
      vocal: leadLayer.pcm,
      bpm: opts.bpm ?? null,
      durationMs: Math.round((totalSamples / sampleRate) * 1000),
    });
    for (const L of layers) {
      const role = (L.type || "lead").toLowerCase();
      const roleScale =
        role.includes("lead") ? 1 :
        role.includes("double") ? 0.55 :
        role.includes("harm") ? 0.45 :
        role.includes("adlib") ? 0.4 :
        role.includes("choir") ? 0.35 : 0.5;
      applySectionAutomation(L.pcm, arrangement, {
        roleScale,
        layerStartMs: L.startMs,
      });
    }
    console.info(
      "[fast-produce] arrangement",
      JSON.stringify({
        method: arrangement.method,
        sections: arrangement.sections.map((s) => ({
          type: s.type,
          startMs: s.startMs,
          endMs: s.endMs,
          energy: s.energy,
        })),
      })
    );
  } catch (arrErr) {
    console.warn(
      "[fast-produce] arrangement skip",
      arrErr instanceof Error ? arrErr.message : arrErr
    );
    arrangement = null;
  }

  await report("mixing");

  // --- Sum beat + vocals with envelope ducking ---
  const mix: PcmStereo = {
    left: new Float32Array(totalSamples),
    right: new Float32Array(totalSamples),
    sampleRate,
  };
  const bg = beatGain;
  for (let i = 0; i < totalSamples; i++) {
    mix.left[i] = (beat.left[i] || 0) * bg;
    mix.right[i] = (beat.right[i] || 0) * bg;
  }

  // Vocal envelope for ducking (sum of all vocal abs)
  const vocalEnv = new Float32Array(totalSamples);
  for (const L of layers) {
    const start = Math.min(totalSamples - 1, Math.floor((L.startMs / 1000) * sampleRate));
    const len = Math.min(L.pcm.left.length, totalSamples - start);
    for (let i = 0; i < len; i++) {
      const a = Math.abs(L.pcm.left[i] || 0) + Math.abs(L.pcm.right[i] || 0);
      vocalEnv[start + i] = Math.max(vocalEnv[start + i] || 0, a * 0.5);
    }
  }
  // Smooth envelope
  const envSmooth = Math.exp(-1 / (0.02 * sampleRate));
  let e = 0;
  for (let i = 0; i < totalSamples; i++) {
    e = e * envSmooth + (vocalEnv[i] || 0) * (1 - envSmooth);
    vocalEnv[i] = e;
  }
  const duckAmt = Math.min(0.35, Math.max(0.12, duckDb / 12)); // mild
  for (let i = 0; i < totalSamples; i++) {
    const duck = 1 - Math.min(0.35, (vocalEnv[i] || 0) * duckAmt * 2.5);
    mix.left[i]! *= duck;
    mix.right[i]! *= duck;
  }

  // Add vocals
  for (const L of layers) {
    const start = Math.min(totalSamples - 1, Math.floor((L.startMs / 1000) * sampleRate));
    const len = Math.min(L.pcm.left.length, totalSamples - start);
    const g = L.gain;
    for (let i = 0; i < len; i++) {
      mix.left[start + i]! += (L.pcm.left[i] || 0) * g;
      mix.right[start + i]! += (L.pcm.right[i] || 0) * g;
    }
  }

  // --- MIX bus (pre-master): glue only, preserve headroom for loudness stage ---
  const peakBeforeGlue = Math.max(peakOf(mix.left), peakOf(mix.right), 1e-9);
  compressStereo(mix, {
    thresholdDb: -18,
    ratio: 1.35,
    attackMs: 18,
    releaseMs: 160,
    kneeDb: 6,
    makeupDb: 0.4,
  });
  const peakAfterGlue = Math.max(peakOf(mix.left), peakOf(mix.right), 1e-9);
  if (peakAfterGlue > dbToGain(-0.5)) {
    limitStereo(mix, -0.5);
  }
  const mixPeak = Math.max(peakOf(mix.left), peakOf(mix.right), 1e-9);
  const mixRmsProxyDb = estimateLoudnessProxyDb(mix);
  const mixWav = encodeStereoWav(mix);

  await report("mastering");

  // --- MASTER: clone mix, then tonal polish + streaming loudness + true-peak ---
  const master = cloneStereo(mix);
  // Subtle polish EQ (master only)
  applyEqStereo(master, [
    { type: "peak", freq: 120, gainDb: -0.6, q: 0.7 },
    { type: "peak", freq: 3200, gainDb: 0.7, q: 0.9 },
    { type: "highshelf", freq: 11000, gainDb: 0.5, q: 0.7 },
  ]);

  const TARGET_LUFS = -11.5;
  const CEILING_DB = -1.0;
  const proxyBeforeDb = estimateLoudnessProxyDb(master);
  const loudness = normalizeToStreamingTarget(master, TARGET_LUFS, CEILING_DB, 0.35);
  truePeakLimit(master, CEILING_DB, 0.35);
  const proxyAfterDb = estimateLoudnessProxyDb(master);
  const masterPeak = Math.max(peakOf(master.left), peakOf(master.right), 1e-9);
  const masterTruePeakDbApprox = 20 * Math.log10(masterPeak + 1e-12);

  // Clamp any numerical overshoot before encode
  for (let i = 0; i < master.left.length; i++) {
    if (master.left[i] > 1) master.left[i] = 1;
    if (master.left[i] < -1) master.left[i] = -1;
    if (master.right[i] > 1) master.right[i] = 1;
    if (master.right[i] < -1) master.right[i] = -1;
  }

  const masterWav = encodeStereoWav(master);
  const durationMs = Math.round((mix.left.length / mix.sampleRate) * 1000);

  const diagnostics: Record<string, unknown> = {
    path: "fast-space",
    engineVersion: FAST_ENGINE_VERSION,
    layerCount: layers.length,
    durationMs,
    beatGain,
    duckDb,
    spaceCharacter,
    spaceNotes,
    loudness: {
      targetLufs: TARGET_LUFS,
      proxyBeforeDb: Math.round(proxyBeforeDb * 10) / 10,
      proxyAfterDb: Math.round(proxyAfterDb * 10) / 10,
      totalGainDb: Math.round(loudness.totalGainDb * 100) / 100,
      passes: loudness.passes,
      method: loudness.method,
    },
    mix: {
      peak: Math.round(mixPeak * 1000) / 1000,
      peakDb: Math.round(20 * Math.log10(mixPeak + 1e-12) * 10) / 10,
      rmsProxyDb: Math.round(mixRmsProxyDb * 10) / 10,
      peakBeforeGlue: Math.round(peakBeforeGlue * 1000) / 1000,
      peakAfterGlue: Math.round(peakAfterGlue * 1000) / 1000,
    },
    master: {
      peak: Math.round(masterPeak * 1000) / 1000,
      peakDb: Math.round(20 * Math.log10(masterPeak + 1e-12) * 10) / 10,
      rmsProxyDb: Math.round(proxyAfterDb * 10) / 10,
      truePeakDbApprox: Math.round(masterTruePeakDbApprox * 10) / 10,
      ceilingDb: CEILING_DB,
    },
    layers: layers.map((L) => ({
      role: L.role,
      startMs: L.startMs,
      samples: L.pcm.left.length,
      spaceCharacter: L.spaceCharacter,
      duckDb: L.duckDb,
    })),
    note: "Mix = pre-loudness bus; master = loudness + true-peak. Full engine off by default.",
  };
  console.info(
    "[fast-produce] done",
    JSON.stringify({
      engineVersion: FAST_ENGINE_VERSION,
      layerCount: layers.length,
      durationMs,
      loudness: diagnostics.loudness,
      mixPeakDb: (diagnostics.mix as { peakDb: number }).peakDb,
      masterPeakDb: (diagnostics.master as { peakDb: number }).peakDb,
    })
  );
  return {
    wav: masterWav,
    mixWav,
    masterWav,
    layerCount: layers.length,
    durationMs,
    path: "fast-space",
    diagnostics,
    engineVersion: FAST_ENGINE_VERSION,
  };
}
