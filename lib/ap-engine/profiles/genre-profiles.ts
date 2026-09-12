/**
 * Genre production profiles — philosophy for hierarchy, not fixed EQ presets.
 */

import type { VocalRole } from "../roles";
import { enhanceRnbProfile, isRnbFamily } from "./rnb-production";

export type RoleTreatment = {
  gainDbOffset: number;
  width: number;
  reverb: number;
  delay: number;
  compressionRatioBoost: number;
  highPassHzOffset: number;
  presenceDb: number;
  warmthDb: number;
};

export type GenreProfile = {
  id: string;
  label: string;
  /** Lead intimacy: higher = more forward/dry */
  leadForwardness: number;
  preserveDynamics: number; // 0–1, ballad high
  beatRespect: number; // 0–1, don't bury groove
  chorusEnergyBoostDb: number;
  verseIntimacyDb: number;
  targetLufs: number;
  roles: Record<VocalRole, RoleTreatment>;
  notes: string[];
};

function baseRoles(overrides: Partial<Record<VocalRole, Partial<RoleTreatment>>> = {}): Record<VocalRole, RoleTreatment> {
  const def = (r: VocalRole, t: RoleTreatment): RoleTreatment => ({ ...t, ...(overrides[r] || {}) });
  return {
    lead: def("lead", { gainDbOffset: 0, width: 0, reverb: 0.12, delay: 0.06, compressionRatioBoost: 0, highPassHzOffset: 0, presenceDb: 2.2, warmthDb: 1 }),
    double: def("double", { gainDbOffset: -4.5, width: 0.28, reverb: 0.1, delay: 0.04, compressionRatioBoost: 0.4, highPassHzOffset: 15, presenceDb: 1, warmthDb: 0.3 }),
    harmony_high: def("harmony_high", { gainDbOffset: -7, width: 0.55, reverb: 0.2, delay: 0.08, compressionRatioBoost: 0.5, highPassHzOffset: 40, presenceDb: 1.5, warmthDb: -0.5 }),
    harmony_mid: def("harmony_mid", { gainDbOffset: -6.5, width: 0.45, reverb: 0.18, delay: 0.06, compressionRatioBoost: 0.5, highPassHzOffset: 25, presenceDb: 1.2, warmthDb: 0.2 }),
    harmony_low: def("harmony_low", { gainDbOffset: -7.5, width: 0.4, reverb: 0.16, delay: 0.05, compressionRatioBoost: 0.4, highPassHzOffset: 10, presenceDb: 0.5, warmthDb: 1.2 }),
    adlib: def("adlib", { gainDbOffset: -5.5, width: 0.5, reverb: 0.22, delay: 0.14, compressionRatioBoost: 0.3, highPassHzOffset: 30, presenceDb: 1.8, warmthDb: 0 }),
    background: def("background", { gainDbOffset: -9, width: 0.65, reverb: 0.28, delay: 0.08, compressionRatioBoost: 0.6, highPassHzOffset: 50, presenceDb: 0.3, warmthDb: 0.5 }),
    intro: def("intro", { gainDbOffset: -3, width: 0.35, reverb: 0.3, delay: 0.12, compressionRatioBoost: -0.2, highPassHzOffset: 20, presenceDb: 1, warmthDb: 0.8 }),
    outro: def("outro", { gainDbOffset: -2, width: 0.45, reverb: 0.32, delay: 0.15, compressionRatioBoost: -0.2, highPassHzOffset: 15, presenceDb: 1, warmthDb: 1 }),
  };
}

