import type { PitchFrame } from "./types";
import { hzToMidi } from "./detector";

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

export function estimateKeyFromFrames(frames: PitchFrame[]): {
  keyMidiRoot: number | null;
  scale: "major" | "minor" | "chromatic";
  confidence: number;
} {
  const hist = new Float32Array(12);
  let voiced = 0;
  for (const f of frames) {
    if (!f.voiced || f.frequencyHz == null) continue;
    const midi = hzToMidi(f.frequencyHz);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    hist[pc] += f.confidence;
    voiced++;
  }
  if (voiced < 8) return { keyMidiRoot: null, scale: "chromatic", confidence: 0 };
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += hist[i];
  if (sum <= 0) return { keyMidiRoot: null, scale: "chromatic", confidence: 0 };
  for (let i = 0; i < 12; i++) hist[i] /= sum;

  let bestRoot = 0;
  let bestScale: "major" | "minor" = "major";
  let bestScore = -1e9;
  for (let root = 0; root < 12; root++) {
    for (const scale of ["major", "minor"] as const) {
      const template = scale === "major" ? MAJOR : MINOR;
      let score = 0;
      for (let pc = 0; pc < 12; pc++) {
        const degree = (pc - root + 12) % 12;
        score += hist[pc] * (template.includes(degree) ? 1 : -0.6);
      }
      if (score > bestScore) {
        bestScore = score;
        bestRoot = root;
        bestScale = scale;
      }
    }
  }
  const conf = Math.max(0, Math.min(1, (bestScore + 0.2) / 0.8));
  if (conf < 0.2) return { keyMidiRoot: null, scale: "chromatic", confidence: conf };
  return { keyMidiRoot: bestRoot, scale: bestScale, confidence: conf };
}

export function nearestScaleMidi(
  midi: number,
  keyRoot: number | null,
  scale: "major" | "minor" | "chromatic"
): number {
  if (keyRoot == null || scale === "chromatic") return Math.round(midi);
  const template = scale === "major" ? MAJOR : MINOR;
  const octave = Math.floor(midi / 12);
  let best = Math.round(midi);
  let bestDist = 1e9;
  for (const deg of template) {
    for (const o of [octave - 1, octave, octave + 1]) {
      const candidate = o * 12 + ((keyRoot + deg) % 12);
      const dist = Math.abs(candidate - midi);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
  }
  return best;
}
