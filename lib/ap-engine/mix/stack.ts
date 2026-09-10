/**
 * Multi-vocal stack mixer — lead establishes reference; others support.
 * Order: restore → pitch polish → stabilize → vocal chain → place.
 */
import { cloneStereo } from "../dsp";
import type { PcmStereo } from "../types";
import type { LayerDecision } from "../production/decision-engine";
import { applyWidth } from "./width";
import { restoreVocal } from "../restoration/denoise";
import { stabilizeLevel } from "../restoration/dynamics-fix";
import { processVocalChain } from "../production/vocal-chain";
import { placeOnTimeline } from "../ingestion/normalize";
import { polishVocalLayer, type PolishResult } from "../pitch";

export type StackLayerInput = {
  pcm: PcmStereo;
  startMs: number;
  decision: LayerDecision;
  genre?: string | null;
  leadReference?: PcmStereo | null;
};

export type StackLayerResult = {
  placed: PcmStereo;
  polished: PolishResult | null;
  restored: PcmStereo;
  processed: PcmStereo;
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
  let v = cloneStereo(layer.pcm);
  v = restoreVocal(v, layer.decision.vocal);
  const restored = cloneStereo(v);

  let polished: PolishResult | null = null;
  try {
    polished = polishVocalLayer({
      pcm: v,
      role: layer.decision.role,
      genre: layer.genre,
      leadReference: layer.leadReference || null,
    });
    if (polished.applied) v = polished.pcm;
  } catch (e) {
    console.warn(
      "[ap-engine] pitch polish failed — continuing without",
      e instanceof Error ? e.message : e
    );
    polished = null;
  }

  v = stabilizeLevel(v, layer.decision.role === "lead" ? 0.11 : 0.08);
  v = processVocalChain(v, layer.decision.vocal);
  const processed = cloneStereo(v);

  const role = layer.decision.role;
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
  return { placed: placed.vocal, polished, restored, processed };
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
