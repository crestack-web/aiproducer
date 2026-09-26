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
  // Keep shifts modest — large intervals are the main "robot" source
  const r = Math.max(0.94, Math.min(1.06, ratio)); // ±~100 cents max — words stay intact
  const sr = pcm.sampleRate;
  const n = pcm.left.length;
  // Longer grains + more overlap → smoother, less metallic
  const grainMs = 48;
  const grain = Math.max(128, Math.floor((sr * grainMs) / 1000));
  const hop = Math.max(24, Math.floor(grain / 6));
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const win = new Float32Array(grain);
  for (let i = 0; i < grain; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, grain - 1));
  }
  const norm = new Float32Array(n);

  for (let outPos = 0; outPos < n; outPos += hop) {
    const srcCenter = outPos / r;
    const srcStart = srcCenter - grain / 2;
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
  const out: PcmStereo = { left, right, sampleRate: sr };
  // Always soften after any non-trivial shift (removes chipmunk edge)
  if (r > 1.01) {
    softenHarmonic(out);
    let lpL = 0;
    let lpR = 0;
    const a = r > 1.12 ? 0.14 : 0.1;
    for (let i = 0; i < n; i++) {
      lpL = lpL + a * (left[i] - lpL);
      lpR = lpR + a * (right[i] - lpR);
      left[i] = left[i] * 0.28 + lpL * 0.72;
      right[i] = right[i] * 0.28 + lpR * 0.72;
    }
  } else if (r < 0.99) {
    softenHarmonic(out);
  }
  return out;
}

/**
 * Light gain/pan-style flutter only — no continuous time-stretch.
 * Time-stretch humanize was smearing formants so lyrics became unintelligible.
 */
function humanizeVoice(pcm: PcmStereo, opts?: { centsPeak?: number; gainDepth?: number }): PcmStereo {
  const out = cloneStereo(pcm);
  const n = out.left.length;
  const sr = out.sampleRate;
  const gainDepth = opts?.gainDepth ?? 0.035;
  const rate = 1.8 + Math.random() * 1.2;
  const phase = Math.random() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const g =
      1 +
      Math.sin(2 * Math.PI * rate * t + phase) * gainDepth +
      (Math.random() * 2 - 1) * 0.004;
    out.left[i] = (pcm.left[i] || 0) * g;
    out.right[i] = (pcm.right[i] || 0) * g;
  }
  return out;
}

/**
 * Unison choir voice: same words as the lead, only delay + tiny fixed detune.
 * This is what real "stack" plugins do for width without killing intelligibility.
 */
