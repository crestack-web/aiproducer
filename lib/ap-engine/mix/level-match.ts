/**
 * Cross-section vocal level consistency.
 * Match active-region RMS of lead takes to a shared target so verse/chorus
 * don't jump in perceived volume. Support roles stay relative to leads.
 */
import { applyGainStereo, cloneStereo, dbToGain, rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";
import type { VocalRole } from "../roles";

function activeRms(pcm: PcmStereo): number {
  const mono = stereoToMono(pcm);
  const sr = pcm.sampleRate;
  const frame = Math.max(64, Math.floor(sr * 0.02));
  const energies: number[] = [];
  for (let i = 0; i + frame <= mono.length; i += frame) {
    let s = 0;
    for (let j = i; j < i + frame; j++) {
      const x = mono[j] || 0;
      s += x * x;
    }
    energies.push(Math.sqrt(s / frame));
  }
  if (!energies.length) return rmsOf(mono);
  const sorted = [...energies].sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.15)] || 1e-6;
  const thr = Math.max(noise * 3.5, sorted[Math.floor(sorted.length * 0.5)] * 0.25);
  let sum = 0;
  let n = 0;
  for (const e of energies) {
    if (e >= thr) {
      sum += e * e;
      n++;
    }
  }
  if (n < 3) return rmsOf(mono);
  return Math.sqrt(sum / n);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Role offsets relative to lead target (dB). */
function roleOffsetDb(role: VocalRole): number {
  if (role === "lead") return 0;
  if (role === "double") return -3.5;
  if (role.startsWith("harmony")) return -5.5;
  if (role === "background") return -7.5;
  if (role === "adlib") return -4.5;
  if (role === "intro" || role === "outro") return -1.5;
  return -4;
}

export type LevelMatchResult = {
  layers: PcmStereo[];
  targetRms: number;
  adjustmentsDb: number[];
  notes: string[];
};

/**
 * Match placed vocal layers to consistent levels across the song.
 * Leads → shared median active RMS. Others → lead target + role offset.
 */
export function matchVocalLevelsAcrossSong(
  layers: PcmStereo[],
  roles: VocalRole[]
): LevelMatchResult {
  const notes: string[] = [];
  if (layers.length === 0) {
    return { layers, targetRms: 0, adjustmentsDb: [], notes: ["level_match:empty"] };
  }

  const rmsList = layers.map((l) => activeRms(l));
  const leadRms = rmsList.filter((r, i) => roles[i] === "lead" && r > 1e-5);
  // Target: median of leads, or all layers if no lead tagged
  const targetRms = Math.max(
    0.04,
    Math.min(0.18, leadRms.length ? median(leadRms) : median(rmsList.filter((r) => r > 1e-5)) || 0.1)
  );
  notes.push(`level_match:target_rms=${targetRms.toFixed(4)}`);

  const adjustmentsDb: number[] = [];
  const out: PcmStereo[] = [];

  for (let i = 0; i < layers.length; i++) {
    const role = roles[i] || "lead";
    const cur = rmsList[i];
    const desired = targetRms * dbToGain(roleOffsetDb(role));
    let adjDb = 0;
    if (cur > 1e-5 && desired > 1e-5) {
      adjDb = 20 * Math.log10(desired / cur);
      // Clamp: consistency, not rewriting dynamics of a take
      adjDb = Math.max(-8, Math.min(8, adjDb));
      // Soften very small moves
      if (Math.abs(adjDb) < 0.35) adjDb = 0;
    }
    adjustmentsDb.push(adjDb);
    if (Math.abs(adjDb) >= 0.35) {
      const pcm = cloneStereo(layers[i]);
      applyGainStereo(pcm, dbToGain(adjDb));
      out.push(pcm);
      notes.push(`l${i}:${role}:${adjDb >= 0 ? "+" : ""}${adjDb.toFixed(1)}dB`);
    } else {
      out.push(layers[i]);
    }
  }

  return { layers: out, targetRms, adjustmentsDb, notes };
}
