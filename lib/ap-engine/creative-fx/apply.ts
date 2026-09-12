/**
 * Execute creative FX on placed vocal PCM.
 * Delay throws on phrase tails; ambient reverb; light filter/stereo.
 */
import { addReverbStereo, cloneStereo } from "../dsp";
import type { PcmStereo } from "../types";
import type { PhraseDecision } from "../producer-mind/types";

function bpmToEighthMs(bpm: number | null | undefined): number {
  const b = bpm && bpm > 40 && bpm < 240 ? bpm : 96;
  return (60_000 / b) * 0.5;
}

export function applyCreativeFxToPlacedVocal(opts: {
  placed: PcmStereo;
  phrases: PhraseDecision[];
  bpm?: number | null;
}): { pcm: PcmStereo; notes: string[] } {
  const notes: string[] = [];
  const out = cloneStereo(opts.placed);
  const sr = out.sampleRate;
  const eighth = bpmToEighthMs(opts.bpm);

  for (const ph of opts.phrases) {
    const fx = ph.creativeFx;
    if (!fx) continue;

    const [startMs, endMs] = ph.timeRangeMs;
    const start = Math.max(0, Math.floor((startMs / 1000) * sr));
    const end = Math.min(out.left.length, Math.floor((endMs / 1000) * sr));
    if (end <= start + 64) continue;

    if (fx.delayThrow?.enabled) {
      const tailMs = 280;
      const tailStart = Math.max(start, end - Math.floor((tailMs / 1000) * sr));
      const delayMs =
        fx.delayThrow.type === "quarter_echo"
          ? eighth * 2
          : fx.delayThrow.type === "slap"
            ? 90
            : eighth;
      const delaySamp = Math.floor((delayMs / 1000) * sr);
      const wet = fx.delayThrow.type === "slap" ? 0.22 : 0.28;

      for (let i = tailStart; i < end; i++) {
        const dest = i + delaySamp;
        if (dest >= out.left.length) break;
        const fade = (i - tailStart) / Math.max(1, end - tailStart);
        const g = wet * (0.4 + 0.6 * fade);
        out.left[dest] = (out.left[dest] || 0) + (out.left[i] || 0) * g * 0.85;
        out.right[dest] = (out.right[dest] || 0) + (out.right[i] || 0) * g;
      }
      notes.push(`fx:delay_throw ${fx.delayThrow.type} @${Math.round(endMs)}ms`);
    }

    if (fx.filterAutomation) {
      const mid = Math.floor((start + end) / 2);
      for (let i = start; i < end; i++) {
        const t = (i - start) / Math.max(1, end - start);
        const close = t < 0.45 ? 1 - t / 0.45 : Math.max(0, 1 - (t - 0.45) / 0.55);
        const g = 1 - close * 0.55;
        out.left[i] = (out.left[i] || 0) * g;
        out.right[i] = (out.right[i] || 0) * g;
      }
      let prevL = 0;
      let prevR = 0;
      const a = 0.12;
      for (let i = start; i < mid; i++) {
        const l = out.left[i] || 0;
        const r = out.right[i] || 0;
        prevL = prevL + a * (l - prevL);
        prevR = prevR + a * (r - prevR);
        out.left[i] = prevL;
        out.right[i] = prevR;
      }
      notes.push(`fx:filter_auto @${Math.round(startMs)}ms`);
    }

    if (fx.stereoMovement) {
      for (let i = start; i < end; i++) {
        const t = (i - start) / Math.max(1, end - start);
        const pan = Math.sin(t * Math.PI * 2) * 0.45;
        const l = out.left[i] || 0;
        const r = out.right[i] || 0;
        const mid = (l + r) * 0.5;
        const side = (l - r) * 0.5;
        out.left[i] = mid + side + mid * Math.max(0, -pan) * 0.3;
        out.right[i] = mid - side + mid * Math.max(0, pan) * 0.3;
      }
      notes.push(`fx:stereo_move @${Math.round(startMs)}ms`);
    }
  }

  const ambient = opts.phrases.some((p) => p.creativeFx?.reverbCharacter === "ambient_large");
  if (ambient) {
    const wet = cloneStereo(out);
    addReverbStereo(wet, 0.12);
    for (let i = 0; i < out.left.length; i++) {
      out.left[i] = (out.left[i] || 0) * 0.92 + (wet.left[i] || 0) * 0.08;
      out.right[i] = (out.right[i] || 0) * 0.92 + (wet.right[i] || 0) * 0.08;
    }
    notes.push("fx:ambient_reverb_character");
  }

  return { pcm: out, notes };
}
