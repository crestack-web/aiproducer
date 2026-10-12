/**
 * Vibe Profiles — human-friendly chips → concrete mix/master deltas.
 * Bridges artist intent into production_direction + worker DSP.
 */

export type VibeProfileKey =
  | "intimate_warm"
  | "punchy_forward"
  | "ethereal_dreamy"
  | "raw_soulful"
  | "polished_pop";

export type VibeDeltas = {
  /** Lead presence (≈2–4 kHz) boost in dB */
  leadPresenceBoostDb: number;
  /** Lead air shelf (≈10–12 kHz) in dB */
  leadAirShelfDb: number;
  /** Lead mud cut (≈200–350 Hz) in dB (usually negative) */
  leadMudCutDb: number;
  /** Mix-bus glue ratio */
  busCompressionRatio: number;
  /** Mix-bus attack (ms) */
  busAttackMs: number;
  /** Side amplification (1 = neutral) */
  stereoWidthMultiplier: number;
  /** Scales space / reverb feel */
  reverbDecayModifier: number;
  /** Section energy bias: chorus lift relative to verse (dB-ish) */
  chorusEnergyBoostDb: number;
  /** Verse intimacy (lead dryness / closeness bias) */
  verseIntimacyDb: number;
  /** Master target LUFS nudge (added to genre base) */
  targetLufsNudge: number;
  /** Style axis: 0 raw → 1 polished */
  polishAxis: number;
};

export type VibeSettings = {
  vibeKey: VibeProfileKey;
  displayName: string;
  description: string;
  deltas: VibeDeltas;
};

export const VIBE_PROFILES: Record<VibeProfileKey, VibeSettings> = {
  intimate_warm: {
    vibeKey: "intimate_warm",
    displayName: "Intimate & Warm",
    description: "Velvety lows, close-up vocals, plush and cozy space.",
    deltas: {
      leadPresenceBoostDb: 1.5,
      leadAirShelfDb: 0.5,
      leadMudCutDb: -2.0,
      busCompressionRatio: 1.4,
      busAttackMs: 30,
      stereoWidthMultiplier: 0.95,
      reverbDecayModifier: 1.15,
      chorusEnergyBoostDb: 0.8,
      verseIntimacyDb: 1.2,
      targetLufsNudge: -1.5,
      polishAxis: 0.35,
    },
  },
  punchy_forward: {
    vibeKey: "punchy_forward",
    displayName: "Punchy & Forward",
    description: "In-your-face impact, crisp transients, clean modern sheen.",
    deltas: {
      leadPresenceBoostDb: 3.0,
      leadAirShelfDb: 2.0,
      leadMudCutDb: -3.5,
      busCompressionRatio: 1.8,
      busAttackMs: 15,
      stereoWidthMultiplier: 1.05,
      reverbDecayModifier: 0.85,
      chorusEnergyBoostDb: 1.5,
      verseIntimacyDb: 0.3,
      targetLufsNudge: 0.5,
      polishAxis: 0.75,
    },
  },
  ethereal_dreamy: {
    vibeKey: "ethereal_dreamy",
    displayName: "Ethereal & Dreamy",
    description: "Expansive soundscapes, washed harmonies, floating atmosphere.",
    deltas: {
      leadPresenceBoostDb: 1.0,
      leadAirShelfDb: 2.5,
      leadMudCutDb: -1.5,
      busCompressionRatio: 1.3,
      busAttackMs: 40,
      stereoWidthMultiplier: 1.25,
      reverbDecayModifier: 1.4,
      chorusEnergyBoostDb: 1.2,
      verseIntimacyDb: 0.8,
      targetLufsNudge: -2.0,
      polishAxis: 0.45,
    },
  },
  raw_soulful: {
    vibeKey: "raw_soulful",
    displayName: "Raw & Soulful",
    description: "Preserved dynamics, organic midrange grit, tactile character.",
    deltas: {
      leadPresenceBoostDb: 1.2,
      leadAirShelfDb: 0.8,
      leadMudCutDb: -1.0,
      busCompressionRatio: 1.25,
      busAttackMs: 50,
      stereoWidthMultiplier: 1.0,
      reverbDecayModifier: 1.0,
      chorusEnergyBoostDb: 0.6,
      verseIntimacyDb: 1.0,
      targetLufsNudge: -2.5,
      polishAxis: 0.25,
    },
  },
  polished_pop: {
    vibeKey: "polished_pop",
    displayName: "Polished Pop",
    description: "Commercial sheen, razor-sharp separation, competitive density.",
    deltas: {
      leadPresenceBoostDb: 2.5,
      leadAirShelfDb: 2.0,
      leadMudCutDb: -3.0,
      busCompressionRatio: 1.7,
      busAttackMs: 20,
      stereoWidthMultiplier: 1.1,
      reverbDecayModifier: 0.95,
      chorusEnergyBoostDb: 1.8,
      verseIntimacyDb: 0.2,
      targetLufsNudge: 0.8,
      polishAxis: 0.9,
    },
  },
};

export const VIBE_PROFILE_LIST: VibeSettings[] = Object.values(VIBE_PROFILES);

export function isVibeProfileKey(v: unknown): v is VibeProfileKey {
  return typeof v === "string" && v in VIBE_PROFILES;
}
