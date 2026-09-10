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
  // Distinct stereo image by role — lead stays center; support spreads
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