const PROFILES: Record<string, GenreProfile> = {
  afrobeats: {
    id: "afrobeats",
    label: "Afrobeats / Afropop",
    leadForwardness: 0.75,
    preserveDynamics: 0.45,
    beatRespect: 0.85,
    chorusEnergyBoostDb: 1.2,
    verseIntimacyDb: -0.8,
    targetLufs: -11,
    roles: baseRoles({
      lead: { presenceDb: 3, reverb: 0.1, delay: 0.08, warmthDb: 0.4 },
      double: { gainDbOffset: -4, width: 0.3 },
      adlib: { delay: 0.16, width: 0.55, gainDbOffset: -5 },
    }),
    notes: ["vocal_forward_preserve_groove"],
  },
  afro_rnb: {
    id: "afro_rnb",
    label: "Afro-R&B",
    leadForwardness: 0.7,
    preserveDynamics: 0.6,
    beatRespect: 0.75,
    chorusEnergyBoostDb: 1.5,
    verseIntimacyDb: -1.2,
    targetLufs: -12,
    roles: baseRoles({
      lead: { presenceDb: 2.4, warmthDb: 1.4, reverb: 0.14 },
      harmony_high: { reverb: 0.24, width: 0.6 },
      adlib: { delay: 0.18, reverb: 0.24 },
    }),
    notes: ["intimate_lead_lush_stacks"],
  },
  rnb: {
    id: "rnb",
    label: "R&B / Neo-Soul",
    leadForwardness: 0.72,
    preserveDynamics: 0.78,
    beatRespect: 0.68,
    chorusEnergyBoostDb: 1.5,
    verseIntimacyDb: -1.6,
    targetLufs: -12.5,
    roles: baseRoles({
      lead: {
        presenceDb: 2.4,
        warmthDb: 2.0,
        reverb: 0.12,
        delay: 0.07,
        compressionRatioBoost: -0.25,
      },
      double: {
        gainDbOffset: -4.2,
        width: 0.26,
        reverb: 0.08,
        delay: 0.03,
        compressionRatioBoost: 0.55,
      },
      harmony_high: { reverb: 0.24, width: 0.6, delay: 0.1 },
      harmony_mid: { reverb: 0.22, width: 0.52 },
      background: { reverb: 0.32, width: 0.7 },
      adlib: { delay: 0.18, reverb: 0.22, width: 0.55 },
    }),
    notes: ["emotion_over_perfection", "rnb_pocket", "warm_intimate_lead"],
  },
  hiphop: {
    id: "hiphop",
    label: "Hip-Hop",
    leadForwardness: 0.9,
    preserveDynamics: 0.35,
    beatRespect: 0.8,
    chorusEnergyBoostDb: 0.8,
    verseIntimacyDb: -0.3,
    targetLufs: -11,
    roles: baseRoles({
      lead: { presenceDb: 3.5, reverb: 0.08, delay: 0.04, warmthDb: 0.2, compressionRatioBoost: 0.5 },
      double: { width: 0.32, gainDbOffset: -4 },
      adlib: { width: 0.6, delay: 0.12, presenceDb: 2.2, gainDbOffset: -4.5 },
    }),
    notes: ["punch_intelligibility"],
  },
  trap: {
    id: "trap",
    label: "Trap",
    leadForwardness: 0.92,
    preserveDynamics: 0.3,
    beatRespect: 0.82,
    chorusEnergyBoostDb: 0.6,
    verseIntimacyDb: 0,
    targetLufs: -10.5,
    roles: baseRoles({
      lead: { presenceDb: 3.8, reverb: 0.07, compressionRatioBoost: 0.7, highPassHzOffset: 15 },
      adlib: { width: 0.65, delay: 0.15, gainDbOffset: -4, presenceDb: 2.5 },
      double: { width: 0.35, gainDbOffset: -3.8 },
    }),
    notes: ["cut_through_808"],
  },
  pop: {
    id: "pop",
    label: "Pop",
    leadForwardness: 0.85,
    preserveDynamics: 0.4,
    beatRespect: 0.65,
    chorusEnergyBoostDb: 1.8,
    verseIntimacyDb: -1,
    targetLufs: -11,
    roles: baseRoles({
      lead: { presenceDb: 3.2, reverb: 0.12, compressionRatioBoost: 0.4 },
      harmony_high: { width: 0.62, gainDbOffset: -6.5 },
      double: { width: 0.3, gainDbOffset: -4.2 },
    }),
    notes: ["polished_stack_size"],
  },
  amapiano: {
    id: "amapiano",
    label: "Amapiano",
    leadForwardness: 0.7,
    preserveDynamics: 0.5,
    beatRespect: 0.9,
    chorusEnergyBoostDb: 1.0,
    verseIntimacyDb: -0.6,
    targetLufs: -12,
    roles: baseRoles({
      lead: { presenceDb: 2.6, reverb: 0.12, highPassHzOffset: 10, warmthDb: 0.6 },
      background: { width: 0.7, reverb: 0.3 },
      adlib: { delay: 0.1, width: 0.45, gainDbOffset: -6 },
    }),
    notes: ["preserve_log_drum_space"],
  },
  ballad: {
    id: "ballad",
    label: "Ballad / Soul",
    leadForwardness: 0.55,
    preserveDynamics: 0.9,
    beatRespect: 0.6,
    chorusEnergyBoostDb: 0.8,
    verseIntimacyDb: -1.8,
    targetLufs: -13,
    roles: baseRoles({
      lead: { presenceDb: 1.8, warmthDb: 2, reverb: 0.18, compressionRatioBoost: -0.6, delay: 0.05 },
      harmony_mid: { reverb: 0.26, width: 0.5 },
      outro: { reverb: 0.38, delay: 0.18 },
    }),
    notes: ["emotion_dynamics_space"],
  },
};

export function resolveGenreProfile(genre?: string | null): GenreProfile {
  const g = (genre || "rnb").toLowerCase();
  if (g.includes("trap")) return PROFILES.trap;
  if (g.includes("hip") || g.includes("rap")) return PROFILES.hiphop;
  if (g.includes("amapiano") || g.includes("piano")) return PROFILES.amapiano;
  if (g.includes("afro") && (g.includes("r&b") || g.includes("rnb") || g.includes("soul"))) return enhanceRnbProfile(PROFILES.afro_rnb);
  if (g.includes("afrobeat") || g.includes("afropop") || g.includes("afro pop")) return PROFILES.afrobeats;
  if (g.includes("ballad") || g.includes("slow")) return PROFILES.ballad;
  if (g.includes("pop")) return PROFILES.pop;
  if (g.includes("hausa")) return enhanceRnbProfile(PROFILES.afro_rnb);
  if (g.includes("r&b") || g.includes("rnb") || g.includes("soul") || g.includes("neo")) {
    return enhanceRnbProfile(PROFILES.rnb);
  }
  // Default: R&B doctrine (most AP sessions trend contemporary R&B)
  return enhanceRnbProfile(PROFILES.rnb);
}

export function listGenreProfiles(): GenreProfile[] {
  return Object.values(PROFILES);
}

// Re-export for older import path compatibility
export type { GenreProfile as GenreProfileV2 };
