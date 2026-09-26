import { trimVocalSumToTargetPeak } from "./vocal-bus";
import { cloneStereo } from "../dsp";
import type { MixDecision, PcmStereo } from "../types";
import { applyMixGains, sumStereo, autoBalanceGains } from "./balance";
import { applyBeatPresenceCut } from "./masking-lite";
import { applyMixGlue } from "./glue";
import { applyBusGrooveLock } from "../production/timing-intelligence";

/**
 * Mix vocal into beat — groove lock, presence mask, static balance, glue (no sidechain duck).
 */
export function mixVocalAndBeat(
  vocalIn: PcmStereo,
  beatIn: PcmStereo,
  decision: MixDecision
): PcmStereo {
  let vocal = cloneStereo(vocalIn);
  const beat = cloneStereo(beatIn);

  // 0. Bus groove lock — pull late vocal performances forward into the pocket
  const locked = applyBusGrooveLock(vocal, beat, 150);
  vocal = locked.pcm;

  // 1. Spectral space for the voice
  applyBeatPresenceCut(beat, decision);

  // 2. Pocket balance — vocal inside the track
  const balanced = autoBalanceGains(vocal, beat, decision, 0.72);
  const liveDecision: MixDecision = {
    ...decision,
    vocalGainDb: balanced.vocalGainDb,
    beatGainDb: balanced.beatGainDb,
  };
  applyMixGains(vocal, beat, liveDecision);

  // 3. No dynamic sidechain duck — beat level stays steady under vocals
  // (pumping beat down on vocal / up on silence was the reported defect).
  // Pocket comes from static gains + presence cut only, not envelope ducking.
  void decision.duckDb;

  // 4. Sum + bus glue
  const trimmed = trimVocalSumToTargetPeak(vocal, -3);
  vocal = trimmed.pcm;
  if (trimmed.trimDb !== 0) {
    console.info("[mix] vocal sum trim", { trimDb: trimmed.trimDb });
  }
  let mix = sumStereo(vocal, beat);
  mix = applyMixGlue(mix, { parallel: 0.22, room: 0.08, center: 0.22 });

  return mix;
}
