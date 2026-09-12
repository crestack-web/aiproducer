/**
 * Lightweight per-artist memory. Stored by caller (DB/metadata); engine merges.
 */
export type ArtistMasterProfile = {
  sessionCount: number;
  /** Preferred style axis 0..1 if inferred from feedback */
  preferredStyleAxis?: number;
  /** Typical loudness preference offset dB (negative = quieter) */
  loudnessBiasDb?: number;
  /** Rolling vocal brightness preference */
  vocalBrightness?: number;
  /** Last feedback tags */
  recentTags?: string[];
};

export function mergeArtistProfile(
  profile: ArtistMasterProfile | null | undefined,
  fingerprintBrightness: number
): {
  styleBias: number;
  loudnessBiasDb: number;
  brightnessPrior: number;
  confidence: number;
} {
  if (!profile || profile.sessionCount < 1) {
    return {
      styleBias: 0,
      loudnessBiasDb: 0,
      brightnessPrior: fingerprintBrightness,
      confidence: 0,
    };
  }
  const confidence = Math.min(1, profile.sessionCount / 5);
  return {
    styleBias: ((profile.preferredStyleAxis ?? 0.75) - 0.75) * confidence,
    loudnessBiasDb: (profile.loudnessBiasDb ?? 0) * confidence,
    brightnessPrior:
      fingerprintBrightness * (1 - confidence * 0.4) +
      (profile.vocalBrightness ?? fingerprintBrightness) * (confidence * 0.4),
    confidence,
  };
}

/** Apply a feedback tag into a profile update (pure). */
export function applyFeedbackTag(
  profile: ArtistMasterProfile | null | undefined,
  tag: string
): ArtistMasterProfile {
  const p: ArtistMasterProfile = {
    sessionCount: (profile?.sessionCount ?? 0) + 1,
    preferredStyleAxis: profile?.preferredStyleAxis,
    loudnessBiasDb: profile?.loudnessBiasDb ?? 0,
    vocalBrightness: profile?.vocalBrightness,
    recentTags: [...(profile?.recentTags || []), tag].slice(-12),
  };
  const t = tag.toLowerCase();
  if (t.includes("quiet") || t.includes("too quiet")) p.loudnessBiasDb = (p.loudnessBiasDb ?? 0) + 1.2;
  if (t.includes("loud") || t.includes("too loud")) p.loudnessBiasDb = (p.loudnessBiasDb ?? 0) - 1.2;
  if (t.includes("bright") || t.includes("harsh")) p.vocalBrightness = Math.max(0, (p.vocalBrightness ?? 0.5) - 0.08);
  if (t.includes("dark") || t.includes("muddy")) p.vocalBrightness = Math.min(1, (p.vocalBrightness ?? 0.5) + 0.06);
  if (t.includes("muddy")) p.loudnessBiasDb = (p.loudnessBiasDb ?? 0) - 0.2;
  if (t.includes("thin")) p.vocalBrightness = Math.min(1, (p.vocalBrightness ?? 0.5) + 0.05);
  if (t.includes("raw") || t.includes("intimate")) p.preferredStyleAxis = 0.25;
  if (t.includes("polish") || t.includes("good")) p.preferredStyleAxis = Math.min(1, (p.preferredStyleAxis ?? 0.75) + 0.05);
  return p;
}
