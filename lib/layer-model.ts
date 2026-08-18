/**
 * Musical sections vs recording layers.
 *
 * PlanSection (musical structure) → RecordingLayer[] → Take[]
 * AI may suggest many layers; they must NOT become independent song sections.
 */

export type LayerRole =
  | "lead"
  | "double"
  | "harmony"
  | "harmony2"
  | "adlib"
  | "background"
  | "doubler"
  | "other";

/** Linear HTMLMediaElement volumes (not dB). Lead dominates. */
export const DEFAULT_LAYER_LINEAR_GAIN: Record<LayerRole, number> = {
  lead: 1.0,
  double: 0.55,
  doubler: 0.5,
  harmony: 0.5,
  harmony2: 0.45,
  adlib: 0.45,
  background: 0.4,
  other: 0.65,
};

export function normalizeLayerRole(type: string | null | undefined): LayerRole {
  const t = (type || "").toLowerCase();
  if (t.includes("lead") || t === "main") return "lead";
  if (t.includes("double") || t.includes("doubler")) return "double";
  if (t.includes("harmony") && (t.includes("2") || t.includes("low") || t.includes("second"))) {
    return "harmony2";
  }
  if (t.includes("harmony") || t.includes("high_harmony") || t.includes("low_harmony")) {
    return "harmony";
  }
  if (t.includes("adlib") || t.includes("ad-lib") || t.includes("ad_lib")) return "adlib";
  if (t.includes("background") || t.includes("bgv") || t.includes("ooh") || t.includes("ahh")) {
    return "background";
  }
  if (t.includes("hum") || t.includes("texture") || t.includes("whisper") || t.includes("chant")) {
    return "background";
  }
  if (t.includes("call") || t.includes("response")) return "adlib";
  return "other";
}

/** Core song-section performance (must record). Everything else is a production layer. */
export function isCoreLayerRole(role: LayerRole): boolean {
  return role === "lead";
}

export function isCoreRecordingTask(task: {
  type?: string | null;
  required?: boolean | null;
}): boolean {
  const role = normalizeLayerRole(task.type);
  if (isCoreLayerRole(role)) return true;
  // Legacy: required LEAD-shaped rows without type keywords
  if (task.required && role === "other") return true;
  return false;
}

export function isProductionLayerTask(task: { type?: string | null; required?: boolean | null }): boolean {
  return !isCoreRecordingTask(task);
}

export function defaultLinearGainForTaskType(type: string | null | undefined): number {
  const role = normalizeLayerRole(type);
  return DEFAULT_LAYER_LINEAR_GAIN[role];
}

export function sectionGroupKey(task: {
  id: string;
  section_id?: string | null;
  start_ms?: number | null;
  metadata?: { section_id?: string; section_label?: string } | null;
}): string {
  if (task.section_id) return `s:${task.section_id}`;
  const mid = task.metadata?.section_id;
  if (mid) return `s:${mid}`;
  if (task.start_ms != null) return `ms:${task.start_ms}`;
  return `id:${task.id}`;
}

export type BarRangeHint = {
  startBar?: number | null;
  endBar?: number | null;
  /** Human-readable, e.g. "the last phrase" */
  phraseHint?: string | null;
};

/** Attach bar-range style hints for supporting layers (UI copy only; placement still uses ms). */
export function layerPhraseHint(role: LayerRole, sectionLabel: string): string {
  switch (role) {
    case "double":
      return `Record the same melody again across ${sectionLabel}. I'll sit it under your lead.`;
    case "harmony":
    case "harmony2":
      return `Try a softer harmony — focus on the lines that need lift (often the back half of the section).`;
    case "adlib":
      return `Add short reactions in the open spaces or on the final phrase.`;
    case "background":
      return `Soft oohs/ahhs under the main lines — stay quieter than the lead.`;
    case "doubler":
      return `A subtle double across the section for width.`;
    default:
      return `Optional layer for ${sectionLabel}. Skip anytime.`;
  }
}
