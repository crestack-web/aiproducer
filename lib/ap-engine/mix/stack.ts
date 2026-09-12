/**
 * Multi-vocal stack mixer — lead establishes reference; others support.
 * Order: restore → mouth-noise → pitch polish → vocal ride → stabilize → vocal chain → place.
 */
import { cloneStereo } from "../dsp";
import type { PcmStereo } from "../types";
import type { LayerDecision } from "../production/decision-engine";
import { applyWidth } from "./width";
import { restoreVocal } from "../restoration/denoise";
import { editVocalPerformance, type VocalEditQC } from "../edit/vocal-edit";
import { type RoomToneQC } from "../restoration/room-tone";
import { reduceNaturalRoom, type SpaceQC } from "../restoration/intentional-space";
import { planMusicalSpace, applyMusicalSpace } from "../production/musical-space";
import { applyTimingIntelligence } from "../production/timing-intelligence";
import { runApTime } from "../timing";
import { sectionEnergyDb } from "../production/vocal-automation";
import { treatMouthNoise, type MouthNoiseQC } from "../restoration/mouth-noise";
import { rideVocalLevel, type VocalRideQC } from "../restoration/vocal-ride";
import { stabilizeLevel } from "../restoration/dynamics-fix";
import { processVocalChainDetailed } from "../production/vocal-chain";
import { placeOnTimeline } from "../ingestion/normalize";
import { polishVocalLayer, type PolishResult } from "../pitch";
import type { SmartDeessQC } from "../restoration/smart-deess";

export type StackLayerInput = {
  pcm: PcmStereo;
  startMs: number;
  decision: LayerDecision;
  genre?: string | null;
  leadReference?: PcmStereo | null;
  bpm?: number | null;
  correctionStrengthBias?: number;
  timingTightnessBias?: number;
};

export type PerformanceQc = {
  mouth: MouthNoiseQC | null;
  ride: VocalRideQC | null;
  deess: SmartDeessQC | null;
  room: RoomToneQC | null;
  space: SpaceQC | null;
};

export type StackLayerResult = {
  placed: PcmStereo;
  polished: PolishResult | null;
  restored: PcmStereo;
  processed: PcmStereo;
  performanceQc: PerformanceQc;
};

export function processAndPlaceLayer(
  beatLengthPcm: PcmStereo,
  layer: StackLayerInput
): PcmStereo {
  return processAndPlaceLayerDetailed(beatLengthPcm, layer).placed;
}

