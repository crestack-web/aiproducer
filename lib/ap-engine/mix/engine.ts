import { cloneStereo } from "../dsp";
import type { MixDecision, PcmStereo } from "../types";
import { applyMixGains, duckBeatFromVocal, sumStereo, autoBalanceGains } from "./balance";
import { applyBeatPresenceCut } from "./masking-lite";
import { applyMixGlue } from "./glue";
import { applyBusGrooveLock } from "../production/timing-intelligence";
import { applyBusArrangementLift } from "../production/vocal-automation";

/**
 * Mix vocal into beat as one production — groove lock, pocket, mask, duck, glue.
 */
export function mixVocalAndBeat(
  vocalIn: PcmStereo,
  beatIn: PcmStereo,
  decision: MixDecision
): PcmStereo {
  let vocal = cloneStereo(vocalIn);
  const beat = cloneStereo(beatIn);

  // 0. Bus groove lock — pull late vocal performances forward into the pocket
  const locked = applyBusGrooveLock(vocal, beat, 60);
  vocal = locked.pcm;

  // 0b. Arrangement energy lift on denser vocal regions (chorus contrast)
  vocal = applyBusArrangementLift(vocal, 0.4);

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

  // 3. Mid-focused duck — R&B needs a real pocket under the lead
  const duck = Math.max(decision.duckDb, 2.2);
  duckBeatFromVocal(vocal, beat, duck, decision.duckMidFocus ?? 0.88);

  // 4. Sum + bus glue
  let mix = sumStereo(vocal, beat);
  mix = applyMixGlue(mix, { parallel: 0.42, room: 0.1, center: 0.28 });

  return mix;
}
