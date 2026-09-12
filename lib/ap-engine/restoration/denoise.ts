import { gateInPlace, highPassInPlace, cloneStereo } from "../dsp";
import type { PcmStereo, VocalDecision } from "../types";
import { cleanTakeEdges } from "./edge-fade";
import { trimVocalSilence } from "./silence-trim";

/**
 * Light restoration: gentle edge clean → HPF → soft gate.
 * Avoid aggressive silence chopping (it created vocal artifacts).
 */
export function restoreVocal(pcm: PcmStereo, decision: VocalDecision): PcmStereo {
  // Soft head/tail only — no internal gap muting
  let out = trimVocalSilence(pcm, "normal").pcm;

  out = cloneStereo(out);
  highPassInPlace(out.left, out.sampleRate, decision.highPassHz);
  highPassInPlace(out.right, out.sampleRate, decision.highPassHz);

  // Gentler gate: don't carve into quiet phrase endings
  const gateDb = Math.min(decision.gateThresholdDb, -38);
  gateInPlace(out.left, out.sampleRate, gateDb);
  gateInPlace(out.right, out.sampleRate, gateDb);

  // One soft edge pass after gate (not multiple aggressive trims)
  out = cleanTakeEdges(out, {
    fadeInMs: 30,
    fadeOutMs: 70,
    maxLeadMs: 180,
    maxTailMs: 220,
    contentRatio: 0.08,
  });
  return out;
}
