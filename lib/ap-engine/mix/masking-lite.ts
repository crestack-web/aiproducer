import { applyBiquadInPlace, bandEnergy, stereoToMono } from "../dsp";
import type { MixDecision, PcmStereo, VocalAnalysis, BeatAnalysis } from "../types";

/**
 * Multi-band beat masking under the vocal.
 * Carves space where the voice lives instead of one fixed 2.5 kHz dip.
 */
export function applyBeatPresenceCut(beat: PcmStereo, decision: MixDecision): void {
  const bands = decision.beatMaskBands;
  if (bands && bands.length) {
    for (const b of bands) {
      if (Math.abs(b.gainDb) < 0.25) continue;
      applyBiquadInPlace(beat.left, "peak", b.freq, beat.sampleRate, -Math.abs(b.gainDb), b.q);
      applyBiquadInPlace(beat.right, "peak", b.freq, beat.sampleRate, -Math.abs(b.gainDb), b.q);
    }
    return;
  }
  const cut = decision.beatPresenceCutDb;
  if (cut < 0.5) return;
  applyBiquadInPlace(beat.left, "peak", 2500, beat.sampleRate, -cut, 1.0);
  applyBiquadInPlace(beat.right, "peak", 2500, beat.sampleRate, -cut, 1.0);
}

/**
 * Build mask bands from lead vocal vs beat spectral overlap.
 * Conservative cuts — protect beat punch (kick/sub) and extreme air.
 */
export function buildBeatMaskBands(
  vocal: VocalAnalysis | null,
  beat: BeatAnalysis,
  presenceCutDb: number
): { freq: number; gainDb: number; q: number }[] {
  const base = Math.max(0, presenceCutDb);
  if (!vocal) {
    return base > 0.4
      ? [
          { freq: 1800, gainDb: base * 0.55, q: 1.0 },
          { freq: 2800, gainDb: base * 0.9, q: 1.1 },
          { freq: 4200, gainDb: base * 0.45, q: 1.0 },
        ]
      : [];
  }

  const overlapMid =
    Math.min(1, vocal.bands.mid * 1.4) * Math.min(1, beat.bands.mid * 1.3);
  const overlapHigh =
    Math.min(1, vocal.bands.high * 1.2) * Math.min(1, beat.bands.high * 1.2);

  const bands: { freq: number; gainDb: number; q: number }[] = [];

  if (vocal.bands.low > 0.32 && beat.bands.low > 0.3) {
    bands.push({ freq: 350, gainDb: 0.6 + base * 0.25, q: 0.85 });
  }

  const presence = 1.2 + base * 0.85 + overlapMid * 1.4;
  bands.push({ freq: 1700, gainDb: Math.min(3.2, presence * 0.55), q: 1.0 });
  bands.push({ freq: 2600, gainDb: Math.min(3.8, presence * 0.75), q: 1.15 });
  bands.push({
    freq: 3800,
    gainDb: Math.min(2.8, presence * 0.5 + overlapHigh * 0.8),
    q: 1.0,
  });

  if (overlapHigh > 0.35) {
    bands.push({
      freq: 6500,
      gainDb: Math.min(1.8, 0.6 + overlapHigh * 1.2),
      q: 0.8,
    });
  }

  return bands;
}

export function vocalMidDominance(vocal: PcmStereo, beat: PcmStereo): number {
  const vm = stereoToMono(vocal);
  const bm = stereoToMono(beat);
  const v = bandEnergy(vm, vocal.sampleRate, 800, 4500);
  const b = bandEnergy(bm, beat.sampleRate, 800, 4500);
  if (b < 1e-9) return 1;
  return Math.max(0, Math.min(1.5, v / (b + 1e-9)));
}
