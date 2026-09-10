import { bandEnergy, peakOf, rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo, VocalAnalysis } from "../types";

export function analyzeVocal(pcm: PcmStereo): VocalAnalysis {
  const mono = stereoToMono(pcm);
  const sr = pcm.sampleRate;
  const peak = peakOf(mono);
  const rms = rmsOf(mono);
  const crest = rms > 1e-9 ? peak / rms : null;

  let clipCount = 0;
  let silent = 0;
  const clipThr = 0.99;
  const silThr = 0.01;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i] || 0);
    if (a >= clipThr) clipCount++;
    if (a < silThr) silent++;
  }
  const clippingRatio = mono.length ? clipCount / mono.length : 0;
  const silenceRatio = mono.length ? silent / mono.length : 1;

  // Noise floor ~ lower percentile of frame RMS
  const frame = Math.floor(sr * 0.02);
  const frameRms: number[] = [];
  for (let i = 0; i + frame < mono.length; i += frame) {
    let s = 0;
    for (let j = 0; j < frame; j++) {
      const v = mono[i + j] || 0;
      s += v * v;
    }
    frameRms.push(Math.sqrt(s / frame));
  }
  frameRms.sort((a, b) => a - b);
  const noiseFloor =
    frameRms.length > 10 ? frameRms[Math.floor(frameRms.length * 0.1)] : null;

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
    clippingRatio,
    noiseFloor,
    silenceRatio,
    bands: { low: low / sum, mid: mid / sum, high: high / sum },
  };
}
