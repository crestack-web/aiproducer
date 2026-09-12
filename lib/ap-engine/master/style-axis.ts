/**
 * Style axis: raw/intimate ←→ polished/commercial (independent of genre).
 * 0 = raw, 1 = polished.
 */
export type StyleAxis = number; // 0..1

export function resolveStyleAxis(opts: {
  explicit?: number | string | null;
  mood?: string | null;
  fingerprintLra?: number;
  fingerprintDensity?: number;
}): StyleAxis {
  if (typeof opts.explicit === "number" && Number.isFinite(opts.explicit)) {
    return Math.max(0, Math.min(1, opts.explicit));
  }
  const s = String(opts.explicit || "").toLowerCase();
  if (s.includes("raw") || s.includes("intimate") || s.includes("lo-fi") || s.includes("lofi")) {
    return 0.2;
  }
  if (s.includes("polish") || s.includes("commercial") || s.includes("radio")) {
    return 0.9;
  }

  // Infer from mood + measured dynamics
  let axis = 0.75; // default slightly polished
  const m = (opts.mood || "").toLowerCase();
  if (m.includes("spacious") || m.includes("dynamic") || m.includes("soft")) axis = 0.35;
  if (m.includes("loud") || m.includes("dense")) axis = 0.85;

  const lra = opts.fingerprintLra ?? 8;
  // Wide LRA → nudge raw; already dense/squashed → polished
  if (lra > 10) axis = Math.min(axis, 0.45);
  if (lra < 5) axis = Math.max(axis, 0.7);

  const dens = opts.fingerprintDensity ?? 0.5;
  if (dens > 0.7) axis = Math.max(axis, 0.65);

  return Math.max(0, Math.min(1, axis));
}

export function styleLabel(axis: StyleAxis): string {
  if (axis < 0.33) return "raw/intimate";
  if (axis < 0.66) return "balanced";
  return "polished/commercial";
}
