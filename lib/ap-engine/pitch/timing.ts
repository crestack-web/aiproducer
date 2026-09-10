import type { PcmStereo } from "../types";
import type { VocalRole } from "../roles";
import { stereoToMono, monoToStereo, cloneStereo } from "../dsp";

function onsetStrength(mono: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.max(1, Math.floor(sampleRate * 0.01));
  const n = Math.ceil(mono.length / hop);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i * hop;
    const b = Math.min(mono.length, a + hop);
    let s = 0;
    for (let j = a; j < b; j++) s += Math.abs(mono[j] || 0);
    env[i] = s / Math.max(1, b - a);
  }
  const str = new Float32Array(n);
  for (let i = 1; i < n; i++) str[i] = Math.max(0, env[i] - env[i - 1]);
  return str;
}

function primaryOnset(str: Float32Array, sampleRate: number, hop: number): number {
  let best = 0,
    bestV = -1;
  const skip = Math.floor(0.02 / (hop / sampleRate));
  for (let i = skip; i < str.length; i++) {
    if (str[i] > bestV) {
      bestV = str[i];
      best = i;
    }
  }
  return best * hop;
}

function delaySamples(pcm: PcmStereo, offset: number): PcmStereo {
  const n = pcm.left.length;
  const out = cloneStereo(pcm);
  const o = Math.round(offset);
  if (o === 0) return out;
  out.left.fill(0);
  out.right.fill(0);
  for (let i = 0; i < n; i++) {
    const src = i - o;
    if (src < 0 || src >= n) continue;
    out.left[i] = pcm.left[src] || 0;
    out.right[i] = pcm.right[src] || 0;
  }
  return out;
}

export function polishTiming(opts: {
  layer: PcmStereo;
  leadReference: PcmStereo | null;
  role: VocalRole;
  tightness: number;
}): { pcm: PcmStereo; shiftMs: number } {
  const { layer, leadReference, role, tightness } = opts;
  if (tightness < 0.2 || !leadReference || role === "lead" || role === "adlib") {
    return { pcm: layer, shiftMs: 0 };
  }
  const hop = Math.max(1, Math.floor(layer.sampleRate * 0.01));
  const layerOn = primaryOnset(
    onsetStrength(stereoToMono(layer), layer.sampleRate),
    layer.sampleRate,
    hop
  );
  const leadOn = primaryOnset(
    onsetStrength(stereoToMono(leadReference), leadReference.sampleRate),
    leadReference.sampleRate,
    hop
  );
  let delta = leadOn - layerOn;
  const maxShift = Math.floor(layer.sampleRate * 0.04 * tightness);
  if (delta > maxShift) delta = maxShift;
  if (delta < -maxShift) delta = -maxShift;
  if (Math.abs(delta) < layer.sampleRate * 0.004) return { pcm: layer, shiftMs: 0 };
  return { pcm: delaySamples(layer, delta), shiftMs: (delta / layer.sampleRate) * 1000 };
}

export function toMonoStereo(mono: Float32Array, sampleRate: number): PcmStereo {
  return monoToStereo(mono, sampleRate);
}
