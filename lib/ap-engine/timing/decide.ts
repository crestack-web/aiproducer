import type { VocalRole, SongSectionKind } from "../roles";
import type { PhraseRegion } from "../edit/phrase-detect";
import type { BeatGrid } from "./beat-grid";
import { nearestBeat } from "./beat-grid";
import { detectPhraseOnset } from "./phrase-onset";
import type { PhraseTimingAnalysis, TimingDecision, TimingStatus } from "./types";
import { maxShiftForRole, resolveTimingProfile, type TimingLimits } from "./profile";
import type { PcmStereo } from "../types";

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Analyze all phrases, detect intentional behind-the-beat feel from consistency.
 */
export function analyzePhraseTimings(opts: {
  pcm: PcmStereo;
  phrases: PhraseRegion[];
  noiseFloor: number;
  grid: BeatGrid;
  role: VocalRole;
  section: SongSectionKind;
  genre?: string | null;
}): { analyses: PhraseTimingAnalysis[]; limits: TimingLimits } {
  const limits = resolveTimingProfile(opts.genre, opts.section);
  const sr = opts.pcm.sampleRate;
  const analyses: PhraseTimingAnalysis[] = [];

  for (let i = 0; i < opts.phrases.length; i++) {
    const ph = opts.phrases[i];
    const onset = detectPhraseOnset(opts.pcm, ph, opts.noiseFloor);
    const nb = nearestBeat(onset.onsetSample, opts.grid);
    const offsetMs = (nb.offsetSamples / sr) * 1000; // + = late vs beat

    let status: TimingStatus = "uncertain";
    const abs = Math.abs(offsetMs);
    if (abs <= limits.onTimeMs) status = "on_time";
    else if (offsetMs > limits.onTimeMs) status = "late";
    else status = "early";

    // Confidence: stronger when grid is good and attack is clear
    const confidence = Math.min(
      1,
      opts.grid.confidence * 0.6 + onset.attackStrength * 0.4
    );

    analyses.push({
      phraseId: `p${i}`,
      startSample: ph.startSample,
      endSample: ph.endSample,
      detectedOnsetSample: onset.onsetSample,
      nearestBeatSample: nb.sample,
      offsetMs,
      confidence,
      status,
      vocalEnergy: onset.energy,
      attackStrength: onset.attackStrength,
      section: opts.section,
      role: opts.role,
    });
  }

  // Intentional offbeat: consistent behind-the-beat in the intentional band
  const lateOffsets = analyses
    .filter((a) => a.offsetMs > 0)
    .map((a) => a.offsetMs);
  const medLate = median(lateOffsets);
  const consistentBehind =
    lateOffsets.length >= 2 &&
    medLate >= limits.intentionalBehindMinMs &&
    medLate <= limits.intentionalBehindMaxMs &&
    lateOffsets.filter(
      (o) =>
        o >= limits.intentionalBehindMinMs && o <= limits.intentionalBehindMaxMs
    ).length >=
      Math.ceil(lateOffsets.length * 0.6);

  if (consistentBehind) {
    for (const a of analyses) {
      if (
        a.offsetMs >= limits.intentionalBehindMinMs &&
        a.offsetMs <= limits.intentionalBehindMaxMs
      ) {
        a.status = "intentional_offbeat";
      }
    }
  }

  return { analyses, limits };
}

