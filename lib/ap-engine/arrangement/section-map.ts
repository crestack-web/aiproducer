/**
 * Cheap, deterministic song structure from beat + vocal energy.
 * No ASR. Bias toward 8/16-bar blocks when BPM is known.
 */
import { peakOf, rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";
import type { ArrangementPlan, SectionType, VocalSection, VocalTreatment } from "./types";
import { treatmentFor } from "./treatments";

const FRAME_SEC = 0.5;

function frameRms(mono: Float32Array, sampleRate: number): { tMs: number; rms: number }[] {
  const frame = Math.max(256, Math.floor(sampleRate * FRAME_SEC));
  const out: { tMs: number; rms: number }[] = [];
  for (let i = 0; i + frame <= mono.length; i += frame) {
    let s = 0;
    for (let j = 0; j < frame; j++) {
      const v = mono[i + j] || 0;
      s += v * v;
    }
    out.push({ tMs: (i / sampleRate) * 1000, rms: Math.sqrt(s / frame) });
  }
  if (!out.length && mono.length) {
    out.push({ tMs: 0, rms: rmsOf(mono) });
  }
  return out;
}

function normalize(vals: number[]): number[] {
  const max = Math.max(...vals, 1e-9);
  return vals.map((v) => v / max);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

/**
 * Detect section boundaries. Prefer bar-aligned cuts when bpm is available.
 */
export function detectVocalSections(opts: {
  beat: PcmStereo;
  vocal: PcmStereo | null;
  bpm?: number | null;
  durationMs?: number;
}): VocalSection[] {
  const sr = opts.beat.sampleRate;
  const durMs =
    opts.durationMs ??
    Math.round((Math.max(opts.beat.left.length, opts.vocal?.left.length || 0) / sr) * 1000);
  if (durMs < 2000) {
    return [
      {
        startMs: 0,
        endMs: durMs,
        type: "verse",
        energy: 0.5,
        vocalDensity: 0.5,
        confidence: 0.3,
      },
    ];
  }

  const beatMono = stereoToMono(opts.beat);
  const vocalMono = opts.vocal ? stereoToMono(opts.vocal) : null;
  const beatFrames = frameRms(beatMono, sr);
  const vocalFrames = vocalMono ? frameRms(vocalMono, sr) : beatFrames.map((f) => ({ ...f, rms: 0 }));

  const n = Math.min(beatFrames.length, vocalFrames.length);
  const beatN = normalize(beatFrames.slice(0, n).map((f) => f.rms));
  const vocN = normalize(vocalFrames.slice(0, n).map((f) => f.rms));
  const score = beatN.map((b, i) => 0.4 * b + 0.6 * (vocN[i] ?? 0));

  const med = median(score);
  const hi = med + 0.12;

  // Bar length in ms
  const bpm = opts.bpm && opts.bpm > 40 && opts.bpm < 220 ? opts.bpm : 100;
  const barMs = (4 * 60_000) / bpm;
  const blockMs = barMs * 8; // 8-bar bias

  const blocks: { startMs: number; endMs: number; avg: number; vocAvg: number }[] = [];
  for (let t = 0; t < durMs; t += blockMs) {
    const end = Math.min(durMs, t + blockMs);
    let sum = 0;
    let vsum = 0;
    let c = 0;
    for (let i = 0; i < n; i++) {
      const tm = beatFrames[i]!.tMs;
      if (tm >= t && tm < end) {
        sum += score[i] ?? 0;
        vsum += vocN[i] ?? 0;
        c++;
      }
    }
    blocks.push({
      startMs: Math.round(t),
      endMs: Math.round(end),
      avg: c ? sum / c : 0,
      vocAvg: c ? vsum / c : 0,
    });
  }
  if (!blocks.length) {
    blocks.push({ startMs: 0, endMs: durMs, avg: 0.5, vocAvg: 0.5 });
  }

  // Label blocks: first low-voc → intro; high energy → chorus; last high → final chorus pattern
  const energyVals = blocks.map((b) => b.avg);
  const eMed = median(energyVals);
  const sections: VocalSection[] = [];
  let verseCount = 0;
  let chorusCount = 0;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const isFirst = i === 0;
    const isLast = i === blocks.length - 1;
    const high = b.avg >= eMed + 0.08;
    const lowVoc = b.vocAvg < 0.25;

    let type: SectionType;
    if (isFirst && (lowVoc || b.avg < eMed - 0.05)) {
      type = "intro";
    } else if (isLast && blocks.length > 2 && !high) {
      type = "outro";
    } else if (high) {
      type = "chorus";
      chorusCount++;
    } else if (
      i > 0 &&
      sections[i - 1]?.type === "verse" &&
      b.avg > eMed - 0.02 &&
      b.avg < eMed + 0.08
    ) {
      type = "prechorus";
    } else if (
      blocks.length >= 4 &&
      i === Math.floor(blocks.length * 0.65) &&
      !high
    ) {
      type = "bridge";
    } else {
      type = "verse";
      verseCount++;
    }

    const confidence = Math.min(0.9, 0.4 + Math.abs(b.avg - eMed) * 1.2);
    sections.push({
      startMs: b.startMs,
      endMs: b.endMs,
      type,
      energy: Math.round(b.avg * 1000) / 1000,
      vocalDensity: Math.round(b.vocAvg * 1000) / 1000,
      confidence: Math.round(confidence * 100) / 100,
    });
  }

  // Ensure at least one chorus if any high region existed
  if (!sections.some((s) => s.type === "chorus") && sections.length >= 2) {
    let best = 0;
    for (let i = 1; i < sections.length; i++) {
      if (sections[i]!.energy > sections[best]!.energy) best = i;
    }
    sections[best] = { ...sections[best]!, type: "chorus" };
  }

  void verseCount;
  void chorusCount;
  void hi;
  return sections;
}

export function buildArrangementPlan(opts: {
  beat: PcmStereo;
  vocal: PcmStereo | null;
  bpm?: number | null;
  durationMs?: number;
}): ArrangementPlan {
  const sections = detectVocalSections(opts);
  const treatments = sections.map((s, idx) =>
    treatmentFor(s.type, {
      isFinalChorus:
        s.type === "chorus" &&
        !sections.slice(idx + 1).some((x) => x.type === "chorus"),
      energy: s.energy,
    })
  );
  return {
    sections,
    treatments,
    bpm: opts.bpm ?? null,
    method: "energy_8bar_v1",
  };
}
