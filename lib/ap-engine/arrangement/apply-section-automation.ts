/**
 * Sample-accurate section automation on a continuous vocal.
 * Never shifts samples in time — only multiplies/mixes at existing indices.
 */
import { dbToGain } from "../dsp";
import type { PcmStereo } from "../types";
import type { VocalArrangementMap, VocalTreatment } from "./types";

function treatmentAt(plan: VocalArrangementMap, timeMs: number): VocalTreatment {
  const { sections, treatments } = plan;
  if (!sections.length) {
    return {
      gainDb: 0,
      width: 0.1,
      reverb: 0.14,
      delay: 0,
      compression: 0.4,
      brightnessDb: 0,
      double: false,
      delayThrow: false,
    };
  }
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    if (timeMs >= s.startMs && timeMs < s.endMs) return treatments[i]!;
  }
  return treatments[treatments.length - 1]!;
}

function applyBrightnessFrame(
  x: number,
  prev: number,
  amount: number
): { y: number; prev: number } {
  const hp = x - prev;
  const y = x + hp * amount;
  return { y, prev: x * 0.95 + prev * 0.05 };
}

/**
 * Apply arrangement map. roleScale < 1 for doubles/harmonies.
 */
export function applySectionAutomation(
  pcm: PcmStereo,
  plan: VocalArrangementMap,
  opts?: { roleScale?: number; layerStartMs?: number }
): void {
  const roleScale = opts?.roleScale ?? 1;
  const layerStartMs = opts?.layerStartMs ?? 0;
  const sr = pcm.sampleRate;
  const n = pcm.left.length;

  const gainEnv = new Float32Array(n);
  const brightEnv = new Float32Array(n);
  const widthEnv = new Float32Array(n);
  const reverbEnv = new Float32Array(n);

  // ~120ms smoothing → no clicks at section boundaries
  const smooth = Math.exp(-1 / (0.12 * sr));
  let gSm = 1;
  let bSm = 0;
  let wSm = 0.1;
  let rSm = 0.14;

  for (let i = 0; i < n; i++) {
    const songMs = layerStartMs + (i / sr) * 1000;
    const t = treatmentAt(plan, songMs);
    const targetG = dbToGain(t.gainDb * roleScale);
    const targetB = (t.brightnessDb / 6) * roleScale;
    const targetW = t.width * roleScale;
    const targetR = t.reverb * roleScale;
    gSm = gSm * smooth + targetG * (1 - smooth);
    bSm = bSm * smooth + targetB * (1 - smooth);
    wSm = wSm * smooth + targetW * (1 - smooth);
    rSm = rSm * smooth + targetR * (1 - smooth);
    gainEnv[i] = gSm;
    brightEnv[i] = bSm;
    widthEnv[i] = wSm;
    reverbEnv[i] = rSm;
  }

  const delaySamp = Math.min(n - 1, Math.floor(sr * 0.015));
  const leftCopy = new Float32Array(pcm.left);
  const rightCopy = new Float32Array(pcm.right);

  let prevL = 0;
  let prevR = 0;
  const revLen = Math.max(8, Math.floor(sr * 0.08));
  const revBufL = new Float32Array(revLen);
  const revBufR = new Float32Array(revLen);
  let revPos = 0;

  for (let i = 0; i < n; i++) {
    let l = leftCopy[i]!;
    let r = rightCopy[i]!;

    const bl = applyBrightnessFrame(l, prevL, brightEnv[i]!);
    const br = applyBrightnessFrame(r, prevR, brightEnv[i]!);
    prevL = bl.prev;
    prevR = br.prev;
    l = bl.y;
    r = br.y;

    const w = widthEnv[i]!;
    if (w > 0.02 && i >= delaySamp) {
      const dL = rightCopy[i - delaySamp]!;
      const dR = leftCopy[i - delaySamp]!;
      l = l * (1 - w * 0.32) + dL * w * 0.32;
      r = r * (1 - w * 0.32) + dR * w * 0.32;
    }

    const send = reverbEnv[i]!;
    const rL = revBufL[revPos]!;
    const rR = revBufR[revPos]!;
    const wet = send * 0.26;
    l = l * (1 - wet * 0.45) + rL * wet;
    r = r * (1 - wet * 0.45) + rR * wet;
    revBufL[revPos] = l * 0.32 + rL * 0.55;
    revBufR[revPos] = r * 0.32 + rR * 0.55;
    revPos = (revPos + 1) % revLen;

    pcm.left[i] = l * gainEnv[i]!;
    pcm.right[i] = r * gainEnv[i]!;
  }

  // Phrase-end delay throws: only high-confidence non-breath phrases, every 2nd in chorus
  const throwDelayS = Math.floor(0.32 * sr);
  let chorusPhraseIdx = 0;
  for (const phrase of plan.phrases) {
    if (phrase.isBreathLike || phrase.confidence < 0.55) continue;
    const mid = (phrase.startMs + phrase.endMs) / 2;
    const tr = treatmentAt(plan, mid);
    if (!tr.delayThrow) continue;
    chorusPhraseIdx++;
    if (chorusPhraseIdx % 2 !== 0) continue; // every 2nd suitable phrase

    const throwStart = phrase.endMs - Math.min(180, (phrase.endMs - phrase.startMs) * 0.2);
    const throwEnd = Math.min(
      phrase.endMs + 280,
      (plan.sections[plan.sections.length - 1]?.endMs ?? phrase.endMs + 280)
    );
    const wet = 0.16 * roleScale * tr.delay;
    for (let i = 0; i < n; i++) {
      const songMs = layerStartMs + (i / sr) * 1000;
      if (songMs < throwStart || songMs > throwEnd) continue;
      const src = i - throwDelayS;
      if (src < 0) continue;
      // Don't smear into next strong phrase attack
      const next = plan.phrases.find((p) => p.startMs > phrase.endMs && !p.isBreathLike);
      if (next && songMs > next.startMs - 40) continue;
      const fade = 1 - (songMs - throwStart) / Math.max(1, throwEnd - throwStart);
      pcm.left[i]! += leftCopy[src]! * wet * fade * 0.85;
      pcm.right[i]! += rightCopy[src]! * wet * fade;
    }
  }
}
