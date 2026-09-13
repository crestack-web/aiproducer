/**
 * Commercial-readiness gate — separate from taste.
 * Inform before export; never hard-block.
 */
import { peakOf, rmsOf, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";

export type CommercialCheck = {
  passed: boolean;
  issues: string[];
  warnings: string[];
  metrics: {
    peak: number;
    peakDb: number;
    rmsDb: number;
    monoPeak: number;
    silentRatio: number;
  };
  plainSummary: string;
};

function db(x: number): number {
  if (x < 1e-12) return -120;
  return 20 * Math.log10(x);
}

export function runCommercialReadiness(pcm: PcmStereo): CommercialCheck {
  const peak = Math.max(peakOf(pcm.left), peakOf(pcm.right));
  const mono = stereoToMono(pcm);
  const monoPeak = peakOf(mono);
  const rms = rmsOf(mono);
  const peakDb = db(peak);
  const rmsDb = db(rms);

  // Silent ratio
  let silent = 0;
  const n = mono.length;
  const hop = Math.max(1, Math.floor(n / 2000));
  let samples = 0;
  for (let i = 0; i < n; i += hop) {
    samples++;
    if (Math.abs(mono[i] || 0) < 0.0008) silent++;
  }
  const silentRatio = samples ? silent / samples : 0;

  const issues: string[] = [];
  const warnings: string[] = [];

  // True peak proxy: target ≤ -1 dBTP ≈ 0.89 linear
  if (peak > 0.95) {
    issues.push(
      `True peak is about ${peakDb.toFixed(1)} dBTP, which risks clipping on some systems — consider pulling level down before export.`
    );
  } else if (peak > 0.89) {
    warnings.push(
      `True peak is close to ceiling (${peakDb.toFixed(1)} dBTP). Safe for most platforms, but tight.`
    );
  }

  // Competitive loudness proxy (RMS not LUFS) — very quiet or crushed
  if (rmsDb < -28) {
    warnings.push(
      `Overall level is quite quiet (~${rmsDb.toFixed(0)} dB RMS proxy). You may want it louder for streaming competitiveness.`
    );
  }
  if (rmsDb > -8) {
    warnings.push(
      `Overall level is very hot (~${rmsDb.toFixed(0)} dB RMS proxy). Dynamics may feel crushed on some systems.`
    );
  }

  // Mono: if mono peak collapses hard vs stereo, phase risk
  if (peak > 0.1 && monoPeak < peak * 0.35) {
    warnings.push(
      "Mono check: the mix loses a lot of energy when summed to mono — some elements may be out of phase."
    );
  }

  if (silentRatio > 0.35) {
    warnings.push(
      "There are long quiet stretches — check for unexpected dead air or dropouts."
    );
  }

  const passed = issues.length === 0;
  const plainParts: string[] = [];
  if (passed && warnings.length === 0) {
    plainParts.push("Looks clean for export (peak and mono checks are fine).");
  } else if (passed) {
    plainParts.push("Export is allowed; a few notes:");
    plainParts.push(...warnings);
  } else {
    plainParts.push("Before export, worth knowing:");
    plainParts.push(...issues, ...warnings);
  }

  return {
    passed,
    issues,
    warnings,
    metrics: { peak, peakDb, rmsDb, monoPeak, silentRatio },
    plainSummary: plainParts.join(" "),
  };
}
