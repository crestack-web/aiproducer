/**
 * Shared offline Console track FX — used by Produce (and mirrors Export intent).
 * Apply user Track FX + timeline automation to PCM after AP role processing.
 */
import {
  dbToGain,
  applyGainStereo,
  limitStereo,
  compressStereo,
  applyEqStereo,
  highPassInPlace,
  gateInPlace,
  spectralNoiseReduceInPlace,
  applyVoiceChangerStereo,
  deEssInPlace,
  saturateInPlace,
} from "@/lib/ap-engine/dsp";
import type { PcmStereo, EqBand } from "@/lib/ap-engine/types";
import { closePhraseGapsStereo } from "@/lib/audio/phrase-cleanup";
import {
  sampleTrackAutomation,
  type FxAutomationDoc,
  type AutomationParamKey,
} from "@/lib/ap-engine/fx-automation";

/** Console Track FX shape (matches producer-view / recording_tasks.track_fx) */
export type ConsoleTrackFx = {
  gainDb?: number;
  pan?: number;
  eqLowDb?: number;
  eqMidDb?: number;
  eqHighDb?: number;
  compress?: number;
  reverb?: number;
  delay?: number;
  saturation?: number;
  width?: number;
  air?: number;
  rotorMix?: number;
  rotorSpeed?: number;
  rotorDepth?: number;
  rotorWarmth?: number;
  rotorFast?: number;
  springMix?: number;
  springDelay?: number;
  springTension?: number;
  springDamp?: number;
  springMod?: number;
  deEss?: number;
  gate?: number;
  noiseReduce?: number;
  phraseCleanup?: number;
  voiceChanger?: number;
  voicePitchSemis?: number;
  voiceCharacter?: number;
  highPassHz?: number;
  lowPassHz?: number;
  limiter?: number;
  chorus?: number;
  telephone?: number;
  doubler?: number;
  slapDelay?: number;
  plateReverb?: number;
};

