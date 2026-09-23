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
/**
 * Formant-safer pitch shift: grain OLA + post EQ so intervals stay more "human"
 * than raw resample (which chipmunks upward shifts).
 */
function pitchShiftRatio(pcm: PcmStereo, ratio: number): PcmStereo {
  if (Math.abs(ratio - 1) < 0.001) return cloneStereo(pcm);
  // Cap extreme shifts — choir uses modest intervals only
  const r = Math.max(0.75, Math.min(1.35, ratio));
  const sr = pcm.sampleRate;
  const n = pcm.left.length;
  const grainMs = 32;
  const grain = Math.max(64, Math.floor((sr * grainMs) / 1000));
  const hop = Math.max(16, Math.floor(grain / 4));
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const win = new Float32Array(grain);
  for (let i = 0; i < grain; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, grain - 1));
  }
  const norm = new Float32Array(n);

  for (let outPos = 0; outPos < n; outPos += hop) {
    const srcCenter = outPos / r;
    const srcStart = Math.floor(srcCenter - grain / 2);
    for (let i = 0; i < grain; i++) {
      const oi = outPos - Math.floor(grain / 2) + i;
      if (oi < 0 || oi >= n) continue;
      const si = srcStart + i;
      let sL = 0;
      let sR = 0;
      if (si >= 0 && si < n - 1) {
        const i0 = Math.floor(si);
        const f = si - i0;
        sL = pcm.left[i0] * (1 - f) + pcm.left[Math.min(n - 1, i0 + 1)] * f;
        sR = pcm.right[i0] * (1 - f) + pcm.right[Math.min(n - 1, i0 + 1)] * f;
      } else if (si >= 0 && si < n) {
        sL = pcm.left[si];
        sR = pcm.right[si];
      }
      const w = win[i];
      left[oi] += sL * w;
      right[oi] += sR * w;
      norm[oi] += w;
    }
  }
  for (let i = 0; i < n; i++) {
    const g = norm[i] > 1e-6 ? 1 / norm[i] : 0;
    left[i] *= g;
    right[i] *= g;
  }
  // Formant hint: upward shift → tame highs; downward → slight presence
  const out: PcmStereo = { left, right, sampleRate: sr };
  if (r > 1.02) {
    softenHarmonic(out);
    // extra gentle lowpass-ish: one-pole on both channels
    let lpL = 0;
    let lpR = 0;
    const a = r > 1.15 ? 0.18 : 0.12;
    for (let i = 0; i < n; i++) {
      lpL = lpL + a * (left[i] - lpL);
      lpR = lpR + a * (right[i] - lpR);
      left[i] = left[i] * 0.35 + lpL * 0.65;
      right[i] = right[i] * 0.35 + lpR * 0.65;
    }
  } else if (r < 0.98) {
    // keep air on downward intervals
    for (let i = 0; i < n; i++) {
      left[i] *= 1.02;
      right[i] *= 1.02;
    }
  }
  return out;
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





export type StackMode = "double" | "choir_light" | "choir_full" | "chorus_lift";

/** Gain budget — generated layers stay under the lead (distortion fix). */
const LAYER_GAIN_RANGE_DB: Record<StackMode, [number, number]> = {
  double: [-9, -6],
  choir_light: [-11, -8],
  choir_full: [-12, -9],
  chorus_lift: [-10, -7],
};
/** Power-sum of generated layers must stay this far under the lead (dB). */
const MAX_STACK_SUM_DB_UNDER_LEAD = -6;
const MAX_CONCURRENT_LAYERS = 3;

function sumGainsDb(gs: number[]): number {
  const linear = gs.reduce((acc, g) => acc + Math.pow(10, g / 10), 0);
  return 10 * Math.log10(Math.max(linear, 1e-12));
}

/**
 * Assign relative gains (dB under lead) so each layer is in-range and the
 * combined stack cannot overpower the lead.
 */
export function assignStackGainsDb(mode: StackMode, count: number): number[] {
  const n = Math.min(Math.max(0, count), MAX_CONCURRENT_LAYERS);
  if (n === 0) return [];
  const [minDb, maxDb] = LAYER_GAIN_RANGE_DB[mode] || [-11, -8];
  let gains = Array.from({ length: n }, () => minDb);
  const STEP = 0.5;
  for (let guard = 0; guard < 40; guard++) {
    if (sumGainsDb(gains) >= MAX_STACK_SUM_DB_UNDER_LEAD - 0.05) break;
    const next = gains.map((g) => Math.min(g + STEP, maxDb));
    if (sumGainsDb(next) > MAX_STACK_SUM_DB_UNDER_LEAD) break;
    if (next.every((g, i) => g === gains[i])) break;
    gains = next;
  }
  return gains;
}

