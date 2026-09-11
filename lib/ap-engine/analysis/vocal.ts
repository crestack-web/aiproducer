import { bandEnergy, peakOf, rmsOf, stereoToMono } from "../dsp";
import type { BandEnergies, PcmStereo, VocalAnalysis } from "../types";

export type VocalCharacter = {
  mud: number; // 0–1 excess 80–250
  box: number; // 0–1 excess 300–600
  nasal: number; // 0–1 excess 800–1500
  harsh: number; // 0–1 excess 2.5–5k
  air: number; // 0–1 energy above 8k
  thin: number; // 0–1 lack of body <250
  presence: number; // 0–1 1.5–4k
};

export type ExtendedVocalAnalysis = VocalAnalysis & {
  character: VocalCharacter;
  bandsFine: {
    sub: number;
    body: number;
    lowMid: number;
    mid: number;
    presence: number;
    brilliance: number;
    air: number;
  };
};

function safeRatio(part: number, sum: number): number {
  return Math.max(0, Math.min(1, part / (sum + 1e-9)));
}

export function analyzeVocal(pcm: PcmStereo): VocalAnalysis {
  return analyzeVocalExtended(pcm);
}

export function analyzeVocalExtended(pcm: PcmStereo): ExtendedVocalAnalysis {
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

  const sub = bandEnergy(mono, sr, 40, 120);
  const body = bandEnergy(mono, sr, 120, 300);
  const lowMid = bandEnergy(mono, sr, 300, 700);
  const mid = bandEnergy(mono, sr, 700, 1800);
  const presence = bandEnergy(mono, sr, 1800, 4500);
  const brilliance = bandEnergy(mono, sr, 4500, 8000);
  const air = bandEnergy(mono, sr, 8000, Math.min(14000, sr * 0.45));
  const fineSum = sub + body + lowMid + mid + presence + brilliance + air + 1e-9;

  const bandsFine = {
    sub: safeRatio(sub, fineSum),
    body: safeRatio(body, fineSum),
    lowMid: safeRatio(lowMid, fineSum),
    mid: safeRatio(mid, fineSum),
    presence: safeRatio(presence, fineSum),
    brilliance: safeRatio(brilliance, fineSum),
    air: safeRatio(air, fineSum),
  };

  const low = sub + body;
  const midB = lowMid + mid + presence;
  const high = brilliance + air;
  const sum = low + midB + high + 1e-9;
  const bands: BandEnergies = {
    low: low / sum,
    mid: midB / sum,
    high: high / sum,
  };

  // Character scores vs healthy voice priors (relative)
  const character: VocalCharacter = {
    mud: Math.max(0, Math.min(1, (bandsFine.body + bandsFine.sub) * 1.4 - 0.22)),
    box: Math.max(0, Math.min(1, bandsFine.lowMid * 2.2 - 0.18)),
    nasal: Math.max(0, Math.min(1, bandsFine.mid * 2.0 - 0.2)),
    harsh: Math.max(0, Math.min(1, (bandsFine.presence * 0.6 + bandsFine.brilliance) * 1.8 - 0.2)),
    air: Math.max(0, Math.min(1, bandsFine.air * 3.5)),
    thin: Math.max(0, Math.min(1, 0.28 - (bandsFine.body + bandsFine.sub))),
    presence: Math.max(0, Math.min(1, bandsFine.presence * 2.2)),
  };

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
    bands,
    character,
    bandsFine,
  };
}