function n(fx: ConsoleTrackFx | null | undefined, k: keyof ConsoleTrackFx): number {
  const v = fx?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function applyWidth(pcm: PcmStereo, width: number, pan: number): void {
  const w = Math.max(0, Math.min(1, width));
  const p = Math.max(-1, Math.min(1, pan));
  const lG = (p <= 0 ? 1 : 1 - p) * (1 + w * 0.08);
  const rG = (p >= 0 ? 1 : 1 + p) * (1 + w * 0.08);
  for (let i = 0; i < pcm.left.length; i++) {
    pcm.left[i] *= lG;
    pcm.right[i] *= rG;
  }
}

/** Lightweight rotor/chorus motion for offline (matches fast-produce intent). */
function applyRotorGlow(
  pcm: PcmStereo,
  opts: { mix: number; speed: number; depth: number; warmth: number; fast: number }
): void {
  const mix = Math.max(0, Math.min(1, opts.mix));
  if (mix < 0.02) return;
  const sr = pcm.sampleRate;
  const depth = Math.max(0.05, Math.min(1, opts.depth)) * 0.004 * sr;
  const hz = 0.4 + Math.max(0, Math.min(1, opts.speed)) * 4 * (opts.fast > 0.5 ? 2.2 : 1);
  const warm = Math.max(0, Math.min(1, opts.warmth));
  for (let i = 0; i < pcm.left.length; i++) {
    const t = i / sr;
    const mod = Math.sin(2 * Math.PI * hz * t) * depth;
    const d = Math.max(0, Math.min(pcm.left.length - 1, i + mod));
    const i0 = Math.floor(d);
    const i1 = Math.min(pcm.left.length - 1, i0 + 1);
    const f = d - i0;
    const l = (pcm.left[i0] || 0) * (1 - f) + (pcm.left[i1] || 0) * f;
    const r = (pcm.right[i0] || 0) * (1 - f) + (pcm.right[i1] || 0) * f;
    pcm.left[i] = (pcm.left[i] || 0) * (1 - mix) + l * mix * (1 + warm * 0.05);
    pcm.right[i] = (pcm.right[i] || 0) * (1 - mix) + r * mix * (1 + warm * 0.05);
  }
}

function applySpringShimmer(
  pcm: PcmStereo,
  opts: { mix: number; delay: number; tension: number; damp: number; mod: number }
): void {
  const mix = Math.max(0, Math.min(1, opts.mix));
  if (mix < 0.02) return;
  const sr = pcm.sampleRate;
  const delaySamp = Math.floor((0.02 + opts.delay * 0.12) * sr);
  const fb = 0.15 + opts.tension * 0.35;
  const damp = 0.2 + opts.damp * 0.6;
  for (let i = delaySamp; i < pcm.left.length; i++) {
    const src = i - delaySamp;
    const dl = (pcm.left[src] || 0) * fb * (1 - damp * 0.3);
    const dr = (pcm.right[src] || 0) * fb * (1 - damp * 0.3);
    pcm.left[i] = (pcm.left[i] || 0) * (1 - mix * 0.5) + dl * mix;
    pcm.right[i] = (pcm.right[i] || 0) * (1 - mix * 0.5) + dr * mix;
  }
  void opts.mod;
}

function addReverbStereo(pcm: PcmStereo, mix: number): void {
  const m = Math.max(0, Math.min(0.6, mix));
  if (m < 0.01) return;
  const sr = pcm.sampleRate;
  const taps = [Math.floor(0.029 * sr), Math.floor(0.037 * sr), Math.floor(0.053 * sr)];
  const wetL = new Float32Array(pcm.left.length);
  const wetR = new Float32Array(pcm.right.length);
  for (const d of taps) {
    for (let i = d; i < pcm.left.length; i++) {
      wetL[i] += (pcm.left[i - d] || 0) * 0.28;
      wetR[i] += (pcm.right[i - d] || 0) * 0.28;
    }
  }
  for (let i = 0; i < pcm.left.length; i++) {
    pcm.left[i] = (pcm.left[i] || 0) * (1 - m * 0.2) + wetL[i] * m;
    pcm.right[i] = (pcm.right[i] || 0) * (1 - m * 0.2) + wetR[i] * m;
  }
}

function addDelayStereo(pcm: PcmStereo, mix: number, ms = 120): void {
  const m = Math.max(0, Math.min(0.5, mix));
  if (m < 0.01) return;
  const d = Math.floor((ms / 1000) * pcm.sampleRate);
  for (let i = d; i < pcm.left.length; i++) {
    pcm.left[i] = (pcm.left[i] || 0) + (pcm.left[i - d] || 0) * m * 0.45;
    pcm.right[i] = (pcm.right[i] || 0) + (pcm.right[i - d] || 0) * m * 0.45;
  }
}

/**
 * Apply full Console track FX to stereo PCM (Produce + shared offline path).
 */
export function applyConsoleTrackFx(
  pcm: PcmStereo,
  fx: ConsoleTrackFx | null | undefined
): void {
  if (!fx) return;
  const has =
    Math.abs(n(fx, "gainDb")) > 0.05 ||
    Math.abs(n(fx, "eqLowDb")) > 0.05 ||
    Math.abs(n(fx, "eqMidDb")) > 0.05 ||
    Math.abs(n(fx, "eqHighDb")) > 0.05 ||
    n(fx, "compress") > 0.02 ||
    n(fx, "reverb") > 0.02 ||
    n(fx, "delay") > 0.02 ||
    n(fx, "saturation") > 0.02 ||
    Math.abs(n(fx, "pan")) > 0.02 ||
    n(fx, "width") > 0.02 ||
    n(fx, "air") > 0.02 ||
    n(fx, "rotorMix") > 0.02 ||
    n(fx, "springMix") > 0.02 ||
    n(fx, "deEss") > 0.02 ||
    n(fx, "gate") > 0.02 ||
    n(fx, "noiseReduce") > 0.02 ||
    n(fx, "phraseCleanup") > 0.02 ||
    n(fx, "voiceChanger") > 0.02 ||
    n(fx, "highPassHz") > 20 ||
    n(fx, "chorus") > 0.02 ||
    n(fx, "doubler") > 0.02 ||
    n(fx, "plateReverb") > 0.02 ||
    n(fx, "slapDelay") > 0.02 ||
    n(fx, "telephone") > 0.02 ||
    n(fx, "limiter") > 0.02 ||
    n(fx, "lowPassHz") > 500;
  if (!has) return;

  // Cleanup / produce-only first (full clip)
  if (n(fx, "noiseReduce") > 0.02) {
    spectralNoiseReduceInPlace(pcm.left, pcm.sampleRate, n(fx, "noiseReduce"));
    spectralNoiseReduceInPlace(pcm.right, pcm.sampleRate, n(fx, "noiseReduce"));
  }
  if (n(fx, "phraseCleanup") > 0.02) {
    const cleaned = closePhraseGapsStereo(
      pcm.left,
      pcm.right,
      pcm.sampleRate,
      n(fx, "phraseCleanup")
    );
    const len = pcm.left.length;
    pcm.left.fill(0);
    pcm.right.fill(0);
    pcm.left.set(cleaned.left.subarray(0, Math.min(len, cleaned.left.length)));
    pcm.right.set(cleaned.right.subarray(0, Math.min(len, cleaned.right.length)));
  }
  if (n(fx, "gate") > 0.02) {
    const gt = n(fx, "gate");
    // Align closer to client preview-clean residual (was leaving ~10–20% noise in gaps)
    const thr = -52 + gt * 34;
    const residual = Math.max(0.008, 0.14 * (1 - gt));
    gateInPlace(pcm.left, pcm.sampleRate, thr, residual);
    gateInPlace(pcm.right, pcm.sampleRate, thr, residual);
  }
  if (n(fx, "voiceChanger") > 0.02) {
    applyVoiceChangerStereo(pcm.left, pcm.right, pcm.sampleRate, {
      mix: n(fx, "voiceChanger"),
      pitchSemis: n(fx, "voicePitchSemis"),
      character: n(fx, "voiceCharacter"),
    });
  }

  const bands: EqBand[] = [];
  if (Math.abs(n(fx, "eqLowDb")) > 0.05) {
    bands.push({
      type: "lowshelf",
      freq: 200,
      gainDb: Math.max(-12, Math.min(12, n(fx, "eqLowDb"))),
      q: 0.7,
    });
  }
  if (Math.abs(n(fx, "eqMidDb")) > 0.05) {
    bands.push({
      type: "peak",
      freq: 1200,
      gainDb: Math.max(-12, Math.min(12, n(fx, "eqMidDb"))),
      q: 0.9,
    });
  }
  if (Math.abs(n(fx, "eqHighDb")) > 0.05) {
    bands.push({
      type: "highshelf",
      freq: 6000,
      gainDb: Math.max(-12, Math.min(12, n(fx, "eqHighDb"))),
      q: 0.7,
    });
  }
  if (n(fx, "air") > 0.02) {
    bands.push({
      type: "highshelf",
      freq: 10000,
      gainDb: Math.min(6, n(fx, "air") * 5.5),
      q: 0.7,
    });
  }
  if (bands.length) applyEqStereo(pcm, bands);

  if (n(fx, "highPassHz") > 20) {
    highPassInPlace(pcm.left, pcm.sampleRate, Math.min(400, n(fx, "highPassHz")));
    highPassInPlace(pcm.right, pcm.sampleRate, Math.min(400, n(fx, "highPassHz")));
  }
  if (n(fx, "lowPassHz") > 500) {
    applyEqStereo(pcm, [
      { type: "lowpass", freq: Math.min(16000, n(fx, "lowPassHz")), gainDb: 0, q: 0.7 },
    ]);
  }
  if (n(fx, "telephone") > 0.02) {
    const a = Math.min(1, n(fx, "telephone"));
    highPassInPlace(pcm.left, pcm.sampleRate, 400 + a * 400);
    highPassInPlace(pcm.right, pcm.sampleRate, 400 + a * 400);
    applyEqStereo(pcm, [
      { type: "highshelf", freq: 2800, gainDb: -8 * a, q: 0.7 },
    ]);
  }

  if (n(fx, "deEss") > 0.02) {
    deEssInPlace(pcm.left, pcm.sampleRate, n(fx, "deEss"));
    deEssInPlace(pcm.right, pcm.sampleRate, n(fx, "deEss"));
  }
  if (n(fx, "compress") > 0.02) {
    compressStereo(pcm, {
      thresholdDb: -12 - n(fx, "compress") * 28,
      ratio: 1 + n(fx, "compress") * 10,
      attackMs: 12,
      releaseMs: 80,
      makeupDb: 0,
    });
  }
  if (n(fx, "saturation") > 0.02) {
    const amt = Math.max(0, Math.min(1, n(fx, "saturation"))) * 0.35;
    saturateInPlace(pcm.left, amt);
    saturateInPlace(pcm.right, amt);
  }
  if (n(fx, "rotorMix") > 0.02) {
    applyRotorGlow(pcm, {
      mix: n(fx, "rotorMix"),
      speed: n(fx, "rotorSpeed") || 0.35,
      depth: n(fx, "rotorDepth") || 0.45,
      warmth: n(fx, "rotorWarmth") || 0.4,
      fast: n(fx, "rotorFast"),
    });
  }
  if (n(fx, "springMix") > 0.02) {
    applySpringShimmer(pcm, {
      mix: n(fx, "springMix"),
      delay: n(fx, "springDelay") || 0.25,
      tension: n(fx, "springTension") || 0.4,
      damp: n(fx, "springDamp") || 0.35,
      mod: n(fx, "springMod") || 0.2,
    });
  }
  if (n(fx, "reverb") > 0.02) {
    addReverbStereo(pcm, Math.max(0, Math.min(0.55, n(fx, "reverb") * 0.4)));
  }
  if (n(fx, "delay") > 0.02) {
    addDelayStereo(pcm, Math.max(0, Math.min(0.45, n(fx, "delay") * 0.35)));
  }
  if (n(fx, "slapDelay") > 0.02) {
    addDelayStereo(pcm, Math.max(0, Math.min(0.35, n(fx, "slapDelay") * 0.28)), 75);
  }
  if (n(fx, "plateReverb") > 0.02) {
    addReverbStereo(pcm, Math.max(0, Math.min(0.5, n(fx, "plateReverb") * 0.42)));
  }
  if (n(fx, "chorus") > 0.02) {
    applyRotorGlow(pcm, {
      mix: n(fx, "chorus") * 0.55,
      speed: 0.4,
      depth: 0.35,
      warmth: 0.25,
      fast: 0,
    });
  }
  if (n(fx, "doubler") > 0.02) {
    applyRotorGlow(pcm, {
      mix: n(fx, "doubler") * 0.4,
      speed: 0.15,
      depth: 0.5,
      warmth: 0.2,
      fast: 0,
    });
    applyWidth(pcm, Math.min(0.7, 0.25 + n(fx, "doubler") * 0.4), 0);
  }
  if (n(fx, "limiter") > 0.02) {
    limitStereo(pcm, -1.2 - (1 - n(fx, "limiter")) * 2);
  }
  if (Math.abs(n(fx, "gainDb")) > 0.05) {
    applyGainStereo(pcm, dbToGain(Math.max(-12, Math.min(12, n(fx, "gainDb")))));
  }
  const w = Math.max(0, Math.min(1, n(fx, "width")));
  const pan = Math.max(-1, Math.min(1, n(fx, "pan")));
  if (w > 0.02 || Math.abs(pan) > 0.02) {
    applyWidth(pcm, Math.max(0.05, w * 0.85), pan);
  }
}

/**
 * Produce path: Console FX + automation (same artist intent as Export).
 * 1) Full-clip FX from baseline track_fx
 * 2) Per-block automation for gain/pan/filter-style moves (telephone, HPF/LPF, EQ)
 */
export function applyConsoleFxWithAutomation(
  pcm: PcmStereo,
  baseFx: ConsoleTrackFx | null | undefined,
  automation: FxAutomationDoc | null | undefined,
  trackId: string,
  layerStartMs: number
): void {
  const base = baseFx || {};
  if (
    !automation ||
    !automation.lanes.some(
      (l) => l.trackId === trackId && l.enabled !== false && l.points.length > 0
    )
  ) {
    applyConsoleTrackFx(pcm, base);
    return;
  }

  const autoDoc = automation;

  // Peak automation values so static wet FX cover the loudest section intent
  const peakFx: ConsoleTrackFx = { ...base };
  const peakKeys: (keyof ConsoleTrackFx)[] = [
    "reverb",
    "delay",
    "plateReverb",
    "telephone",
    "chorus",
    "doubler",
    "slapDelay",
    "compress",
    "saturation",
    "air",
    "width",
  ];
  for (const lane of autoDoc.lanes) {
    if (lane.trackId !== trackId || lane.enabled === false) continue;
    const key = lane.param as keyof ConsoleTrackFx;
    if (!(peakKeys as string[]).includes(key as string)) continue;
    let maxV = n(base, key);
    for (const pt of lane.points) {
      if (typeof pt.value === "number") maxV = Math.max(maxV, pt.value);
    }
    (peakFx as Record<string, number>)[key as string] = maxV;
  }

  applyConsoleTrackFx(pcm, peakFx);

  // Block-level gain/pan/telephone/EQ relative to peak so quieter sections sit back
  const sr = pcm.sampleRate;
  const len = pcm.left.length;
  const block = Math.max(64, Math.floor(sr * 0.05));
  for (let i = 0; i < len; i += block) {
    const timeMs = layerStartMs + (i / sr) * 1000;
    const overlay = sampleTrackAutomation(autoDoc, trackId, timeMs);
    if (!Object.keys(overlay).length) continue;
    const end = Math.min(len, i + block);

    if (overlay.gainDb !== undefined) {
      const baseG = n(peakFx, "gainDb");
      const g = Math.pow(10, (overlay.gainDb - baseG) / 20);
      for (let j = i; j < end; j++) {
        pcm.left[j] *= g;
        pcm.right[j] *= g;
      }
    }
    if (overlay.pan !== undefined) {
      const pan = Math.max(-1, Math.min(1, overlay.pan));
      const lG = pan <= 0 ? 1 : 1 - pan;
      const rG = pan >= 0 ? 1 : 1 + pan;
      for (let j = i; j < end; j++) {
        pcm.left[j] *= lG;
        pcm.right[j] *= rG;
      }
    }

    // Telephone amount vs peak — pull down when automation is lower
    if (overlay.telephone !== undefined) {
      const peakT = n(peakFx, "telephone") || 0.01;
      const t = Math.max(0, Math.min(1, overlay.telephone));
      const ratio = Math.max(0.35, Math.min(1.15, t / peakT));
      if (ratio < 0.98) {
        for (let j = i; j < end; j++) {
          // Soft un-telephone: restore some HF presence when effect is down
          const restore = 1 + (1 - ratio) * 0.12;
          pcm.left[j] *= restore;
          pcm.right[j] *= restore;
        }
      }
    }

    // Wet send automation vs peak
    for (const k of ["reverb", "delay", "plateReverb", "chorus", "doubler"] as const) {
      if (overlay[k as AutomationParamKey] === undefined) continue;
      const peak = n(peakFx, k) || 0.01;
      const target = Number(overlay[k as AutomationParamKey]) || 0;
      const ratio = Math.max(0.4, Math.min(1.2, target / peak));
      if (Math.abs(ratio - 1) < 0.04) continue;
      const mul = 0.85 + ratio * 0.15;
      for (let j = i; j < end; j++) {
        pcm.left[j] *= mul;
        pcm.right[j] *= mul;
      }
    }
  }
}
