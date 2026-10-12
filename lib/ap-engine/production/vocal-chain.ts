import {
  addDelayStereo,
  addReverbStereo,
  applyEqStereo,
  applyGainStereo,
  cloneStereo,
  compressStereo,
  dbToGain,
  saturateInPlace,
} from "../dsp";
import type { PcmStereo, VocalDecision } from "../types";
import type { VocalRole } from "../roles";
import { smartDeess, type SmartDeessQC } from "../restoration/smart-deess";
import { parallelVocalDensity } from "./parallel-vocal";

export type VocalChainResult = {
  pcm: PcmStereo;
  deessQc: SmartDeessQC | null;
};

export function processVocalChain(
  pcm: PcmStereo,
  decision: VocalDecision,
  role?: VocalRole
): PcmStereo {
  return processVocalChainDetailed(pcm, decision, role).pcm;
}

export function processVocalChainDetailed(
  pcm: PcmStereo,
  decision: VocalDecision,
  role?: VocalRole
): VocalChainResult {
  const out = cloneStereo(pcm);
  const r = role || "lead";
  const isChoirProtect =
    r === "background" || r.startsWith("harmony") || r === "double";

  applyEqStereo(out, decision.eq);

  // Choir protect: ultra-gentle dynamics already on decision; still clamp ratio/attack
  if (isChoirProtect && decision.compressor) {
    compressStereo(out, {
      ...decision.compressor,
      ratio: Math.min(decision.compressor.ratio, r === "background" ? 1.45 : 1.8),
      attackMs: Math.max(decision.compressor.attackMs, r === "background" ? 55 : 45),
      makeupDb: Math.min(decision.compressor.makeupDb, r === "background" ? 0.35 : 0.8),
    });
  } else {
    compressStereo(out, decision.compressor);
  }

  // Adaptive de-ess — skip / near-zero on choir so breath & texture survive
  let deessQc: SmartDeessQC | null = null;
  const deessAmount =
    r === "background"
      ? 0
      : r.startsWith("harmony")
        ? Math.min(0.06, decision.deEsserAmount * 0.25)
        : r === "double"
          ? Math.min(0.12, decision.deEsserAmount * 0.45)
          : decision.deEsserAmount;
  if (deessAmount >= 0.05) {
    try {
      const de = smartDeess({
        pcm: out,
        role: r,
        amount: deessAmount,
      });
      if (de.qc.applied) {
        out.left.set(de.pcm.left);
        out.right.set(de.pcm.right);
      }
      deessQc = de.qc;
    } catch {
      deessQc = null;
    }
  } else {
    deessQc = {
      sibilanceRatio: 0,
      events: 0,
      meanDuck: 0,
      maxDuck: 0,
      applied: false,
      skippedReason: "choir_protect_no_deess",
    };
  }

  // No saturation on stacks — keeps organic, non-distorted tone
  if (!isChoirProtect) {
    saturateInPlace(out.left, decision.saturation);
    saturateInPlace(out.right, decision.saturation);
  }
  applyGainStereo(out, dbToGain(decision.gainDb));

  // Parallel density on lead only — expensive presence without killing dynamics
  if (r === "lead") {
    try {
      const dens = parallelVocalDensity(out, 0.26);
      out.left.set(dens.left);
      out.right.set(dens.right);
    } catch {
      /* keep dry path */
    }
  }

  addReverbStereo(out, decision.reverbSend);
  addDelayStereo(out, decision.delaySend);
  return { pcm: out, deessQc };
}