export function decidePhraseTiming(
  analysis: PhraseTimingAnalysis,
  limits: TimingLimits,
  opts: {
    role: VocalRole;
    leadOffsetMs?: number | null;
    beatConfidence: number;
  }
): TimingDecision {
  const maxShift = maxShiftForRole(limits, opts.role);
  const conf = analysis.confidence * opts.beatConfidence;

  // Ad-libs: almost always preserve
  if (opts.role === "adlib") {
    if (analysis.status === "late" && analysis.offsetMs > 120 && conf > 0.7) {
      const shift = -Math.min(maxShift, analysis.offsetMs * 0.35);
      return {
        phraseId: analysis.phraseId,
        action: "move_earlier",
        shiftMs: shift,
        confidence: conf,
        reason: "adlib_extreme_late_soft_nudge",
        transitionStrategy: "micro_crossfade",
      };
    }
    return {
      phraseId: analysis.phraseId,
      action: "preserve_offbeat",
      shiftMs: 0,
      confidence: conf,
      reason: "adlib_freedom",
      transitionStrategy: "none",
    };
  }

  // Double: tighten toward lead offset if available, else beat
  if (opts.role === "double" && opts.leadOffsetMs != null) {
    const delta = analysis.offsetMs - opts.leadOffsetMs;
    if (Math.abs(delta) < 12) {
      return {
        phraseId: analysis.phraseId,
        action: "keep",
        shiftMs: 0,
        confidence: conf,
        reason: "double_already_tight_to_lead",
        transitionStrategy: "none",
      };
    }
    if (conf < limits.minConfidence) {
      return {
        phraseId: analysis.phraseId,
        action: "keep",
        shiftMs: 0,
        confidence: conf,
        reason: "low_confidence",
        transitionStrategy: "none",
      };
    }
    const shift = -Math.sign(delta) * Math.min(maxShift, Math.abs(delta) * 0.75);
    return {
      phraseId: analysis.phraseId,
      action: "tighten_to_lead",
      shiftMs: shift,
      confidence: conf,
      reason: `double_to_lead_delta_${delta.toFixed(0)}ms`,
      transitionStrategy: "micro_crossfade",
    };
  }

  // Harmonies: moderate tighten
  if (opts.role.startsWith("harmony") || opts.role === "background") {
    if (analysis.status === "intentional_offbeat" || analysis.status === "on_time") {
      return {
        phraseId: analysis.phraseId,
        action: analysis.status === "intentional_offbeat" ? "preserve_offbeat" : "keep",
        shiftMs: 0,
        confidence: conf,
        reason: analysis.status,
        transitionStrategy: "none",
      };
    }
    if (conf < limits.minConfidence || Math.abs(analysis.offsetMs) < limits.onTimeMs) {
      return {
        phraseId: analysis.phraseId,
        action: "keep",
        shiftMs: 0,
        confidence: conf,
        reason: "harmony_keep",
        transitionStrategy: "none",
      };
    }
    const shift =
      analysis.offsetMs > 0
        ? -Math.min(maxShift, analysis.offsetMs * 0.55)
        : Math.min(maxShift, -analysis.offsetMs * 0.4);
    return {
      phraseId: analysis.phraseId,
      action: analysis.offsetMs > 0 ? "move_earlier" : "move_later",
      shiftMs: shift,
      confidence: conf,
      reason: "harmony_moderate",
      transitionStrategy: "micro_crossfade",
    };
  }

  // Lead
  if (analysis.status === "on_time") {
    return {
      phraseId: analysis.phraseId,
      action: "keep",
      shiftMs: 0,
      confidence: conf,
      reason: "on_time",
      transitionStrategy: "none",
    };
  }
  if (analysis.status === "intentional_offbeat") {
    return {
      phraseId: analysis.phraseId,
      action: "preserve_offbeat",
      shiftMs: 0,
      confidence: conf,
      reason: "consistent_behind_beat_feel",
      transitionStrategy: "none",
    };
  }
  if (conf < limits.minConfidence || opts.beatConfidence < 0.3) {
    return {
      phraseId: analysis.phraseId,
      action: "keep",
      shiftMs: 0,
      confidence: conf,
      reason: "uncertain_preserve",
      transitionStrategy: "none",
    };
  }

  // Isolated late mistake vs mild early
  if (analysis.status === "late" && analysis.offsetMs >= limits.lateMistakeMs) {
    const shift = -Math.min(maxShift, analysis.offsetMs * 0.65);
    return {
      phraseId: analysis.phraseId,
      action: "move_earlier",
      shiftMs: shift,
      confidence: conf,
      reason: `late_${analysis.offsetMs.toFixed(0)}ms`,
      transitionStrategy: "micro_crossfade",
    };
  }
  if (analysis.status === "late" && analysis.offsetMs > limits.onTimeMs) {
    // mild late — small polish only
    const shift = -Math.min(maxShift * 0.5, analysis.offsetMs * 0.4);
    if (Math.abs(shift) < 6) {
      return {
        phraseId: analysis.phraseId,
        action: "keep",
        shiftMs: 0,
        confidence: conf,
        reason: "mild_late_preserve",
        transitionStrategy: "none",
      };
    }
    return {
      phraseId: analysis.phraseId,
      action: "move_earlier",
      shiftMs: shift,
      confidence: conf,
      reason: "mild_late_polish",
      transitionStrategy: "micro_crossfade",
    };
  }
  if (analysis.status === "early" && analysis.offsetMs < -limits.lateMistakeMs) {
    const shift = Math.min(maxShift, -analysis.offsetMs * 0.5);
    return {
      phraseId: analysis.phraseId,
      action: "move_later",
      shiftMs: shift,
      confidence: conf,
      reason: `early_${analysis.offsetMs.toFixed(0)}ms`,
      transitionStrategy: "micro_crossfade",
    };
  }

  return {
    phraseId: analysis.phraseId,
    action: "keep",
    shiftMs: 0,
    confidence: conf,
    reason: "default_preserve",
    transitionStrategy: "none",
  };
}
