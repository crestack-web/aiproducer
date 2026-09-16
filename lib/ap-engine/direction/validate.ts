import type { ProductionDirection } from "./types";

/** Soft relative unit used in direction deltas */
export function clampUnit(n: number, lo = -1, hi = 1): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, n));
}

/** Hard safety clamps before DSP application */
export function validateDirection(d: ProductionDirection): ProductionDirection {
  const out: ProductionDirection = JSON.parse(JSON.stringify(d || {}));
  const clampField = (obj: Record<string, unknown> | undefined, keys: string[]) => {
    if (!obj) return;
    for (const k of keys) {
      if (typeof obj[k] === "number") obj[k] = clampUnit(obj[k] as number);
    }
  };
  clampField(out.vocal as Record<string, unknown>, [
    "leadPresence",
    "intimacy",
    "brightness",
    "warmth",
    "density",
    "aggression",
  ]);
  clampField(out.layers as Record<string, unknown>, [
    "doubles",
    "harmonies",
    "adlibs",
    "backgrounds",
  ]);
  clampField(out.space as Record<string, unknown>, [
    "dryness",
    "width",
    "ambience",
    "delay",
    "reverb",
  ]);
  clampField(out.arrangement as Record<string, unknown>, [
    "verseEnergy",
    "chorusEnergy",
    "bridgeEnergy",
    "introAtmosphere",
    "outroAtmosphere",
  ]);
  clampField(out.beatIntegration as Record<string, unknown>, [
    "vocalForwardness",
    "beatRespect",
    "masking",
    "ducking",
  ]);
  clampField(out.dynamics as Record<string, unknown>, [
    "vocalDynamics",
    "punch",
    "softness",
  ]);
  clampField(out.character as Record<string, unknown>, [
    "intimate",
    "polished",
    "raw",
    "atmospheric",
    "energetic",
  ]);
  if (out.sections) {
    for (const k of Object.keys(out.sections)) {
      clampField(out.sections[k] as Record<string, unknown>, [
        "energy",
        "width",
        "space",
        "intimacy",
      ]);
    }
  }
  if (out.roles) {
    for (const k of Object.keys(out.roles)) {
      clampField(out.roles[k] as Record<string, unknown>, [
        "presence",
        "width",
        "space",
      ]);
    }
  }
  if (typeof out.confidence === "number") {
    out.confidence = clampUnit(out.confidence, 0, 1);
  }
  return out;
}
