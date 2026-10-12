/**
 * Section-based dynamic riding scaled by vibe profile.
 * Verses: intimate, drier, less width/air.
 * Choruses: wider, more air, support stacks open outward.
 */
import { applyEqStereo, applyGainStereo, dbToGain } from "../dsp";
import { applyWidth } from "../mix/width";
import type { PcmStereo } from "../types";
import type { VocalRole } from "../roles";
import type { ResolvedVibe } from "./resolveVibeContext";

export type SectionKind =
  | "intro"
  | "verse"
  | "prechorus"
  | "chorus"
  | "bridge"
  | "outro"
  | "unknown";

export function classifySectionLabel(label?: string | null): SectionKind {
  const s = String(label || "").toLowerCase();
  if (/pre[\s_-]?chorus|prechorus|build/.test(s)) return "prechorus";
  if (/chorus|hook|drop|refrain/.test(s)) return "chorus";
  if (/verse|v\d/.test(s)) return "verse";
  if (/bridge/.test(s)) return "bridge";
  if (/intro/.test(s)) return "intro";
  if (/outro|end/.test(s)) return "outro";
  return "unknown";
}

/**
 * Apply vibe-aware section ride on a single layer (after role/vibe baseline EQ).
 */
export function applyVibeSectionRide(
  pcm: PcmStereo,
  opts: {
    sectionLabel?: string | null;
    role: VocalRole;
    vibe: ResolvedVibe;
  }
): { section: SectionKind; notes: string[] } {
  const section = classifySectionLabel(opts.sectionLabel);
  const notes: string[] = [`section:${section}`, `vibe:${opts.vibe.vibeKey}`];
  const isLead = opts.role === "lead";
  const isSupport =
    opts.role === "double" ||
    opts.role.startsWith("harmony") ||
    opts.role === "adlib" ||
    opts.role === "background";

  // Base section intent
  let airDb = 0;
  let widthAdd = 0;
  let gainDb = 0;
  let mudDb = 0;

  switch (section) {
    case "verse":
      // Intimate: pull air, tighten width, slight presence control
      airDb = -0.8 - opts.vibe.verseIntimacyDb * 0.25;
      widthAdd = -0.08 * opts.vibe.stereoWidthMultiplier;
      gainDb = isLead ? 0 : -0.4;
      mudDb = opts.vibe.vibeKey === "intimate_warm" ? 0.3 : 0;
      notes.push("verse:intimate_dry");
      break;
    case "prechorus":
      airDb = 0.4;
      widthAdd = 0.06 * opts.vibe.stereoWidthMultiplier;
      gainDb = 0.3;
      notes.push("pre:build");
      break;
    case "chorus":
      // Open the stage: air + width + support outward
      airDb = 1.0 + Math.min(0.5, opts.vibe.leadAirShelfDb * 0.15);
      if (opts.vibe.vibeKey === "punchy_forward" || opts.vibe.vibeKey === "polished_pop") {
        airDb += 0.35;
      }
      widthAdd =
        0.12 * opts.vibe.stereoWidthMultiplier +
        (isSupport ? 0.1 * opts.vibe.stereoWidthMultiplier : 0);
      gainDb = isLead
        ? 0.35 + opts.vibe.chorusEnergyBoostDb * 0.15
        : 0.5 + opts.vibe.chorusEnergyBoostDb * 0.2;
      notes.push("chorus:open_stage");
      break;
    case "bridge":
      airDb = -0.3;
      widthAdd = 0.04;
      gainDb = -0.5;
      notes.push("bridge:pull_back");
      break;
    case "intro":
    case "outro":
      airDb = 0.2;
      widthAdd = 0.08 * opts.vibe.reverbDecayModifier;
      gainDb = -0.3;
      notes.push(`${section}:atmosphere`);
      break;
    default:
      notes.push("section:neutral");
      return { section, notes };
  }

  // Ethereal: more width everywhere; Raw: less aggressive rides
  if (opts.vibe.vibeKey === "ethereal_dreamy") {
    widthAdd *= 1.25;
    airDb += 0.3;
  }
  if (opts.vibe.vibeKey === "raw_soulful") {
    airDb *= 0.55;
    gainDb *= 0.5;
    widthAdd *= 0.6;
  }

  // Apply EQ (air / mud)
  const bands: {
    type: "peak" | "highshelf" | "lowshelf";
    freq: number;
    gainDb: number;
    q: number;
  }[] = [];
  if (Math.abs(airDb) > 0.05) {
    bands.push({ type: "highshelf", freq: 10000, gainDb: airDb, q: 0.7 });
  }
  if (Math.abs(mudDb) > 0.05) {
    bands.push({ type: "peak", freq: 280, gainDb: mudDb, q: 0.85 });
  }
  // Chorus: slight presence lift on lead only so hierarchy stays clear
  if (section === "chorus" && isLead) {
    bands.push({
      type: "peak",
      freq: 2800,
      gainDb: 0.6 + opts.vibe.leadPresenceBoostDb * 0.1,
      q: 1.0,
    });
  }
  // Verse: slight presence hold without harshness
  if (section === "verse" && isLead) {
    bands.push({ type: "peak", freq: 2500, gainDb: 0.35, q: 1.0 });
  }
  if (bands.length) applyEqStereo(pcm, bands);

  if (Math.abs(gainDb) > 0.05) {
    applyGainStereo(pcm, dbToGain(gainDb));
  }

  if (Math.abs(widthAdd) > 0.02) {
    try {
      applyWidth(pcm, Math.max(-0.2, Math.min(0.55, widthAdd)), 0);
    } catch {
      /* optional */
    }
  }

  return { section, notes };
}
