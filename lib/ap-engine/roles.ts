/**
 * AP vocal roles — maps existing recording task types to production hierarchy.
 * No schema change required; uses task.type / layer-model.
 */

import { normalizeLayerRole } from "@/lib/layer-model";

/** Coerce DB/json values to string before .includes / .toLowerCase */
function asStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(asStr).filter(Boolean).join(" ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["name", "label", "type", "value", "id", "title"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }
  return "";
}

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

/**
 * Map recording_tasks.type (and titles) → mix hierarchy.
 * Covers AP-generated plan types (toDbTaskType lowercases ProductionTaskType):
 *   lead, double, high_harmony, low_harmony, background, adlib, hum, texture,
 *   whisper, call_response, chant, sustain, intro_vocal, outro_vocal, …
 * plus Console uploads / choir stack labels.
 */
export function resolveVocalRole(taskType: string | null | undefined, sectionLabel?: string | null): VocalRole {
  const t = asStr(taskType).toLowerCase().replace(/-/g, "_");
  const sec = asStr(sectionLabel).toLowerCase();
  const blob = `${t} ${sec}`;

  // Intro / outro plan types (intro_vocal, outro_vocal)
  if (t === "intro_vocal" || (t.includes("intro") && !t.includes("lead"))) return "intro";
  if (t === "outro_vocal" || (t.includes("outro") && !t.includes("lead"))) return "outro";

  // Doubles
  if (t.includes("double") || t.includes("doubler") || t.includes("dub")) return "double";

  // Adlibs / call-response / chants
  if (
    t.includes("adlib") ||
    t.includes("ad_lib") ||
    t.includes("call_response") ||
    t.includes("call") ||
    t.includes("response") ||
    t.includes("riff") ||
    t.includes("chant")
  ) {
    return "adlib";
  }

  // Background / texture family (plan: BACKGROUND, HUM, TEXTURE, WHISPER, SUSTAIN)
  if (
    t.includes("background") ||
    t.includes("bgv") ||
    t.includes("ooh") ||
    t.includes("ahh") ||
    t.includes("hum") ||
    t.includes("texture") ||
    t.includes("whisper") ||
    t.includes("sustain") ||
    t.includes("choir") ||
    t.includes("stack") ||
    t.includes("pad")
  ) {
    return "background";
  }

  // Harmonies — high_harmony / low_harmony / harmony
  if (t.includes("harmony") || t.includes("harm") || t === "hype") {
    if (t.includes("high") || t.includes("top") || t.includes("upper")) return "harmony_high";
    if (t.includes("low") || t.includes("bottom") || t.includes("bass") || t.includes("2") || t.includes("second")) {
      return "harmony_low";
    }
    const lr = normalizeLayerRole(taskType);
    if (lr === "harmony2") return "harmony_low";
    return "harmony_mid";
  }

  // Lead / main / emotional take
  if (
    t.includes("lead") ||
    t === "main" ||
    t.includes("melody") ||
    t.includes("emotional_take") ||
    t === "spoken" ||
    normalizeLayerRole(taskType) === "lead"
  ) {
    return "lead";
  }

  // Title / section cues when type is generic ("custom", "vocal", "upload")
  if (blob.includes("double") || blob.includes("dub")) return "double";
  if (blob.includes("adlib") || blob.includes("ad_lib") || blob.includes("call")) return "adlib";
  if (
    blob.includes("harmon") ||
    blob.includes("bgv") ||
    blob.includes("choir") ||
    blob.includes("backing") ||
    blob.includes("whisper") ||
    blob.includes("hum")
  ) {
    if (blob.includes("high") || blob.includes("top")) return "harmony_high";
    if (blob.includes("low") || blob.includes("bottom")) return "harmony_low";
    if (
      blob.includes("background") ||
      blob.includes("choir") ||
      blob.includes("bgv") ||
      blob.includes("backing") ||
      blob.includes("whisper") ||
      blob.includes("hum")
    ) {
      return "background";
    }
    return "harmony_mid";
  }
  if (sec.includes("outro") && !t.includes("lead")) return "outro";
  if (sec.includes("intro") && !t.includes("lead")) return "intro";

  return "lead"; // safe default for core takes
}

/** Stereo pan bias by role (−1 left … +1 right). Leads stay center. */
export const DEFAULT_ROLE_PAN: Record<VocalRole, number> = {
  lead: 0,
  double: -0.22,
  harmony_high: 0.48,
  harmony_mid: 0.28,
  harmony_low: -0.42,
  adlib: 0.32,
  background: -0.12,
  intro: 0.08,
  outro: -0.08,
};

export function resolveSectionKind(label: string | null | undefined, type?: string | null): SongSectionKind {
  const s = `${asStr(label)} ${asStr(type)}`.toLowerCase();
  if (s.includes("pre") && s.includes("chorus")) return "pre_chorus";
  if (s.includes("chorus") || s.includes("hook")) return "chorus";
  if (s.includes("verse")) return "verse";
  if (s.includes("bridge")) return "bridge";
  if (s.includes("intro")) return "intro";
  if (s.includes("outro") || s.includes("end")) return "outro";
  return "other";
}

/**
 * Relative level vs lead — supporting layers sit clearly under.
 * Choir / background protection: stacks must never compete with the lead.
 */
export const DEFAULT_ROLE_GAIN_DB: Record<VocalRole, number> = {
  lead: 0,
  double: -7.5,
  // Generated / stacked harmonies: bed only — never near lead
  harmony_high: -14,
  harmony_mid: -13.5,
  harmony_low: -14.5,
  adlib: -8,
  // True background / Stack choir: almost unnoticeable unless you listen for it
  background: -20,
  intro: -4,
  outro: -3,
};

/**
 * 0 = mono center (lead), higher = wider support.
 * Choir protection: keep background width moderate to avoid phase-y mono collapse.
 */
export const DEFAULT_ROLE_WIDTH: Record<VocalRole, number> = {
  lead: 0.02,
  double: 0.32,
  harmony_high: 0.55,
  harmony_mid: 0.48,
  harmony_low: 0.45,
  adlib: 0.55,
  background: 0.52,
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
