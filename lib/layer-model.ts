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

/** Linear HTMLMediaElement volumes — DAW-style: lead is focus, stacks sit under. */
export const DEFAULT_LAYER_LINEAR_GAIN: Record<LayerRole, number> = {
  lead: 1.0,
  double: 0.62,
  doubler: 0.55,
  harmony: 0.48,
  harmony2: 0.42,
  adlib: 0.42,
  background: 0.35,
  other: 0.7,
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

/**
 * Group lead + doubles/harmonies/adlibs that belong to the SAME musical section.
 * Never key only on start_ms — layers often start mid-section and would split apart.
 */
export function sectionGroupKey(task: {
  id: string;
  section_id?: string | null;
  start_ms?: number | null;
  title?: string | null;
  metadata?: {
    section_id?: string;
    section_label?: string;
    parent_section_label?: string;
    section_type?: string;
  } | null;
}): string {
  if (task.section_id) return `s:${task.section_id}`;
  const mid = task.metadata?.section_id;
  if (mid) return `s:${mid}`;
  const label = (
    task.metadata?.parent_section_label ||
    task.metadata?.section_label ||
    task.title ||
    ""
  )
    .trim()
    .toLowerCase();
  if (label) return `label:${label}`;
  const st = (task.metadata?.section_type || "").trim().toLowerCase();
  if (st && task.start_ms != null) {
    // Coarse bucket so mid-section layers still group with the lead
    return `type:${st}:ms:${Math.round(Number(task.start_ms) / 5000) * 5000}`;
  }
  if (task.start_ms != null) return `ms:${Math.round(Number(task.start_ms) / 5000) * 5000}`;
  return `id:${task.id}`;
}

function taskSectionId(t: {
  section_id?: string | null;
  metadata?: { section_id?: string } | null;
}): string | null {
  if (t.section_id) return String(t.section_id);
  const mid = t.metadata?.section_id;
  return mid ? String(mid) : null;
}

/** True if layer task belongs to the same musical section as parent (lead or any part). */
export function sameMusicalSection(
  parent: {
    id: string;
    section_id?: string | null;
    start_ms?: number | null;
    end_ms?: number | null;
    title?: string | null;
    metadata?: {
      section_id?: string;
      section_label?: string;
      parent_section_label?: string;
      section_type?: string;
    } | null;
  },
  candidate: {
    id: string;
    section_id?: string | null;
    start_ms?: number | null;
    end_ms?: number | null;
    title?: string | null;
    metadata?: {
      section_id?: string;
      section_label?: string;
      parent_section_label?: string;
      section_type?: string;
    } | null;
  }
): boolean {
  // Strongest signal: shared section_id (never match across different ids)
  const pid = taskSectionId(parent);
  const cid = taskSectionId(candidate);
  if (pid && cid) return pid === cid;
  if (pid && !cid) {
    // candidate missing id — allow only if group key / window matches
  } else if (!pid && cid) {
    /* fall through */
  }

  if (sectionGroupKey(parent) === sectionGroupKey(candidate)) return true;

  // Time window: candidate onset must fall inside parent window (layers often start later)
  const ps = parent.start_ms != null ? Number(parent.start_ms) : null;
  const pe = parent.end_ms != null ? Number(parent.end_ms) : null;
  const cs = candidate.start_ms != null ? Number(candidate.start_ms) : null;
  const ce = candidate.end_ms != null ? Number(candidate.end_ms) : null;
  if (ps != null && pe != null && cs != null) {
    // Onset inside parent section (with small tolerance)
    if (cs >= ps - 300 && cs < pe - 200) return true;
    // Substantial overlap of ranges
    if (ce != null) {
      const overlap = Math.min(pe, ce) - Math.max(ps, cs);
      if (overlap > 1500) return true;
    }
  }

  return false;
}

export type BarRangeHint = {
  startBar?: number | null;
  endBar?: number | null;
  phraseHint?: string | null;
};

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
