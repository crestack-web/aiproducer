/**
 * Lightweight key/chroma estimate from instrumental PCM.
 * Not a full chord tracker — enough to gate harmony generation.
 */
import { stereoToMono, rmsOf } from "../dsp";
import type { PcmStereo } from "../types";

export type KeyEstimate = {
  /** Pitch class 0–11 (C=0) */
  root: number;
  mode: "major" | "minor" | "unknown";
  confidence: "high" | "medium" | "low" | "none";
  notes: string[];
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Goertzel-ish energy at MIDI-ish centers across one octave template. */
function chromaVector(mono: Float32Array, sr: number): Float32Array {
  const chroma = new Float32Array(12);
  // Sample short windows across the file
  const win = Math.min(mono.length, Math.floor(sr * 0.5));
  const hops = 8;
  for (let h = 0; h < hops; h++) {
    const start = Math.floor(((mono.length - win) * h) / Math.max(1, hops - 1));
    for (let pc = 0; pc < 12; pc++) {
      // Sum energy near several octaves of this pitch class
      for (const oct of [2, 3, 4, 5]) {
        const freq = 440 * Math.pow(2, (pc - 9) / 12 + (oct - 4)); // A4=440, pc 9 = A
        if (freq < 60 || freq > sr * 0.4) continue;
        // Crude correlator
        let re = 0;
        let im = 0;
        const step = Math.max(1, Math.floor(sr / freq / 8));
        const n = Math.floor(win / step);
        for (let i = 0; i < n; i++) {
          const idx = start + i * step;
          if (idx >= mono.length) break;
          const t = i / sr;
          const s = mono[idx] || 0;
          re += s * Math.cos(2 * Math.PI * freq * t);
          im += s * Math.sin(2 * Math.PI * freq * t);
        }
        chroma[pc] += Math.sqrt(re * re + im * im) / Math.max(1, n);
      }
    }
  }
  // Normalize
  let max = 1e-9;
  for (let i = 0; i < 12; i++) max = Math.max(max, chroma[i]);
  for (let i = 0; i < 12; i++) chroma[i] /= max;
  return chroma;
}

const MAJOR = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1];
const MINOR = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0];

function templateScore(chroma: Float32Array, template: number[], root: number): number {
  let s = 0;
  for (let i = 0; i < 12; i++) {
    s += chroma[i] * template[(i - root + 12) % 12];
  }
  return s;
}

export function estimateKeyFromBeat(beat: PcmStereo): KeyEstimate {
  const mono = stereoToMono(beat);
  if (rmsOf(mono) < 1e-5) {
    return { root: 0, mode: "unknown", confidence: "none", notes: ["silent_beat"] };
  }
  const chroma = chromaVector(mono, beat.sampleRate);
  let best = { root: 0, mode: "major" as "major" | "minor", score: -1 };
  for (let r = 0; r < 12; r++) {
    const maj = templateScore(chroma, MAJOR, r);
    const min = templateScore(chroma, MINOR, r);
    if (maj > best.score) best = { root: r, mode: "major", score: maj };
    if (min > best.score) best = { root: r, mode: "minor", score: min };
  }
  // Confidence from peak vs mean of scores
  const scores: number[] = [];
  for (let r = 0; r < 12; r++) {
    scores.push(templateScore(chroma, MAJOR, r), templateScore(chroma, MINOR, r));
  }
  scores.sort((a, b) => b - a);
  const margin = scores[0] - (scores[1] || 0);
  let confidence: KeyEstimate["confidence"] = "low";
  if (margin > 0.35) confidence = "high";
  else if (margin > 0.18) confidence = "medium";
  else if (margin < 0.08) confidence = "none";

  return {
    root: best.root,
    mode: best.mode,
    confidence,
    notes: [`key:${NOTE_NAMES[best.root]} ${best.mode}`, `margin:${margin.toFixed(2)}`],
  };
}
