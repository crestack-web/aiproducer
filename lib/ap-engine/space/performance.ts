/**
 * Vocal performance signals — drive space/integration decisions.
 * Confidence-aware; does not claim emotion certainty.
 */
import { peakOf, rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";

export type PerformanceSignals = {
  rms: number;
  peak: number;
  crest: number;
  durationMs: number;
  silenceRatio: number;
  /** 0–1 relative energy */
  energy: number;
  brightness: number;
  phraseDensity: number;
  intimacy: number;
  sustained: number;
  transientDensity: number;
  lowContamination: number;
  confidence: number;
  notes: string[];
};

function bandEnergy(mono: Float32Array, sr: number, lo: number, hi: number): number {
  // Simple zero-crossing / energy proxy via windowed RMS on highpassed residual is expensive;
  // use spectral proxy: difference of successive samples correlates with high frequency.
  let e = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(mono.length / 8000));
  for (let i = 1; i < mono.length; i += step) {
    const d = Math.abs((mono[i] || 0) - (mono[i - 1] || 0));
    const a = Math.abs(mono[i] || 0);
    // high band proxy
    if (hi > 4000) e += d;
    else if (lo < 200) e += a * (1 - Math.min(1, d * 8));
    else e += a;
    n++;
  }
  return n ? e / n : 0;
}

export function analyzePerformance(pcm: PcmStereo): PerformanceSignals {
  const mono = stereoToMono(pcm);
  const sr = pcm.sampleRate || 44100;
  const durationMs = Math.round((mono.length / sr) * 1000);
  const rms = rmsOf(mono);
  const peak = peakOf(mono);
  const crest = rms > 1e-9 ? peak / rms : 1;

  // Silence ratio
  const thresh = Math.max(0.008, rms * 0.18);
  let silent = 0;
  const hop = Math.max(1, Math.floor(sr * 0.01));
  let frames = 0;
  for (let i = 0; i < mono.length; i += hop) {
    let s = 0;
    const end = Math.min(mono.length, i + hop);
    for (let j = i; j < end; j++) s += Math.abs(mono[j] || 0);
    const m = s / Math.max(1, end - i);
    if (m < thresh) silent++;
    frames++;
  }
  const silenceRatio = frames ? silent / frames : 0;

  const brightProxy = bandEnergy(mono, sr, 4000, 12000);
  const lowProxy = bandEnergy(mono, sr, 40, 180);
  const midProxy = Math.max(1e-9, rms);

  const brightness = Math.min(1, brightProxy / (midProxy * 2.5 + 1e-6));
  const lowContamination = Math.min(1, lowProxy / (midProxy * 1.8 + 1e-6));

  // Phrase density: active frames ratio inverse of silence, weighted by short windows
  const phraseDensity = Math.min(1, Math.max(0, (1 - silenceRatio) * (durationMs > 8000 ? 0.85 : 1)));

  // Energy relative to typical speech-ish RMS ~0.05–0.15
  const energy = Math.min(1, Math.max(0, (rms - 0.02) / 0.18));

  // Sustained: low crest + long active stretches
  const sustained = Math.min(1, Math.max(0, (2.2 - Math.min(crest, 4)) / 1.5) * (1 - silenceRatio));

  // Transients: high crest
  const transientDensity = Math.min(1, Math.max(0, (crest - 2) / 6));

  // Intimacy heuristic: lower energy, higher silence, lower brightness → intimate
  const intimacy = Math.min(
    1,
    Math.max(
      0,
      (1 - energy) * 0.45 + silenceRatio * 0.25 + (1 - brightness) * 0.2 + (1 - phraseDensity) * 0.1
    )
  );

  let confidence = 0.55;
  if (durationMs > 1500 && rms > 0.01) confidence += 0.15;
  if (durationMs > 4000) confidence += 0.1;
  if (peak > 0.05 && peak < 0.99) confidence += 0.08;
  if (silenceRatio > 0.05 && silenceRatio < 0.85) confidence += 0.05;
  confidence = Math.min(0.92, confidence);

  const notes: string[] = [];
  if (energy > 0.65) notes.push("energetic");
  if (intimacy > 0.55) notes.push("intimate");
  if (phraseDensity > 0.7) notes.push("dense_lyrics");
  if (sustained > 0.55) notes.push("sustained");
  if (brightness > 0.6) notes.push("bright");
  if (lowContamination > 0.55) notes.push("low_mud_risk");

  return {
    rms,
    peak,
    crest,
    durationMs,
    silenceRatio,
    energy,
    brightness,
    phraseDensity,
    intimacy,
    sustained,
    transientDensity,
    lowContamination,
    confidence,
    notes,
  };
}
