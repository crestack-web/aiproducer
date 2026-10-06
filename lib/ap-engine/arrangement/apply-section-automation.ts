/**
 * Apply section treatments as smooth automation on a continuous vocal.
 * In-place on pcm. Lightweight — no neural DSP.
 */
import { dbToGain } from "../dsp";
import type { PcmStereo } from "../types";
import type { ArrangementPlan, VocalTreatment } from "./types";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function treatmentAt(
  plan: ArrangementPlan,
  timeMs: number
): VocalTreatment {
  const { sections, treatments } = plan;
  if (!sections.length) {
    return {
      gainDb: 0,
      width: 0.1,
      reverb: 0.15,
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

/**
 * One-pole high shelf approximation driven by brightnessDb (± few dB).
 */
function applyBrightnessFrame(
  x: number,
  prev: number,
  amount: number
): { y: number; prev: number } {
  // amount in linear "presence" blend of highpass residual
  const hp = x - prev;
  const y = x + hp * amount;
  return { y, prev: x * 0.95 + prev * 0.05 };
}

/**
 * Apply gain, brightness, stereo width (micro-delay double), and light reverb tail
 * per section. RoleScale reduces effect for non-lead layers.
 */
export function applySectionAutomation(
  pcm: PcmStereo,
  plan: ArrangementPlan,
  opts?: { roleScale?: number; layerStartMs?: number }
): void {
  const roleScale = opts?.roleScale ?? 1;
  const layerStartMs = opts?.layerStartMs ?? 0;
  const sr = pcm.sampleRate;
  const n = pcm.left.length;

  // Precompute per-sample gain (smoothed)
  const gainEnv = new Float32Array(n);
  const brightEnv = new Float32Array(n);
  const widthEnv = new Float32Array(n);
  const reverbEnv = new Float32Array(n);

  let gSm = 1;
  let bSm = 0;
  let wSm = 0.1;
  let rSm = 0.15;
  const smooth = Math.exp(-1 / (0.05 * sr)); // ~50ms

  for (let i = 0; i < n; i++) {
    const songMs = layerStartMs + (i / sr) * 1000;
    const t = treatmentAt(plan, songMs);
    const targetG = dbToGain(t.gainDb * roleScale);
    const targetB = (t.brightnessDb / 6) * roleScale; // map ~±6dB → ±1
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

  // Width / double: delayed opposite channel (12–18ms)
  const delaySamp = Math.min(n - 1, Math.floor(sr * 0.015));
  const leftCopy = new Float32Array(pcm.left);
  const rightCopy = new Float32Array(pcm.right);

  let prevL = 0;
  let prevR = 0;
  // Simple reverb: short feedback delay line
  const revLen = Math.floor(sr * 0.08);
  const revBufL = new Float32Array(revLen);
  const revBufR = new Float32Array(revLen);
  let revPos = 0;

  for (let i = 0; i < n; i++) {
    let l = leftCopy[i]!;
    let r = rightCopy[i]!;

    // Brightness
    const bl = applyBrightnessFrame(l, prevL, brightEnv[i]!);
    const br = applyBrightnessFrame(r, prevR, brightEnv[i]!);
    prevL = bl.prev;
    prevR = br.prev;
    l = bl.y;
    r = br.y;

    // Width / micro-double
    const w = widthEnv[i]!;
    if (w > 0.02 && i >= delaySamp) {
      const dL = rightCopy[i - delaySamp]!;
      const dR = leftCopy[i - delaySamp]!;
      l = l * (1 - w * 0.35) + dL * w * 0.35;
      r = r * (1 - w * 0.35) + dR * w * 0.35;
    }

    // Light reverb send
    const send = reverbEnv[i]!;
    const rL = revBufL[revPos]!;
    const rR = revBufR[revPos]!;
    const wet = send * 0.28;
    l = l * (1 - wet * 0.5) + rL * wet;
    r = r * (1 - wet * 0.5) + rR * wet;
    revBufL[revPos] = l * 0.35 + rL * 0.55;
    revBufR[revPos] = r * 0.35 + rR * 0.55;
    revPos = (revPos + 1) % revLen;

    // Gain
    const g = gainEnv[i]!;
    pcm.left[i] = l * g;
    pcm.right[i] = r * g;
  }

  // Delay throws at chorus phrase ends: boost short echo on last 15% of chorus sections
  for (let si = 0; si < plan.sections.length; si++) {
    const s = plan.sections[si]!;
    const tr = plan.treatments[si]!;
    if (!tr.delayThrow || tr.delay < 0.05) continue;
    const throwStart = s.startMs + (s.endMs - s.startMs) * 0.85;
    const delayMs = 320;
    const delayS = Math.floor((delayMs / 1000) * sr);
    const wet = 0.18 * roleScale * tr.delay;
    for (let i = 0; i < n; i++) {
      const songMs = layerStartMs + (i / sr) * 1000;
      if (songMs < throwStart || songMs >= s.endMs) continue;
      const src = i - delayS;
      if (src < 0) continue;
      const fade = 1 - (songMs - throwStart) / Math.max(1, s.endMs - throwStart);
      pcm.left[i]! += leftCopy[src]! * wet * fade * 0.8;
      pcm.right[i]! += rightCopy[src]! * wet * fade;
    }
  }

  void lerp;
}
