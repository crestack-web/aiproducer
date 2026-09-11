/**
 * Trim empty vocal space so gaps don't produce weird FX/noise artifacts.
 *
 * - Leading / trailing silence → hard-zeroed outside content (with soft fades)
 * - Long internal gaps → forced to true silence (keeps timing vs the beat)
 *
 * Does NOT time-compress the performance — phrase positions stay aligned to placement.
 */
import { cloneStereo, rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";
import { cleanTakeEdges } from "./edge-fade";

export type SilenceTrimQC = {
  applied: boolean;
  leadTrimMs: number;
  tailTrimMs: number;
  internalGaps: number;
  internalSilentMs: number;
};

function frameRms(buf: Float32Array, start: number, len: number): number {
  let s = 0;
  const end = Math.min(buf.length, start + len);
  const n = Math.max(1, end - start);
  for (let i = start; i < end; i++) {
    const v = buf[i] || 0;
    s += v * v;
  }
  return Math.sqrt(s / n);
}

/**
 * Zero long quiet regions inside the take so reverb/delay/FX don't smear noise
 * through empty bars. Keeps sample positions (timeline stays valid).
 */
export function silenceInternalGaps(
  pcm: PcmStereo,
  opts?: { minGapMs?: number; contentRatio?: number; padMs?: number }
): { pcm: PcmStereo; gaps: number; silentMs: number } {
  const minGapMs = opts?.minGapMs ?? 220;
  const contentRatio = opts?.contentRatio ?? 0.055;
  const padMs = opts?.padMs ?? 40;

  const mono = stereoToMono(pcm);
  const sr = pcm.sampleRate;
  const frame = Math.max(32, Math.floor(sr * 0.01)); // 10ms
  const peak = Math.max(rmsOf(mono), 1e-6);
  const thr = peak * contentRatio;
  const minGapFrames = Math.max(2, Math.floor(minGapMs / 10));
  const padFrames = Math.max(1, Math.floor(padMs / 10));

  const nFrames = Math.floor(mono.length / frame);
  const active = new Uint8Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    active[i] = frameRms(mono, i * frame, frame) >= thr ? 1 : 0;
  }

  // Mark gaps longer than minGap as silent zones (with pad so we don't eat consonants)
  const silent = new Uint8Array(nFrames);
  let i = 0;
  let gaps = 0;
  let silentFrames = 0;
  while (i < nFrames) {
    if (active[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < nFrames && !active[j]) j++;
    const len = j - i;
    if (len >= minGapFrames) {
      gaps++;
      const a = Math.min(nFrames, i + padFrames);
      const b = Math.max(a, j - padFrames);
      for (let k = a; k < b; k++) {
        silent[k] = 1;
        silentFrames++;
      }
    }
    i = j;
  }

  if (gaps === 0) {
    return { pcm, gaps: 0, silentMs: 0 };
  }

  const out = cloneStereo(pcm);
  const fade = Math.max(8, Math.floor(sr * 0.008));
  for (let f = 0; f < nFrames; f++) {
    if (!silent[f]) continue;
    const start = f * frame;
    const end = Math.min(out.left.length, start + frame);
    // Soft edges when entering/leaving a gap
    const prevSilent = f > 0 && silent[f - 1];
    const nextSilent = f + 1 < nFrames && silent[f + 1];
    for (let s = start; s < end; s++) {
      let g = 0;
      if (!prevSilent && s - start < fade) {
        g = 1 - (s - start) / fade; // fade out into silence
      } else if (!nextSilent && end - s < fade) {
        g = 1 - (end - s) / fade; // fade in from silence
      }
      out.left[s] = (out.left[s] || 0) * g;
      out.right[s] = (out.right[s] || 0) * g;
    }
  }

  return {
    pcm: out,
    gaps,
    silentMs: Math.round((silentFrames * frame) / sr * 1000),
  };
}

/**
 * Full empty-space cleanup for a vocal take:
 * 1) aggressive edge content bounds + fades
 * 2) internal long-gap silence
 */
export function trimVocalSilence(
  pcm: PcmStereo,
  intensity: "normal" | "aggressive" = "aggressive"
): { pcm: PcmStereo; qc: SilenceTrimQC } {
  const aggressive = intensity === "aggressive";

  // Stronger edge pass than default restore — phone takes often have 0.5–1.5s empty head/tail
  const edged = cleanTakeEdges(pcm, {
    maxLeadMs: aggressive ? 1200 : 600,
    maxTailMs: aggressive ? 1400 : 700,
    fadeInMs: aggressive ? 35 : 45,
    fadeOutMs: aggressive ? 70 : 90,
    contentRatio: aggressive ? 0.06 : 0.08,
  });

  const mono0 = stereoToMono(pcm);
  const mono1 = stereoToMono(edged);
  // Approximate lead/tail removed as zeroed region length at ends
  let lead = 0;
  let tail = 0;
  const thr = Math.max(rmsOf(mono0) * 0.05, 1e-5);
  for (let i = 0; i < mono1.length; i++) {
    if (Math.abs(mono1[i] || 0) > thr) break;
    lead++;
  }
  for (let i = mono1.length - 1; i >= 0; i--) {
    if (Math.abs(mono1[i] || 0) > thr) break;
    tail++;
  }

  const internal = silenceInternalGaps(edged, {
    minGapMs: aggressive ? 180 : 280,
    contentRatio: aggressive ? 0.05 : 0.06,
    padMs: aggressive ? 35 : 50,
  });

  const qc: SilenceTrimQC = {
    applied: true,
    leadTrimMs: Math.round((lead / pcm.sampleRate) * 1000),
    tailTrimMs: Math.round((tail / pcm.sampleRate) * 1000),
    internalGaps: internal.gaps,
    internalSilentMs: internal.silentMs,
  };

  return { pcm: internal.pcm, qc };
}
