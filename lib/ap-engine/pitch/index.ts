import type { PcmStereo } from "../types";
import type { VocalRole } from "../roles";
import { stereoToMono, monoToStereo, cloneStereo } from "../dsp";
import { analyzePitch } from "./analysis";
import { decideNoteCorrections, decideVocalPolish } from "./decision";
import { applyPitchCorrection } from "./correction";
import { polishTiming } from "./timing";
import { applyFormantPreserve, selectFormantStrategy } from "./formant";
import type { CorrectionProfile, PitchQC, PolishResult, VocalPolishDecision } from "./types";

export * from "./types";
export { analyzePitch } from "./analysis";
export { decideVocalPolish, decideNoteCorrections } from "./decision";
export { detectPitchYin, hzToMidi, midiToHz, centsBetween } from "./detector";

function stabilityFromMono(mono: Float32Array, sampleRate: number): number {
  return analyzePitch(mono, sampleRate).meanStability;
}

export function polishVocalLayer(opts: {
  pcm: PcmStereo;
  role: VocalRole;
  genre?: string | null;
  leadReference?: PcmStereo | null;
  forceProfile?: CorrectionProfile;
  /** Producer Mind partial-correction strength 0–1 (never full snap) */
  correctionStrengthBias?: number;
  timingTightnessBias?: number;
  forcePreserveVibrato?: boolean;
}): PolishResult {
  const src = cloneStereo(opts.pcm);
  const mono = stereoToMono(src);
  const analysis = analyzePitch(mono, src.sampleRate);
  let decision: VocalPolishDecision = decideVocalPolish({
    analysis,
    role: opts.role,
    genre: opts.genre,
    forceProfile: opts.forceProfile,
  });
  if (typeof opts.correctionStrengthBias === "number") {
    const bias = Math.max(0, Math.min(0.78, opts.correctionStrengthBias));
    decision = {
      ...decision,
      correctionStrength: Math.max(
        0,
        Math.min(0.78, (decision.correctionStrength || 0.4) * 0.35 + bias * 0.65)
      ),
      timingTightness:
        typeof opts.timingTightnessBias === "number"
          ? Math.min(0.55, opts.timingTightnessBias)
          : decision.timingTightness,
      preserveVibrato: opts.forcePreserveVibrato !== false ? true : decision.preserveVibrato,
      maxCorrectionCents: Math.min(
        decision.maxCorrectionCents || 80,
        35 + bias * 50
      ),
      notes: [...decision.notes, `mind_strength:${bias.toFixed(2)}`],
    };
  }

  const noteDecisions = decideNoteCorrections(analysis.notes, decision);

  const qcBase: PitchQC = {
    analyzedFrames: analysis.frames.length,
    voicedFrames: analysis.frames.filter((f) => f.voiced).length,
    correctedFrames: 0,
    averageCorrectionCents: 0,
    maxCorrectionCents: 0,
    pitchStabilityBefore: analysis.meanStability,
    pitchStabilityAfter: analysis.meanStability,
    lowConfidenceRatio:
      analysis.frames.length > 0
        ? analysis.frames.filter((f) => f.voiced && f.confidence < 0.4).length /
          Math.max(1, analysis.frames.filter((f) => f.voiced).length)
        : 0,
    artifactRisk: 0,
    notesDetected: analysis.notes.length,
    notesCorrected: 0,
    skippedLowConfidence: !decision.enabled,
    usedFallback: false,
  };

  if (!decision.enabled) {
    return { pcm: src, analysis, decision, noteDecisions, qc: qcBase, applied: false };
  }

  const corr = applyPitchCorrection(
    mono,
    src.sampleRate,
    analysis.frames,
    analysis.notes,
    noteDecisions
  );
  let outMono = corr.out;
  let usedFallback = false;
  if (corr.maxAbsCents > decision.maxCorrectionCents * 1.5) {
    outMono = new Float32Array(mono);
    usedFallback = true;
  }
  outMono = applyFormantPreserve(outMono, src.sampleRate, selectFormantStrategy(corr.maxAbsCents));
  let stereo = monoToStereo(outMono, src.sampleRate);
  const timing = polishTiming({
    layer: stereo,
    leadReference: opts.leadReference || null,
    role: opts.role,
    tightness: decision.timingTightness,
  });
  stereo = timing.pcm;

  const stabilityAfter = stabilityFromMono(stereoToMono(stereo), src.sampleRate);
  const notesCorrected = noteDecisions.filter((d) => !d.skip).length;
  let artifactRisk = 0;
  if (corr.maxAbsCents > 90) artifactRisk += 0.3;
  if (stabilityAfter + 0.05 < analysis.meanStability) artifactRisk += 0.4;
  if (corr.correctedSamples > mono.length * 0.85 && corr.maxAbsCents > 60) artifactRisk += 0.2;

  if (artifactRisk >= 0.7) {
    return {
      pcm: src,
      analysis,
      decision: { ...decision, notes: [...decision.notes, "artifact_fallback"] },
      noteDecisions,
      qc: { ...qcBase, artifactRisk, usedFallback: true },
      applied: false,
    };
  }

  return {
    pcm: stereo,
    analysis,
    decision: {
      ...decision,
      notes: [
        ...decision.notes,
        `notes_corrected:${notesCorrected}/${analysis.notes.length}`,
        timing.shiftMs !== 0 ? `timing_shift_ms:${timing.shiftMs.toFixed(1)}` : null,
      ].filter(Boolean) as string[],
    },
    noteDecisions,
    qc: {
      ...qcBase,
      correctedFrames: corr.correctedSamples,
      averageCorrectionCents: corr.meanAbsCents,
      maxCorrectionCents: corr.maxAbsCents,
      pitchStabilityAfter: stabilityAfter,
      notesCorrected,
      usedFallback,
      artifactRisk,
    },
    applied: corr.correctedSamples > 0 || Math.abs(timing.shiftMs) > 0.5,
  };
}
