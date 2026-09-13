import type { DecisionMapVersion, TweakHistory, InterpretedEdit, SectionAdjustment } from "./types";

export function emptyHistory(): TweakHistory {
  return { versions: [], currentVersion: 0 };
}

export function parseHistory(raw: unknown): TweakHistory {
  if (!raw || typeof raw !== "object") return emptyHistory();
  const h = raw as TweakHistory;
  if (!Array.isArray(h.versions)) return emptyHistory();
  return {
    versions: h.versions,
    currentVersion: typeof h.currentVersion === "number" ? h.currentVersion : 0,
  };
}

export function pushVersion(
  history: TweakHistory,
  opts: {
    prompt?: string | null;
    edits: InterpretedEdit[];
    summary: string;
    sectionAdjustments: SectionAdjustment[];
  }
): TweakHistory {
  // Drop any redo branch
  const versions = history.versions.slice(0, history.currentVersion);
  const version = versions.length + 1;
  const entry: DecisionMapVersion = {
    version,
    at: new Date().toISOString(),
    prompt: opts.prompt ?? null,
    edits: opts.edits,
    summary: opts.summary,
    sectionAdjustments: opts.sectionAdjustments,
  };
  versions.push(entry);
  return { versions, currentVersion: versions.length };
}

export function revertTo(
  history: TweakHistory,
  version: number
): TweakHistory | null {
  if (version < 0 || version > history.versions.length) return null;
  return { ...history, currentVersion: version };
}

export function currentAdjustments(history: TweakHistory): SectionAdjustment[] {
  if (history.currentVersion <= 0) return [];
  const v = history.versions[history.currentVersion - 1];
  return v?.sectionAdjustments || [];
}
