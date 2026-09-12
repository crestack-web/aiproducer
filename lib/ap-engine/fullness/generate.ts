/**
 * Generate doubles / harmonies / sparse ad-libs from the artist's real vocal PCM.
 * No external voice model — only transform the provided take.
 */
import {
  cloneStereo,
  applyGainStereo,
  dbToGain,
  peakOf,
} from "../dsp";
import type { PcmStereo } from "../types";
import type { VocalRole, SongSectionKind } from "../roles";
import type { FullnessDecision, GeneratedLayer, HarmonyInterval } from "./types";
import { applyWidth } from "../mix/width";

/** Fractional delay in samples (linear interp) for double timing humanize. */
function delayPcm(pcm: PcmStereo, delaySamples: number): PcmStereo {
  const out = cloneStereo(pcm);
  const d = Math.max(0, delaySamples);
  const n = pcm.left.length;
  for (let i = 0; i < n; i++) {
    const src = i - d;
    if (src < 0) {
      out.left[i] = 0;
      out.right[i] = 0;
      continue;
    }
    const i0 = Math.floor(src);
    const i1 = Math.min(n - 1, i0 + 1);
    const f = src - i0;
    out.left[i] = (pcm.left[i0] || 0) * (1 - f) + (pcm.left[i1] || 0) * f;
    out.right[i] = (pcm.right[i0] || 0) * (1 - f) + (pcm.right[i1] || 0) * f;
  }
  return out;
}

/**
 * Simple resampling pitch shift (formant not perfect — keep intervals small).
 * ratio > 1 = higher pitch.
 */
function pitchShiftRatio(pcm: PcmStereo, ratio: number): PcmStereo {
  if (Math.abs(ratio - 1) < 0.001) return cloneStereo(pcm);
  const n = pcm.left.length;
  const outLen = n;
  const left = new Float32Array(outLen);
  const right = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(n - 1, i0 + 1);
    const f = src - i0;
    if (i0 < 0 || i0 >= n) continue;
    left[i] = (pcm.left[i0] || 0) * (1 - f) + (pcm.left[i1] || 0) * f;
    right[i] = (pcm.right[i0] || 0) * (1 - f) + (pcm.right[i1] || 0) * f;
  }
  return { left, right, sampleRate: pcm.sampleRate };
}

function intervalRatio(interval: HarmonyInterval, minorPrefer: boolean): number {
  switch (interval) {
    case "major3rd":
      return minorPrefer ? Math.pow(2, 3 / 12) : Math.pow(2, 4 / 12); // m3 or M3
    case "minor3rd":
      return Math.pow(2, 3 / 12);
    case "perfect5th":
      return Math.pow(2, 7 / 12);
    default:
      return 1;
  }
}

/** Soft high-shelf tuck after pitch shift to reduce chipmunk */
function softenHarmonic(pcm: PcmStereo): PcmStereo {
  const out = cloneStereo(pcm);
  let prevL = 0;
  let prevR = 0;
  const a = 0.22;
  for (let i = 0; i < out.left.length; i++) {
    const l = out.left[i] || 0;
    const r = out.right[i] || 0;
    const lpL = prevL + a * (l - prevL);
    const lpR = prevR + a * (r - prevR);
    out.left[i] = l * 0.55 + lpL * 0.45;
    out.right[i] = r * 0.55 + lpR * 0.45;
    prevL = lpL;
    prevR = lpR;
  }
  applyGainStereo(out, 0.72);
  return out;
}

export function generateDouble(opts: {
  pcm: PcmStereo;
  startMs: number;
  section: SongSectionKind;
  side?: "left" | "right";
}): GeneratedLayer {
  const sr = opts.pcm.sampleRate;
  // 12–28ms delay + tiny pitch (±8 cents)
  const delayMs = 14 + Math.random() * 12;
  const cents = (Math.random() * 2 - 1) * 8;
  const ratio = Math.pow(2, cents / 1200);
  let d = delayPcm(opts.pcm, (delayMs / 1000) * sr);
  d = pitchShiftRatio(d, ratio);
  applyGainStereo(d, 0.55);
  const pan = opts.side === "right" ? 0.55 : -0.55;
  applyWidth(d, 0.35, pan);
  return {
    kind: "double",
    pcm: d,
    startMs: opts.startMs,
    role: "double",
    section: opts.section,
    gainDb: -6.5,
    pan,
  };
}

export function generateHarmony(opts: {
  pcm: PcmStereo;
  startMs: number;
  section: SongSectionKind;
  interval: HarmonyInterval;
  minorMode: boolean;
}): GeneratedLayer | null {
  if (opts.interval === "none") return null;
  const ratio = intervalRatio(opts.interval, opts.minorMode);
  let h = pitchShiftRatio(opts.pcm, ratio);
  h = softenHarmonic(h);
  applyWidth(h, 0.5, opts.interval === "perfect5th" ? -0.35 : 0.4);
  return {
    kind: "harmony",
    pcm: h,
    startMs: opts.startMs,
    role: opts.interval === "perfect5th" ? "harmony_low" : "harmony_high",
    section: opts.section,
    gainDb: -9,
    pan: opts.interval === "perfect5th" ? -0.35 : 0.4,
  };
}

/**
 * Sparse ad-lib: take last ~350ms of phrase, delay into the gap after phrase end.
 */
export function generateAdlibEcho(opts: {
  pcm: PcmStereo;
  startMs: number;
  phraseEndMs: number;
  section: SongSectionKind;
}): GeneratedLayer | null {
  const sr = opts.pcm.sampleRate;
  const tailMs = 320;
  const startSamp = Math.max(0, opts.pcm.left.length - Math.floor((tailMs / 1000) * sr));
  const left = opts.pcm.left.subarray(startSamp);
  const right = opts.pcm.right.subarray(startSamp);
  if (peakOf(left) < 0.02) return null;
  let snippet: PcmStereo = {
    left: new Float32Array(left),
    right: new Float32Array(right),
    sampleRate: sr,
  };
  applyGainStereo(snippet, 0.4);
  applyWidth(snippet, 0.45, 0.5);
  // Place slightly after phrase (startMs is layer origin; phrase end relative)
  const placeMs = opts.startMs + (opts.phraseEndMs - opts.startMs) + 80;
  return {
    kind: "adlib",
    pcm: snippet,
    startMs: placeMs,
    role: "adlib",
    section: opts.section,
    gainDb: -11,
    pan: 0.5,
  };
}

export function generateFromDecision(opts: {
  leadPcm: PcmStereo;
  startMs: number;
  section: SongSectionKind;
  decision: FullnessDecision;
  minorMode: boolean;
  phraseEndMs: number;
  adlibBudgetLeft: number;
}): GeneratedLayer[] {
  const out: GeneratedLayer[] = [];
  if (opts.decision.doubles) {
    out.push(
      generateDouble({
        pcm: opts.leadPcm,
        startMs: opts.startMs,
        section: opts.section,
        side: "left",
      })
    );
  }
  if (opts.decision.harmony.interval !== "none" && opts.decision.harmony.confidence !== "none") {
    const h = generateHarmony({
      pcm: opts.leadPcm,
      startMs: opts.startMs,
      section: opts.section,
      interval: opts.decision.harmony.interval,
      minorMode: opts.minorMode,
    });
    if (h) out.push(h);
  }
  if (opts.decision.adlibs && opts.adlibBudgetLeft > 0) {
    const a = generateAdlibEcho({
      pcm: opts.leadPcm,
      startMs: opts.startMs,
      phraseEndMs: opts.phraseEndMs,
      section: opts.section,
    });
    if (a) out.push(a);
  }
  return out;
}
