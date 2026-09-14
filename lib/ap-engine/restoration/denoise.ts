import { gateInPlace, highPassInPlace, cloneStereo } from "../dsp";
import type { PcmStereo, VocalDecision } from "../types";
import { trimVocalSilence } from "./silence-trim";

/**
 * Light restoration: HPF + very soft gate.
 * No lead/tail silence zeroing and no musical edge fades (preserves space/hum).
 */
export function restoreVocal(pcm: PcmStereo, decision: VocalDecision): PcmStereo {
  // Micro click-guard only — keeps duration and quiet material
  let out = trimVocalSilence(pcm, "normal").pcm;

  out = cloneStereo(out);
  highPassInPlace(out.left, out.sampleRate, decision.highPassHz);
  highPassInPlace(out.right, out.sampleRate, decision.highPassHz);

  // Gate only true near-silence — never carve hum or soft phrase endings
  const gateDb = Math.min(decision.gateThresholdDb, -55);
  gateInPlace(out.left, out.sampleRate, gateDb);
  gateInPlace(out.right, out.sampleRate, gateDb);

  return out;
}
