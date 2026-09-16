import type { ProductionDirection } from "./types";
import { validateDirection } from "./validate";

function mergeNums(
  a?: number,
  b?: number,
  mode: "avg" | "latest" = "avg"
): number | undefined {
  if (a == null && b == null) return undefined;
  if (a == null) return b;
  if (b == null) return a;
  if (mode === "latest") return b;
  // Soft compose toward latest
  return Math.max(-1, Math.min(1, a * 0.35 + b * 0.65));
}

function mergeRecord(
  base?: Record<string, number | undefined>,
  next?: Record<string, number | undefined>
): Record<string, number | undefined> | undefined {
  if (!base && !next) return undefined;
  const keys = new Set([
    ...Object.keys(base || {}),
    ...Object.keys(next || {}),
  ]);
  const out: Record<string, number | undefined> = {};
  for (const k of keys) {
    out[k] = mergeNums(base?.[k], next?.[k]);
  }
  return out;
}

/**
 * Compose directions. Later more-specific role/section keys override softly.
 * Explicit role width overrides generic space.width for that role.
 */
export function mergeProductionDirection(
  existing: ProductionDirection | null | undefined,
  incoming: ProductionDirection
): ProductionDirection {
  const a = existing || {};
  const b = incoming || {};

  const sections: ProductionDirection["sections"] = { ...(a.sections || {}) };
  if (b.sections) {
    for (const [k, v] of Object.entries(b.sections)) {
      sections[k] = {
        energy: mergeNums(sections[k]?.energy, v.energy),
        width: mergeNums(sections[k]?.width, v.width),
        space: mergeNums(sections[k]?.space, v.space),
        intimacy: mergeNums(sections[k]?.intimacy, v.intimacy),
      };
    }
  }

  const roles: ProductionDirection["roles"] = { ...(a.roles || {}) };
  if (b.roles) {
    for (const [k, v] of Object.entries(b.roles)) {
      roles[k] = {
        presence: mergeNums(roles[k]?.presence, v.presence, "latest"),
        width: mergeNums(roles[k]?.width, v.width, "latest"),
        space: mergeNums(roles[k]?.space, v.space, "latest"),
      };
    }
  }

  const merged: ProductionDirection = {
    vocal: mergeRecord(
      a.vocal as Record<string, number | undefined>,
      b.vocal as Record<string, number | undefined>
    ) as ProductionDirection["vocal"],
    layers: mergeRecord(
      a.layers as Record<string, number | undefined>,
      b.layers as Record<string, number | undefined>
    ) as ProductionDirection["layers"],
    space: mergeRecord(
      a.space as Record<string, number | undefined>,
      b.space as Record<string, number | undefined>
    ) as ProductionDirection["space"],
    arrangement: mergeRecord(
      a.arrangement as Record<string, number | undefined>,
      b.arrangement as Record<string, number | undefined>
    ) as ProductionDirection["arrangement"],
    beatIntegration: mergeRecord(
      a.beatIntegration as Record<string, number | undefined>,
      b.beatIntegration as Record<string, number | undefined>
    ) as ProductionDirection["beatIntegration"],
    dynamics: mergeRecord(
      a.dynamics as Record<string, number | undefined>,
      b.dynamics as Record<string, number | undefined>
    ) as ProductionDirection["dynamics"],
    character: mergeRecord(
      a.character as Record<string, number | undefined>,
      b.character as Record<string, number | undefined>
    ) as ProductionDirection["character"],
    sections: Object.keys(sections).length ? sections : undefined,
    roles: Object.keys(roles).length ? roles : undefined,
    references: { ...(a.references || {}), ...(b.references || {}) },
    scope: {
      sections: Array.from(
        new Set([...(a.scope?.sections || []), ...(b.scope?.sections || [])])
      ),
      roles: Array.from(
        new Set([...(a.scope?.roles || []), ...(b.scope?.roles || [])])
      ),
    },
    confidence: Math.max(a.confidence || 0, b.confidence || 0),
    sourcePrompt: b.sourcePrompt || a.sourcePrompt,
    plainSummary: b.plainSummary || a.plainSummary,
    updatedAt: new Date().toISOString(),
  };

  return validateDirection(merged);
}
