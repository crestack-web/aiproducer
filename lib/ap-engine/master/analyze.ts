/**
 * Pre-master analysis — LUFS proxy, peak, LRA proxy, spectral balance, width.
 */
import { bandEnergy, peakOf, rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";
import { estimateLoudnessProxyDb } from "./loudness";

export type MasterAnalysis = {
  integratedDb: number;
  truePeakDb: number;
  /** Loudness range proxy (dB difference between loud and quiet active frames) */
  lraProxy: number;
  bands: { low: number; mid: number; high: number };
  stereoWidth: number;
  durationMs: number;
};

function truePeakDb(pcm: PcmStereo): number {
  let tp = 0;
  const n = pcm.left.length;
  for (let i = 0; i < n - 1; i++) {
    const l0 = Math.abs(pcm.left[i] || 0);
    const l1 = Math.abs(pcm.left[i + 1] || 0);
    const r0 = Math.abs(pcm.right[i] || 0);
    const r1 = Math.abs(pcm.right[i + 1] || 0);
    tp = Math.max(tp, l0, l1, r0, r1, (l0 + l1) * 0.5, (r0 + r1) * 0.5);
  }
  if (tp < 1e-12) return -120;
  return 20 * Math.log10(tp);
}

function lraProxy(pcm: PcmStereo): number {
  const mono = stereoToMono(pcm);
  const sr = pcm.sampleRate;
  const frame = Math.max(256, Math.floor(sr * 0.4)); // ~400ms blocks
  const blocks: number[] = [];
  for (let i = 0; i + frame <= mono.length; i += frame) {
    let s = 0;
    for (let j = i; j < i + frame; j++) {
      const x = mono[j] || 0;
      s += x * x;
    }
    const r = Math.sqrt(s / frame);
    if (r > 1e-5) blocks.push(20 * Math.log10(r));
  }
  if (blocks.length < 4) return 0;
  blocks.sort((a, b) => a - b);
  const lo = blocks[Math.floor(blocks.length * 0.1)];
  const hi = blocks[Math.floor(blocks.length * 0.95)];
  return Math.max(0, hi - lo);
}

function stereoWidth(pcm: PcmStereo): number {
  // 0 = mono, 1 = very wide (side energy vs mid)
  let mid = 0;
  let side = 0;
  const n = pcm.left.length;
  const step = Math.max(1, Math.floor(n / 80000));
  for (let i = 0; i < n; i += step) {
    const l = pcm.left[i] || 0;
    const r = pcm.right[i] || 0;
    const m = (l + r) * 0.5;
    const s = (l - r) * 0.5;
    mid += m * m;
    side += s * s;
  }
  if (mid < 1e-12) return 0;
  return Math.min(1, Math.sqrt(side / mid));
}

export function analyzeMasterInput(pcm: PcmStereo): MasterAnalysis {
  const mono = stereoToMono(pcm);
  const low = bandEnergy(mono, pcm.sampleRate, 30, 250);
  const mid = bandEnergy(mono, pcm.sampleRate, 250, 4000);
  const high = bandEnergy(mono, pcm.sampleRate, 4000, Math.min(12000, pcm.sampleRate * 0.45));
  const sum = low + mid + high + 1e-9;
  return {
    integratedDb: estimateLoudnessProxyDb(pcm),
    truePeakDb: truePeakDb(pcm),
    lraProxy: lraProxy(pcm),
    bands: { low: low / sum, mid: mid / sum, high: high / sum },
    stereoWidth: stereoWidth(pcm),
    durationMs: Math.round((mono.length / pcm.sampleRate) * 1000),
  };
}
