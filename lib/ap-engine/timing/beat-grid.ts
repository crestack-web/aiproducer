import { stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";

export type BeatGrid = {
  bpm: number;
  confidence: number;
  /** sample indices of estimated quarter-note beats across the buffer */
  beatSamples: number[];
  beatPeriodSamples: number;
};

/**
 * Build a quarter-note grid from BPM prior + onset alignment to the beat PCM.
 * Does not invent BPM — requires a prior (metadata or estimate).
 */
export function buildBeatGrid(
  beat: PcmStereo,
  bpmPrior: number | null | undefined
): BeatGrid {
  const sr = beat.sampleRate;
  const mono = stereoToMono(beat);
  let bpm = bpmPrior && bpmPrior > 60 && bpmPrior < 200 ? bpmPrior : null;
  let confidence = bpm ? 0.55 : 0.2;

  // Lightweight tempo refine from onset autocorrelation if no prior
  if (!bpm) {
    const hop = Math.max(1, Math.floor(sr * 0.01));
    const n = Math.floor(mono.length / hop);
    const on = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      const a = i * hop;
      const b = Math.min(mono.length, a + hop);
      for (let j = a; j < b; j++) s += Math.abs(mono[j] || 0);
      const e = s / Math.max(1, b - a);
      on[i] = Math.max(0, e - prev);
      prev = e;
    }
    // Search lags corresponding to 70–160 BPM
    let bestLag = 0;
    let bestScore = -1;
    const minLag = Math.floor((60 / 160) * (sr / hop));
    const maxLag = Math.floor((60 / 70) * (sr / hop));
    for (let lag = minLag; lag <= maxLag; lag++) {
      let score = 0;
      let c = 0;
      for (let i = 0; i + lag < n; i++) {
        score += on[i] * on[i + lag];
        c++;
      }
      score /= Math.max(1, c);
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    if (bestLag > 0) {
      bpm = 60 / ((bestLag * hop) / sr);
      confidence = 0.4;
    } else {
      bpm = 96;
      confidence = 0.15;
    }
  }

  const period = Math.max(1, Math.round((60 / bpm) * sr));
  // Align phase: find strongest onset in first 2 bars, snap grid
  const hop = Math.max(1, Math.floor(sr * 0.01));
  const search = Math.min(mono.length, period * 8);
  let bestPhase = 0;
  let bestPhaseScore = -1;
  for (let phase = 0; phase < period; phase += hop) {
    let score = 0;
    for (let t = phase; t < search; t += period) {
      const a = t;
      const b = Math.min(mono.length, t + hop);
      let s = 0;
      for (let j = a; j < b; j++) s += Math.abs(mono[j] || 0);
      score += s;
    }
    if (score > bestPhaseScore) {
      bestPhaseScore = score;
      bestPhase = phase;
    }
  }
  confidence = Math.min(0.9, confidence + 0.15);

  const beatSamples: number[] = [];
  for (let t = bestPhase; t < mono.length; t += period) {
    beatSamples.push(t);
  }

  return {
    bpm,
    confidence,
    beatSamples,
    beatPeriodSamples: period,
  };
}

export function nearestBeat(sample: number, grid: BeatGrid): { sample: number; offsetSamples: number } {
  if (!grid.beatSamples.length) {
    return { sample: 0, offsetSamples: sample };
  }
  let best = grid.beatSamples[0];
  let bestDist = Math.abs(sample - best);
  for (const b of grid.beatSamples) {
    const d = Math.abs(sample - b);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return { sample: best, offsetSamples: sample - best };
}
