/**
 * Unified tool executor — maps tool calls → existing DSP primitives.
 */
import {
  applyEqStereo,
  applyBiquadInPlace,
  compressStereo,
  addReverbStereo,
  addDelayStereo,
  saturateInPlace,
  applyGainStereo,
  cloneStereo,
  peakOf,
  dbToGain,
  limitStereo,
} from "../dsp";
import type { PcmStereo } from "../types";
import type { ToolCall } from "./types";

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback: string): string {
  return v != null && String(v) ? String(v) : fallback;
}

/**
 * Apply a list of tool calls to a full buffer (song scope) or leave
 * region application to the caller via applyToolCallsToRegion.
 */
export function applyToolCalls(
  pcm: PcmStereo,
  calls: ToolCall[],
  opts?: { maxCalls?: number }
): { pcm: PcmStereo; applied: ToolCall[]; capped: boolean } {
  const max = opts?.maxCalls ?? 4;
  const capped = calls.length > max;
  const list = calls.slice(0, max);
  let out = cloneStereo(pcm);
  const applied: ToolCall[] = [];

  for (const call of list) {
    try {
      out = applyOne(out, call);
      applied.push(call);
    } catch {
      /* skip broken call */
    }
  }

  // Safety ceiling
  const peak = Math.max(peakOf(out.left), peakOf(out.right));
  if (peak > 0.89) {
    applyGainStereo(out, 0.89 / peak);
  }

  return { pcm: out, applied, capped };
}

function applyOne(s: PcmStereo, call: ToolCall): PcmStereo {
  const out = cloneStereo(s);
  const p = call.params;

  switch (call.tool) {
    case "eq": {
      const freq = num(p.freq, 3200);
      const gainDb = Math.max(-6, Math.min(6, num(p.gainDb, 1)));
      const q = num(p.q, 1.0);
      const type = str(p.type, "peak") as "peak" | "highshelf" | "lowshelf" | "highpass" | "lowpass";
      applyEqStereo(out, [{ type, freq, gainDb, q }]);
      break;
    }
    case "filter": {
      const type = str(p.type, "highpass");
      const freq = num(p.freq, type === "lowpass" ? 4000 : 90);
      applyBiquadInPlace(out.left, type === "lowpass" ? "lowpass" : "highpass", freq, out.sampleRate, 0, 0.7);
      applyBiquadInPlace(out.right, type === "lowpass" ? "lowpass" : "highpass", freq, out.sampleRate, 0, 0.7);
      break;
    }
    case "compressor": {
      compressStereo(out, {
        thresholdDb: num(p.thresholdDb, -18),
        ratio: Math.max(1.2, Math.min(8, num(p.ratio, 3))),
        attackMs: num(p.attackMs, 12),
        releaseMs: num(p.releaseMs, 120),
        makeupDb: num(p.makeupDb, 1),
      });
      break;
    }
    case "reverb": {
      // Map type → wet intensity; decay approximated via wet
      const type = str(p.type, "plate");
      let wet = num(p.wet_mix, 0.15);
      if (wet > 1) wet = wet / 100; // allow "18%"
      wet = Math.max(0.04, Math.min(0.45, wet));
      if (type === "hall") wet *= 1.15;
      if (type === "room") wet *= 0.85;
      if (type === "spring") wet *= 0.9;
      addReverbStereo(out, wet);
      break;
    }
    case "delay": {
      let wet = num(p.wet_mix, 0.18);
      if (wet > 1) wet = wet / 100;
      wet = Math.max(0.05, Math.min(0.4, wet));
      const delayMs = num(p.delay_ms, str(p.type, "") === "slap" ? 95 : 180);
      addDelayStereo(out, wet, delayMs);
      break;
    }
    case "saturation": {
      const drive = Math.max(0.05, Math.min(0.5, num(p.drive, 0.2)));
      saturateInPlace(out.left, drive);
      saturateInPlace(out.right, drive);
      break;
    }
    case "deesser": {
      // Light high-mid dip as proxy
      const amt = Math.max(0.5, Math.min(4, num(p.amount, 1.5)));
      applyEqStereo(out, [{ type: "peak", freq: 6500, gainDb: -amt, q: 1.4 }]);
      break;
    }
    case "stereo_width": {
      const w = Math.max(0.5, Math.min(1.5, num(p.width, 1.1)));
      for (let i = 0; i < out.left.length; i++) {
        const mid = ((out.left[i] || 0) + (out.right[i] || 0)) * 0.5;
        const side = ((out.left[i] || 0) - (out.right[i] || 0)) * 0.5 * w;
        out.left[i] = mid + side;
        out.right[i] = mid - side;
      }
      break;
    }
    case "limiter": {
      limitStereo(out, num(p.ceilingDb, -1));
      break;
    }
    default:
      break;
  }
  return out;
}

/**
 * Apply tool calls only inside [startMs, endMs] by processing a slice and writing back.
 */
export function applyToolCallsToRegion(
  master: PcmStereo,
  calls: ToolCall[],
  startMs: number,
  endMs: number
): PcmStereo {
  const out = cloneStereo(master);
  const sr = out.sampleRate;
  const start = Math.max(0, Math.floor((startMs / 1000) * sr));
  const end = Math.min(out.left.length, Math.floor((endMs / 1000) * sr));
  if (end <= start + 64) return out;

  const slice: PcmStereo = {
    left: out.left.slice(start, end),
    right: out.right.slice(start, end),
    sampleRate: sr,
  };
  const { pcm: processed } = applyToolCalls(slice, calls);
  out.left.set(processed.left, start);
  out.right.set(processed.right, start);

  const peak = Math.max(peakOf(out.left), peakOf(out.right));
  if (peak > 0.89) applyGainStereo(out, 0.89 / peak);
  return out;
}
