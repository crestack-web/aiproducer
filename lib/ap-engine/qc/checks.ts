import { peakOf, rmsOf, stereoToMono, limitStereo, cloneStereo } from "../dsp";
import type { PcmStereo, QcIssue, QcResult } from "../types";
import { countClippedSamples, measureIntegratedLufs, truePeakDbtp } from "../master/lufs";

/** Issues that mean the render is unusable — fail the job. */
const FATAL_ISSUES: QcIssue[] = ["SILENT_OUTPUT", "INVALID_DURATION", "BROKEN_RENDER"];

/**
 * Run QC on master (and optional mix).
 * Level/peak problems are warnings after soft limiting — only silence / broken / too-short fail hard.
 * Phone + bedroom takes often sit outside studio-ideal RMS; failing those blocked Produce.
 */
export function runQc(master: PcmStereo, mix?: PcmStereo): QcResult {
  const issues: QcIssue[] = [];
  const warnings: string[] = [];
  const mono = stereoToMono(master);
  const durationMs = Math.round((mono.length / master.sampleRate) * 1000);
  const peak = peakOf(mono);
  const rms = rmsOf(mono);

  if (durationMs < 300) issues.push("INVALID_DURATION");
  if (peak < 0.001 && rms < 0.0005) issues.push("SILENT_OUTPUT");
  if (!Number.isFinite(peak) || !Number.isFinite(rms)) issues.push("BROKEN_RENDER");

  if (peak >= 0.999) {
    issues.push("CLIPPING");
    warnings.push("clipping_detected");
  } else if (peak > 0.98) {
    issues.push("EXCESSIVE_PEAK");
    warnings.push("near_clip");
  }

  if (rms < 0.012 && peak < 0.1) {
    issues.push("VOCAL_TOO_QUIET");
    warnings.push("low_level");
  }
  if (rms > 0.42) {
    issues.push("VOCAL_TOO_LOUD");
    warnings.push("high_rms");
  }

  // Streaming delivery checks (BS.1770 loudness, oversampled true peak, clipped samples)
  const lufs = measureIntegratedLufs(master);
  const tpDb = truePeakDbtp(master);
  const clipped = countClippedSamples(master);
  if (lufs > -8) warnings.push("loudness_too_hot");
  if (lufs < -14.5) warnings.push("loudness_too_quiet");
  if (tpDb > -0.9) warnings.push("true_peak_over");
  if (clipped > 0) warnings.push("clipped_samples");
  const radioReady = lufs <= -8 && lufs >= -14.5 && tpDb <= -0.9 && clipped === 0;

  // Vocal vs beat dominance is not measurable from the summed master alone.
  const vocalDominance: number | undefined = mix ? undefined : undefined;

  const fatal = issues.some((i) => FATAL_ISSUES.includes(i));
  const softIssues = issues.filter((i) => !FATAL_ISSUES.includes(i));
  for (const i of softIssues) {
    if (!warnings.includes(i.toLowerCase())) warnings.push(`qc_${i.toLowerCase()}`);
  }

  return {
    passed: !fatal,
    issues: fatal ? issues.filter((i) => FATAL_ISSUES.includes(i)) : [],
    warnings: [
      ...warnings,
      ...(!fatal && softIssues.length ? softIssues.map((i) => `soft_${i}`) : []),
    ],
    metrics: { peak, rms, durationMs, vocalDominance, lufs, truePeakDbtp: tpDb, clippedSamples: clipped },
    radioReady,
  };
}

/**
 * Final safety pass before QC: gentle limit if peak is hot so CLIPPING is rare.
 */
export function safetyLimitMaster(master: PcmStereo, ceilingDb = -1): PcmStereo {
  const out = cloneStereo(master);
  const mono = stereoToMono(out);
  const peak = peakOf(mono);
  if (peak > 0.95) {
    limitStereo(out, ceilingDb);
  }
  return out;
}
