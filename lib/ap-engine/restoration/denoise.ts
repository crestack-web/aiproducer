import { gateInPlace, highPassInPlace, cloneStereo } from "../dsp";
import type { PcmStereo, VocalDecision } from "../types";
import { cleanTakeEdges } from "./edge-fade";

/**
 * Phase 1 restoration: edge clean (mouth open/close) + HPF + gate.
 * Prefer natural voice over aggressive noise reduction.
 */
export function restoreVocal(pcm: PcmStereo, decision: VocalDecision): PcmStereo {
  // Edge fade first — removes mouth-close clicks before dynamics/EQ
  let out = cleanTakeEdges(pcm, {
    fadeInMs: 50,
    fadeOutMs: 100,
    maxLeadMs: 400,
    maxTailMs: 450,
  });
  out = cloneStereo(out);
  highPassInPlace(out.left, out.sampleRate, decision.highPassHz);
  highPassInPlace(out.right, out.sampleRate, decision.highPassHz);
  gateInPlace(out.left, out.sampleRate, decision.gateThresholdDb);
  gateInPlace(out.right, out.sampleRate, decision.gateThresholdDb);
  // Second gentle edge pass after gate (gate can leave residual tails)
  out = cleanTakeEdges(out, {
    fadeInMs: 25,
    fadeOutMs: 70,
    maxLeadMs: 120,
    maxTailMs: 180,
    contentRatio: 0.05,
  });
  return out;
}
