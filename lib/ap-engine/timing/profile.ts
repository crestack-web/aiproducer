import type { VocalRole, SongSectionKind } from "../roles";
import type { TimingProfileId } from "./types";
import { isRnbFamily } from "../profiles/rnb-production";

export type TimingLimits = {
  profile: TimingProfileId;
  /** max absolute shift applied to lead (ms) */
  maxLeadShiftMs: number;
  maxDoubleShiftMs: number;
  maxHarmonyShiftMs: number;
  maxAdlibShiftMs: number;
  /** offsets below this → on_time */
  onTimeMs: number;
  /** accidental late threshold (isolated) */
  lateMistakeMs: number;
  /** consistent behind-the-beat band that we preserve */
  intentionalBehindMinMs: number;
  intentionalBehindMaxMs: number;
  minConfidence: number;
};

export function resolveTimingProfile(
  genre: string | null | undefined,
  section: SongSectionKind
): TimingLimits {
  const g = (genre || "rnb").toLowerCase();
  let profile: TimingProfileId = "polished";
  let maxLead = 45;
  let maxDouble = 55;
  let maxHarmony = 40;
  let maxAdlib = 20;
  let onTime = 18;
  let lateMistake = 55;
  let behindMin = 20;
  let behindMax = 55;
  let minConf = 0.45;

  if (isRnbFamily(g) || g.includes("soul") || g.includes("ballad")) {
    profile = "natural";
    maxLead = 38;
    lateMistake = 70;
    behindMin = 18;
    behindMax = 60;
    minConf = 0.5;
  } else if (g.includes("hip") || g.includes("trap") || g.includes("rap")) {
    profile = "tight";
    maxLead = 40;
    maxDouble = 50;
    lateMistake = 45;
    behindMax = 40;
  } else if (g.includes("afrobeat") || g.includes("amapiano") || g.includes("afropop")) {
    profile = "polished";
    maxLead = 42;
    lateMistake = 60;
    behindMax = 50;
  } else if (g.includes("pop")) {
    profile = "tight";
    maxLead = 40;
    maxDouble = 55;
    lateMistake = 50;
  }

  // Section: chorus tighter
  if (section === "chorus") {
    maxLead *= 0.85;
    maxDouble *= 0.9;
    lateMistake *= 0.9;
    if (profile === "natural") profile = "polished";
  } else if (section === "verse" || section === "bridge") {
    maxLead *= 1.05;
    minConf = Math.max(minConf, 0.48);
  }

  return {
    profile,
    maxLeadShiftMs: maxLead,
    maxDoubleShiftMs: maxDouble,
    maxHarmonyShiftMs: maxHarmony,
    maxAdlibShiftMs: maxAdlib,
    onTimeMs: onTime,
    lateMistakeMs: lateMistake,
    intentionalBehindMinMs: behindMin,
    intentionalBehindMaxMs: behindMax,
    minConfidence: minConf,
  };
}

export function maxShiftForRole(limits: TimingLimits, role: VocalRole): number {
  if (role === "lead") return limits.maxLeadShiftMs;
  if (role === "double") return limits.maxDoubleShiftMs;
  if (role.startsWith("harmony") || role === "background") return limits.maxHarmonyShiftMs;
  if (role === "adlib") return limits.maxAdlibShiftMs;
  return limits.maxLeadShiftMs;
}
