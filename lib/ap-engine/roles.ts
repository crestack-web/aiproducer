/**
 * AP vocal roles — maps existing recording task types to production hierarchy.
 * No schema change required; uses task.type / layer-model.
 */

import { normalizeLayerRole } from "@/lib/layer-model";

export type VocalRole =
  | "lead"
  | "double"
  | "harmony_high"
  | "harmony_mid"
  | "harmony_low"
  | "adlib"
  | "background"
  | "intro"
  | "outro";

export type SongSectionKind =
  | "intro"
  | "verse"
  | "pre_chorus"
  | "chorus"
  | "bridge"
  | "outro"
  | "other";

/** Hierarchy priority (lower = more focal). */
export const ROLE_PRIORITY: Record<VocalRole, number> = {
  lead: 0,
  double: 1,
  harmony_mid: 2,
  harmony_high: 3,
  harmony_low: 4,
  adlib: 5,
  background: 6,
  intro: 7,
  outro: 8,
};

export function resolveVocalRole(taskType: string | null | undefined, sectionLabel?: string | null): VocalRole {
  const t = (taskType || "").toLowerCase();
  const sec = (sectionLabel || "").toLowerCase();

  if (t.includes("intro") || (sec.includes("intro") && t.includes("lead") === false && t.includes("ad"))) {
    if (t.includes("intro")) return "intro";
  }
  if (t.includes("outro")) return "outro";

  if (t.includes("double") || t.includes("doubler")) return "double";
  if (t.includes("adlib") || t.includes("ad-lib") || t.includes("ad_lib") || t.includes("call") || t.includes("response")) {
    return "adlib";
  }
  if (t.includes("background") || t.includes("bgv") || t.includes("ooh") || t.includes("ahh") || t.includes("hum") || t.includes("texture")) {
    return "background";
  }

  // Harmonies: high / low / mid
  if (t.includes("harmony")) {
    if (t.includes("high") || t.includes("top") || t.includes("upper")) return "harmony_high";
    if (t.includes("low") || t.includes("bottom") || t.includes("bass") || t.includes("2") || t.includes("second")) {
      return "harmony_low";
    }
    // layer-model harmony2 → low-ish
    const lr = normalizeLayerRole(taskType);
    if (lr === "harmony2") return "harmony_low";
    return "harmony_mid";
  }

  if (t.includes("lead") || t === "main" || normalizeLayerRole(taskType) === "lead") return "lead";

  // Section-only cues
  if (sec.includes("outro") && !t.includes("lead")) return "outro";
  if (sec.includes("intro") && !t.includes("lead")) return "intro";

  return "lead"; // safe default for core takes
}

export function resolveSectionKind(label: string | null | undefined, type?: string | null): SongSectionKind {
  const s = `${label || ""} ${type || ""}`.toLowerCase();
  if (s.includes("pre") && s.includes("chorus")) return "pre_chorus";
  if (s.includes("chorus") || s.includes("hook")) return "chorus";
  if (s.includes("verse")) return "verse";
  if (s.includes("bridge")) return "bridge";
  if (s.includes("intro")) return "intro";
  if (s.includes("outro") || s.includes("end")) return "outro";
  return "other";
}

/** Relative gain targets vs lead (dB). Genre may adjust. */
/** Relative level vs lead — supporting layers sit clearly under. */
export const DEFAULT_ROLE_GAIN_DB: Record<VocalRole, number> = {
  lead: 0,
  double: -5.5,
  harmony_high: -8.5,
  harmony_mid: -8,
  harmony_low: -9,
  adlib: -6.5,
  background: -11,
  intro: -4,
  outro: -3,
};

/** 0 = mono center (lead), higher = wider support. */
export const DEFAULT_ROLE_WIDTH: Record<VocalRole, number> = {
  lead: 0.02,
  double: 0.32,
  harmony_high: 0.62,
  harmony_mid: 0.52,
  harmony_low: 0.48,
  adlib: 0.58,
  background: 0.72,
  intro: 0.4,
  outro: 0.5,
};

export const DEFAULT_ROLE_REVERB: Record<VocalRole, number> = {
  lead: 0.1,
  double: 0.09,
  harmony_high: 0.24,
  harmony_mid: 0.2,
  harmony_low: 0.18,
  adlib: 0.26,
  background: 0.34,
  intro: 0.32,
  outro: 0.36,
};