export function processAndPlaceLayerDetailed(
  beatLengthPcm: PcmStereo,
  layer: StackLayerInput
): StackLayerResult {
  const role = layer.decision.role;
  let v = cloneStereo(layer.pcm);

  // 0. AP EDIT — phrase detect, clear dead pre/post, keep musical pauses
  let editQc: VocalEditQC | null = null;
  try {
    const edited = editVocalPerformance(v);
    v = edited.pcm;
    editQc = edited.qc;
    if (editQc.applied) {
      console.log(
        `[ap-edit] phrases=${editQc.phraseCount} pre=${editQc.preRollClearedMs}ms post=${editQc.postRollClearedMs}ms`
      );
    }
  } catch (e) {
    console.warn("[ap-edit] failed — continuing with raw take", e instanceof Error ? e.message : e);
    editQc = null;
  }

  // 1. Basic restore (edge fade, HPF, gate)
  v = restoreVocal(v, layer.decision.vocal);

  // 1b. Stronger safe room reduce (still budgeted)
  let roomQc: RoomToneQC | null = null;
  let spaceQc: SpaceQC | null = null;
  try {
    const reduced = reduceNaturalRoom(v, role === "lead" ? 0.52 : 0.58);
    v = reduced.pcm;
    roomQc = reduced.room;
  } catch {
    roomQc = null;
  }

  const restored = cloneStereo(v);

  // 2. Selective mouth-noise (plosives / clicks / excess breaths)
  let mouthQc: MouthNoiseQC | null = null;
  try {
    const mouth = treatMouthNoise({ pcm: v, role, intensity: 0.55 });
    if (mouth.qc.applied) v = mouth.pcm;
    mouthQc = mouth.qc;
  } catch (e) {
    console.warn(
      "[ap-engine] mouth-noise failed — continuing without",
      e instanceof Error ? e.message : e
    );
  }

  // 3. Pitch polish + timing
  let polished: PolishResult | null = null;
  try {
    polished = polishVocalLayer({
      pcm: v,
      role,
      genre: layer.genre,
      leadReference: layer.leadReference || null,
      correctionStrengthBias: layer.correctionStrengthBias,
      timingTightnessBias: layer.timingTightnessBias,
      forcePreserveVibrato: true,
    });
    if (polished.applied) v = polished.pcm;
  } catch (e) {
    console.warn(
      "[ap-engine] pitch polish failed — continuing without",
      e instanceof Error ? e.message : e
    );
    polished = null;
  }

  // 4. Phrase-level vocal ride (before compressor)
  let rideQc: VocalRideQC | null = null;
  try {
    const ride = rideVocalLevel({ pcm: v, role });
    if (ride.qc.applied) v = ride.pcm;
    rideQc = ride.qc;
  } catch (e) {
    console.warn(
      "[ap-engine] vocal ride failed — continuing without",
      e instanceof Error ? e.message : e
    );
  }

  // 5. AP TIME — phrase-level musical timing (after pitch; uses AP EDIT phrases)
  try {
    const timed = runApTime({
      vocal: v,
      beat: beatLengthPcm,
      role,
      section: layer.decision.section,
      genre: layer.genre ?? null,
      bpm: layer.bpm ?? null,
      leadOffsetMs: null,
    });
    v = timed.pcm as typeof v;
    if (timed.notes.length) {
      console.log("[ap-time]", timed.notes.join(" "));
    }
  } catch (e) {
    console.warn("[ap-time] failed — fallback coarse lock", e instanceof Error ? e.message : e);
    try {
      const timed = applyTimingIntelligence({
        vocal: v,
        beat: beatLengthPcm,
        role,
        section: layer.decision.section,
        leadReference: layer.leadReference || null,
        genre: layer.genre ?? null,
      });
      v = timed.pcm;
    } catch {
      /* keep untimed */
    }
  }

  // 5b. Light global stabilize, then production chain
  v = stabilizeLevel(v, role === "lead" ? 0.11 : 0.08);
  // Reduce chain sends slightly; intentional space owns musical room
  const vocalDec = {
    ...layer.decision.vocal,
    reverbSend: Math.min(0.12, layer.decision.vocal.reverbSend * 0.45),
    delaySend: Math.min(0.08, layer.decision.vocal.delaySend * 0.45),
  };
  const chain = processVocalChainDetailed(v, vocalDec, role);
  v = chain.pcm;

  // Musical space: ER + short/long + tempo delay + throws (producer space, not generic verb)
  try {
    const plan = planMusicalSpace(role, layer.decision.section, layer.bpm ?? null, layer.genre ?? null);
    const spaced = applyMusicalSpace(v, plan);
    v = spaced.pcm;
    spaceQc = {
      room: roomQc,
      deReverbApplied: true,
      section: layer.decision.section,
      reverbWet: plan.shortWet + plan.longWet,
      delayWet: plan.delayWet,
      reverted: roomQc?.reverted ?? false,
    };
  } catch {
    spaceQc = null;
  }

  const processed = cloneStereo(v);

  // 6. Stereo image by role
  let pan = 0;
  if (role === "double") pan = -0.18;
  else if (role === "harmony_high") pan = 0.42;
  else if (role === "harmony_mid") pan = 0.22;
  else if (role === "harmony_low") pan = -0.38;
  else if (role === "adlib") pan = 0.28;
  else if (role === "background") pan = -0.15;
  else if (role === "intro" || role === "outro") pan = 0.1;
  applyWidth(v, layer.decision.width, pan);

  const placed = placeOnTimeline(v, beatLengthPcm, layer.startMs);
  return {
    placed: placed.vocal,
    polished,
    restored,
    processed,
    performanceQc: {
      mouth: mouthQc,
      ride: rideQc,
      deess: chain.deessQc,
      room: roomQc,
      space: spaceQc,
    },
  };
}

export function sumVocalBus(layers: PcmStereo[]): PcmStereo {
  if (layers.length === 0) throw new Error("No vocal layers to sum");
  const sr = layers[0].sampleRate;
  const n = Math.max(...layers.map((l) => l.left.length));
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (const layer of layers) {
    for (let i = 0; i < layer.left.length; i++) {
      left[i] += layer.left[i] || 0;
      right[i] += layer.right[i] || 0;
    }
  }
  const busGain = layers.length >= 4 ? 0.85 : layers.length >= 3 ? 0.9 : 1;
  if (busGain !== 1) {
    for (let i = 0; i < n; i++) {
      left[i] *= busGain;
      right[i] *= busGain;
    }
  }
  return { left, right, sampleRate: sr };
}
