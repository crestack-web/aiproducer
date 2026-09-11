import { gateInPlace, highPassInPlace, cloneStereo } from "../dsp";
import type { PcmStereo, VocalDecision } from "../types";
import { cleanTakeEdges } from "./edge-fade";
import { trimVocalSilence } from "./silence-trim";

/**
 * Restoration: silence trim → edge clean → HPF → gate.
 * Empty space is removed/zeroed so FX don't create weird noise in gaps.
 */
export function restoreVocal(pcm: PcmStereo, decision: VocalDecision): PcmStereo {
  // 1. Trim empty head/tail + silence long internal gaps (timing preserved)
  let out = trimVocalSilence(pcm, "aggressive").pcm;

  // 2. Extra edge polish after trim
  out = cleanTakeEdges(out, {
    fadeInMs: 40,
    fadeOutMs: 80,
    maxLeadMs: 200,
    maxTailMs: 250,
    contentRatio: 0.05,
  });
  out = cloneStereo(out);
  highPassInPlace(out.left, out.sampleRate, decision.highPassHz);
  highPassInPlace(out.right, out.sampleRate, decision.highPassHz);
  gateInPlace(out.left, out.sampleRate, decision.gateThresholdDb);
  gateInPlace(out.right, out.sampleRate, decision.gateThresholdDb);
  // Second gentle edge pass after gate
  out = cleanTakeEdges(out, {
    fadeInMs: 20,
    fadeOutMs: 60,
    maxLeadMs: 100,
    maxTailMs: 150,
    contentRatio: 0.05,
  });
  return out;
}
