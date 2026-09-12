/**
 * Fullness decisions from Producer Mind phrase/section signals — not a separate brain.
 */
import type { EmotionalWeight, PhraseDecision, SectionDecision, SongRead } from "../producer-mind/types";
import type { FullnessDecision, HarmonyInterval } from "./types";

export function decideFullnessForPhrase(opts: {
  phrase: PhraseDecision;
  song: SongRead;
  section?: SectionDecision;
  keyConfidence: "high" | "medium" | "low" | "none";
  styleIntimate: boolean;
}): FullnessDecision {
  const { phrase, song, section, keyConfidence, styleIntimate } = opts;
  const weight = phrase.emotionalWeight;
  const density = section?.density || "hold";
  const restraint = phrase.instructions.restraint;

  let doubles = false;
  let harmony: FullnessDecision["harmony"] = {
    interval: "none",
    confidence: "none",
  };
  let adlibs = false;
  const reasons: string[] = [];

  // Intimate / vulnerable → almost never stack
  if (weight === "vulnerable" || weight === "intimate" || restraint === "preserve") {
    reasons.push("intimate_leave_dry");
    return { doubles: false, harmony, adlibs: false, reasoning: reasons.join(",") };
  }

  // Raw/intimate style axis suppresses fullness even in chorus
  if (styleIntimate && song.restraintVsPolish < 0.4) {
    reasons.push("style_axis_suppress");
    return { doubles: false, harmony, adlibs: false, reasoning: reasons.join(",") };
  }

  if (weight === "hook" || density === "push" || phrase.section === "chorus") {
    doubles = true;
    reasons.push("hook_or_chorus_widen");
    if (keyConfidence === "high" || keyConfidence === "medium") {
      const interval: HarmonyInterval =
        keyConfidence === "high" ? "major3rd" : "perfect5th";
      harmony = {
        interval: keyConfidence === "high" ? "major3rd" : keyConfidence === "medium" ? "perfect5th" : "none",
        confidence: keyConfidence,
      };
      if (harmony.interval !== "none") reasons.push(`harmony_${harmony.interval}`);
    } else {
      reasons.push("no_harmony_low_key_confidence");
    }
  } else if (density === "build" || phrase.section === "pre_chorus") {
    doubles = true;
    reasons.push("pre_chorus_double");
  }

  // Ad-libs rare: only aggressive hooks with polish bias
  if (
    weight === "hook" &&
    phrase.section === "chorus" &&
    song.restraintVsPolish > 0.7 &&
    !styleIntimate
  ) {
    adlibs = true;
    reasons.push("chorus_adlib_sparse");
  }

  return {
    doubles,
    harmony,
    adlibs,
    reasoning: reasons.join(",") || "none",
  };
}
