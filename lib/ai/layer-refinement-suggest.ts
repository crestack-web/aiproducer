/**
 * Post-lead layer refinement: suggest plan changes from analysis + planned layers.
 * Never mutates the plan — UI must accept explicitly.
 *
 * Phrase-level fullness (full Producer Mind) needs lyrics/ASR; until that is
 * always available on the analyze path we use high-confidence proxies from
 * AudioAnalysis + section type + planned open layers so suggestions stay rare.
 */

import type { AudioAnalysis } from "@/lib/audio/analysis-types";
import { decideSectionFullness } from "@/lib/production-fullness-plan";

export type LayerRefinementSuggestion = {
  /** Stable id for dismiss de-dupe */
  id: string;
  kind: "skip_planned" | "add_unplanned";
  targetType: "DOUBLE" | "HIGH_HARMONY" | "ADLIB";
  /** Existing open task to skip (skip_planned only) */
  taskId?: string;
  message: string;
  confidence: number;
  reasoning: string;
};

export type OpenLayerRow = {
  id: string;
  type: string;
  status: string;
  section_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

function normType(t: string): string {
  return (t || "").toUpperCase().replace(/-/g, "_");
}

function isDouble(t: string) {
  return normType(t).includes("DOUBLE");
}
function isHarmony(t: string) {
  const n = normType(t);
  return n.includes("HARMONY");
}
function isAdlib(t: string) {
  const n = normType(t);
  return n.includes("ADLIB") || n.includes("AD_LIB");
}

function roleBucket(t: string): "DOUBLE" | "HIGH_HARMONY" | "ADLIB" | null {
  if (isDouble(t)) return "DOUBLE";
  if (isHarmony(t)) return "HIGH_HARMONY";
  if (isAdlib(t)) return "ADLIB";
  return null;
}

/**
 * Only when the completed task is a LEAD and phrase/section signals clearly
 * diverge from planned-but-unrecorded layers.
 */
export function suggestPostLeadLayerRefinement(opts: {
  completedTaskType: string;
  sectionType?: string | null;
  sectionLabel?: string | null;
  sectionId?: string | null;
  genre?: string | null;
  mood?: string | null;
  energyPct?: number | null;
  analysis: AudioAnalysis | null;
  /** Open (not completed/skipped) production layers on the same section */
  openPlannedLayers: OpenLayerRow[];
  /** Suggestion ids already dismissed for this section (persist client or server) */
  dismissedIds?: string[];
}): LayerRefinementSuggestion | null {
  const leadTy = normType(opts.completedTaskType);
  if (!leadTy.includes("LEAD") && leadTy !== "MAIN") return null;

  const dismissed = new Set(opts.dismissedIds || []);
  const sectionType = (opts.sectionType || "verse").toLowerCase();
  const energy =
    typeof opts.energyPct === "number" && Number.isFinite(opts.energyPct)
      ? opts.energyPct
      : sectionType.includes("chorus")
        ? 90
        : sectionType.includes("bridge")
          ? 35
          : 45;

  // Re-run section fullness with analysis-informed intimacy signal
  const a = opts.analysis;
  const quiet =
    a?.loudness?.rms != null && a.loudness.rms < 0.04
      ? true
      : a?.quality?.silenceRatio != null && a.quality.silenceRatio > 0.35;
  const shortVsWindow =
    a?.timeline?.expectedDurationMs != null &&
    a?.timeline?.actualDurationMs != null &&
    a.timeline.actualDurationMs < a.timeline.expectedDurationMs * 0.7;

  const mood = quiet || shortVsWindow ? `${opts.mood || ""},intimate` : opts.mood;

  const fullness = decideSectionFullness({
    sectionType,
    energyPct: energy,
    genre: opts.genre,
    mood,
  });

  const planned = {
    double: opts.openPlannedLayers.find((l) => isDouble(l.type)),
    harmony: opts.openPlannedLayers.find((l) => isHarmony(l.type)),
    adlib: opts.openPlannedLayers.find((l) => isAdlib(l.type)),
  };

  // High-confidence skip: plan has harmony/double but post-lead fullness says no
  // and take reads intimate/quiet
  if (planned.harmony && !fullness.harmony && (quiet || shortVsWindow || fullness.reasoning.includes("restrain"))) {
    const id = `skip:${planned.harmony.id}:harmony`;
    if (!dismissed.has(id)) {
      return {
        id,
        kind: "skip_planned",
        targetType: "HIGH_HARMONY",
        taskId: planned.harmony.id,
        message: `Now that we've heard the lead${opts.sectionLabel ? ` on ${opts.sectionLabel}` : ""}, this harmony might not be needed — want to skip it?`,
        confidence: 0.78,
        reasoning: `post_lead_skip_harmony:${fullness.reasoning}`,
      };
    }
  }

  if (planned.double && !fullness.doubles && quiet && (sectionType.includes("verse") || sectionType.includes("bridge"))) {
    const id = `skip:${planned.double.id}:double`;
    if (!dismissed.has(id)) {
      return {
        id,
        kind: "skip_planned",
        targetType: "DOUBLE",
        taskId: planned.double.id,
        message: `This lead already feels intimate — skip the planned double here?`,
        confidence: 0.76,
        reasoning: `post_lead_skip_double:${fullness.reasoning}`,
      };
    }
  }

  // High-confidence add: chorus/hook fullness wants adlib but none planned
  if (
    fullness.adlibs &&
    !planned.adlib &&
    (sectionType.includes("chorus") || sectionType.includes("hook")) &&
    !quiet
  ) {
    const id = `add:adlib:${opts.sectionId || opts.sectionLabel || "sec"}`;
    if (!dismissed.has(id)) {
      return {
        id,
        kind: "add_unplanned",
        targetType: "ADLIB",
        message: `This section might benefit from an ad-lib we didn't originally plan — add one?`,
        confidence: 0.74,
        reasoning: `post_lead_add_adlib:${fullness.reasoning}`,
      };
    }
  }

  if (fullness.harmony && !planned.harmony && sectionType.includes("chorus") && !quiet) {
    const id = `add:harmony:${opts.sectionId || opts.sectionLabel || "sec"}`;
    if (!dismissed.has(id)) {
      return {
        id,
        kind: "add_unplanned",
        targetType: "HIGH_HARMONY",
        message: `A harmony could lift this chorus — add one to the plan?`,
        confidence: 0.72,
        reasoning: `post_lead_add_harmony:${fullness.reasoning}`,
      };
    }
  }

  return null;
}
