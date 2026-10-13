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
 * Independent L/R fractional delay — decorrelates the copy so it stops
 * phase-locking with the lead (the main “one person, two tracks” tell).
 */
function delayPcmStereoSplit(
  pcm: PcmStereo,
  delayL: number,
  delayR: number
): PcmStereo {
  const n = pcm.left.length;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const read = (ch: Float32Array, src: number): number => {
    if (src < 0) return 0;
    if (src >= n - 1) return ch[n - 1] || 0;
    const i0 = Math.floor(src);
    const f = src - i0;
    return (ch[i0] || 0) * (1 - f) + (ch[Math.min(n - 1, i0 + 1)] || 0) * f;
  };
  for (let i = 0; i < n; i++) {
    left[i] = read(pcm.left, i - delayL);
    right[i] = read(pcm.right, i - delayR);
  }
  return { left, right, sampleRate: pcm.sampleRate };
}

/**
 * Chorus-style modulated delay — creates natural pitch shimmer without
 * grain pitch-shift (grain OLA is the main metallic / robotic artifact).
 * depthMs ~0.4–2.0, rateHz ~0.3–1.8 feels like real singers drifting.
 */
function modulatedDelay(
  pcm: PcmStereo,
  opts: { baseMs: number; depthMs: number; rateHz: number; phase?: number }
): PcmStereo {
  const sr = pcm.sampleRate;
  const n = pcm.left.length;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const base = Math.max(0, (opts.baseMs / 1000) * sr);
  const depth = Math.max(0, (opts.depthMs / 1000) * sr);
  const phase = opts.phase ?? Math.random() * Math.PI * 2;
  // Slightly different L/R rates → stereo width without processing sameness
  const rateL = opts.rateHz;
  const rateR = opts.rateHz * (0.87 + Math.random() * 0.2);
  const phaseR = phase + 0.7 + Math.random() * 0.9;
  const read = (ch: Float32Array, src: number): number => {
    if (src < 0) return 0;
    if (src >= n - 1) return ch[n - 1] || 0;
    const i0 = Math.floor(src);
    const f = src - i0;
    return (ch[i0] || 0) * (1 - f) + (ch[Math.min(n - 1, i0 + 1)] || 0) * f;
  };
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const modL = Math.sin(2 * Math.PI * rateL * t + phase) * depth;
    const modR = Math.sin(2 * Math.PI * rateR * t + phaseR) * depth * 0.92;
    left[i] = read(pcm.left, i - (base + modL));
    right[i] = read(pcm.right, i - (base + modR));
  }
  return { left, right, sampleRate: sr };
}

/**
 * Formant-safer pitch shift: grain OLA. Only used for larger detunes;
 * small cents use modulated delay instead (far less metallic).
 */
function pitchShiftRatio(pcm: PcmStereo, ratio: number): PcmStereo {
  if (Math.abs(ratio - 1) < 0.001) return cloneStereo(pcm);
  // Cap tightly — large intervals destroy formants and sound robotic
  const r = Math.max(0.97, Math.min(1.03, ratio)); // ±~50 cents
  const sr = pcm.sampleRate;
  const n = pcm.left.length;
  // Longer grains + heavy overlap → smoother, less metallic
  const grainMs = 64;
  const grain = Math.max(256, Math.floor((sr * grainMs) / 1000));
  const hop = Math.max(32, Math.floor(grain / 8));
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
        sL = pcm.left[Math.floor(si)] || 0;
        sR = pcm.right[Math.floor(si)] || 0;
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
  // Mild soften only — heavy LPF made stacks sound muffled/synthetic
  softenHarmonic(out, r > 1.005 ? 0.35 : 0.25);
  return out;
}

/**
 * Light gain flutter — mimics breath/support variation between singers.
 * No time-stretch (that smears formants).
 */
function humanizeVoice(pcm: PcmStereo, opts?: { centsPeak?: number; gainDepth?: number }): PcmStereo {
  const out = cloneStereo(pcm);
  const n = out.left.length;
  const sr = out.sampleRate;
  const gainDepth = opts?.gainDepth ?? 0.045;
  const rate = 0.35 + Math.random() * 0.9; // slower = more human, less LFO
  const rate2 = 1.1 + Math.random() * 1.6;
  const phase = Math.random() * Math.PI * 2;
  const phase2 = Math.random() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const g =
      1 +
      Math.sin(2 * Math.PI * rate * t + phase) * gainDepth +
      Math.sin(2 * Math.PI * rate2 * t + phase2) * (gainDepth * 0.35) +
      (Math.random() * 2 - 1) * 0.003;
    out.left[i] = (pcm.left[i] || 0) * g;
    out.right[i] = (pcm.right[i] || 0) * g;
  }
  return out;
}

