/**
 * Partial re-render: apply section/song gain & presence to existing master PCM.
 * Skips restoration / analysis — only DSP execution on affected regions.
 */
import {
  applyGainStereo,
  applyBiquadInPlace,
  cloneStereo,
  peakOf,
  dbToGain,
} from "../dsp";
import type { PcmStereo } from "../types";
import type { InterpretedEdit, SectionAdjustment } from "./types";
import type { SectionHint } from "./interpreter";

const TRUE_PEAK_CEILING = 0.89; // ~-1 dBTP proxy

export function buildSectionAdjustments(
  sections: SectionHint[],
  edits: InterpretedEdit[],
  prev?: SectionAdjustment[]
): SectionAdjustment[] {
  const byKey = new Map<string, SectionAdjustment>();

  for (const s of sections) {
    const prevAdj = prev?.find((p) => p.sectionKey === s.id);
    byKey.set(s.id, {
      sectionKey: s.id,
      startMs: s.startMs,
      endMs: s.endMs,
      gainDb: prevAdj?.gainDb ?? 0,
      presenceDb: prevAdj?.presenceDb ?? 0,
      reverbScale: prevAdj?.reverbScale ?? 1,
    });
  }

  // Song-level: apply to all sections
  for (const e of edits) {
    if (e.scope === "song") {
      for (const adj of byKey.values()) {
        if (e.field === "loudness_target" && e.deltaDb != null) adj.gainDb += e.deltaDb;
        if (e.field === "vocal_presence_bias" && e.deltaDb != null) adj.presenceDb += e.deltaDb;
        if (e.field === "reverb_send_scale" && e.deltaScale != null) {
          adj.reverbScale = Math.max(0.2, Math.min(2, adj.reverbScale + e.deltaScale));
        }
      }
      continue;
    }
    const adj = byKey.get(e.target);
    if (!adj) continue;
    if (e.field === "loudness_target" && e.deltaDb != null) adj.gainDb += e.deltaDb;
    if (e.field === "vocal_presence_bias" && e.deltaDb != null) adj.presenceDb += e.deltaDb;
    if (e.field === "reverb_send_scale" && e.deltaScale != null) {
      adj.reverbScale = Math.max(0.2, Math.min(2, adj.reverbScale + e.deltaScale));
    }
  }

  // Cap cumulative gain per section
  for (const adj of byKey.values()) {
    adj.gainDb = Math.max(-6, Math.min(5, adj.gainDb));
    adj.presenceDb = Math.max(-3, Math.min(3, adj.presenceDb));
  }

  return Array.from(byKey.values());
}

/**
 * Apply cumulative section adjustments onto a copy of the master.
 */
export function applyAdjustmentsToMaster(
  master: PcmStereo,
  adjustments: SectionAdjustment[]
): PcmStereo {
  const out = cloneStereo(master);
  const sr = out.sampleRate;

  for (const adj of adjustments) {
    if (Math.abs(adj.gainDb) < 0.05 && Math.abs(adj.presenceDb) < 0.05) continue;
    const start = Math.max(0, Math.floor((adj.startMs / 1000) * sr));
    const end = Math.min(out.left.length, Math.floor((adj.endMs / 1000) * sr));
    if (end <= start + 8) continue;

    const g = dbToGain(adj.gainDb);
    for (let i = start; i < end; i++) {
      out.left[i] = (out.left[i] || 0) * g;
      out.right[i] = (out.right[i] || 0) * g;
    }

    if (Math.abs(adj.presenceDb) >= 0.05) {
      // Presence shelf only on region: process a slice via temp buffers
      const len = end - start;
      const slice: PcmStereo = {
        left: out.left.subarray(start, end),
        right: out.right.subarray(start, end),
        sampleRate: sr,
      };
      // biquad in-place on slice views mutates out
      applyBiquadInPlace(slice.left, "peak", 3200, sr, adj.presenceDb, 1.05);
      applyBiquadInPlace(slice.right, "peak", 3200, sr, adj.presenceDb, 1.05);
      void len;
    }
  }

  // True-peak safety on full buffer
  const peak = Math.max(peakOf(out.left), peakOf(out.right));
  if (peak > TRUE_PEAK_CEILING) {
    applyGainStereo(out, TRUE_PEAK_CEILING / peak);
  }

  return out;
}
