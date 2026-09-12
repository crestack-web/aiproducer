/**
 * Musical Space — where the vocal lives inside the song.
 * Not "add reverb". Early reflections + short cohesion + selective long + tempo delay + throws.
 */
import {
  cloneStereo,
  addReverbStereo,
  applyGainStereo,
  dbToGain,
  applyBiquadInPlace,
  rmsOf,
  stereoToMono,
} from "../dsp";
import type { PcmStereo } from "../types";
import type { VocalRole, SongSectionKind } from "../roles";
import { isRnbFamily, rnbSectionSpaceScale } from "../profiles/rnb-production";

export type SpacePlan = {
  earlyMs: number;
  earlyWet: number;
  shortWet: number;
  longWet: number;
  delayMs: number;
  delayWet: number;
  throwWet: number;
  notes: string[];
};

export function planMusicalSpace(
  role: VocalRole,
  section: SongSectionKind,
  bpm: number | null,
  genre?: string | null
): SpacePlan {
  const notes: string[] = [];
  const tempo = bpm && bpm > 60 && bpm < 200 ? bpm : 96;
  // Tempo-synced delays: 1/8, 1/4
  const beatMs = 60000 / tempo;
  const delay8 = beatMs / 2;
  const delay4 = beatMs;

  let earlyMs = 18;
  let earlyWet = 0.08;
  let shortWet = 0.1;
  let longWet = 0;
  let delayMs = delay8;
  let delayWet = 0.06;
  let throwWet = 0;

  if (section === "verse") {
    earlyWet = role === "lead" ? 0.1 : 0.08;
    shortWet = 0.07;
    longWet = 0;
    delayWet = 0.04;
    delayMs = delay8;
    notes.push("space:intimate");
  } else if (section === "pre_chorus") {
    earlyWet = 0.12;
    shortWet = 0.12;
    longWet = 0.04;
    delayWet = 0.08;
    delayMs = delay8;
    notes.push("space:building");
  } else if (section === "chorus") {
    earlyWet = 0.1;
    shortWet = 0.14;
    longWet = 0.08;
    delayWet = 0.1;
    delayMs = delay8;
    throwWet = role === "lead" ? 0.12 : 0.06;
    notes.push("space:open");
  } else if (section === "bridge") {
    earlyWet = 0.12;
    shortWet = 0.12;
    longWet = 0.12;
    delayWet = 0.12;
    delayMs = delay4;
    notes.push("space:wide");
  } else if (section === "outro" || section === "intro") {
    earlyWet = 0.1;
    shortWet = 0.12;
    longWet = 0.14;
    delayWet = 0.14;
    delayMs = delay4;
    throwWet = 0.1;
    notes.push("space:atmospheric");
  }

  if (role === "adlib") {
    delayWet = Math.max(delayWet, 0.14);
    throwWet = Math.max(throwWet, 0.18);
    longWet = Math.max(longWet, 0.08);
    delayMs = delay4;
    notes.push("space:adlib_throw");
  } else if (role.startsWith("harmony") || role === "background") {
    shortWet *= 1.25;
    longWet = Math.max(longWet, 0.1);
    earlyWet *= 0.8;
    notes.push("space:stack_wash");
  } else if (role === "double") {
    shortWet *= 0.85;
    delayWet *= 0.5;
    notes.push("space:double_tight");
  }

  // R&B: intimate verses, open choruses, controlled not washed
  if (genre && isRnbFamily(genre)) {
    const sc = rnbSectionSpaceScale(section);
    earlyWet *= sc.early;
    shortWet *= sc.short;
    longWet *= sc.long;
    delayWet *= sc.delay;
    throwWet *= sc.throw;
    notes.push("space:rnb_section");
  }

  return { earlyMs, earlyWet, shortWet, longWet, delayMs, delayWet, throwWet, notes };
}

/** Simple early-reflection tap (short pre-delay echo, filtered). */
function addEarlyReflections(s: PcmStereo, delayMs: number, wet: number): void {
  if (wet < 0.02) return;
  const d = Math.max(1, Math.floor((delayMs / 1000) * s.sampleRate));
  const n = s.left.length;
  const wetG = wet * 0.7;
  for (let i = n - 1; i >= d; i--) {
    s.left[i] = (s.left[i] || 0) + (s.left[i - d] || 0) * wetG * 0.55;
    s.right[i] = (s.right[i] || 0) + (s.right[i - d] || 0) * wetG * 0.45;
  }
  // Soft lowpass on the whole to glue ER (gentle)
  applyBiquadInPlace(s.left, "lowpass", 7000, s.sampleRate, 0, 0.7);
  applyBiquadInPlace(s.right, "lowpass", 7000, s.sampleRate, 0, 0.7);
}

