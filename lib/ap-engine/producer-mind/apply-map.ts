/**
 * DSP execution of Producer Mind decision map.
 * Applies phrase/section fader rides on placed stereo buffers.
 */
import { cloneStereo, dbToGain } from "../dsp";
import type { PcmStereo } from "../types";
import type { DecisionMap, PhraseDecision } from "./types";

function applyRideRegion(
  pcm: PcmStereo,
  startMs: number,
  endMs: number,
  gainDb: number
): void {
  if (Math.abs(gainDb) < 0.12) return;
  const sr = pcm.sampleRate;
  const start = Math.max(0, Math.floor((startMs / 1000) * sr));
  const end = Math.min(pcm.left.length, Math.floor((endMs / 1000) * sr));
  if (end <= start) return;
  const g = dbToGain(gainDb);
  const fade = Math.max(1, Math.floor(0.025 * sr));
  for (let i = start; i < end; i++) {
    let env = 1;
    if (i - start < fade) env = (i - start) / fade;
    if (end - i < fade) env = Math.min(env, (end - i) / fade);
    const gg = 1 + (g - 1) * env;
    pcm.left[i] = (pcm.left[i] || 0) * gg;
    pcm.right[i] = (pcm.right[i] || 0) * gg;
  }
}

/**
 * Apply all phrase fader rides for a given role onto a placed (song-timeline) vocal.
 */
export function applyPhraseFaderRides(
  placed: PcmStereo,
  map: DecisionMap,
  roleFilter?: string
): PcmStereo {
  const out = cloneStereo(placed);
  for (const ph of map.phrases) {
    if (roleFilter && ph.role !== roleFilter) continue;
    applyRideRegion(out, ph.timeRangeMs[0], ph.timeRangeMs[1], ph.instructions.vocalFaderRideDb);
  }
  // Section-level rides as soft underlay when no phrases (or additional)
  for (const sec of map.sections) {
    // Only apply residual section ride if we have few phrases covering it
    const covering = map.phrases.filter(
      (p) => p.timeRangeMs[0] < sec.timeRangeMs[1] && p.timeRangeMs[1] > sec.timeRangeMs[0]
    );
    if (covering.length >= 2) continue;
    applyRideRegion(out, sec.timeRangeMs[0], sec.timeRangeMs[1], sec.vocalFaderRideDb * 0.5);
  }
  return out;
}

/** Scale decision for a layer before DSP chain (compression / reverb / breath). */
export function phraseInfluenceForLayer(
  map: DecisionMap,
  role: string,
  section: string
): {
  reverbScale: number;
  compressionScale: number;
  deEssScale: number;
  preserveBreath: boolean;
  faderDb: number;
} {
  const relevant = map.phrases.filter((p) => p.role === role && p.section === section);
  if (!relevant.length) {
    const sec = map.sections.find((s) => s.section === section);
    return {
      reverbScale: sec?.reverbSendScale ?? 1,
      compressionScale: 1,
      deEssScale: 1,
      preserveBreath: false,
      faderDb: sec?.vocalFaderRideDb ?? 0,
    };
  }
  const avg = (fn: (p: PhraseDecision) => number) =>
    relevant.reduce((a, p) => a + fn(p), 0) / relevant.length;
  return {
    reverbScale: avg((p) => p.instructions.reverbSendScale),
    compressionScale: avg((p) => p.instructions.compressionScale),
    deEssScale: avg((p) => p.instructions.deEssScale),
    preserveBreath: relevant.some((p) => p.instructions.preserveBreath),
    faderDb: avg((p) => p.instructions.vocalFaderRideDb),
  };
}
