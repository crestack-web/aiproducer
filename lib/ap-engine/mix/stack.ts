/**
 * Multi-vocal stack mixer — lead establishes reference; others support.
 */
import { applyGainStereo, cloneStereo, dbToGain } from "../dsp";
import type { PcmStereo } from "../types";
import type { LayerDecision } from "../production/decision-engine";
import { applyWidth } from "./width";
import { restoreVocal } from "../restoration/denoise";
import { stabilizeLevel } from "../restoration/dynamics-fix";
import { processVocalChain } from "../production/vocal-chain";
import { placeOnTimeline } from "../ingestion/normalize";

export type StackLayerInput = {
  pcm: PcmStereo;
  startMs: number;
  decision: LayerDecision;
};

export function processAndPlaceLayer(
  beatLengthPcm: PcmStereo,
  layer: StackLayerInput
): PcmStereo {
  let v = cloneStereo(layer.pcm);
  v = restoreVocal(v, layer.decision.vocal);
  v = stabilizeLevel(v, layer.decision.role === "lead" ? 0.11 : 0.08);
  v = processVocalChain(v, layer.decision.vocal);
  applyWidth(v, layer.decision.width, layer.decision.role === "double" ? (layer.decision.width > 0 ? 0.15 : 0) : 0);
  // Alternate doubles slightly opposite if width set
  if (layer.decision.role === "double") {
    applyWidth(v, layer.decision.width, -0.12);
  }
  if (layer.decision.role === "harmony_high") applyWidth(v, layer.decision.width, 0.35);
  if (layer.decision.role === "harmony_low") applyWidth(v, layer.decision.width, -0.3);

  const placed = placeOnTimeline(v, beatLengthPcm, layer.startMs);
  return placed.vocal;
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
  // Gentle bus gain to avoid automatic clip when many layers
  const busGain = layers.length >= 4 ? 0.85 : layers.length >= 3 ? 0.9 : 1;
  if (busGain !== 1) {
    for (let i = 0; i < n; i++) {
      left[i] *= busGain;
      right[i] *= busGain;
    }
  }
  return { left, right, sampleRate: sr };
}
