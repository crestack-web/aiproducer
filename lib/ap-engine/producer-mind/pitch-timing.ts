/**
 * Phrase-level pitch & timing correction amounts — Producer Mind extension.
 * Amount is a producer decision; DSP only executes partial correction.
 */
import type { PhraseDecision, SectionDecision, SongRead } from "./types";

export type CorrectionAmount = "none" | "light" | "moderate" | "tight";

export type PitchTimingDecision = {
  pitchCorrection: CorrectionAmount;
  timingCorrection: CorrectionAmount;
  preserve: Array<"vibrato" | "breath_placement" | "slides">;
  reasoning: string;
  /** 0–1 strength passed to DSP (partial correction, never full snap by default) */
  pitchStrength: number;
  timingStrength: number;
};

const STRENGTH: Record<CorrectionAmount, number> = {
  none: 0,
  light: 0.28,
  moderate: 0.52,
  tight: 0.72, // never 1.0 — always leave human residual
};

export function decidePitchTimingForPhrase(opts: {
  phrase: PhraseDecision;
  song: SongRead;
  section?: SectionDecision;
  styleIntimate: boolean;
}): PitchTimingDecision {
  const { phrase, song, section, styleIntimate } = opts;
  const weight = phrase.emotionalWeight;
  const density = section?.density || "hold";
  const preserve: PitchTimingDecision["preserve"] = ["vibrato", "breath_placement", "slides"];

  let pitch: CorrectionAmount = "light";
  let timing: CorrectionAmount = "none";
  const reasons: string[] = [];

  if (weight === "vulnerable" || weight === "intimate" || phrase.instructions.restraint === "preserve") {
    pitch = "none";
    timing = "none";
    reasons.push("vulnerable_leave_human");
  } else if (styleIntimate || song.restraintVsPolish < 0.4) {
    pitch = "light";
    timing = "none";
    reasons.push("intimate_style_axis");
  } else if (weight === "hook" || density === "push" || phrase.section === "chorus") {
    pitch = song.restraintVsPolish > 0.65 ? "tight" : "moderate";
    timing = song.restraintVsPolish > 0.7 ? "light" : "none";
    reasons.push("hook_polish");
  } else if (density === "build" || phrase.section === "pre_chorus") {
    pitch = "moderate";
    timing = "none";
    reasons.push("pre_chorus_stabilize");
  } else if (weight === "aggressive") {
    pitch = "moderate";
    timing = "light";
    reasons.push("aggressive_clarity");
  } else {
    pitch = "light";
    timing = "none";
    reasons.push("default_light");
  }

  return {
    pitchCorrection: pitch,
    timingCorrection: timing,
    preserve,
    reasoning: reasons.join(","),
    pitchStrength: STRENGTH[pitch],
    timingStrength: STRENGTH[timing],
  };
}

/** Aggregate per-layer strength from phrases (max for hooks, min bias for intimate). */
export function aggregatePitchTiming(
  decisions: PitchTimingDecision[]
): { pitchStrength: number; timingStrength: number; preserveVibrato: boolean; summary: string } {
  if (!decisions.length) {
    return {
      pitchStrength: 0.35,
      timingStrength: 0,
      preserveVibrato: true,
      summary: "correct: default light pitch, timing untouched",
    };
  }
  const pitches = decisions.map((d) => d.pitchStrength);
  const timings = decisions.map((d) => d.timingStrength);
  // Use median-ish: average of mid values — avoid one hook forcing whole verse tight
  pitches.sort((a, b) => a - b);
  timings.sort((a, b) => a - b);
  const mid = (arr: number[]) => arr[Math.floor(arr.length / 2)] ?? 0;
  const pitchStrength = mid(pitches);
  const timingStrength = mid(timings);
  const noneCount = decisions.filter((d) => d.pitchCorrection === "none").length;
  const tightCount = decisions.filter((d) => d.pitchCorrection === "tight").length;
  return {
    pitchStrength,
    timingStrength,
    preserveVibrato: true,
    summary: `correct: pitch ~${Math.round(pitchStrength * 100)}% on ${decisions.length} phrases (${noneCount} left human, ${tightCount} tighter), timing ${timingStrength > 0.1 ? "light" : "untouched"} — vibrato preserved`,
  };
}
