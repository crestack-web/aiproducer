import type { VocalRole } from "../roles";
import { resolveGenreProfile } from "../profiles/genre-profiles";
import { nearestScaleMidi } from "./scale";
import { midiToHz } from "./detector";
import type {
  CorrectionProfile,
  DetectedNote,
  NotePitchDecision,
  PitchAnalysisResult,
  VocalPolishDecision,
} from "./types";

function profileForGenre(genre?: string | null): CorrectionProfile {
  const id = resolveGenreProfile(genre).id;
  if (id === "ballad" || id === "rnb" || id === "afro_rnb") return "natural";
  if (id === "pop" || id === "trap") return "tight";
  return "polished";
}

function strengthForProfile(p: CorrectionProfile): number {
  switch (p) {
    case "natural":
      return 0.35;
    case "polished":
      return 0.55;
    case "tight":
      return 0.75;
    case "creative":
      return 0.85;
    default:
      return 0.55;
  }
}

/**
 * Pitch correction strength by role.
 * Choir/harmony/background MUST stay near zero — human drift is the organic mass.
 * Heavy auto-tune on stacks causes phasey comb-filter / "Cher" robot tone.
 */
function roleStrengthMul(role: VocalRole): number {
  switch (role) {
    case "lead":
      return 1;
    case "double":
      return 0.35; // light tighten only; doubles still need some human lag
    case "harmony_high":
    case "harmony_mid":
    case "harmony_low":
      return 0.08; // effectively off — preserve micro-drift
    case "background":
      return 0; // full bypass
    case "adlib":
      return 0.55;
    case "intro":
    case "outro":
      return 0.4;
    default:
      return 1;
  }
}

/**
 * Timing quantize by role — choir relies on micro-timing variation for size.
 */
function roleTiming(role: VocalRole): number {
  switch (role) {
    case "lead":
      return 0.15;
    case "double":
      return 0.12;
    case "harmony_high":
    case "harmony_mid":
    case "harmony_low":
    case "background":
      return 0; // never grid-lock stacks
    case "adlib":
      return 0.1;
    default:
      return 0.05;
  }
}

export function decideVocalPolish(opts: {
  analysis: PitchAnalysisResult;
  role: VocalRole;
  genre?: string | null;
  forceProfile?: CorrectionProfile;
}): VocalPolishDecision {
  const { analysis, role, genre } = opts;
  const profile = opts.forceProfile || profileForGenre(genre);
  const g = resolveGenreProfile(genre);
  const notes: string[] = [`profile:${profile}`, `role:${role}`, `genre:${g.id}`];

  if (analysis.likelySpoken) {
    notes.push("spoken_protect");
    return {
      enabled: false,
      correctionProfile: profile,
      correctionStrength: 0,
      preserveSlides: true,
      preserveVibrato: true,
      timingTightness: 0,
      formantPreservation: true,
      confidenceThreshold: 0.55,
      maxCorrectionCents: 0,
      keyMidiRoot: analysis.keyMidiRoot,
      scale: analysis.scale,
      notes,
    };
  }

  if (analysis.meanConfidence < 0.35 || analysis.voicedRatio < 0.08) {
    notes.push("low_confidence_disable");
    return {
      enabled: false,
      correctionProfile: profile,
      correctionStrength: 0,
      preserveSlides: true,
      preserveVibrato: true,
      timingTightness: 0,
      formantPreservation: true,
      confidenceThreshold: 0.55,
      maxCorrectionCents: 0,
      keyMidiRoot: analysis.keyMidiRoot,
      scale: analysis.scale,
      notes,
    };
  }

  const roleMul = roleStrengthMul(role);
  // Choir / background / harmony: hard-disable pitch+timing polish
  if (roleMul < 0.05 || role === "background") {
    notes.push("choir_protect_no_pitch", "organic_drift");
    return {
      enabled: false,
      correctionProfile: "natural",
      correctionStrength: 0,
      preserveSlides: true,
      preserveVibrato: true,
      timingTightness: 0,
      formantPreservation: true,
      confidenceThreshold: 0.55,
      maxCorrectionCents: 0,
      keyMidiRoot: analysis.keyMidiRoot,
      scale: analysis.scale,
      notes,
    };
  }

  let strength = strengthForProfile(profile) * roleMul;
  if (g.preserveDynamics > 0.65 && role === "lead") {
    strength *= 0.75;
    notes.push("preserve_dynamics");
  }
  if (role.startsWith("harmony") || role === "double") {
    strength = Math.min(strength, 0.28);
    notes.push("stack_light_pitch");
  }
  strength = Math.max(0, Math.min(0.95, strength));
  if (strength < 0.12) {
    notes.push("pitch_disabled_low_strength");
    return {
      enabled: false,
      correctionProfile: profile,
      correctionStrength: 0,
      preserveSlides: true,
      preserveVibrato: true,
      timingTightness: 0,
      formantPreservation: true,
      confidenceThreshold: 0.55,
      maxCorrectionCents: 0,
      keyMidiRoot: analysis.keyMidiRoot,
      scale: analysis.scale,
      notes,
    };
  }

  const maxCents =
    role.startsWith("harmony") || role === "double"
      ? 18
      : profile === "natural"
        ? 45
        : profile === "polished"
          ? 70
          : profile === "tight"
            ? 100
            : 120;

  return {
    enabled: true,
    correctionProfile: profile,
    correctionStrength: strength,
    preserveSlides: true,
    preserveVibrato: true,
    timingTightness: roleTiming(role) * (profile === "tight" ? 1.05 : 1),
    formantPreservation: true,
    confidenceThreshold: role === "adlib" ? 0.5 : 0.4,
    maxCorrectionCents: maxCents,
    keyMidiRoot: analysis.keyMidiRoot,
    scale: analysis.scale,
    notes,
  };
}