/**
 * Per-voice spectral character — real choir members don't share one EQ curve.
 * brightness < 0 → warmer/darker; > 0 → slightly brighter (still soft).
 */
function spectralTint(pcm: PcmStereo, brightness: number): void {
  const n = pcm.left.length;
  // One-pole shelf approximation
  const bright = Math.max(-1, Math.min(1, brightness));
  // Darker voices: more LP weight; brighter: keep a touch more HF but still tame
  const lpMix = 0.45 + bright * -0.22; // dark → higher lpMix
  const dry = 1 - lpMix;
  let lpL = 0;
  let lpR = 0;
  const a = 0.18 + (bright < 0 ? 0.08 : 0);
  for (let i = 0; i < n; i++) {
    const l = pcm.left[i] || 0;
    const r = pcm.right[i] || 0;
    lpL = lpL + a * (l - lpL);
    lpR = lpR + a * (r - lpR);
    pcm.left[i] = l * dry + lpL * lpMix;
    pcm.right[i] = r * dry + lpR * lpMix;
  }
  // Soften onset so stack doesn't click locked with the lead
  const fade = Math.min(n, Math.floor(pcm.sampleRate * 0.012));
  for (let i = 0; i < fade; i++) {
    const w = i / Math.max(1, fade);
    pcm.left[i] *= w;
    pcm.right[i] *= w;
  }
}

/**
 * Natural unison choir voice — same words as the lead.
 * Real stack plugins (and real choirs) rely on timing + level + tiny pitch drift,
 * NOT aggressive formant-breaking pitch shift. Grain pitch-shift is only a
 * last resort for larger detunes; micro-detune uses modulated delay.
 */