function addTempoDelay(s: PcmStereo, delayMs: number, wet: number, feedback = 0.28): void {
  if (wet < 0.02) return;
  const d = Math.max(1, Math.floor((delayMs / 1000) * s.sampleRate));
  const n = s.left.length;
  const fb = Math.min(0.45, feedback);
  for (let i = d; i < n; i++) {
    const dl = (s.left[i - d] || 0) * wet;
    const dr = (s.right[i - d] || 0) * wet;
    s.left[i] = (s.left[i] || 0) + dl;
    s.right[i] = (s.right[i] || 0) + dr;
    // light feedback into buffer
    if (i + d < n) {
      s.left[i] += dl * fb * 0.5;
      s.right[i] += dr * fb * 0.5;
    }
  }
}

/**
 * Delay throws on phrase endings — energy peak then drop.
 * Copies a short slice into a tempo delay trail.
 */
export function applyDelayThrows(
  pcm: PcmStereo,
  delayMs: number,
  throwWet: number
): { pcm: PcmStereo; throws: number } {
  if (throwWet < 0.04) return { pcm, throws: 0 };
  const out = cloneStereo(pcm);
  const mono = stereoToMono(pcm);
  const sr = pcm.sampleRate;
  const hop = Math.max(1, Math.floor(sr * 0.02));
  const nFrames = Math.floor(mono.length / hop);
  const env = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    let s = 0;
    const a = i * hop;
    const b = Math.min(mono.length, a + hop);
    for (let j = a; j < b; j++) s += Math.abs(mono[j] || 0);
    env[i] = s / Math.max(1, b - a);
  }
  // Smooth
  for (let i = 1; i < nFrames; i++) env[i] = env[i] * 0.6 + env[i - 1] * 0.4;

  const dSamp = Math.max(1, Math.floor((delayMs / 1000) * sr));
  let throws = 0;
  const minGap = Math.floor(0.45 / 0.02); // ~450ms between throws

  let lastThrow = -999;
  for (let i = 4; i < nFrames - 6; i++) {
    const peak = env[i];
    const after = env[i + 3] || 0;
    // Phrase end: local peak then drop
    if (
      peak > 0.04 &&
      peak > (env[i - 2] || 0) * 1.15 &&
      after < peak * 0.45 &&
      i - lastThrow >= minGap
    ) {
      lastThrow = i;
      throws++;
      const start = i * hop;
      const len = Math.min(Math.floor(sr * 0.12), mono.length - start);
      // Three decaying taps
      for (let tap = 1; tap <= 3; tap++) {
        const dest = start + dSamp * tap;
        const g = throwWet * Math.pow(0.55, tap - 1);
        for (let k = 0; k < len && dest + k < out.left.length; k++) {
          out.left[dest + k] = (out.left[dest + k] || 0) + (pcm.left[start + k] || 0) * g;
          out.right[dest + k] = (out.right[dest + k] || 0) + (pcm.right[start + k] || 0) * g * 0.9;
        }
      }
    }
  }
  return { pcm: out, throws };
}

export function applyMusicalSpace(
  pcm: PcmStereo,
  plan: SpacePlan
): { pcm: PcmStereo; throws: number } {
  const out = cloneStereo(pcm);

  // 1. Early reflections — physical room
  addEarlyReflections(out, plan.earlyMs, plan.earlyWet);

  // 2. Short cohesion reverb
  if (plan.shortWet > 0.02) addReverbStereo(out, plan.shortWet);

  // 3. Long tail (selective)
  if (plan.longWet > 0.02) addReverbStereo(out, plan.longWet);

  // 4. Tempo-synced delay bed
  if (plan.delayWet > 0.02) addTempoDelay(out, plan.delayMs, plan.delayWet, 0.3);

  // 5. Delay throws on phrase ends
  const thrown = applyDelayThrows(out, plan.delayMs, plan.throwWet);

  return { pcm: thrown.pcm, throws: thrown.throws };
}
