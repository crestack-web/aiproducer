/**
 * Arrangement automation — levels and width evolve by section energy.
 * Applied on placed layers / bus so the song has arc, not static settings.
 */
import { applyGainStereo, cloneStereo, dbToGain, peakOf } from "../dsp";
import type { PcmStereo } from "../types";
import type { SongSectionKind } from "../roles";

export function sectionEnergyDb(section: SongSectionKind, role: string): number {
  let db = 0;
  if (section === "verse") db = role === "lead" ? -0.5 : -1.2;
  else if (section === "pre_chorus") db = 0.4;
  else if (section === "chorus") db = role === "lead" ? 1.0 : 1.4;
  else if (section === "bridge") db = -0.3;
  else if (section === "outro") db = role === "lead" ? -0.8 : -1.5;
  else if (section === "intro") db = -1.0;
  return db;
}

/** Soft gain envelope on a placed vocal spanning the full song. */
export function applySectionGainOnPlaced(
  placed: PcmStereo,
  startMs: number,
  durationMs: number,
  gainDb: number
): PcmStereo {
  if (Math.abs(gainDb) < 0.15) return placed;
  const out = cloneStereo(placed);
  const sr = out.sampleRate;
  const start = Math.max(0, Math.floor((startMs / 1000) * sr));
  const len = Math.max(1, Math.floor((durationMs / 1000) * sr));
  const end = Math.min(out.left.length, start + len);
  const g = dbToGain(gainDb);
  // 30ms fade in/out of the automation region edges
  const fade = Math.floor(0.03 * sr);
  for (let i = start; i < end; i++) {
    let env = 1;
    if (i - start < fade) env = (i - start) / fade;
    if (end - i < fade) env = Math.min(env, (end - i) / fade);
    const gg = 1 + (g - 1) * env;
    out.left[i] = (out.left[i] || 0) * gg;
    out.right[i] = (out.right[i] || 0) * gg;
  }
  return out;
}

/**
 * Chorus lift on the full vocal bus: detect higher-energy regions and
 * slightly open presence + level so arrangement has contrast.
 */
export function applyBusArrangementLift(bus: PcmStereo, amount = 0.35): PcmStereo {
  const out = cloneStereo(bus);
  const sr = out.sampleRate;
  const hop = Math.max(1, Math.floor(sr * 0.05));
  const n = Math.floor(out.left.length / hop);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const a = i * hop;
    const b = Math.min(out.left.length, a + hop);
    for (let j = a; j < b; j++) {
      const x = Math.max(Math.abs(out.left[j] || 0), Math.abs(out.right[j] || 0));
      s += x;
    }
    e[i] = s / Math.max(1, b - a);
  }
  // percentile threshold
  const sorted = Array.from(e).filter((x) => x > 1e-6).sort((a, b) => a - b);
  if (sorted.length < 8) return out;
  const thr = sorted[Math.floor(sorted.length * 0.62)] || 0;
  const lift = dbToGain(1.2 * amount);
  for (let i = 0; i < n; i++) {
    if (e[i] < thr) continue;
    const a = i * hop;
    const b = Math.min(out.left.length, a + hop);
    for (let j = a; j < b; j++) {
      out.left[j] = (out.left[j] || 0) * lift;
      out.right[j] = (out.right[j] || 0) * lift;
    }
  }
  const p = Math.max(peakOf(out.left), peakOf(out.right));
  if (p > 0.97) {
    const s = 0.95 / p;
    for (let i = 0; i < out.left.length; i++) {
      out.left[i] = (out.left[i] || 0) * s;
      out.right[i] = (out.right[i] || 0) * s;
    }
  }
  return out;
}
