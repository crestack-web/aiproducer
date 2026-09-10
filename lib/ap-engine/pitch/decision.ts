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

function roleStrengthMul(role: VocalRole): number {
  switch (role) {
    case "lead":
      return 1;
    case "double":
      return 1.25;
    case "harmony_high":
    case "harmony_mid":
    case "harmony_low":
      return 1.3;
    case "background":
      return 1.2;
    case "adlib":
      return 0.75;
    case "intro":
    case "outro":
      return 0.6;
    default:
      return 1;
  }
}

function roleTiming(role: VocalRole): number {
  switch (role) {
    case "lead":
      return 0.15;
    case "double":
      return 0.55;
    case "harmony_high":
    case "harmony_mid":
    case "harmony_low":
      return 0.5;
    case "background":
      return 0.45;
    case "adlib":
      return 0.2;
    default:
      return 0.1;
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

  let strength = strengthForProfile(profile) * roleStrengthMul(role);
  if (g.preserveDynamics > 0.65 && role === "lead") {
    strength *= 0.75;
    notes.push("preserve_dynamics");
  }
  strength = Math.max(0.15, Math.min(0.95, strength));
  const maxCents =
    profile === "natural" ? 45 : profile === "polished" ? 70 : profile === "tight" ? 100 : 120;

  return {
    enabled: true,
    correctionProfile: profile,
    correctionStrength: strength,
    preserveSlides: profile !== "creative",
    preserveVibrato: true,
    timingTightness: roleTiming(role) * (profile === "tight" ? 1.15 : 1),
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
