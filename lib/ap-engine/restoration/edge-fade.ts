/**
 * Clean phone-recording edges: mouth open/close clicks and breath dumps
 * at the start/end of a take. Soft fade + light silence trim — keeps the song
 * part, not a hard chop that clicks.
 */

import { cloneStereo, rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";

export type EdgeFadeOptions = {
  /** Max leading silence/noise to scan (ms) */
  maxLeadMs?: number;
  /** Max trailing silence/noise to scan (ms) */
  maxTailMs?: number;
  /** Fade-in length once content starts (ms) */
  fadeInMs?: number;
  /** Fade-out length before content ends (ms) */
  fadeOutMs?: number;
  /** RMS threshold relative to peak for "content started" */
  contentRatio?: number;
};

const DEFAULTS: Required<EdgeFadeOptions> = {
  maxLeadMs: 350,
  maxTailMs: 400,
  fadeInMs: 45,
  fadeOutMs: 90,
  contentRatio: 0.08,
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
 * Find first/last index where short-frame energy rises above a fraction of peak RMS.
 * Caps search so we never eat into the middle of a short take.
 */
function findContentBounds(
  mono: Float32Array,
  sampleRate: number,
  opts: Required<EdgeFadeOptions>
): { start: number; end: number } {
  const frame = Math.max(32, Math.floor(sampleRate * 0.008)); // 8ms
  const peak = Math.max(rmsOf(mono), 1e-6);
  const thr = peak * opts.contentRatio;

  const maxLead = Math.min(mono.length, Math.floor((opts.maxLeadMs / 1000) * sampleRate));
  const maxTail = Math.min(mono.length, Math.floor((opts.maxTailMs / 1000) * sampleRate));

  let start = 0;
  for (let i = 0; i + frame < maxLead; i += frame) {
    if (frameRms(mono, i, frame) >= thr) {
      start = Math.max(0, i - frame); // small pad so attack isn't clipped
      break;
    }
  }

  let end = mono.length;
  for (let i = mono.length - frame; i > mono.length - maxTail && i >= 0; i -= frame) {
    if (frameRms(mono, i, frame) >= thr) {
      end = Math.min(mono.length, i + frame * 2);
      break;
    }
  }

  // Guard very short takes
  if (end - start < sampleRate * 0.12) {
    return { start: 0, end: mono.length };
  }
  return { start, end };
}

function applyLinearFadeIn(buf: Float32Array, from: number, fadeSamples: number): void {
  const n = Math.min(fadeSamples, buf.length - from);
  if (n <= 1) return;
  for (let i = 0; i < n; i++) {
    const g = i / (n - 1);
    // cosine ease — smoother than linear on breaths
    const w = 0.5 - 0.5 * Math.cos(Math.PI * g);
    buf[from + i] = (buf[from + i] || 0) * w;
  }
}

function applyLinearFadeOut(buf: Float32Array, toExclusive: number, fadeSamples: number): void {
  const n = Math.min(fadeSamples, toExclusive);
  if (n <= 1) return;
  const start = toExclusive - n;
  for (let i = 0; i < n; i++) {
    const g = 1 - i / (n - 1);
    const w = 0.5 - 0.5 * Math.cos(Math.PI * g);
    buf[start + i] = (buf[start + i] || 0) * w;
  }
}

/**
 * Zero outside content bounds, fade in/out at edges.
 * Removes typical mouth-close thumps without dulling the performance.
 */
export function cleanTakeEdges(pcm: PcmStereo, options?: EdgeFadeOptions): PcmStereo {
  const opts = { ...DEFAULTS, ...(options || {}) };
  const out = cloneStereo(pcm);
  const mono = stereoToMono(out);
  const { start, end } = findContentBounds(mono, out.sampleRate, opts);

  // Silence leading mouth-noise
  for (let i = 0; i < start; i++) {
    out.left[i] = 0;
    out.right[i] = 0;
  }
  // Silence trailing mouth-close
  for (let i = end; i < out.left.length; i++) {
    out.left[i] = 0;
    out.right[i] = 0;
  }

  const fadeIn = Math.max(1, Math.floor((opts.fadeInMs / 1000) * out.sampleRate));
  const fadeOut = Math.max(1, Math.floor((opts.fadeOutMs / 1000) * out.sampleRate));

  applyLinearFadeIn(out.left, start, fadeIn);
  applyLinearFadeIn(out.right, start, fadeIn);
  applyLinearFadeOut(out.left, end, fadeOut);
  applyLinearFadeOut(out.right, end, fadeOut);

  return out;
}