function generateUnisonVoice(
  pcm: PcmStereo,
  opts: {
    delayMs: number;
    cents: number;
    pan: number;
    gainLinear: number;
    /** -1 warm … +1 bright; default mild random */
    brightness?: number;
  }
): PcmStereo {
  const sr = pcm.sampleRate;
  const absCents = Math.abs(opts.cents);
  // Base timing offset + L/R split so the copy is not mono-correlated with the lead
  const baseSamples = (opts.delayMs / 1000) * sr;
  const split = 0.15 + Math.random() * 0.55; // ms-ish in samples later
  let v = delayPcmStereoSplit(
    pcm,
    baseSamples,
    baseSamples + (split / 1000) * sr * (8 + Math.random() * 18)
  );

  // Chorus modulation = natural pitch drift without metallic grains
  const depthMs = 0.55 + Math.min(1.4, absCents * 0.06) + Math.random() * 0.45;
  const rateHz = 0.28 + Math.random() * 1.1;
  v = modulatedDelay(v, {
    baseMs: 0.4 + Math.random() * 1.2,
    depthMs,
    rateHz,
    phase: Math.random() * Math.PI * 2,
  });

  // Only apply grain pitch-shift above ~10 cents; keep it tiny
  if (absCents >= 10) {
    const capped = Math.max(-18, Math.min(18, opts.cents));
    v = pitchShiftRatio(v, Math.pow(2, capped / 1200));
  }

  spectralTint(v, opts.brightness ?? (Math.random() * 0.7 - 0.45));
  v = humanizeVoice(v, { gainDepth: 0.04 + Math.random() * 0.025 });
  applyGainStereo(v, opts.gainLinear);
  // Choir protect: mild width only — aggressive widening causes phase-y mono collapse
  applyWidth(v, 0.22 + Math.random() * 0.14, opts.pan);
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

/**
 * Soft high-shelf tuck after pitch shift (mutates + returns).
 * Choir protect: slightly stronger default soften so stacks stay warm, not metallic.
 * @param amount 0–1 low-pass blend; lower = more natural, higher = duller
 */
function softenHarmonic(pcm: PcmStereo, amount = 0.38): PcmStereo {
  let prevL = 0;
  let prevR = 0;
  const mix = Math.max(0.2, Math.min(0.58, amount));
  const a = 0.24;
  for (let i = 0; i < pcm.left.length; i++) {
    const l = pcm.left[i] || 0;
    const r = pcm.right[i] || 0;
    const lpL = prevL + a * (l - prevL);
    const lpR = prevR + a * (r - prevR);
    pcm.left[i] = l * (1 - mix) + lpL * mix;
    pcm.right[i] = r * (1 - mix) + lpR * mix;
    prevL = lpL;
    prevR = lpR;
  }
  applyGainStereo(pcm, 0.85);
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
  applyGainStereo(h, 0.32);
  applyWidth(h, 0.42, opts.interval === "perfect5th" ? -0.4 : 0.42);
  return {
    kind: "harmony",
    pcm: h,
    startMs: opts.startMs,
    role: opts.interval === "perfect5th" ? "harmony_low" : "harmony_high",
    section: opts.section,
    gainDb: -12.5,
    pan: opts.interval === "perfect5th" ? -0.38 : 0.4,
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

/** Gain budget — stacks support the lead; quieter = natural choir, not competing. */
const LAYER_GAIN_RANGE_DB: Record<StackMode, [number, number]> = {
  double: [-14, -11],
  // Console-preview can be louder via UI faders; Produce bakes these in — keep bed quiet
  choir_light: [-22, -18],
  choir_full: [-23, -19],
  chorus_lift: [-21, -17],
};
/** Power-sum of generated layers must stay this far under the lead (dB). */
const MAX_STACK_SUM_DB_UNDER_LEAD = -14;
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
   * Product rule: same words as the take, natural “extra singers” feel.
   * Real choirs / stack plugins: timing offsets + level + tiny pitch drift +
   * spectral variety. Avoid large interval pitch-shift (robotic formants).
   */
  const pushUnison = (
    label: string,
    role: ChoirVoice["role"],
    delayMs: number,
    cents: number,
    pan: number,
    gainDb: number,
    brightness?: number
  ) => {
    const pcm = generateUnisonVoice(lead, {
      delayMs,
      cents,
      pan,
      gainLinear: dbToGain(gainDb),
      brightness,
    });
    voices.push({ role, label, gainDb, pan, pcm, mode });
  };

  // Tight stereo doubles — modest delay, micro-detune via chorus (not heavy cents)
  pushUnison(
    mode === "double" ? "Double L" : "Choir L",
    "double",
    14 + Math.random() * 16,
    -3 - Math.random() * 4, // small cents = less robot
    -0.42 - Math.random() * 0.1,
    mode === "double" ? -8 : -9.5,
    -0.2 - Math.random() * 0.25 // warmer
  );
  pushUnison(
    mode === "double" ? "Double R" : "Choir R",
    "double",
    20 + Math.random() * 18,
    2 + Math.random() * 4,
    0.42 + Math.random() * 0.1,
    mode === "double" ? -8.5 : -10,
    0.0 + Math.random() * 0.15
  );

  if (mode === "double") {
    // fall through to gain budget
  } else if (mode === "choir_light" || mode === "chorus_lift") {
    // Soft center body — further back, darker, later (true background level)
    pushUnison(
      "Choir center",
      "background",
      30 + Math.random() * 20,
      (Math.random() * 2 - 1) * 3,
      (Math.random() * 2 - 1) * 0.1,
      -13.5,
      -0.4 - Math.random() * 0.2
    );
  } else {
    // choir_full: 5-voice cluster — wider timing, still micro-detune only
    pushUnison(
      "Choir center",
      "background",
      24 + Math.random() * 16,
      (Math.random() * 2 - 1) * 3,
      (Math.random() * 2 - 1) * 0.08,
      -12.5,
      -0.25
    );
    pushUnison(
      "Choir wide L",
      "background",
      36 + Math.random() * 22,
      -5 - Math.random() * 3,
      -0.55 - Math.random() * 0.1,
      -14.5,
      -0.45
    );
    pushUnison(
      "Choir wide R",
      "background",
      40 + Math.random() * 24,
      4 + Math.random() * 3,
      0.55 + Math.random() * 0.1,
      -14.5,
      0.1
    );
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
