import type { VocalSectionType, VocalTreatment } from "./types";

/**
 * Deterministic section treatments. Low confidence → conservative (verse-like).
 */
export function treatmentFor(
  type: VocalSectionType,
  opts?: { isFinalChorus?: boolean; energy?: number; confidence?: number }
): VocalTreatment {
  const conf = opts?.confidence ?? 0.6;

  const base: Record<VocalSectionType, VocalTreatment> = {
    intro: {
      gainDb: -1.2,
      width: 0.1,
      reverb: 0.14,
      delay: 0.04,
      compression: 0.35,
      brightnessDb: -0.6,
      double: false,
      delayThrow: false,
    },
    verse: {
      gainDb: 0,
      width: 0.12,
      reverb: 0.14,
      delay: 0.03,
      compression: 0.45,
      brightnessDb: 0,
      double: false,
      delayThrow: false,
    },
    prechorus: {
      gainDb: 0.5,
      width: 0.2,
      reverb: 0.22,
      delay: 0.07,
      compression: 0.48,
      brightnessDb: 0.35,
      double: false,
      delayThrow: false,
    },
    chorus: {
      gainDb: 1.5,
      width: 0.4,
      reverb: 0.34,
      delay: 0.11,
      compression: 0.4,
      brightnessDb: 0.7,
      double: true,
      delayThrow: true,
    },
    bridge: {
      gainDb: -0.7,
      width: 0.16,
      reverb: 0.28,
      delay: 0.08,
      compression: 0.32,
      brightnessDb: -0.4,
      double: false,
      delayThrow: false,
    },
    break: {
      gainDb: -1.5,
      width: 0.08,
      reverb: 0.1,
      delay: 0.02,
      compression: 0.3,
      brightnessDb: -0.8,
      double: false,
      delayThrow: false,
    },
    outro: {
      gainDb: -0.4,
      width: 0.25,
      reverb: 0.38,
      delay: 0.12,
      compression: 0.35,
      brightnessDb: -0.2,
      double: false,
      delayThrow: false,
    },
    unknown: {
      gainDb: 0,
      width: 0.12,
      reverb: 0.14,
      delay: 0.03,
      compression: 0.4,
      brightnessDb: 0,
      double: false,
      delayThrow: false,
    },
  };

  let t = { ...base[type] };

  // Low confidence: pull toward conservative verse-like
  if (conf < 0.5) {
    const verse = base.verse;
    const blend = (conf / 0.5) * 0.6; // less of the bold treatment
    t = {
      gainDb: verse.gainDb + (t.gainDb - verse.gainDb) * blend,
      width: verse.width + (t.width - verse.width) * blend,
      reverb: verse.reverb + (t.reverb - verse.reverb) * blend,
      delay: verse.delay + (t.delay - verse.delay) * blend,
      compression: verse.compression,
      brightnessDb: verse.brightnessDb + (t.brightnessDb - verse.brightnessDb) * blend,
      double: false,
      delayThrow: false,
    };
  }

  if (type === "chorus" && opts?.isFinalChorus && conf >= 0.5) {
    t.gainDb += 0.45;
    t.width = Math.min(0.52, t.width + 0.07);
    t.reverb = Math.min(0.48, t.reverb + 0.05);
    t.brightnessDb += 0.25;
  }

  if (typeof opts?.energy === "number") {
    t.gainDb += (opts.energy - 0.5) * 0.6;
  }

  return t;
}