function generateUnisonVoice(
  pcm: PcmStereo,
  opts: { delayMs: number; cents: number; pan: number; gainLinear: number }
): PcmStereo {
  const sr = pcm.sampleRate;
  let v = delayPcm(pcm, (opts.delayMs / 1000) * sr);
  if (Math.abs(opts.cents) >= 0.5) {
    v = pitchShiftRatio(v, Math.pow(2, opts.cents / 1200));
  }
  v = humanizeVoice(v, { gainDepth: 0.03 });
  applyGainStereo(v, opts.gainLinear);
  applyWidth(v, 0.4, opts.pan);
  return v;
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

/** Soft high-shelf tuck after pitch shift to reduce chipmunk (mutates + returns). */
function softenHarmonic(pcm: PcmStereo): PcmStereo {
  let prevL = 0;
  let prevR = 0;
  const a = 0.28;
  for (let i = 0; i < pcm.left.length; i++) {
    const l = pcm.left[i] || 0;
    const r = pcm.right[i] || 0;
    const lpL = prevL + a * (l - prevL);
    const lpR = prevR + a * (r - prevR);
    // More low-pass weight = less metallic / robot edge
    pcm.left[i] = l * 0.4 + lpL * 0.6;
    pcm.right[i] = r * 0.4 + lpR * 0.6;
    prevL = lpL;
    prevR = lpR;
  }
  applyGainStereo(pcm, 0.78);
  return pcm;
}

export function generateDouble(opts: {
  pcm: PcmStereo;
  startMs: number;
  section: SongSectionKind;
  side?: "left" | "right";
}): GeneratedLayer {
  const delayMs = 16 + Math.random() * 18;
  const cents = (Math.random() * 2 - 1) * 10;
  const pan = opts.side === "right" ? 0.58 : -0.55;
  const d = generateUnisonVoice(opts.pcm, {
    delayMs,
    cents,
    pan,
    gainLinear: 0.5,
  });
  return {
    kind: "double",
    pcm: d,
    startMs: opts.startMs,
    role: "double",
    section: opts.section,
    gainDb: -7.5,
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
  const sr = opts.pcm.sampleRate;
  const ratio = intervalRatio(opts.interval, opts.minorMode);
  // Small timing offset so harmony is not sample-locked to the lead
  const delayMs = 22 + Math.random() * 28;
  let h = delayPcm(opts.pcm, (delayMs / 1000) * sr);
  h = pitchShiftRatio(h, ratio);
  h = softenHarmonic(h);
  h = humanizeVoice(h, { centsPeak: 4 + Math.random() * 3, gainDepth: 0.035 });
  // Harmony sits further back and softer — less "synth choir"
  applyGainStereo(h, 0.38);
  applyWidth(h, 0.55, opts.interval === "perfect5th" ? -0.45 : 0.5);
  return {
    kind: "harmony",
    pcm: h,
    startMs: opts.startMs,
    role: opts.interval === "perfect5th" ? "harmony_low" : "harmony_high",
    section: opts.section,
    gainDb: -11,
    pan: opts.interval === "perfect5th" ? -0.4 : 0.45,
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
  double: [-10, -7],
  choir_light: [-13, -10],
  choir_full: [-14, -11],
  chorus_lift: [-12, -9],
};
/** Power-sum of generated layers must stay this far under the lead (dB). */
const MAX_STACK_SUM_DB_UNDER_LEAD = -6;
const MAX_CONCURRENT_LAYERS = 5;

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
 * - choir_light: unison cluster (3 voices, ±cents) — same words as lead
 * - choir_full: thicker unison cluster (5 voices) — still intelligible
 * - chorus_lift: same as light for chorus sections
 * Large interval pitch-shifts removed — they made lyrics unintelligible.
 */
export function generateStack(opts: {
  lead: PcmStereo;
  mode?: StackMode;
  startMs?: number;
}): ChoirVoice[] {
  const mode: StackMode = opts.mode || "choir_light";
  const lead = opts.lead;
  if (!lead?.left?.length || !lead?.right?.length) {
    console.warn("[fullness] generateStack: empty lead pcm");
    return [];
  }
  // Guard: empty / near-silent lead → no stack (avoids noise floor "robot" choir)
  const peak = Math.max(peakOf(lead.left), peakOf(lead.right));
  if (!(peak > 0.008)) {
    console.warn("[fullness] generateStack: lead too quiet", peak);
    return [];
  }

  const startMs = opts.startMs ?? 0;
  const section = "chorus" as SongSectionKind;
  void section;
  const voices: ChoirVoice[] = [];

  /**
   * Product rule: choir layers must remain intelligible (same words as the take).
   * Large musical intervals (3rd/5th) with pure DSP pitch-shift destroy formants
   * and sound fully robotic. Real stack plugins use unison ±cents + delay.
   */
  const pushUnison = (
    label: string,
    role: ChoirVoice["role"],
    delayMs: number,
    cents: number,
    pan: number,
    gainDb: number
  ) => {
    const pcm = generateUnisonVoice(lead, {
      delayMs,
      cents,
      pan,
      gainLinear: dbToGain(gainDb),
    });
    voices.push({ role, label, gainDb, pan, pcm, mode });
  };

  // Core stereo doubles — always
  pushUnison(
    mode === "double" ? "Double L" : "Choir L",
    "double",
    16 + Math.random() * 10,
    -8 - Math.random() * 6,
    -0.55,
    mode === "double" ? -5 : -6
  );
  pushUnison(
    mode === "double" ? "Double R" : "Choir R",
    "double",
    20 + Math.random() * 14,
    7 + Math.random() * 7,
    0.55,
    mode === "double" ? -5.5 : -6.5
  );

  if (mode === "double") {
    // fall through to gain budget
  } else if (mode === "choir_light" || mode === "chorus_lift") {
    // One more soft center unison — still same words
    pushUnison("Choir center", "background", 28 + Math.random() * 12, (Math.random() * 2 - 1) * 5, 0.05, -9);
  } else {
    // choir_full: thicker unison cluster (4–5 voices), still no interval shift
    pushUnison("Choir center", "double", 24 + Math.random() * 10, (Math.random() * 2 - 1) * 4, 0.0, -8);
    pushUnison("Choir wide L", "background", 32 + Math.random() * 16, -12 - Math.random() * 5, -0.72, -9.5);
    pushUnison("Choir wide R", "background", 36 + Math.random() * 18, 11 + Math.random() * 6, 0.72, -9.5);
  }

  if (!voices.length) {
    // Absolute fallback — at least one double so choir never returns empty
    try {
      const d = generateDouble({
        pcm: lead,
        startMs,
        section,
        side: "left",
      });
      applyGainStereo(d.pcm, dbToGain(-8));
      voices.push({
        role: "double",
        label: "Double L",
        gainDb: -8,
        pan: -0.25,
        pcm: d.pcm,
        mode,
      });
    } catch {
      return [];
    }
  }

  // Gain budget: scale existing layers so the stack sits under the lead
  const gains = assignStackGainsDb(mode, voices.length);
  const budgeted = voices.slice(0, Math.max(gains.length, 1)).map((v, i) => {
    try {
      const pcm = cloneStereo(v.pcm);
      const gDb = gains[i] ?? v.gainDb ?? -9;
      // Relative trim from current peak toward lead peak * budget
      const peak = Math.max(peakOf(pcm.left), peakOf(pcm.right), 1e-9);
      const leadPeak = Math.max(peakOf(lead.left), peakOf(lead.right), 1e-9);
      const target = leadPeak * dbToGain(gDb);
      const scale = Math.min(4, Math.max(0.02, target / peak));
      if (Number.isFinite(scale) && scale > 0) applyGainStereo(pcm, scale);
      return { ...v, pcm, gainDb: gDb };
    } catch {
      return v;
    }
  });
  return budgeted.filter((v) => v?.pcm?.left?.length > 0);
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
