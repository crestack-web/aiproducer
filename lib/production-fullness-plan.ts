/**
 * Pre-recording, section-level fullness → layer task types.
 *
 * Produce-time fullness (phrase-level, needs lead vocal) stays in ap-engine.
 * Here we only use song/section shape (type, energy, genre, mood) so the booth
 * plan can be built before any take exists. candidateLayers() remains the
 * safety-net fallback when this path is empty or disabled.
 */

import type { ProductionTaskType } from "@/lib/production-planner";

export type SectionFullnessDecision = {
  doubles: boolean;
  harmony: boolean;
  adlibs: boolean;
  reasoning: string;
  source: "section_fullness";
};

type LayerSpec = { type: ProductionTaskType; required: boolean; priority: number };

/**
 * Section-level fullness (no audio / no lyrics). Mirrors restraint of
 * decideFullnessForPhrase: sparse verses, fuller choruses.
 */
export function decideSectionFullness(opts: {
  sectionType: string;
  energyPct: number;
  genre?: string | null;
  mood?: string | null;
}): SectionFullnessDecision {
  const st = (opts.sectionType || "").toLowerCase().replace(/\s+/g, "_");
  const energy = opts.energyPct;
  const genre = (opts.genre || "").toLowerCase();
  const mood = (opts.mood || "").toLowerCase();
  const intimate =
    mood.includes("intimate") ||
    mood.includes("sad") ||
    mood.includes("vulnerable") ||
    mood.includes("quiet");

  if (st === "intro" || st === "outro") {
    return {
      doubles: false,
      harmony: false,
      adlibs: st === "intro" && genre.includes("hip"),
      reasoning: "edge_section_sparse",
      source: "section_fullness",
    };
  }

  if (st === "verse" || st === "bridge") {
    // Restraint: rarely stack on vulnerable sections
    if (intimate || energy < 50) {
      return {
        doubles: false,
        harmony: false,
        adlibs: energy >= 45 && st === "verse",
        reasoning: "verse_bridge_restrain",
        source: "section_fullness",
      };
    }
    return {
      doubles: false,
      harmony: st === "bridge" && energy >= 40,
      adlibs: energy >= 55,
      reasoning: "verse_bridge_light",
      source: "section_fullness",
    };
  }

  if (st === "pre_chorus" || st === "prechorus") {
    return {
      doubles: energy >= 55,
      harmony: energy >= 60,
      adlibs: false,
      reasoning: "pre_chorus_build",
      source: "section_fullness",
    };
  }

  if (st === "chorus" || st === "hook" || st === "drop") {
    if (intimate && energy < 70) {
      return {
        doubles: true,
        harmony: false,
        adlibs: false,
        reasoning: "chorus_intimate_double_only",
        source: "section_fullness",
      };
    }
    return {
      doubles: true,
      harmony: !genre.includes("hip"),
      adlibs: energy >= 75 || genre.includes("hip") || genre.includes("afro"),
      reasoning: "chorus_widen",
      source: "section_fullness",
    };
  }

  // Default unknown section types
  return {
    doubles: energy >= 80,
    harmony: energy >= 85,
    adlibs: false,
    reasoning: "default_energy",
    source: "section_fullness",
  };
}

/** Convert fullness flags into the same LayerSpec shape as candidateLayers (lead separate). */
export function layerSpecsFromSectionFullness(
  decision: SectionFullnessDecision,
  sectionType: string
): LayerSpec[] {
  const specs: LayerSpec[] = [];
  if (decision.doubles) {
    specs.push({ type: "DOUBLE", required: false, priority: 80 });
  }
  if (decision.harmony) {
    specs.push({ type: "HIGH_HARMONY", required: false, priority: 70 });
  }
  if (decision.adlibs) {
    const st = (sectionType || "").toLowerCase();
    if (st === "intro") {
      specs.push({ type: "ADLIB", required: false, priority: 40 });
    } else {
      specs.push({ type: "ADLIB", required: false, priority: 55 });
    }
  }
  return specs;
}
