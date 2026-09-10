import { bandEnergy, peakOf, rmsOf, stereoToMono } from "../dsp";
import type { BeatAnalysis, PcmStereo } from "../types";

export function analyzeBeat(pcm: PcmStereo, bpmHint?: number | null): BeatAnalysis {
  const mono = stereoToMono(pcm);
  const sr = pcm.sampleRate;
  const peak = peakOf(mono);
  const rms = rmsOf(mono);
  const crest = rms > 1e-9 ? peak / rms : null;
  const low = bandEnergy(mono, sr, 30, 250);
  const mid = bandEnergy(mono, sr, 250, 4000);
  const high = bandEnergy(mono, sr, 4000, Math.min(12000, sr * 0.45));
  const sum = low + mid + high + 1e-9;
  return {
    durationMs: Math.round((mono.length / sr) * 1000),
    sampleRate: sr,
    channels: 2,
    rms,
    peak,
    crest,
    bands: { low: low / sum, mid: mid / sum, high: high / sum },
    bpm: bpmHint != null && Number.isFinite(bpmHint) ? bpmHint : null,
  };
}
