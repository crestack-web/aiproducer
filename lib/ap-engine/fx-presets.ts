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
  noiseReduce: number;
  voiceChanger: number;
  voicePitchSemis: number;
  voiceCharacter: number;
  highPassHz: number;
  lowPassHz: number;
  limiter: number;
  chorus: number;
  telephone: number;
  doubler: number;
  slapDelay: number;
  plateReverb: number;
  phraseCleanup: number;
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
  noiseReduce: 0,
  voiceChanger: 0,
  voicePitchSemis: 0,
  voiceCharacter: 0,
  highPassHz: 0,
  lowPassHz: 0,
  limiter: 0,
  chorus: 0,
  telephone: 0,
  doubler: 0,
  slapDelay: 0,
  plateReverb: 0,
  phraseCleanup: 0,
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

/** Per-effect presets — only touch that plugin's parameters */
export type EffectPluginPreset = {
  id: string;
  label: string;
  fx: Partial<TrackFxShape>;
};

export const EFFECT_PLUGIN_PRESETS: Record<string, EffectPluginPreset[]> = {
  compress: [
    { id: "comp_light", label: "Light", fx: { compress: 0.25 } },
    { id: "comp_vocal", label: "Vocal", fx: { compress: 0.45 } },
    { id: "comp_punch", label: "Punch", fx: { compress: 0.7 } },
    { id: "comp_smash", label: "Smash", fx: { compress: 0.9 } },
  ],
  deess: [
    { id: "deess_soft", label: "Soft", fx: { deEss: 0.25 } },
    { id: "deess_med", label: "Medium", fx: { deEss: 0.45 } },
    { id: "deess_hard", label: "Hard", fx: { deEss: 0.75 } },
  ],
  gate: [
    { id: "gate_light", label: "Light", fx: { gate: 0.25 } },
    { id: "gate_tight", label: "Tight", fx: { gate: 0.55 } },
    { id: "gate_hard", label: "Hard", fx: { gate: 0.85 } },
  ],
  cleanup: [
    { id: "clean_light", label: "Light", fx: { phraseCleanup: 0.35 } },
    { id: "clean_tight", label: "Tight", fx: { phraseCleanup: 0.6 } },
    { id: "clean_close", label: "Close gaps", fx: { phraseCleanup: 0.85 } },
  ],
  denoise: [
    { id: "nr_light", label: "Light", fx: { noiseReduce: 0.3 } },
    { id: "nr_med", label: "Medium", fx: { noiseReduce: 0.55 } },
    { id: "nr_strong", label: "Strong", fx: { noiseReduce: 0.8 } },
  ],
  limiter: [
    { id: "lim_gentle", label: "Gentle", fx: { limiter: 0.25 } },
    { id: "lim_safe", label: "Safe", fx: { limiter: 0.5 } },
    { id: "lim_brick", label: "Brick", fx: { limiter: 0.85 } },
  ],
  sat: [
    { id: "sat_warm", label: "Warm", fx: { saturation: 0.25 } },
    { id: "sat_tape", label: "Tape", fx: { saturation: 0.45 } },
    { id: "sat_drive", label: "Drive", fx: { saturation: 0.7 } },
  ],
  eq: [
    { id: "eq_flat", label: "Flat", fx: { eqLowDb: 0, eqMidDb: 0, eqHighDb: 0, air: 0 } },
    { id: "eq_warm", label: "Warm", fx: { eqLowDb: 1.5, eqMidDb: -0.5, eqHighDb: 0.5, air: 0.15 } },
    { id: "eq_bright", label: "Bright", fx: { eqLowDb: -1, eqMidDb: 0.5, eqHighDb: 2.5, air: 0.4 } },
    { id: "eq_radio", label: "Radio", fx: { eqLowDb: -3, eqMidDb: 2, eqHighDb: 1.5, air: 0.25 } },
    { id: "eq_presence", label: "Presence", fx: { eqLowDb: 0, eqMidDb: 2.5, eqHighDb: 1, air: 0.35 } },
  ],
  hpf: [
    { id: "hpf_rumble", label: "Rumble", fx: { highPassHz: 60 } },
    { id: "hpf_vocal", label: "Vocal", fx: { highPassHz: 100 } },
    { id: "hpf_thin", label: "Thin", fx: { highPassHz: 180 } },
    { id: "hpf_off", label: "Off", fx: { highPassHz: 0 } },
  ],
  lpf: [
    { id: "lpf_off", label: "Open", fx: { lowPassHz: 0 } },
    { id: "lpf_soft", label: "Soft", fx: { lowPassHz: 8000 } },
    { id: "lpf_muffle", label: "Muffle", fx: { lowPassHz: 3500 } },
    { id: "lpf_phone", label: "Phone", fx: { lowPassHz: 2800 } },
  ],
  telephone: [
    { id: "tel_light", label: "Light", fx: { telephone: 0.35 } },
    { id: "tel_classic", label: "Classic", fx: { telephone: 0.6 } },
    { id: "tel_extreme", label: "Extreme", fx: { telephone: 0.9 } },
  ],
  reverb: [
    { id: "rev_dry", label: "Dry", fx: { reverb: 0.08 } },
    { id: "rev_room", label: "Room", fx: { reverb: 0.22 } },
    { id: "rev_hall", label: "Hall", fx: { reverb: 0.4 } },
    { id: "rev_wash", label: "Wash", fx: { reverb: 0.65 } },
  ],
  plate: [
    { id: "plate_short", label: "Short", fx: { plateReverb: 0.2 } },
    { id: "plate_vocal", label: "Vocal", fx: { plateReverb: 0.35 } },
    { id: "plate_lush", label: "Lush", fx: { plateReverb: 0.55 } },
  ],
  delay: [
    { id: "delay_subtle", label: "Subtle", fx: { delay: 0.15 } },
    { id: "delay_echo", label: "Echo", fx: { delay: 0.35 } },
    { id: "delay_bounce", label: "Bounce", fx: { delay: 0.55 } },
    { id: "delay_wash", label: "Wash", fx: { delay: 0.75 } },
  ],
  slap: [
    { id: "slap_tight", label: "Tight", fx: { slapDelay: 0.2 } },
    { id: "slap_rock", label: "Rock", fx: { slapDelay: 0.4 } },
    { id: "slap_wide", label: "Wide", fx: { slapDelay: 0.6 } },
  ],
  chorus: [
    { id: "chor_subtle", label: "Subtle", fx: { chorus: 0.2 } },
    { id: "chor_rich", label: "Rich", fx: { chorus: 0.4 } },
    { id: "chor_seasick", label: "Wide", fx: { chorus: 0.65 } },
  ],
  doubler: [
    { id: "dbl_soft", label: "Soft", fx: { doubler: 0.25 } },
    { id: "dbl_stack", label: "Stack", fx: { doubler: 0.45 } },
    { id: "dbl_wide", label: "Wide", fx: { doubler: 0.7 } },
  ],
  voice: [
    { id: "voice_natural", label: "Natural", fx: { voiceChanger: 0, voicePitchSemis: 0, voiceCharacter: 0 } },
    { id: "voice_chip", label: "Chip", fx: { voiceChanger: 0.7, voicePitchSemis: 5, voiceCharacter: 0.4 } },
    { id: "voice_deep", label: "Deep", fx: { voiceChanger: 0.7, voicePitchSemis: -4, voiceCharacter: 0.35 } },
    { id: "voice_robot", label: "Robot", fx: { voiceChanger: 0.85, voicePitchSemis: 0, voiceCharacter: 0.8 } },
  ],
  rotor: [
    { id: "rotor_slow", label: "Slow", fx: { rotorMix: 0.4, rotorSpeed: 0.25, rotorDepth: 0.4, rotorWarmth: 0.45, rotorFast: 0 } },
    { id: "rotor_fast", label: "Fast", fx: { rotorMix: 0.45, rotorSpeed: 0.7, rotorDepth: 0.5, rotorWarmth: 0.35, rotorFast: 1 } },
    { id: "rotor_glow", label: "Glow", fx: { rotorMix: 0.55, rotorSpeed: 0.4, rotorDepth: 0.55, rotorWarmth: 0.6, rotorFast: 0 } },
  ],
  spring: [
    { id: "spring_soft", label: "Soft", fx: { springMix: 0.3, springDelay: 0.2, springTension: 0.35, springDamp: 0.4, springMod: 0.15 } },
    { id: "spring_surf", label: "Surf", fx: { springMix: 0.5, springDelay: 0.35, springTension: 0.5, springDamp: 0.3, springMod: 0.35 } },
    { id: "spring_space", label: "Space", fx: { springMix: 0.65, springDelay: 0.45, springTension: 0.4, springDamp: 0.45, springMod: 0.25 } },
  ],
};

/** Merge a single-plugin preset onto current track FX (does not reset other plugins). */
export function applyEffectPluginPreset(
  base: TrackFxShape,
  pluginId: string,
  presetId: string
): TrackFxShape {
  const list = EFFECT_PLUGIN_PRESETS[pluginId];
  if (!list) return { ...base };
  const preset = list.find((p) => p.id === presetId);
  if (!preset) return { ...base };
  return { ...base, ...preset.fx };
}
