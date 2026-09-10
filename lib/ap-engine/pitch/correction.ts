import type { DetectedNote, NotePitchDecision, PitchFrame } from "./types";

function buildCorrectionRatio(
  notes: DetectedNote[],
  decisions: NotePitchDecision[],
  sampleRate: number,
  length: number
): Float32Array {
  const ratio = new Float32Array(length);
  ratio.fill(1);
  for (let n = 0; n < notes.length; n++) {
    const d = decisions[n];
    if (!d || d.skip || Math.abs(d.correctionCents) < 3) continue;
    const note = notes[n];
    const start = Math.max(0, Math.floor(note.startTime * sampleRate));
    const end = Math.min(length, Math.floor(note.endTime * sampleRate));
    if (end <= start) continue;
    const appliedRatio = Math.pow(2, d.correctionCents / 1200);
    const rClamped = Math.max(0.85, Math.min(1.18, appliedRatio));
    const fade = Math.max(1, Math.floor(0.02 * sampleRate));
    for (let i = start; i < end; i++) {
      let env = 1;
      if (i - start < fade) env = (i - start) / fade;
      else if (end - i < fade) env = (end - i) / fade;
      ratio[i] = 1 + (rClamped - 1) * env;
    }
  }
  const smoothed = new Float32Array(length);
  const win = Math.max(1, Math.floor(0.012 * sampleRate));
  for (let i = 0; i < length; i++) {
    let s = 0,
      c = 0;
    for (let j = -win; j <= win; j++) {
      const k = i + j;
      if (k < 0 || k >= length) continue;
      s += ratio[k];
      c++;
    }
    smoothed[i] = c ? s / c : 1;
  }
  return smoothed;
}

function lerp(buf: Float32Array, pos: number): number {
  if (pos <= 0) return buf[0] || 0;
  if (pos >= buf.length - 1) return buf[buf.length - 1] || 0;
  const i = Math.floor(pos);
  const f = pos - i;
  return (buf[i] || 0) * (1 - f) + (buf[i + 1] || 0) * f;
}

export function applyPitchCorrection(
  mono: Float32Array,
  sampleRate: number,
  _frames: PitchFrame[],
  notes: DetectedNote[],
  decisions: NotePitchDecision[]
): { out: Float32Array; correctedSamples: number; maxAbsCents: number; meanAbsCents: number } {
  const ratio = buildCorrectionRatio(notes, decisions, sampleRate, mono.length);
  let maxAbsCents = 0,
    sumAbsCents = 0,
    nRatio = 0;
  for (let i = 0; i < ratio.length; i++) {
    if (Math.abs(ratio[i] - 1) > 0.0015) {
      const cents = Math.abs(1200 * Math.log2(ratio[i]));
      maxAbsCents = Math.max(maxAbsCents, cents);
      sumAbsCents += cents;
      nRatio++;
    }
  }
  if (nRatio < sampleRate * 0.02) {
    return { out: new Float32Array(mono), correctedSamples: 0, maxAbsCents: 0, meanAbsCents: 0 };
  }

  const grain = Math.max(64, Math.floor((sampleRate * 32) / 1000));
  const hop = Math.max(16, Math.floor((sampleRate * 8) / 1000));
  const half = Math.floor(grain / 2);
  const out = new Float32Array(mono.length);
  const weight = new Float32Array(mono.length);
  let correctedSamples = 0;

  for (let center = half; center + half < mono.length; center += hop) {
    const r = ratio[center] || 1;
    const needs = Math.abs(r - 1) > 0.002;
    for (let k = -half; k < half; k++) {
      const dest = center + k;
      if (dest < 0 || dest >= mono.length) continue;
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * (k + half)) / grain));
      const srcPos = center + k / r;
      out[dest] += lerp(mono, srcPos) * w;
      weight[dest] += w;
      if (needs) correctedSamples++;
    }
  }

  for (let i = 0; i < out.length; i++) {
    if (weight[i] > 1e-6) out[i] /= weight[i];
    else out[i] = mono[i] || 0;
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.98) {
    const g = 0.95 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= g;
  }
  return {
    out,
    correctedSamples: Math.min(correctedSamples, mono.length),
    maxAbsCents,
    meanAbsCents: nRatio ? sumAbsCents / nRatio : 0,
  };
}