/** Section-aware default — full choir only on peak moments. */
export function fullnessModeForSection(
  section: string | null | undefined,
  artistAlreadyRecordedHarmony: boolean
): StackMode | null {
  if (artistAlreadyRecordedHarmony) return null;
  const s = (section || "").toLowerCase();
  if (/verse|intro|bridge|pre/.test(s) && !/chorus|hook/.test(s)) {
    if (/pre.?chorus/.test(s)) return "double";
    return null;
  }
  if (/final|outro|last/.test(s) && /chorus|hook/.test(s)) return "choir_full";
  if (/chorus|hook|drop/.test(s)) return "choir_light";
  return "double";
}



export type ChoirVoice = {
  role: "double" | "harmony_high" | "harmony_mid" | "harmony_low" | "background";
  label: string;
  gainDb: number;
  pan: number;
  pcm: PcmStereo;
  mode: StackMode;
};

/**
 * Stack modes from a single real vocal:
 * - double: tight L/R doubles only
 * - choir_light: doubles + one high 3rd
 * - choir_full: doubles + high/mid/low
 * - chorus_lift: same as light but intended for chorus sections (UI/API gates)
 */
export function generateStack(opts: {
  lead: PcmStereo;
  mode?: StackMode;
  startMs?: number;
}): ChoirVoice[] {
  const mode: StackMode = opts.mode || "choir_light";
  const lead = opts.lead;
  const startMs = opts.startMs ?? 0;
  const section = "chorus" as SongSectionKind;
  const voices: ChoirVoice[] = [];

  const pushDouble = (side: "left" | "right", label: string, gainDb: number, pan: number) => {
    const dbl = generateDouble({ pcm: lead, startMs, section, side });
    applyGainStereo(dbl.pcm, dbToGain(gainDb));
    voices.push({ role: "double", label, gainDb, pan, pcm: dbl.pcm, mode });
  };

  // Always start with stereo doubles for any stack mode
  pushDouble("left", mode === "double" ? "Double L" : "Choir double", mode === "double" ? -4 : -5.5, -0.22);
  pushDouble("right", mode === "double" ? "Double R" : "Choir double R", mode === "double" ? -4.5 : -6, 0.28);

  if (mode === "double") return voices;

  // Light + chorus_lift + full: high third
  const hi = generateHarmony({
    pcm: lead,
    startMs,
    section,
    interval: "major3rd",
    minorMode: false,
  });
  if (hi) {
    const g = mode === "choir_full" ? -7 : -8.5;
    applyGainStereo(hi.pcm, dbToGain(g));
    voices.push({
      role: "harmony_high",
      label: mode === "chorus_lift" ? "Chorus high" : "Choir high",
      gainDb: g,
      pan: 0.48,
      pcm: hi.pcm,
      mode,
    });
  }

  if (mode === "choir_light" || mode === "chorus_lift") return voices;

  // Full: extra tight center double so the stack reads as a real choir, not one harmony
  {
    const center = generateDouble({ pcm: lead, startMs, section, side: "left" });
    applyGainStereo(center.pcm, dbToGain(-8));
    voices.push({
      role: "double",
      label: "Choir center",
      gainDb: -8,
      pan: 0.05,
      pcm: center.pcm,
      mode,
    });
  }

  // Full only: fifth + low third
  const mid = generateHarmony({
    pcm: lead,
    startMs,
    section,
    interval: "perfect5th",
    minorMode: false,
  });
  if (mid) {
    applyGainStereo(mid.pcm, dbToGain(-9));
    voices.push({
      role: "harmony_mid",
      label: "Choir mid",
      gainDb: -9,
      pan: -0.42,
      pcm: mid.pcm,
      mode,
    });
  }

  const low = generateHarmony({
    pcm: lead,
    startMs,
    section,
    interval: "minor3rd",
    minorMode: true,
  });
  if (low) {
    applyGainStereo(low.pcm, dbToGain(-10.5));
    voices.push({
      role: "harmony_low",
      label: "Choir low",
      gainDb: -10.5,
      pan: 0.12,
      pcm: low.pcm,
      mode,
    });
  }

  // Gain budget: keep combined stack under the lead (stops correlated-layer grit)
  const gains = assignStackGainsDb(mode, voices.length);
  const budgeted = voices.slice(0, gains.length).map((v, i) => {
    const pcm = cloneStereo(v.pcm);
    // Replace prior ad-hoc gains with budgeted gain relative to lead unity
    const peak = Math.max(peakOf(pcm.left), peakOf(pcm.right), 1e-9);
    const leadPeak = Math.max(peakOf(lead.left), peakOf(lead.right), 1e-9);
    // Normalize layer to lead peak, then apply budget dB
    const match = leadPeak / peak;
    applyGainStereo(pcm, match * dbToGain(gains[i]));
    return { ...v, pcm, gainDb: gains[i] };
  });
  return budgeted;
}

/** @deprecated use generateStack — kept for callers */
export function generateChoir(opts: {
  lead: PcmStereo;
  intensity?: "light" | "full";
  startMs?: number;
}): ChoirVoice[] {
  return generateStack({
    lead: opts.lead,
    startMs: opts.startMs,
    mode: opts.intensity === "light" ? "choir_light" : "choir_full",
  });
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
