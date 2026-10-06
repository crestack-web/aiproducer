/**
 * Beat-aware section inference from vocal phrases + energy.
 * Timeline is never altered — this only builds a processing map.
 */
import { rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";
import { detectVocalActivity, type VocalPhrase } from "../analysis/vocal-structure";
import type {
  VocalArrangementMap,
  VocalSection,
  VocalSectionType,
  VocalTreatment,
} from "./types";
import { treatmentFor } from "./treatments";

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : ((a[m - 1]! + a[m]!) / 2);
}

function blockEnergy(
  mono: Float32Array,
  sampleRate: number,
  startMs: number,
  endMs: number
): number {
  const a = Math.max(0, Math.floor((startMs / 1000) * sampleRate));
  const b = Math.min(mono.length, Math.floor((endMs / 1000) * sampleRate));
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) {
    const v = mono[i] || 0;
    s += v * v;
  }
  return Math.sqrt(s / (b - a));
}

/**
 * Build arrangement map: phrases → 8-bar blocks → labeled sections + treatments.
 */
export function buildArrangementPlan(opts: {
  beat: PcmStereo;
  vocal: PcmStereo | null;
  bpm?: number | null;
  durationMs?: number;
}): VocalArrangementMap {
  const sr = opts.beat.sampleRate;
  const beatMono = stereoToMono(opts.beat);
  const vocalMono = opts.vocal ? stereoToMono(opts.vocal) : null;
  const durationMs =
    opts.durationMs ??
    Math.round(
      (Math.max(opts.beat.left.length, opts.vocal?.left.length || 0) / sr) * 1000
    );

  const activity = opts.vocal
    ? detectVocalActivity(opts.vocal)
    : { phrases: [] as VocalPhrase[], noiseFloorRms: 0, activeRatio: 0, durationMs };

  const phrases = activity.phrases.filter((p) => !p.isBreathLike);
  const bpm = opts.bpm && opts.bpm > 40 && opts.bpm < 220 ? opts.bpm : 100;
  const barMs = (4 * 60_000) / bpm;
  const blockMs = barMs * 8;

  // Candidate blocks on musical grid
  const blocks: {
    startMs: number;
    endMs: number;
    beatE: number;
    vocE: number;
    phraseCount: number;
    phraseEnergy: number;
  }[] = [];

  for (let t = 0; t < durationMs; t += blockMs) {
    const end = Math.min(durationMs, t + blockMs);
    const beatE = blockEnergy(beatMono, sr, t, end);
    const vocE = vocalMono ? blockEnergy(vocalMono, sr, t, end) : 0;
    const inBlock = phrases.filter((p) => p.startMs < end && p.endMs > t);
    const phraseEnergy =
      inBlock.length > 0
        ? inBlock.reduce((s, p) => s + p.energy, 0) / inBlock.length
        : 0;
    blocks.push({
      startMs: Math.round(t),
      endMs: Math.round(end),
      beatE,
      vocE,
      phraseCount: inBlock.length,
      phraseEnergy,
    });
  }
  if (!blocks.length) {
    blocks.push({
      startMs: 0,
      endMs: durationMs,
      beatE: 0.5,
      vocE: 0.5,
      phraseCount: phrases.length,
      phraseEnergy: 0.5,
    });
  }

  const score = blocks.map(
    (b) => 0.35 * b.beatE + 0.45 * b.vocE + 0.2 * b.phraseEnergy
  );
  const maxS = Math.max(...score, 1e-9);
  const norm = score.map((s) => s / maxS);
  const med = median(norm);

  // Repetition signal: similar phrase-count + energy to a later high block → chorus-like
  const sections: VocalSection[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const n = norm[i]!;
    const isFirst = i === 0;
    const isLast = i === blocks.length - 1;
    const high = n >= med + 0.1;
    const lowVoc = b.vocE < med * 0.35 * maxS || b.phraseCount === 0;

    let type: VocalSectionType = "unknown";
    let confidence = 0.4;

    if (isFirst && (lowVoc || n < med - 0.08)) {
      type = "intro";
      confidence = 0.55 + (lowVoc ? 0.15 : 0);
    } else if (isLast && blocks.length > 2 && !high) {
      type = "outro";
      confidence = 0.5;
    } else if (high && b.phraseCount >= 2) {
      type = "chorus";
      confidence = 0.55 + Math.min(0.3, (n - med) * 1.5);
      // Boost if a later/earlier block looks similar (repeat)
      for (let j = 0; j < blocks.length; j++) {
        if (j === i) continue;
        const other = norm[j]!;
        if (Math.abs(other - n) < 0.12 && blocks[j]!.phraseCount >= 2) {
          confidence = Math.min(0.92, confidence + 0.12);
          break;
        }
      }
    } else if (
      i > 0 &&
      sections[i - 1]?.type === "verse" &&
      n > med - 0.05 &&
      n < med + 0.1
    ) {
      type = "prechorus";
      confidence = 0.5;
    } else if (
      blocks.length >= 4 &&
      i >= Math.floor(blocks.length * 0.55) &&
      i < blocks.length - 1 &&
      !high &&
      n < med
    ) {
      type = "bridge";
      confidence = 0.48;
    } else if (b.phraseCount === 0 && n < med) {
      type = "break";
      confidence = 0.45;
    } else if (b.phraseCount > 0 || n >= med - 0.15) {
      type = "verse";
      confidence = 0.5 + Math.min(0.2, b.phraseCount * 0.03);
    } else {
      type = "unknown";
      confidence = 0.35;
    }

    // Low overall activity → prefer unknown/conservative
    if (activity.activeRatio < 0.08 && type !== "intro" && type !== "outro") {
      type = "unknown";
      confidence = Math.min(confidence, 0.4);
    }

    sections.push({
      startMs: b.startMs,
      endMs: b.endMs,
      type,
      confidence: Math.round(confidence * 100) / 100,
      energy: Math.round(n * 1000) / 1000,
      vocalDensity: Math.round((b.phraseCount / Math.max(1, (b.endMs - b.startMs) / 1000)) * 100) / 100,
      phraseCount: b.phraseCount,
    });
  }

  // Ensure at least one chorus if clear high-energy blocks exist
  if (!sections.some((s) => s.type === "chorus")) {
    let best = 0;
    for (let i = 1; i < sections.length; i++) {
      if (sections[i]!.energy > sections[best]!.energy) best = i;
    }
    if (sections[best] && sections[best]!.energy >= med && sections[best]!.phraseCount >= 1) {
      sections[best] = {
        ...sections[best]!,
        type: "chorus",
        confidence: Math.max(sections[best]!.confidence, 0.55),
      };
    }
  }

  const treatments: VocalTreatment[] = sections.map((s, idx) => {
    const isFinalChorus =
      s.type === "chorus" &&
      !sections.slice(idx + 1).some((x) => x.type === "chorus");
    return treatmentFor(s.type, {
      isFinalChorus,
      energy: s.energy,
      confidence: s.confidence,
    });
  });

  const overall =
    sections.length > 0
      ? sections.reduce((a, s) => a + s.confidence, 0) / sections.length
      : 0.3;

  return {
    phrases: activity.phrases,
    sections,
    treatments,
    confidence: Math.round(overall * 100) / 100,
    bpm,
    method: "phrase_bar_energy_v2",
  };
}

/** @deprecated use buildArrangementPlan */
export function detectVocalSections(opts: {
  beat: PcmStereo;
  vocal: PcmStereo | null;
  bpm?: number | null;
  durationMs?: number;
}): VocalSection[] {
  return buildArrangementPlan(opts).sections;
}
