/**
 * Real Track FX presets — configure actual TrackFx fields applied in Console + Produce.
 */

/** Minimal shape so server code can import without full React component graph issues.
 * Values mirror components/producer-view TrackFx.
 */
export type TrackFxShape = {
  gainDb: number;
  eqLowDb: number;
  eqMidDb: number;
  eqHighDb: number;
  compress: number;
  reverb: number;
  delay: number;
  saturation: number;
  pan: number;
  width: number;
  air: number;
  rotorMix: number;
  rotorSpeed: number;
  rotorDepth: number;
  rotorWarmth: number;
  rotorFast: number;
  springMix: number;
  springDelay: number;
  springTension: number;
  springDamp: number;
  springMod: number;
  deEss: number;
  gate: number;
  highPassHz: number;
  lowPassHz: number;
  limiter: number;
  chorus: number;
  telephone: number;
  doubler: number;
  slapDelay: number;
  plateReverb: number;
};

export const FX_DEFAULTS: TrackFxShape = {
  gainDb: 0,
  eqLowDb: 0,
  eqMidDb: 0,
  eqHighDb: 0,
  compress: 0,
  reverb: 0,
  delay: 0,
  saturation: 0,
  pan: 0,
  width: 0,
  air: 0,
  rotorMix: 0,
  rotorSpeed: 0.35,
  rotorDepth: 0.45,
  rotorWarmth: 0.4,
  rotorFast: 0,
  springMix: 0,
  springDelay: 0.25,
  springTension: 0.4,
  springDamp: 0.35,
  springMod: 0.2,
  deEss: 0,
  gate: 0,
  highPassHz: 0,
  lowPassHz: 0,
  limiter: 0,
  chorus: 0,
  telephone: 0,
  doubler: 0,
  slapDelay: 0,
  plateReverb: 0,
};

export type FxPresetId =
  | "clean_studio"
  | "warm_rnb"
  | "bright_pop"
  | "rap_vocal"
  | "afrobeats"
  | "afro_soul"
  | "gospel"
  | "dreamy_ambient"
  | "soft_harmonies"
  | "wide_stack"
  | "gospel_choir_space"
  | "tight_double";

export type FxPreset = {
  id: FxPresetId;
  label: string;
  group: "lead" | "backing";
  /** Partial overlay on FX_DEFAULTS */
  fx: Partial<TrackFxShape>;
};

