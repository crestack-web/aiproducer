/**
 * Genre → commercial reference track keys for Matchering.
 * Audio files live in object storage (R2), never redistributed — internal spectral match only.
 *
 * Upload WAVs to:
 *   ap-system/references/{genreKey}/{file}.wav
 * and set REF_MASTER_REFERENCE_BASE_URL to a signed-capable base, or rely on
 * REF_MASTER_REFERENCE_URLS JSON map.
 */

export type ReferencePick = {
  genreKey: string;
  /** Object key under the system references prefix, or absolute https URL */
  referenceKeyOrUrl: string;
  label: string;
};

const GENRE_REFERENCES: Record<string, { key: string; label: string }[]> = {
  rnb: [
    { key: "rnb/ref-a.wav", label: "R&B commercial A" },
    { key: "rnb/ref-b.wav", label: "R&B commercial B" },
  ],
  soul: [{ key: "rnb/ref-a.wav", label: "Soul / R&B commercial" }],
  pop: [
    { key: "pop/ref-a.wav", label: "Pop commercial A" },
    { key: "pop/ref-b.wav", label: "Pop commercial B" },
  ],
  hiphop: [
    { key: "hiphop/ref-a.wav", label: "Hip-hop commercial A" },
    { key: "hiphop/ref-b.wav", label: "Hip-hop commercial B" },
  ],
  trap: [{ key: "hiphop/ref-a.wav", label: "Trap / hip-hop commercial" }],
  afrobeat: [
    { key: "afrobeat/ref-a.wav", label: "Afrobeats commercial A" },
    { key: "afrobeat/ref-b.wav", label: "Afrobeats commercial B" },
  ],
  amapiano: [{ key: "afrobeat/ref-a.wav", label: "Amapiano / Afro commercial" }],
  afropop: [{ key: "afrobeat/ref-a.wav", label: "Afropop commercial" }],
  gospel: [{ key: "gospel/ref-a.wav", label: "Gospel commercial" }],
  default: [
    { key: "pop/ref-a.wav", label: "Default commercial" },
    { key: "rnb/ref-a.wav", label: "Default R&B commercial" },
  ],
};

function normalizeGenre(genre: string | null | undefined): string {
  const g = (genre || "").toLowerCase().trim();
  if (!g) return "default";
  if (g.includes("r&b") || g.includes("rnb") || g.includes("rhythm")) return "rnb";
  if (g.includes("soul") || g.includes("ballad")) return "soul";
  if (g.includes("trap")) return "trap";
  if (g.includes("hip") || g.includes("rap")) return "hiphop";
  if (g.includes("amapiano")) return "amapiano";
  if (g.includes("afro")) return "afrobeat";
  if (g.includes("gospel")) return "gospel";
  if (g.includes("pop")) return "pop";
  return "default";
}

/**
 * Resolve which reference file to use for a project genre.
 * Optional override via REF_MASTER_REFERENCE_URLS JSON: { "rnb": "https://...", "pop": "..." }
 */
export function pickReferenceForGenre(genre: string | null | undefined): ReferencePick {
  const genreKey = normalizeGenre(genre);
  const envMapRaw = process.env.REF_MASTER_REFERENCE_URLS || "";
  if (envMapRaw.trim()) {
    try {
      const map = JSON.parse(envMapRaw) as Record<string, string>;
      const url = map[genreKey] || map.default;
      if (url) {
        return { genreKey, referenceKeyOrUrl: url, label: `env:${genreKey}` };
      }
    } catch {
      /* ignore bad JSON */
    }
  }

  const list = GENRE_REFERENCES[genreKey] || GENRE_REFERENCES.default;
  // Stable pick (first) — later can randomize or let artist choose
  const pick = list[0];
  const base = (process.env.REF_MASTER_REFERENCE_BASE || "ap-system/references").replace(/\/$/, "");
  const key = `${base}/${pick.key}`;
  return { genreKey, referenceKeyOrUrl: key, label: pick.label };
}

export function isReferenceMasterEnabled(): boolean {
  if (process.env.REF_MASTER_ENABLED === "0" || process.env.REF_MASTER_ENABLED === "false") {
    return false;
  }
  if (process.env.REF_MASTER_ENABLED === "1" || process.env.REF_MASTER_ENABLED === "true") {
    return true;
  }
  // Enabled when URL is configured
  return Boolean(process.env.REF_MASTER_URL?.trim());
}

export function referenceMasterBaseUrl(): string | null {
  const u = process.env.REF_MASTER_URL?.trim();
  return u || null;
}
