/**
 * Per-artist taste vector — learned from repeated tweak directions across songs.
 * Never fully overrides song-specific analysis on early sessions.
 */

export type TasteDirection = "up" | "down" | "none";

export type TasteFieldKey =
  | "loudness"
  | "presence"
  | "reverb"
  | "compression"
  | "saturation";

export type TasteVector = Record<
  TasteFieldKey,
  { up: number; down: number; lastAt?: string }
>;

export type TasteProfile = {
  version: 1;
  sessionsWithTweaks: number;
  vector: TasteVector;
  /** Recent prompts for loop detection */
  recentPrompts: Array<{ prompt: string; field?: string; at: string }>;
};

export function emptyTasteProfile(): TasteProfile {
  const field = (): TasteVector[TasteFieldKey] => ({ up: 0, down: 0 });
  return {
    version: 1,
    sessionsWithTweaks: 0,
    vector: {
      loudness: field(),
      presence: field(),
      reverb: field(),
      compression: field(),
      saturation: field(),
    },
    recentPrompts: [],
  };
}

export function parseTasteProfile(raw: unknown): TasteProfile {
  if (!raw || typeof raw !== "object") return emptyTasteProfile();
  const p = raw as TasteProfile;
  if (p.version !== 1 || !p.vector) return emptyTasteProfile();
  return {
    ...emptyTasteProfile(),
    ...p,
    vector: { ...emptyTasteProfile().vector, ...p.vector },
    recentPrompts: Array.isArray(p.recentPrompts) ? p.recentPrompts.slice(-40) : [],
  };
}

function fieldFromEditField(field: string): TasteFieldKey | null {
  if (field === "loudness_target") return "loudness";
  if (field === "vocal_presence_bias") return "presence";
  if (field === "reverb_send_scale") return "reverb";
  if (field.includes("compress")) return "compression";
  if (field.includes("satur")) return "saturation";
  return null;
}

export function directionFromDelta(deltaDb?: number, deltaScale?: number): TasteDirection {
  const d = deltaDb ?? (deltaScale != null ? deltaScale * 10 : 0);
  if (d > 0.05) return "up";
  if (d < -0.05) return "down";
  return "none";
}

/**
 * Log one tweak into the taste profile. Single events are weak; repetition matters.
 */
export function logTweakIntoTaste(
  profile: TasteProfile,
  opts: {
    prompt: string;
    field?: string;
    deltaDb?: number;
    deltaScale?: number;
    newSession?: boolean;
  }
): TasteProfile {
  const next = parseTasteProfile(profile);
  if (opts.newSession) next.sessionsWithTweaks += 1;

  const key = opts.field ? fieldFromEditField(opts.field) : null;
  const dir = directionFromDelta(opts.deltaDb, opts.deltaScale);
  if (key && dir !== "none") {
    next.vector[key][dir] += 1;
    next.vector[key].lastAt = new Date().toISOString();
  }

  next.recentPrompts = [
    ...next.recentPrompts,
    {
      prompt: opts.prompt.slice(0, 200),
      field: opts.field,
      at: new Date().toISOString(),
    },
  ].slice(-40);

  return next;
}

/**
 * Trust weight 0–1 for applying taste bias on a new song.
 * Sessions 0–1: ~0, session 2: low, 5+: moderate.
 */
export function tasteTrust(profile: TasteProfile): number {
  const n = profile.sessionsWithTweaks;
  if (n <= 1) return 0;
  if (n === 2) return 0.15;
  if (n <= 4) return 0.35;
  return Math.min(0.55, 0.35 + (n - 4) * 0.04);
}

/** Preferred direction if one side clearly dominates (ratio ≥ 2:1, min 3 events). */
export function dominantDirection(
  profile: TasteProfile,
  key: TasteFieldKey
): TasteDirection {
  const v = profile.vector[key];
  const total = v.up + v.down;
  if (total < 3) return "none";
  if (v.up >= v.down * 2) return "up";
  if (v.down >= v.up * 2) return "down";
  return "none";
}

/**
 * Suggest mild default biases for a new song (not applied over explicit prompts).
 */
export function tasteDefaultHints(profile: TasteProfile): string[] {
  const trust = tasteTrust(profile);
  if (trust < 0.15) return [];
  const hints: string[] = [];
  for (const key of ["loudness", "presence", "reverb"] as TasteFieldKey[]) {
    const d = dominantDirection(profile, key);
    if (d === "none") continue;
    hints.push(`${key}:${d}`);
  }
  return hints;
}

/** Detect ping-pong on the same field (circles). */
export function detectIterationLoop(profile: TasteProfile): string | null {
  const recent = profile.recentPrompts.slice(-8);
  if (recent.length < 4) return null;
  const fields = recent.map((r) => r.field).filter(Boolean);
  if (fields.length < 4) return null;
  const last4 = fields.slice(-4);
  const unique = new Set(last4);
  if (unique.size === 1) {
    return `We’ve gone back and forth on ${last4[0]} a few times — want to pick one direction and move on, or keep exploring?`;
  }
  return null;
}
