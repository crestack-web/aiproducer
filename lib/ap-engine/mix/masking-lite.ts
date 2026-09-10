import { applyBiquadInPlace } from "../dsp";
import type { MixDecision, PcmStereo } from "../types";

/** Light presence dip on beat under vocal region. */
export function applyBeatPresenceCut(beat: PcmStereo, decision: MixDecision): void {
  const cut = decision.beatPresenceCutDb;
  if (cut < 0.5) return;
  applyBiquadInPlace(beat.left, "peak", 2500, beat.sampleRate, -cut, 1.0);
  applyBiquadInPlace(beat.right, "peak", 2500, beat.sampleRate, -cut, 1.0);
}
