/**
 * Mastering context from project setup (defaults when artist doesn't answer).
 * Defaults: genre-typical, loud-and-dense, vocal-forward, streaming+social.
 */
export type MasterMood = "loud" | "balanced" | "spacious";
export type VocalSit = "forward" | "blend";
export type PlatformTarget = "streaming" | "social" | "both";

export type MasterContext = {
  genre: string;
  mood: MasterMood;
  vocalSit: VocalSit;
  platform: PlatformTarget;
  /** Competitive integrated target (proxy toward LUFS) */
  targetLufs: number;
  knownIssues: string[];
};

export function resolveMasterContext(opts: {
  genre?: string | null;
  mood?: string | null;
  vocalSit?: string | null;
  platform?: string | null;
  knownIssues?: string[] | null;
  targetLufsHint?: number | null;
}): MasterContext {
  const g = (opts.genre || "rnb").toLowerCase();
  let mood: MasterMood = "loud";
  const m = (opts.mood || "").toLowerCase();
  if (m.includes("spacious") || m.includes("dynamic") || m.includes("soft") || m.includes("ballad")) {
    mood = "spacious";
  } else if (m.includes("balanced") || m.includes("natural")) {
    mood = "balanced";
  } else if (m.includes("loud") || m.includes("dense") || m.includes("aggressive") || !m) {
    mood = "loud";
  }

  let vocalSit: VocalSit = "forward";
  const v = (opts.vocalSit || "").toLowerCase();
  if (v.includes("blend") || v.includes("inside") || v.includes("pocket")) vocalSit = "blend";

  let platform: PlatformTarget = "both";
  const p = (opts.platform || "").toLowerCase();
  if (p.includes("social") && !p.includes("stream")) platform = "social";
  else if (p.includes("stream") && !p.includes("social")) platform = "streaming";

  // Competitive pre-normalization: loud masters still read as more produced
  let targetLufs = -11;
  if (mood === "loud") targetLufs = -10;
  else if (mood === "balanced") targetLufs = -11.5;
  else targetLufs = -13.5;

  if (platform === "social") targetLufs = Math.min(targetLufs, -10.5);
  if (opts.targetLufsHint != null && Number.isFinite(opts.targetLufsHint)) {
    targetLufs = Math.min(-9, Math.max(-14.5, opts.targetLufsHint));
  }

  // Genre nudges
  if (g.includes("ballad") || g.includes("soul") && mood === "spacious") {
    targetLufs = Math.min(targetLufs, -12.5);
  }
  if (g.includes("trap") || g.includes("hip")) {
    targetLufs = Math.max(targetLufs, -11);
  }

  return {
    genre: g,
    mood,
    vocalSit,
    platform,
    targetLufs,
    knownIssues: opts.knownIssues || [],
  };
}
