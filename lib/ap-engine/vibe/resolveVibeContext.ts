/**
 * Resolve artist vibe chip → deltas for mix/master workers.
 */
import {
  VIBE_PROFILES,
  isVibeProfileKey,
  type VibeDeltas,
  type VibeProfileKey,
  type VibeSettings,
} from "./vibeProfiles";
import type { ProductionDirection } from "../direction/types";

export type ResolvedVibe = {
  vibeKey: VibeProfileKey;
  displayName: string;
  description: string;
} & VibeDeltas;

const DEFAULT_KEY: VibeProfileKey = "punchy_forward";

/**
 * Read vibe from production_direction (preferred) or free-form character biases.
 */
export function resolveVibeDeltas(
  productionDirection?: ProductionDirection | { vibe?: string } | null
): ResolvedVibe {
  const raw =
    productionDirection && typeof productionDirection === "object"
      ? (productionDirection as ProductionDirection & { vibe?: string }).vibe
      : undefined;

  let key: VibeProfileKey = DEFAULT_KEY;
  if (isVibeProfileKey(raw)) {
    key = raw;
  } else if (productionDirection && typeof productionDirection === "object") {
    // Infer from character axes when no explicit chip
    const c = (productionDirection as ProductionDirection).character;
    if (c) {
      const scores: { k: VibeProfileKey; s: number }[] = [
        { k: "intimate_warm", s: (c.intimate || 0) + (c.raw || 0) * 0.3 },
        { k: "raw_soulful", s: (c.raw || 0) + (c.intimate || 0) * 0.2 },
        { k: "ethereal_dreamy", s: (c.atmospheric || 0) },
        { k: "polished_pop", s: (c.polished || 0) },
        { k: "punchy_forward", s: (c.energetic || 0) },
      ];
      scores.sort((a, b) => b.s - a.s);
      if (scores[0] && scores[0].s > 0.25) key = scores[0].k;
    }
  }

  const profile: VibeSettings = VIBE_PROFILES[key] || VIBE_PROFILES[DEFAULT_KEY];
  return {
    vibeKey: profile.vibeKey,
    displayName: profile.displayName,
    description: profile.description,
    ...profile.deltas,
  };
}

/** Map vibe → production_direction character patch (for persistence / UI). */
export function vibeToDirectionPatch(key: VibeProfileKey): Partial<ProductionDirection> {
  const profile = VIBE_PROFILES[key];
  if (!profile) return { vibe: DEFAULT_KEY };
  const d = profile.deltas;
  return {
    vibe: key,
    character: {
      intimate: key === "intimate_warm" || key === "raw_soulful" ? 0.7 : 0.15,
      raw: key === "raw_soulful" ? 0.8 : key === "intimate_warm" ? 0.35 : 0.1,
      polished: d.polishAxis,
      atmospheric: key === "ethereal_dreamy" ? 0.85 : 0.15,
      energetic: key === "punchy_forward" || key === "polished_pop" ? 0.75 : 0.2,
    },
    vocal: {
      leadPresence: Math.max(-1, Math.min(1, d.leadPresenceBoostDb / 4)),
      intimacy: Math.max(-1, Math.min(1, d.verseIntimacyDb / 2)),
      brightness: Math.max(-1, Math.min(1, d.leadAirShelfDb / 3)),
      warmth: key === "intimate_warm" || key === "raw_soulful" ? 0.6 : 0.15,
      aggression: key === "punchy_forward" ? 0.55 : key === "polished_pop" ? 0.35 : 0.1,
    },
    space: {
      width: Math.max(-1, Math.min(1, (d.stereoWidthMultiplier - 1) * 2)),
      reverb: Math.max(-1, Math.min(1, (d.reverbDecayModifier - 1) * 1.5)),
      dryness: Math.max(-1, Math.min(1, 1 - d.reverbDecayModifier)),
    },
    arrangement: {
      chorusEnergy: Math.max(-1, Math.min(1, d.chorusEnergyBoostDb / 2)),
      verseEnergy: Math.max(-1, Math.min(1, -d.verseIntimacyDb / 3)),
    },
    plainSummary: profile.displayName,
    updatedAt: new Date().toISOString(),
  };
}
