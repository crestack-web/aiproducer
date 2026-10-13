/**
 * Map product choir styles → Kits royalty-free voice model IDs.
 * Defaults use documented example IDs where known; override via env:
 *   KITS_VOICE_SOPRANO, KITS_VOICE_ALTO, KITS_VOICE_TENOR, KITS_VOICE_BASS
 *   KITS_VOICE_FEMALE_*, KITS_VOICE_MALE_*
 *
 * Owners should set real IDs from GET https://arpeggi.io/api/kits/v1/voice-models
 */

import type { ChoirBalance, ChoirSectionRole, ChoirStyle } from "./types";

export type SectionSpec = {
  role: ChoirSectionRole;
  label: string;
  /** Semitone shift relative to lead (Kits pitchShift param, -24..24) */
  pitchShift: number;
  pan: number;
  gainDb: number;
  voiceEnvKey: string;
  /** Fallback numeric model id if env unset */
  defaultModelId: number;
};

function envId(key: string, fallback: number): number {
  const v = process.env[key];
  if (v && /^\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return fallback;
}

/** Documented example model from Kits quick-start (Female LoFi). */
const KITS_EXAMPLE_FEMALE = 1014961;

/**
 * Style slightly biases default model picks via env overrides only —
 * without configured env IDs, all styles share the same default IDs so
 * we never invent fake model catalogs.
 */
export function resolveSectionSpecs(opts: {
  arrangement: "light" | "medium" | "full" | "powerful";
  balance: ChoirBalance;
  harmonyIntensity: "subtle" | "moderate" | "rich";
  style: ChoirStyle;
}): SectionSpec[] {
  void opts.style;
  const harm =
    opts.harmonyIntensity === "subtle"
      ? 1
      : opts.harmonyIntensity === "moderate"
        ? 2
        : 3;

  // Unison multi-timbre doubles (0 semitones) always form the core —
  // different AI voices, same notes = real choir body without formant robots.
  const specs: SectionSpec[] = [];

  const femaleSop = envId("KITS_VOICE_SOPRANO", envId("KITS_VOICE_FEMALE_1", KITS_EXAMPLE_FEMALE));
  const femaleAlto = envId("KITS_VOICE_ALTO", envId("KITS_VOICE_FEMALE_2", KITS_EXAMPLE_FEMALE));
  const maleTenor = envId("KITS_VOICE_TENOR", envId("KITS_VOICE_MALE_1", KITS_EXAMPLE_FEMALE));
  const maleBass = envId("KITS_VOICE_BASS", envId("KITS_VOICE_MALE_2", KITS_EXAMPLE_FEMALE));

  const add = (s: SectionSpec) => specs.push(s);

  // Light: 2 doubles
  if (opts.arrangement === "light") {
    if (opts.balance !== "male") {
      add({
        role: "double",
        label: "Choir · High double",
        pitchShift: 0,
        pan: -0.45,
        gainDb: -14,
        voiceEnvKey: "KITS_VOICE_SOPRANO",
        defaultModelId: femaleSop,
      });
    }
    if (opts.balance !== "female") {
      add({
        role: "double",
        label: "Choir · Low double",
        pitchShift: 0,
        pan: 0.45,
        gainDb: -14.5,
        voiceEnvKey: "KITS_VOICE_TENOR",
        defaultModelId: maleTenor,
      });
    }
    if (opts.balance === "female") {
      add({
        role: "double",
        label: "Choir · Alto double",
        pitchShift: 0,
        pan: 0.35,
        gainDb: -14.5,
        voiceEnvKey: "KITS_VOICE_ALTO",
        defaultModelId: femaleAlto,
      });
    }
    if (opts.balance === "male") {
      add({
        role: "double",
        label: "Choir · Bass double",
        pitchShift: 0,
        pan: -0.35,
        gainDb: -15,
        voiceEnvKey: "KITS_VOICE_BASS",
        defaultModelId: maleBass,
      });
    }
  } else {
    // medium / full / powerful — SATB-ish cluster
    if (opts.balance !== "male") {
      add({
        role: "soprano",
        label: "Soprano",
        pitchShift: harm >= 2 ? 4 : 0, // ~major third when moderate+
        pan: -0.55,
        gainDb: -16,
        voiceEnvKey: "KITS_VOICE_SOPRANO",
        defaultModelId: femaleSop,
      });
      add({
        role: "alto",
        label: "Alto",
        pitchShift: harm >= 3 ? 3 : 0,
        pan: -0.25,
        gainDb: -15.5,
        voiceEnvKey: "KITS_VOICE_ALTO",
        defaultModelId: femaleAlto,
      });
    }
    if (opts.balance !== "female") {
      add({
        role: "tenor",
        label: "Tenor",
        pitchShift: harm >= 2 ? -5 : 0,
        pan: 0.3,
        gainDb: -15.5,
        voiceEnvKey: "KITS_VOICE_TENOR",
        defaultModelId: maleTenor,
      });
      add({
        role: "bass",
        label: "Bass",
        pitchShift: harm >= 2 ? -12 : 0, // octave down when moderate+
        pan: 0.55,
        gainDb: -16.5,
        voiceEnvKey: "KITS_VOICE_BASS",
        defaultModelId: maleBass,
      });
    }
    if (opts.arrangement === "full" || opts.arrangement === "powerful") {
      add({
        role: "double",
        label: "Choir · Center pad",
        pitchShift: 0,
        pan: 0,
        gainDb: opts.arrangement === "powerful" ? -13.5 : -15,
        voiceEnvKey: "KITS_VOICE_ALTO",
        defaultModelId: femaleAlto,
      });
    }
    if (opts.arrangement === "powerful" && harm >= 2) {
      add({
        role: "soprano",
        label: "Soprano · high",
        pitchShift: 7,
        pan: -0.7,
        gainDb: -17,
        voiceEnvKey: "KITS_VOICE_SOPRANO",
        defaultModelId: femaleSop,
      });
    }
  }

  return specs.map((s) => ({
    ...s,
    defaultModelId: envId(s.voiceEnvKey, s.defaultModelId),
  }));
}
