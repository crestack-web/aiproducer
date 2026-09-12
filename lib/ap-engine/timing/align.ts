/**
 * Apply phrase shifts with micro-crossfades. Pure sample moves — no pitch change.
 * Positive shiftMs = delay phrase (move later). Negative = advance (move earlier).
 */
import { cloneStereo } from "../dsp";
import type { PcmStereo } from "../types";
import type { TimingDecision, PhraseTimingAnalysis } from "./types";

function crossfadeCopy(
  srcL: Float32Array,
  srcR: Float32Array,
  destL: Float32Array,
  destR: Float32Array,
  srcStart: number,
  destStart: number,
  length: number,
  fade: number
): void {
  const f = Math.min(fade, Math.floor(length / 3));
  for (let i = 0; i < length; i++) {
    const s = srcStart + i;
    const d = destStart + i;
    if (s < 0 || s >= srcL.length || d < 0 || d >= destL.length) continue;
    let g = 1;
    if (i < f) g = i / f;
    if (i > length - f) g = (length - i) / f;
    destL[d] = (destL[d] || 0) * (1 - g) + (srcL[s] || 0) * g;
    destR[d] = (destR[d] || 0) * (1 - g) + (srcR[s] || 0) * g;
  }
}

export function applyPhraseShifts(
  pcm: PcmStereo,
  analyses: PhraseTimingAnalysis[],
  decisions: TimingDecision[]
): { pcm: PcmStereo; applied: number } {
  const byId = new Map(decisions.map((d) => [d.phraseId, d]));
  const moves = analyses
    .map((a) => {
      const d = byId.get(a.phraseId);
      if (!d || Math.abs(d.shiftMs) < 3) return null;
      return { analysis: a, decision: d };
    })
    .filter(Boolean) as { analysis: PhraseTimingAnalysis; decision: TimingDecision }[];

  if (!moves.length) return { pcm, applied: 0 };

  const sr = pcm.sampleRate;
  const fade = Math.max(16, Math.floor(0.012 * sr));
  const out = cloneStereo(pcm);
  // Clear original phrase regions first (with fade) then paste shifted
  // Work from a frozen source
  const srcL = new Float32Array(pcm.left);
  const srcR = new Float32Array(pcm.right);

  for (const { analysis, decision } of moves) {
    const shiftSamples = Math.round((decision.shiftMs / 1000) * sr);
    const len = analysis.endSample - analysis.startSample;
    if (len < fade * 2) continue;

    // Fade out original region
    for (let i = 0; i < len; i++) {
      const idx = analysis.startSample + i;
      if (idx < 0 || idx >= out.left.length) continue;
      let g = 1;
      if (i < fade) g = 1 - i / fade;
      if (i > len - fade) g = (len - i) / fade;
      // leave soft residual only at edges for continuity
      out.left[idx] = (out.left[idx] || 0) * (1 - g);
      out.right[idx] = (out.right[idx] || 0) * (1 - g);
    }

    const destStart = analysis.startSample + shiftSamples;
    crossfadeCopy(
      srcL,
      srcR,
      out.left,
      out.right,
      analysis.startSample,
      destStart,
      len,
      fade
    );
  }

  return { pcm: out, applied: moves.length };
}
