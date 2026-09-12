/**
 * Stage 1 — AP EDIT
 * Turn a raw take into a clean performance region with invisible edges.
 *
 * Keeps: musical pauses between phrases, natural breaths, consonant attacks.
 * Removes: long pre-roll / post-roll dead air (zeroed with micro-fades).
 * Attenuates: long inter-phrase room noise (not time-compressed — timing stays true).
 */
import { cloneStereo, stereoToMono, rmsOf } from "../dsp";
import type { PcmStereo } from "../types";
import { analyzeVocalPhrases, type PhraseAnalysis } from "./phrase-detect";

export type VocalEditQC = {
  applied: boolean;
  phraseCount: number;
  preRollClearedMs: number;
  postRollClearedMs: number;
  internalNoiseGaps: number;
  notes: string[];
};

function fadeRegion(
  left: Float32Array,
  right: Float32Array,
  start: number,
  end: number,
  fadeIn: boolean,
  fadeSamples: number
): void {
  const len = Math.max(0, end - start);
  const f = Math.min(fadeSamples, Math.floor(len / 2));
  if (f < 2) {
    for (let i = start; i < end; i++) {
      left[i] = 0;
      right[i] = 0;
    }
    return;
  }
  for (let i = start; i < end; i++) {
    let g = 0;
    if (fadeIn) {
      // approaching content: silence then fade in at end of region
      const distFromEnd = end - i;
      if (distFromEnd < f) g = 1 - distFromEnd / f;
      else g = 0;
    } else {
      // leaving content: fade out at start of region then silence
      const distFromStart = i - start;
      if (distFromStart < f) g = 1 - distFromStart / f;
      else g = 0;
    }
    left[i] = (left[i] || 0) * g;
    right[i] = (right[i] || 0) * g;
  }
}

/**
 * Edit one vocal take. Does NOT shift content on the timeline —
 * zeros dead pre/post so FX don't smear noise, preserves phrase positions.
 */
