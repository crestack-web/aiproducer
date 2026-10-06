/**
 * Vocal activity + phrase detection (timeline-preserving).
 * Never shifts, deletes, or concatenates audio — analysis only.
 */
import { rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";

/** Tunable constants — phrase detection */
export const PHRASE_MIN_MS = 280;
export const PHRASE_MAX_MS = 12_000;
export const PHRASE_MERGE_GAP_MS = 180;
export const ACTIVITY_HOLD_MS = 80;
export const ACTIVITY_FRAME_MS = 20;
export const ACTIVITY_THRESHOLD_RATIO = 1.8; // vs noise floor estimate
export const MIN_PHRASE_ENERGY = 0.008;

export type VocalPhrase = {
  startMs: number;
  endMs: number;
  energy: number;
  confidence: number;
  isBreathLike?: boolean;
};

export type VocalActivityMap = {
  phrases: VocalPhrase[];
  noiseFloorRms: number;
  activeRatio: number;
  durationMs: number;
};

function frameRmsSeries(
  mono: Float32Array,
  sampleRate: number,
  frameMs: number
): { tMs: number; rms: number }[] {
  const frame = Math.max(64, Math.floor((sampleRate * frameMs) / 1000));
  const hop = frame;
  const out: { tMs: number; rms: number }[] = [];
  for (let i = 0; i + frame <= mono.length; i += hop) {
    let s = 0;
    for (let j = 0; j < frame; j++) {
      const v = mono[i + j] || 0;
      s += v * v;
    }
    out.push({ tMs: (i / sampleRate) * 1000, rms: Math.sqrt(s / frame) });
  }
  return out;
}

/**
 * Detect active vocal regions and group into phrases.
 * Gaps are preserved in the timeline (phrases keep absolute start/end).
 */
export function detectVocalActivity(pcm: PcmStereo): VocalActivityMap {
  const sr = pcm.sampleRate;
  const mono = stereoToMono(pcm);
  const durationMs = Math.round((mono.length / sr) * 1000);
  const frames = frameRmsSeries(mono, sr, ACTIVITY_FRAME_MS);
  if (!frames.length) {
    return { phrases: [], noiseFloorRms: 0, activeRatio: 0, durationMs };
  }

  // Noise floor ≈ 20th percentile of frame RMS
  const sorted = frames.map((f) => f.rms).sort((a, b) => a - b);
  const p20 = sorted[Math.floor(sorted.length * 0.2)] || 1e-6;
  const noiseFloorRms = Math.max(p20, 1e-6);
  const thr = noiseFloorRms * ACTIVITY_THRESHOLD_RATIO + MIN_PHRASE_ENERGY * 0.25;

  // Hysteresis: open above thr, hold ACTIVITY_HOLD_MS after drop
  const holdFrames = Math.max(1, Math.ceil(ACTIVITY_HOLD_MS / ACTIVITY_FRAME_MS));
  const active = new Array<boolean>(frames.length).fill(false);
  let hold = 0;
  for (let i = 0; i < frames.length; i++) {
    if ((frames[i]!.rms) >= thr) {
      active[i] = true;
      hold = holdFrames;
    } else if (hold > 0) {
      active[i] = true;
      hold--;
    }
  }

  // Group into raw regions
  type Raw = { start: number; end: number; sum: number; count: number };
  const raw: Raw[] = [];
  let cur: Raw | null = null;
  for (let i = 0; i < frames.length; i++) {
    if (active[i]) {
      if (!cur) cur = { start: i, end: i, sum: frames[i]!.rms, count: 1 };
      else {
        cur.end = i;
        cur.sum += frames[i]!.rms;
        cur.count++;
      }
    } else if (cur) {
      raw.push(cur);
      cur = null;
    }
  }
  if (cur) raw.push(cur);

  // Merge regions separated by < PHRASE_MERGE_GAP_MS
  const merged: Raw[] = [];
  for (const r of raw) {
    if (!merged.length) {
      merged.push({ ...r });
      continue;
    }
    const prev = merged[merged.length - 1]!;
    const gapMs = frames[r.start]!.tMs - (frames[prev.end]!.tMs + ACTIVITY_FRAME_MS);
    if (gapMs <= PHRASE_MERGE_GAP_MS) {
      prev.end = r.end;
      prev.sum += r.sum;
      prev.count += r.count;
    } else {
      merged.push({ ...r });
    }
  }

  const phrases: VocalPhrase[] = [];
  let activeMs = 0;
  for (const r of merged) {
    const startMs = Math.round(frames[r.start]!.tMs);
    const endMs = Math.round(
      Math.min(durationMs, frames[r.end]!.tMs + ACTIVITY_FRAME_MS)
    );
    const dur = endMs - startMs;
    if (dur < PHRASE_MIN_MS) {
      // Mark as breath-like candidate if short and low energy
      const energy = r.count ? r.sum / r.count : 0;
      if (energy < thr * 1.5) {
        phrases.push({
          startMs,
          endMs,
          energy,
          confidence: 0.35,
          isBreathLike: true,
        });
      }
      continue;
    }
    const clampedEnd = Math.min(endMs, startMs + PHRASE_MAX_MS);
    const energy = r.count ? r.sum / r.count : 0;
    const conf = Math.min(
      0.95,
      0.45 + Math.min(0.4, dur / 2000) + Math.min(0.15, energy / (thr * 4))
    );
    phrases.push({
      startMs,
      endMs: clampedEnd,
      energy,
      confidence: Math.round(conf * 100) / 100,
      isBreathLike: false,
    });
    activeMs += clampedEnd - startMs;
  }

  return {
    phrases,
    noiseFloorRms,
    activeRatio: durationMs > 0 ? activeMs / durationMs : 0,
    durationMs,
  };
}
