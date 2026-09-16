/**
 * AP SPACE decision — producer brain for vocal placement in the arrangement.
 * Decision layer only; DSP executes elsewhere.
 */
import type { VocalRole, SongSectionKind } from "../roles";
import { resolveGenreProfile } from "../profiles/genre-profiles";
import type { PerformanceSignals } from "./performance";
import { planMusicalSpace, type SpacePlan } from "../production/musical-space";

export type SpaceCharacter =
  | "intimate"
  | "present"
  | "expansive"
  | "background";

export type VocalSpaceDecision = {
  character: SpaceCharacter;
  plan: SpacePlan;
  /** Extra gain ride dB before bus */
  automationGainDb: number;
  /** Beat duck depth dB (conservative) */
  duckDb: number;
  duckMidFocus: number;
  width: number;
  /** Reverb return HPF/LPF hints for apply layer */
  reverbHpHz: number;
  reverbLpHz: number;
  delayFeedback: number;
  confidence: number;
  notes: string[];
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function sectionKindFromLabel(label?: string | null): SongSectionKind {
  const s = (label || "").toLowerCase();
  if (s.includes("pre") && s.includes("chorus")) return "pre_chorus";
  if (s.includes("chorus") || s.includes("hook")) return "chorus";
  if (s.includes("verse")) return "verse";
  if (s.includes("bridge")) return "bridge";
  if (s.includes("outro") || s.includes("end")) return "outro";
  if (s.includes("intro")) return "intro";
  return "other";
}

function roleFromType(type?: string | null): VocalRole {
  const t = (type || "lead").toLowerCase();
  if (t.includes("double")) return "double";
  if (t.includes("adlib") || t.includes("ad-lib") || t.includes("ad_lib")) return "adlib";
  if (t.includes("background") || t.includes("bgv")) return "background";
  if (t.includes("harmon")) {
    if (t.includes("high") || t.includes("top")) return "harmony_high";
    if (t.includes("low") || t.includes("bottom")) return "harmony_low";
    return "harmony_mid";
  }
  if (t.includes("intro")) return "intro";
  if (t.includes("outro")) return "outro";
  return "lead";
}

export function decideVocalSpace(opts: {
  performance: PerformanceSignals;
  roleType?: string | null;
  sectionLabel?: string | null;
  genre?: string | null;
  bpm?: number | null;
}): VocalSpaceDecision {
  const role = roleFromType(opts.roleType);
  const section = sectionKindFromLabel(opts.sectionLabel);
  const profile = resolveGenreProfile(opts.genre);
  const perf = opts.performance;
  const notes: string[] = [...perf.notes, `genre:${profile.id}`, `role:${role}`, `section:${section}`];

  // Base plan from existing musical-space
  const plan = planMusicalSpace(role, section, opts.bpm ?? null, opts.genre);

  // Character from performance + role + section
  let character: SpaceCharacter = "present";
  if (role === "background" || role.startsWith("harmony")) {
    character = "background";
  } else if (role === "adlib") {
    character = section === "chorus" ? "expansive" : "present";
  } else if (section === "verse" || section === "intro") {
    character = perf.intimacy > 0.5 || perf.energy < 0.4 ? "intimate" : "present";
  } else if (section === "chorus" || section === "outro" || section === "bridge") {
    character = "expansive";
  } else if (perf.intimacy > 0.6 && perf.phraseDensity < 0.45) {
    character = "intimate";
  }

  // Shape plan by character + performance (safety clamps applied)
  if (character === "intimate") {
    plan.longWet = 0;
    plan.shortWet = clamp(plan.shortWet * 0.65, 0, 0.12);
    plan.delayWet = clamp(plan.delayWet * 0.55, 0, 0.08);
    plan.throwWet = clamp(plan.throwWet * 0.4, 0, 0.08);
    plan.earlyWet = clamp(Math.max(plan.earlyWet, 0.08), 0, 0.14);
    notes.push("space:intimate");
  } else if (character === "expansive") {
    plan.shortWet = clamp(plan.shortWet * 1.15, 0, 0.22);
    plan.longWet = clamp(Math.max(plan.longWet, 0.06) * 1.1, 0, 0.16);
    plan.delayWet = clamp(plan.delayWet * 1.15, 0, 0.16);
    plan.throwWet = clamp(Math.max(plan.throwWet, 0.06), 0, 0.18);
    notes.push("space:expansive");
  } else if (character === "background") {
    plan.shortWet = clamp(plan.shortWet * 1.3, 0, 0.28);
    plan.longWet = clamp(Math.max(plan.longWet, 0.08), 0, 0.2);
    plan.earlyWet *= 0.75;
    plan.delayWet = clamp(plan.delayWet * 0.9, 0, 0.12);
    notes.push("space:background");
  } else {
    notes.push("space:present");
  }

  // Dense lyrics → less delay tail
  if (perf.phraseDensity > 0.7) {
    plan.delayWet *= 0.55;
    plan.throwWet *= 0.5;
    notes.push("dense_less_delay");
  }
  // Sparse + sustained → allow more throw
  if (perf.silenceRatio > 0.4 && perf.sustained > 0.4 && role === "lead") {
    plan.throwWet = clamp(plan.throwWet + 0.04, 0, 0.16);
    notes.push("sparse_throw");
  }

  // Low mud risk → less long reverb
  if (perf.lowContamination > 0.5) {
    plan.longWet *= 0.5;
    plan.shortWet *= 0.85;
    notes.push("cut_mud_space");
  }

  // Genre beat-respect → duck
  const duckDb = clamp(1.2 + (1 - profile.beatRespect) * 1.4, 0.8, 3.2);
  const duckMidFocus = profile.beatRespect > 0.7 ? 0.85 : 0.7;

  // Width from role treatment
  const treatment = profile.roles[role] || profile.roles.lead;
  let width = treatment.width;
  if (character === "intimate") width *= 0.7;
  if (character === "expansive") width = clamp(width * 1.15, 0, 0.75);
  if (character === "background") width = clamp(Math.max(width, 0.5), 0, 0.8);

  // Phrase-level automation (subtle)
  let automationGainDb = 0;
  if (perf.energy < 0.28 && role === "lead") automationGainDb = 1.2;
  else if (perf.energy > 0.75 && role === "lead") automationGainDb = -0.8;
  if (section === "chorus" && role === "lead") automationGainDb += profile.chorusEnergyBoostDb * 0.25;
  if (section === "verse" && role === "lead") automationGainDb += profile.verseIntimacyDb * 0.5;
  automationGainDb = clamp(automationGainDb, -2.5, 2.5);

  // Confidence: lower confidence → safer (drier) space
  if (perf.confidence < 0.6) {
    plan.longWet *= 0.5;
    plan.throwWet *= 0.5;
    plan.delayWet *= 0.7;
    notes.push("low_confidence_safe");
  }

  // Absolute safety ceilings
  plan.earlyWet = clamp(plan.earlyWet, 0, 0.2);
  plan.shortWet = clamp(plan.shortWet, 0, 0.28);
  plan.longWet = clamp(plan.longWet, 0, 0.18);
  plan.delayWet = clamp(plan.delayWet, 0, 0.18);
  plan.throwWet = clamp(plan.throwWet, 0, 0.2);

  return {
    character,
    plan,
    automationGainDb,
    duckDb,
    duckMidFocus,
    width: clamp(width, 0, 0.85),
    reverbHpHz: 280,
    reverbLpHz: character === "intimate" ? 5500 : 7200,
    delayFeedback: clamp(0.22 + (character === "expansive" ? 0.08 : 0), 0.15, 0.38),
    confidence: perf.confidence,
    notes,
  };
}

export { roleFromType, sectionKindFromLabel };
