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
export const DEFAULT_ROLE_GAIN_DB: Record<VocalRole, number> = {
  lead: 0,
  double: -4.5,
  harmony_high: -7,
  harmony_mid: -6.5,
  harmony_low: -7.5,
  adlib: -5.5,
  background: -9,
  intro: -3,
  outro: -2,
};

export const DEFAULT_ROLE_WIDTH: Record<VocalRole, number> = {
  // 0 = mono center, 1 = full L/R split strength
  lead: 0,
  double: 0.25,
  harmony_high: 0.55,
  harmony_mid: 0.45,
  harmony_low: 0.4,
  adlib: 0.5,
  background: 0.65,
  intro: 0.35,
  outro: 0.45,
};

export const DEFAULT_ROLE_REVERB: Record<VocalRole, number> = {
  lead: 0.12,
  double: 0.1,
  harmony_high: 0.2,
  harmony_mid: 0.18,
  harmony_low: 0.16,
  adlib: 0.22,
  background: 0.28,
  intro: 0.3,
  outro: 0.32,
};
