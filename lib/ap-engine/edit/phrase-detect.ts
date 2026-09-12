/**
 * AP EDIT — phrase / region detection on a raw vocal take.
 * Not "delete all silence." Classify:
 *   - performance (voiced + consonants)
 *   - musical breath / short pause (keep)
 *   - pre-roll / post-roll dead air (remove from performance edges)
 *   - long inter-phrase noise (attenuate, keep timeline)
 */
import { rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";

export type PhraseRegion = {
  startSample: number;
  endSample: number;
  startMs: number;
  endMs: number;
  /** mean frame energy in region */
  energy: number;
  /** likely includes leading breath */
  hasBreathLead: boolean;
};

export type PhraseAnalysis = {
  sampleRate: number;
  frameMs: number;
  noiseFloor: number;
  contentThreshold: number;
  phrases: PhraseRegion[];
  /** first sample of meaningful performance (after dead pre-roll) */
  performanceStart: number;
  /** last sample of meaningful performance */
  performanceEnd: number;
  preRollMs: number;
  postRollMs: number;
};

function frameEnergies(mono: Float32Array, frame: number): Float32Array {
  const n = Math.floor(mono.length / frame);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const a = i * frame;
    const b = Math.min(mono.length, a + frame);
    for (let j = a; j < b; j++) {
      const x = mono[j] || 0;
      s += x * x;
    }
    e[i] = Math.sqrt(s / Math.max(1, b - a));
  }
  return e;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[i];
}

/**
 * Detect phrase regions. Conservative: prefer keeping borderline content.
 */
export function analyzeVocalPhrases(pcm: PcmStereo): PhraseAnalysis {
  const mono = stereoToMono(pcm);
  const sr = pcm.sampleRate;
  const frameMs = 10;
  const frame = Math.max(32, Math.floor((frameMs / 1000) * sr));
  const e = frameEnergies(mono, frame);
  const n = e.length;

  // Noise floor from quietest 20% of frames
  const sorted = Array.from(e).filter((x) => x > 0).sort((a, b) => a - b);
  const noiseFloor = Math.max(percentile(sorted, 0.15), 1e-6);
  const peak = Math.max(rmsOf(mono), percentile(sorted, 0.95), 1e-5);
  // Content: clearly above room; keep threshold low enough for soft consonants
  const contentThreshold = Math.max(noiseFloor * 3.2, peak * 0.045);

  const active = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    active[i] = e[i] >= contentThreshold ? 1 : 0;
  }
  // Fill micro-gaps (< 80ms) so consonants/gaps inside words stay one phrase
  const fillFrames = Math.max(1, Math.floor(80 / frameMs));
  for (let i = 1; i < n - 1; i++) {
    if (active[i]) continue;
    let left = false;
    let right = false;
    for (let k = 1; k <= fillFrames; k++) {
      if (i - k >= 0 && active[i - k]) left = true;
      if (i + k < n && active[i + k]) right = true;
    }
    if (left && right) active[i] = 1;
  }

  // Musical pause: short quiet between phrases (keep) vs long dead (trim edges only)
  const minPhraseFrames = Math.max(3, Math.floor(120 / frameMs)); // 120ms min phrase
  const phrases: PhraseRegion[] = [];
  let i = 0;
  while (i < n) {
    if (!active[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && active[j]) j++;
    if (j - i >= minPhraseFrames) {
      const startSample = i * frame;
      const endSample = Math.min(mono.length, j * frame);
      let energy = 0;
      for (let k = i; k < j; k++) energy += e[k];
      energy /= Math.max(1, j - i);
      // Breath lead: soft energy in ~80–200ms before phrase
      let hasBreathLead = false;
      const breathLook = Math.floor(180 / frameMs);
      for (let k = Math.max(0, i - breathLook); k < i; k++) {
        if (e[k] > noiseFloor * 1.6 && e[k] < contentThreshold * 0.95) {
          hasBreathLead = true;
          break;
        }
      }
      phrases.push({
        startSample,
        endSample,
        startMs: (startSample / sr) * 1000,
        endMs: (endSample / sr) * 1000,
        energy,
        hasBreathLead,
      });
    }
    i = j;
  }

  let performanceStart = 0;
  let performanceEnd = mono.length;
  if (phrases.length) {
    const first = phrases[0];
    // Include breath pad (~90ms) before first phrase if detected
    const breathPad = first.hasBreathLead ? Math.floor(0.09 * sr) : Math.floor(0.02 * sr);
    performanceStart = Math.max(0, first.startSample - breathPad);
    const last = phrases[phrases.length - 1];
    // Small tail pad for consonants/release
    performanceEnd = Math.min(mono.length, last.endSample + Math.floor(0.06 * sr));
  }

  return {
    sampleRate: sr,
    frameMs,
    noiseFloor,
    contentThreshold,
    phrases,
    performanceStart,
    performanceEnd,
    preRollMs: (performanceStart / sr) * 1000,
    postRollMs: ((mono.length - performanceEnd) / sr) * 1000,
  };
}