export function decideNoteCorrections(
  notes: DetectedNote[],
  polish: VocalPolishDecision
): NotePitchDecision[] {
  if (!polish.enabled) {
    return notes.map((_, i) => ({
      noteIndex: i,
      targetMidiNote: null,
      correctionCents: 0,
      correctionStrength: 0,
      preserveVibrato: true,
      preserveSlide: true,
      confidence: 0,
      reason: "polish_disabled",
      skip: true,
    }));
  }

  return notes.map((note, i) => {
    if (note.confidence < polish.confidenceThreshold) {
      return {
        noteIndex: i,
        targetMidiNote: null,
        correctionCents: 0,
        correctionStrength: 0,
        preserveVibrato: true,
        preserveSlide: true,
        confidence: note.confidence,
        reason: "low_note_confidence",
        skip: true,
      };
    }
    if (note.endTime - note.startTime < 0.06) {
      return {
        noteIndex: i,
        targetMidiNote: null,
        correctionCents: 0,
        correctionStrength: 0,
        preserveVibrato: true,
        preserveSlide: true,
        confidence: note.confidence,
        reason: "too_short",
        skip: true,
      };
    }

    const target = nearestScaleMidi(note.midiNote, polish.keyMidiRoot, polish.scale);
    const targetHz = midiToHz(target);
    let cents = 1200 * Math.log2(targetHz / note.frequencyHz);
    if (Math.abs(cents) > polish.maxCorrectionCents) {
      cents = Math.sign(cents) * polish.maxCorrectionCents;
    }

    if (note.isSlide && polish.preserveSlides) {
      const soft = Math.max(-25, Math.min(25, cents * 0.35 * polish.correctionStrength));
      return {
        noteIndex: i,
        targetMidiNote: target,
        correctionCents: soft,
        correctionStrength: polish.correctionStrength * 0.35,
        preserveVibrato: true,
        preserveSlide: true,
        confidence: note.confidence,
        reason: "slide_preserve_soft_center",
        skip: Math.abs(soft) < 4,
      };
    }

    if (note.pitchDeviationCents < 12 && note.pitchStability > 0.7) {
      return {
        noteIndex: i,
        targetMidiNote: target,
        correctionCents: cents * 0.15 * polish.correctionStrength,
        correctionStrength: polish.correctionStrength * 0.2,
        preserveVibrato: true,
        preserveSlide: true,
        confidence: note.confidence,
        reason: "already_stable",
        skip: Math.abs(cents) < 8,
      };
    }

    let strength = polish.correctionStrength;
    if (note.hasVibrato && polish.preserveVibrato) strength *= 0.7;

    return {
      noteIndex: i,
      targetMidiNote: target,
      correctionCents: cents * strength,
      correctionStrength: strength,
      preserveVibrato: polish.preserveVibrato && note.hasVibrato,
      preserveSlide: false,
      confidence: note.confidence,
      reason: note.hasVibrato ? "center_with_vibrato" : "standard_correct",
      skip: Math.abs(cents * strength) < 5,
    };
  });
}