export const FX_PRESETS: FxPreset[] = [
  {
    id: "clean_studio",
    label: "Clean Studio",
    group: "lead",
    fx: {
      highPassHz: 80,
      eqLowDb: -1,
      eqMidDb: 0.5,
      eqHighDb: 1.5,
      air: 0.25,
      compress: 0.35,
      deEss: 0.3,
      reverb: 0.12,
      limiter: 0.2,
    },
  },
  {
    id: "warm_rnb",
    label: "Warm R&B",
    group: "lead",
    fx: {
      highPassHz: 90,
      eqLowDb: 1.5,
      eqMidDb: -0.5,
      eqHighDb: 0.5,
      air: 0.15,
      saturation: 0.28,
      compress: 0.4,
      deEss: 0.25,
      plateReverb: 0.22,
      delay: 0.12,
      width: 0.15,
    },
  },
  {
    id: "bright_pop",
    label: "Bright Pop",
    group: "lead",
    fx: {
      highPassHz: 100,
      eqHighDb: 2.5,
      air: 0.45,
      compress: 0.45,
      deEss: 0.4,
      reverb: 0.15,
      delay: 0.1,
      doubler: 0.2,
    },
  },
  {
    id: "rap_vocal",
    label: "Rap Vocal",
    group: "lead",
    fx: {
      highPassHz: 100,
      eqLowDb: -2,
      eqMidDb: 1.5,
      compress: 0.55,
      deEss: 0.45,
      saturation: 0.15,
      reverb: 0.06,
      delay: 0.08,
      limiter: 0.35,
    },
  },
  {
    id: "afrobeats",
    label: "Afrobeats",
    group: "lead",
    fx: {
      highPassHz: 85,
      eqLowDb: 1,
      eqMidDb: 0.8,
      eqHighDb: 1.2,
      air: 0.3,
      saturation: 0.22,
      compress: 0.4,
      plateReverb: 0.18,
      delay: 0.14,
      width: 0.2,
    },
  },
  {
    id: "afro_soul",
    label: "Afro-soul",
    group: "lead",
    fx: {
      highPassHz: 80,
      eqLowDb: 2,
      eqMidDb: -0.3,
      saturation: 0.35,
      compress: 0.35,
      plateReverb: 0.28,
      springMix: 0.15,
      width: 0.18,
      air: 0.2,
    },
  },
  {
    id: "gospel",
    label: "Gospel Lead",
    group: "lead",
    fx: {
      highPassHz: 90,
      eqMidDb: 1,
      eqHighDb: 1.5,
      air: 0.35,
      compress: 0.3,
      plateReverb: 0.35,
      delay: 0.1,
      width: 0.12,
    },
  },
  {
    id: "dreamy_ambient",
    label: "Dreamy Ambient",
    group: "lead",
    fx: {
      highPassHz: 120,
      eqHighDb: 2,
      air: 0.4,
      reverb: 0.45,
      plateReverb: 0.25,
      delay: 0.28,
      chorus: 0.25,
      rotorMix: 0.2,
      width: 0.45,
      compress: 0.2,
    },
  },
  {
    id: "soft_harmonies",
    label: "Soft Harmonies",
    group: "backing",
    fx: {
      highPassHz: 150,
      eqLowDb: -2,
      compress: 0.2,
      reverb: 0.3,
      width: 0.4,
      gainDb: -2,
      deEss: 0.2,
    },
  },
  {
    id: "wide_stack",
    label: "Wide Vocal Stack",
    group: "backing",
    fx: {
      highPassHz: 140,
      width: 0.65,
      doubler: 0.35,
      chorus: 0.2,
      reverb: 0.25,
      gainDb: -3,
      compress: 0.25,
    },
  },
  {
    id: "gospel_choir_space",
    label: "Gospel Choir Space",
    group: "backing",
    fx: {
      highPassHz: 120,
      plateReverb: 0.4,
      reverb: 0.2,
      width: 0.5,
      gainDb: -4,
      compress: 0.15,
      air: 0.2,
    },
  },
  {
    id: "tight_double",
    label: "Tight Vocal Double",
    group: "backing",
    fx: {
      highPassHz: 100,
      doubler: 0.45,
      compress: 0.35,
      reverb: 0.08,
      width: 0.35,
      gainDb: -1.5,
    },
  },
];

export function applyFxPreset(
  base: TrackFxShape,
  presetId: string
): TrackFxShape {
  const preset = FX_PRESETS.find((p) => p.id === presetId);
  if (!preset) return { ...base };
  return { ...FX_DEFAULTS, ...base, ...preset.fx };
}

export function findPresetByPhrase(phrase: string): FxPreset | null {
  const p = phrase.toLowerCase();
  const rules: [RegExp, FxPresetId][] = [
    [/\bwarm\s*r&?b|r&b vocal|rnb\b/, "warm_rnb"],
    [/\bbright\s*pop|pop vocal\b/, "bright_pop"],
    [/\brap\b|hip[- ]?hop vocal/, "rap_vocal"],
    [/\bafrobeats?|afrobeat\b/, "afrobeats"],
    [/\bafro[- ]?soul\b/, "afro_soul"],
    [/\bgospel\b/, "gospel"],
    [/\bdreamy|ambient|ethereal\b/, "dreamy_ambient"],
    [/\bclean studio|studio clean|clean vocal\b/, "clean_studio"],
    [/\bsoft harmon|backing soft\b/, "soft_harmonies"],
    [/\bwide (stack|vocal)|vocal stack\b/, "wide_stack"],
    [/\bchoir space|gospel choir\b/, "gospel_choir_space"],
    [/\btight double|vocal double\b/, "tight_double"],
  ];
  for (const [re, id] of rules) {
    if (re.test(p)) return FX_PRESETS.find((x) => x.id === id) || null;
  }
  return null;
}
