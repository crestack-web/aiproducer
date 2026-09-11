/**
 * Automatic take selection / light phrase comping.
 * Pure TS: score takes, pick best, optionally stitch high-energy segments.
 */
import { peakOf, rmsOf, stereoToMono, cloneStereo } from "../dsp";
import type { PcmStereo } from "../types";

export type TakeScore = {
  score: number;
  rms: number;
  peak: number;
  crest: number;
  silenceRatio: number;
  clipRatio: number;
  notes: string[];
};

export function scoreTake(pcm: PcmStereo): TakeScore {
  const mono = stereoToMono(pcm);
  const rms = rmsOf(mono);
  const peak = peakOf(mono);
  const crest = rms > 1e-9 ? peak / rms : 0;
  let silent = 0;
  let clip = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i] || 0);
    if (a < 0.012) silent++;
    if (a > 0.98) clip++;
  }
  const silenceRatio = mono.length ? silent / mono.length : 1;
  const clipRatio = mono.length ? clip / mono.length : 0;
  const notes: string[] = [];

  // Prefer solid level, moderate crest (not crushed, not tiny), low clip, moderate silence
  let score = 0;
  // RMS in a healthy phone-vocal range
  if (rms > 0.02 && rms < 0.25) score += 3;
  else if (rms > 0.01) score += 1.5;
  else {
    score -= 2;
    notes.push("quiet");
  }

  if (crest > 2.5 && crest < 12) score += 2;
  else if (crest >= 12) {
    score += 0.5;
    notes.push("dynamic");
  } else {
    score -= 1;
    notes.push("flat_or_tiny");
  }

  if (clipRatio > 0.002) {
    score -= 3;
    notes.push("clipping");
  } else score += 1;

  if (silenceRatio > 0.85) {
    score -= 2;
    notes.push("mostly_silent");
  } else if (silenceRatio < 0.55) score += 1;

  // Slight preference for longer usable content
  const dur = mono.length / pcm.sampleRate;
  if (dur > 3 && dur < 90) score += 0.5;

  return { score, rms, peak, crest, silenceRatio, clipRatio, notes };
}

export function pickBestTake<T extends { pcm: PcmStereo }>(
  takes: T[]
): { best: T; scores: TakeScore[]; index: number } {
  if (!takes.length) throw new Error("No takes to comp");
  const scores = takes.map((t) => scoreTake(t.pcm));
  let bestI = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i].score > scores[bestI].score) bestI = i;
  }
  return { best: takes[bestI], scores, index: bestI };
}

/**
 * Phrase-ish stitch: for each window, pick the take with highest local energy
 * among non-clipped frames. Crossfade 8ms. Only when 2+ takes same length-ish.
 */
export function stitchBestPhrases(takes: PcmStereo[], windowMs = 400): {
  pcm: PcmStereo;
  switches: number;
} {
  if (takes.length === 0) throw new Error("No takes");
  if (takes.length === 1) return { pcm: takes[0], switches: 0 };

  const sr = takes[0].sampleRate;
  const n = Math.min(...takes.map((t) => t.left.length));
  const win = Math.max(64, Math.floor((windowMs / 1000) * sr));
  const fade = Math.max(16, Math.floor(0.008 * sr));
  const out = cloneStereo({ left: new Float32Array(n), right: new Float32Array(n), sampleRate: sr });
  let switches = 0;
  let prev = 0;

  for (let start = 0; start < n; start += win) {
    const end = Math.min(n, start + win);
    let bestT = 0;
    let bestE = -1;
    for (let t = 0; t < takes.length; t++) {
      let e = 0;
      let clips = 0;
      for (let i = start; i < end; i++) {
        const a = Math.max(Math.abs(takes[t].left[i] || 0), Math.abs(takes[t].right[i] || 0));
        e += a * a;
        if (a > 0.98) clips++;
      }
      e = e / Math.max(1, end - start);
      if (clips > (end - start) * 0.01) e *= 0.2;
      if (e > bestE) {
        bestE = e;
        bestT = t;
      }
    }
    if (bestT !== prev) switches++;
    prev = bestT;

    for (let i = start; i < end; i++) {
      let g = 1;
      if (i - start < fade && start > 0) g = (i - start) / fade;
      if (end - i < fade) g = Math.min(g, (end - i) / fade);
      // Crossfade with previous material already in out for fade region
      const ol = out.left[i] || 0;
      const or_ = out.right[i] || 0;
      const nl = takes[bestT].left[i] || 0;
      const nr = takes[bestT].right[i] || 0;
      if (i - start < fade && start > 0) {
        out.left[i] = ol * (1 - g) + nl * g;
        out.right[i] = or_ * (1 - g) + nr * g;
      } else {
        out.left[i] = nl;
        out.right[i] = nr;
      }
    }
  }
  return { pcm: out, switches };
}
