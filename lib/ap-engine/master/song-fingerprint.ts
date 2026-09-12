/**
 * Song Analysis Layer — fingerprint from the mix, independent of genre tag.
 */
import { bandEnergy, peakOf, rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";
import { analyzeMasterInput } from "./analyze";

export type VocalTimbre = {
  /** 0 soft/breathy → 1 bright/powerful */
  brightness: number;
  /** harmonic-to-noise proxy 0 noisy/breathy → 1 clean/harmonic */
  harmonicity: number;
  spectralCentroidHz: number;
};

export type SongFingerprint = {
  vocalTimbre: VocalTimbre;
  /** 0 sparse → 1 dense arrangement */
  density: number;
  bpm: number | null;
  currentLra: number;
  crestFactor: number;
  integratedDb: number;
};

function spectralCentroid(mono: Float32Array, sr: number): number {
  // Coarse band-weighted centroid
  const bands = [
    { c: 150, e: bandEnergy(mono, sr, 80, 250) },
    { c: 500, e: bandEnergy(mono, sr, 250, 1000) },
    { c: 2000, e: bandEnergy(mono, sr, 1000, 4000) },
    { c: 6000, e: bandEnergy(mono, sr, 4000, 10000) },
  ];
  let num = 0;
  let den = 0;
  for (const b of bands) {
    num += b.c * b.e;
    den += b.e;
  }
  return den > 1e-12 ? num / den : 2000;
}

function vocalTimbreFromMix(pcm: PcmStereo): VocalTimbre {
  const mono = stereoToMono(pcm);
  const sr = pcm.sampleRate;
  const centroid = spectralCentroid(mono, sr);
  // brightness from centroid (1k–5k typical for vocals in mix)
  const brightness = Math.max(0, Math.min(1, (centroid - 800) / 4000));
  // HNR proxy: mid coherence vs high noise floor energy
  const mid = bandEnergy(mono, sr, 300, 3000);
  const high = bandEnergy(mono, sr, 5000, 12000);
  const harmonicity = Math.max(0, Math.min(1, mid / (mid + high * 1.8 + 1e-9)));
  return { brightness, harmonicity, spectralCentroidHz: centroid };
}

function densityFromMix(pcm: PcmStereo): number {
  const mono = stereoToMono(pcm);
  const sr = pcm.sampleRate;
  const bands = [
    bandEnergy(mono, sr, 40, 120),
    bandEnergy(mono, sr, 120, 400),
    bandEnergy(mono, sr, 400, 1500),
    bandEnergy(mono, sr, 1500, 4000),
    bandEnergy(mono, sr, 4000, 8000),
    bandEnergy(mono, sr, 8000, 14000),
  ];
  const sum = bands.reduce((a, b) => a + b, 0) + 1e-9;
  const norm = bands.map((b) => b / sum);
  // Spectral flatness-ish: more equal bands → denser arrangement
  const geo = Math.exp(norm.reduce((a, b) => a + Math.log(Math.max(b, 1e-9)), 0) / norm.length);
  const arith = norm.reduce((a, b) => a + b, 0) / norm.length;
  const flatness = geo / (arith + 1e-9);
  // Also count "active" bands
  const active = norm.filter((b) => b > 0.08).length / norm.length;
  return Math.max(0, Math.min(1, flatness * 0.55 + active * 0.45));
}

function estimateBpmFromMix(pcm: PcmStereo): number | null {
  const mono = stereoToMono(pcm);
  const sr = pcm.sampleRate;
  const hop = Math.max(1, Math.floor(sr * 0.01));
  const n = Math.floor(mono.length / hop);
  if (n < 200) return null;
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
  let bestLag = 0;
  let best = -1;
  const minLag = Math.floor((60 / 160) * (sr / hop));
  const maxLag = Math.floor((60 / 70) * (sr / hop));
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    let c = 0;
    for (let i = 0; i + lag < n; i += 2) {
      score += on[i] * on[i + lag];
      c++;
    }
    score /= Math.max(1, c);
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  if (bestLag <= 0) return null;
  const bpm = 60 / ((bestLag * hop) / sr);
  if (bpm < 70 || bpm > 180) return null;
  return bpm;
}

export function extractSongFingerprint(pcm: PcmStereo, bpmHint?: number | null): SongFingerprint {
  const a = analyzeMasterInput(pcm);
  const mono = stereoToMono(pcm);
  const peak = peakOf(mono);
  const r = rmsOf(mono);
  const crest = r > 1e-9 ? peak / r : 1;
  const bpm = bpmHint && bpmHint > 60 && bpmHint < 200 ? bpmHint : estimateBpmFromMix(pcm);

  return {
    vocalTimbre: vocalTimbreFromMix(pcm),
    density: densityFromMix(pcm),
    bpm,
    currentLra: a.lraProxy,
    crestFactor: crest,
    integratedDb: a.integratedDb,
  };
}