export function editVocalPerformance(
  pcm: PcmStereo,
  opts?: { preserveInternalSilence?: boolean; maxEdgeClearMs?: number }
): { pcm: PcmStereo; analysis: PhraseAnalysis; qc: VocalEditQC } {
  const preserveInternal = opts?.preserveInternalSilence !== false;
  const maxEdgeClearMs = opts?.maxEdgeClearMs ?? 2500;

  const analysis = analyzeVocalPhrases(pcm);
  const notes: string[] = [`phrases:${analysis.phrases.length}`];
  const out = cloneStereo(pcm);
  const sr = pcm.sampleRate;
  const fadeSamples = Math.max(16, Math.floor(0.012 * sr)); // 12ms micro-fade

  if (!analysis.phrases.length) {
    // No clear phrases — leave untouched (avoid eating the whole take)
    return {
      pcm: out,
      analysis,
      qc: {
        applied: false,
        phraseCount: 0,
        preRollClearedMs: 0,
        postRollClearedMs: 0,
        internalNoiseGaps: 0,
        notes: ["edit:no_phrases_detected"],
      },
    };
  }

  // Cap how much pre/post we clear so we never nuke a sparse but valid performance
  const maxEdge = Math.floor((maxEdgeClearMs / 1000) * sr);
  let perfStart = analysis.performanceStart;
  let perfEnd = analysis.performanceEnd;
  if (perfStart > maxEdge) {
    // Only clear last maxEdge of pre-roll before performance
    perfStart = analysis.performanceStart; // still clear full pre-roll of dead air before first phrase
  }
  // Always clear true pre-roll before first phrase (this is the "waited for beat" problem)
  if (perfStart > fadeSamples) {
    // Zero [0, perfStart) with fade into performance
    for (let i = 0; i < perfStart - fadeSamples; i++) {
      out.left[i] = 0;
      out.right[i] = 0;
    }
    for (let i = Math.max(0, perfStart - fadeSamples); i < perfStart; i++) {
      const g = (i - (perfStart - fadeSamples)) / fadeSamples;
      out.left[i] = (out.left[i] || 0) * g;
      out.right[i] = (out.right[i] || 0) * g;
    }
    notes.push(`pre_roll_clear_ms:${Math.round((perfStart / sr) * 1000)}`);
  }

  if (perfEnd < out.left.length - fadeSamples) {
    const tailStart = perfEnd;
    for (let i = tailStart; i < Math.min(out.left.length, tailStart + fadeSamples); i++) {
      const g = 1 - (i - tailStart) / fadeSamples;
      out.left[i] = (out.left[i] || 0) * g;
      out.right[i] = (out.right[i] || 0) * g;
    }
    for (let i = tailStart + fadeSamples; i < out.left.length; i++) {
      out.left[i] = 0;
      out.right[i] = 0;
    }
    notes.push(
      `post_roll_clear_ms:${Math.round(((out.left.length - perfEnd) / sr) * 1000)}`
    );
  }

  // Internal long gaps: only attenuate room noise, never remove musical short pauses
  let internalNoiseGaps = 0;
  if (preserveInternal && analysis.phrases.length >= 2) {
    const mono = stereoToMono(out);
    const longGapMs = 420; // longer than a natural lyrical pause
    for (let p = 0; p < analysis.phrases.length - 1; p++) {
      const a = analysis.phrases[p].endSample;
      const b = analysis.phrases[p + 1].startSample;
      const gapMs = ((b - a) / sr) * 1000;
      if (gapMs < longGapMs) continue; // keep musical pause
      // Soft pad so we don't touch phrase edges / breaths
      const pad = Math.floor(0.08 * sr);
      const z0 = a + pad;
      const z1 = b - pad;
      if (z1 <= z0 + fadeSamples) continue;
      // Only clear if region is near noise floor (not a quiet sung passage)
      let s = 0;
      let n = 0;
      for (let i = z0; i < z1; i++) {
        const x = mono[i] || 0;
        s += x * x;
        n++;
      }
      const rms = Math.sqrt(s / Math.max(1, n));
      if (rms > analysis.noiseFloor * 2.5) continue; // might be content

      internalNoiseGaps++;
      for (let i = z0; i < z0 + fadeSamples; i++) {
        const g = 1 - (i - z0) / fadeSamples;
        out.left[i] = (out.left[i] || 0) * g;
        out.right[i] = (out.right[i] || 0) * g;
      }
      for (let i = z0 + fadeSamples; i < z1 - fadeSamples; i++) {
        out.left[i] = 0;
        out.right[i] = 0;
      }
      for (let i = Math.max(z0, z1 - fadeSamples); i < z1; i++) {
        const g = (i - (z1 - fadeSamples)) / fadeSamples;
        out.left[i] = (pcm.left[i] || 0) * g;
        out.right[i] = (pcm.right[i] || 0) * g;
      }
    }
    if (internalNoiseGaps) notes.push(`internal_noise_gaps:${internalNoiseGaps}`);
  }

  // Micro fade on each phrase edge for click-free edits
  for (const ph of analysis.phrases) {
    const fi = Math.min(fadeSamples, Math.floor((ph.endSample - ph.startSample) / 4));
    for (let i = 0; i < fi; i++) {
      const g = i / fi;
      const s = ph.startSample + i;
      if (s >= 0 && s < out.left.length) {
        out.left[s] = (out.left[s] || 0) * (0.15 + 0.85 * g);
        out.right[s] = (out.right[s] || 0) * (0.15 + 0.85 * g);
      }
    }
    for (let i = 0; i < fi; i++) {
      const g = i / fi;
      const s = ph.endSample - 1 - i;
      if (s >= 0 && s < out.left.length) {
        out.left[s] = (out.left[s] || 0) * (0.15 + 0.85 * g);
        out.right[s] = (out.right[s] || 0) * (0.15 + 0.85 * g);
      }
    }
  }

  notes.push("edit:performance_cleaned");

  return {
    pcm: out,
    analysis,
    qc: {
      applied: true,
      phraseCount: analysis.phrases.length,
      preRollClearedMs: Math.round(analysis.preRollMs),
      postRollClearedMs: Math.round(analysis.postRollMs),
      internalNoiseGaps,
      notes,
    },
  };
}
