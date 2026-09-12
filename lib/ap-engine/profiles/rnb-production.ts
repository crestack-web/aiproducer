/**
 * R&B / Neo-Soul production doctrine for AP.
 * Goal: intimate lead in a warm pocket; tight doubles; section contrast; controlled space.
 */
import type { GenreProfile } from "./genre-profiles";
import type { VocalRole, SongSectionKind } from "../roles";
import type { MixDecision } from "../types";

export function isRnbFamily(genreId: string): boolean {
  const g = (genreId || "").toLowerCase();
  return (
    g === "rnb" ||
    g === "afro_rnb" ||
    g.includes("rnb") ||
    g.includes("r&b") ||
    g.includes("soul") ||
    g.includes("neo")
  );
}

/** Enrich R&B genre profile (warmth, pocket, stacks). */
export function enhanceRnbProfile(profile: GenreProfile): GenreProfile {
  if (!isRnbFamily(profile.id)) return profile;
  return {
    ...profile,
    leadForwardness: Math.min(0.78, profile.leadForwardness + 0.08),
    preserveDynamics: Math.max(0.72, profile.preserveDynamics),
    beatRespect: Math.min(0.78, Math.max(0.62, profile.beatRespect)),
    chorusEnergyBoostDb: Math.max(1.4, profile.chorusEnergyBoostDb),
    verseIntimacyDb: Math.min(-1.2, profile.verseIntimacyDb),
    targetLufs: profile.targetLufs ?? -11.5,
    roles: {
      ...profile.roles,
      lead: {
        ...profile.roles.lead,
        presenceDb: Math.max(2.2, profile.roles.lead.presenceDb),
        warmthDb: Math.max(1.8, profile.roles.lead.warmthDb),
        reverb: Math.min(0.14, profile.roles.lead.reverb),
        delay: Math.min(0.08, Math.max(0.05, profile.roles.lead.delay)),
        compressionRatioBoost: Math.min(-0.15, profile.roles.lead.compressionRatioBoost),
      },
      double: {
        ...profile.roles.double,
        gainDbOffset: Math.min(-4.2, profile.roles.double.gainDbOffset),
        width: Math.min(0.32, Math.max(0.22, profile.roles.double.width)),
        reverb: Math.min(0.1, profile.roles.double.reverb),
        delay: Math.min(0.03, profile.roles.double.delay),
        compressionRatioBoost: Math.max(0.5, profile.roles.double.compressionRatioBoost),
      },
      harmony_high: {
        ...profile.roles.harmony_high,
        width: Math.max(0.58, profile.roles.harmony_high.width),
        reverb: Math.max(0.22, profile.roles.harmony_high.reverb),
      },
      harmony_mid: {
        ...profile.roles.harmony_mid,
        width: Math.max(0.5, profile.roles.harmony_mid.width),
        reverb: Math.max(0.2, profile.roles.harmony_mid.reverb),
      },
      adlib: {
        ...profile.roles.adlib,
        delay: Math.max(0.16, profile.roles.adlib.delay),
        reverb: Math.max(0.2, profile.roles.adlib.reverb),
        width: Math.max(0.55, profile.roles.adlib.width),
      },
      background: {
        ...profile.roles.background,
        reverb: Math.max(0.3, profile.roles.background.reverb),
        width: Math.max(0.68, profile.roles.background.width),
      },
      harmony_low: profile.roles.harmony_low,
      intro: profile.roles.intro,
      outro: profile.roles.outro,
    },
    notes: [...profile.notes, "rnb_pocket", "rnb_warm_lead", "rnb_tight_doubles", "rnb_section_space"],
  };
}

/** Stronger mid-band pocket + duck for R&B mixes. */
export function applyRnbMixBias(mix: MixDecision, genreId: string): MixDecision {
  if (!isRnbFamily(genreId)) return mix;
  const cutBoost = 0.85;
  const bands = (mix.beatMaskBands || []).map((b) => ({
    ...b,
    // Deepen presence pocket under the lead (1.5–4k)
    gainDb:
      b.freq >= 1500 && b.freq <= 4500
        ? Math.min(4.2, b.gainDb + cutBoost)
        : b.gainDb,
  }));
  // Ensure core R&B mask bands exist
  if (!bands.length) {
    bands.push(
      { freq: 1800, gainDb: 1.8, q: 1.0 },
      { freq: 2600, gainDb: 2.6, q: 1.1 },
      { freq: 3800, gainDb: 1.6, q: 1.0 }
    );
  }
  return {
    ...mix,
    beatPresenceCutDb: Math.max(mix.beatPresenceCutDb, 2.2),
    beatMaskBands: bands,
    duckDb: Math.max(mix.duckDb, 2.6),
    duckMidFocus: Math.max(mix.duckMidFocus ?? 0.8, 0.88),
    // Keep vocal slightly forward but still "in" the track
    vocalGainDb: mix.vocalGainDb + 0.25,
    beatGainDb: mix.beatGainDb - 0.15,
  };
}

/** Section space multipliers for R&B (planMusicalSpace). */
export function rnbSectionSpaceScale(section: SongSectionKind): {
  early: number;
  short: number;
  long: number;
  delay: number;
  throw: number;
} {
  switch (section) {
    case "verse":
      return { early: 1.1, short: 0.75, long: 0.3, delay: 0.7, throw: 0.4 };
    case "pre_chorus":
      return { early: 1.0, short: 1.05, long: 0.7, delay: 1.1, throw: 0.8 };
    case "chorus":
      return { early: 0.95, short: 1.2, long: 1.15, delay: 1.2, throw: 1.3 };
    case "bridge":
      return { early: 1.05, short: 1.1, long: 1.3, delay: 1.25, throw: 1.1 };
    case "outro":
    case "intro":
      return { early: 1.0, short: 1.15, long: 1.35, delay: 1.3, throw: 1.2 };
    default:
      return { early: 1, short: 1, long: 1, delay: 1, throw: 1 };
  }
}

/** Tighter timing policy for R&B doubles. */
export function rnbTimingPull(role: VocalRole, basePull: number): number {
  if (role === "double") return Math.min(0.95, Math.max(0.88, basePull + 0.12));
  if (role === "lead") return Math.min(0.9, Math.max(0.75, basePull + 0.05));
  if (role.startsWith("harmony")) return Math.min(0.7, basePull + 0.08);
  return basePull;
}
