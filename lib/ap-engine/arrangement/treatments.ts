import type { SectionType, VocalTreatment } from "./types";

/**
 * Deterministic section treatments — modest, musical, not crushed.
 * Final chorus gets a small extra lift.
 */
export function treatmentFor(
  type: SectionType,
  opts?: { isFinalChorus?: boolean; energy?: number }
): VocalTreatment {
  const base: Record<SectionType, VocalTreatment> = {
    intro: {
      gainDb: -1.5,
      width: 0.12,
      reverb: 0.18,
      delay: 0.05,
      compression: 0.35,
      brightnessDb: -0.8,
      double: false,
      delayThrow: false,
    },
    verse: {
      gainDb: 0,
      width: 0.14,
      reverb: 0.16,
      delay: 0.04,
      compression: 0.45,
      brightnessDb: 0,
      double: false,
      delayThrow: false,
    },
    prechorus: {
      gainDb: 0.6,
      width: 0.22,
      reverb: 0.24,
      delay: 0.08,
      compression: 0.5,
      brightnessDb: 0.4,
      double: false,
      delayThrow: false,
    },
    chorus: {
      gainDb: 1.4,
      width: 0.42,
      reverb: 0.36,
      delay: 0.12,
      compression: 0.4,
      brightnessDb: 0.8,
      double: true,
      delayThrow: true,
    },
    bridge: {
      gainDb: -0.8,
      width: 0.2,
      reverb: 0.32,
      delay: 0.1,
      compression: 0.3,
      brightnessDb: -0.5,
      double: false,
      delayThrow: false,
    },
    outro: {
      gainDb: -0.5,
      width: 0.28,
      reverb: 0.4,
      delay: 0.14,
      compression: 0.35,
      brightnessDb: -0.3,
      double: false,
      delayThrow: false,
    },
  };

  const t = { ...base[type] };
  if (type === "chorus" && opts?.isFinalChorus) {
    t.gainDb += 0.5;
    t.width = Math.min(0.55, t.width + 0.08);
    t.reverb = Math.min(0.5, t.reverb + 0.06);
    t.brightnessDb += 0.3;
  }
  // Slight energy scaling (±0.4 dB)
  if (typeof opts?.energy === "number") {
    t.gainDb += (opts.energy - 0.5) * 0.8;
  }
  return t;
}
