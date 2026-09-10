export type GenreProfile = {
  id: string;
  label: string;
  vocalPresenceDb: number;
  warmthDb: number;
  reverbSend: number;
  delaySend: number;
  compressionRatio: number;
  highPassHz: number;
  beatDuckDb: number;
  targetLufs: number;
};

const PROFILES: Record<string, GenreProfile> = {
  rnb: {
    id: "rnb",
    label: "R&B",
    vocalPresenceDb: 2.5,
    warmthDb: 1.5,
    reverbSend: 0.14,
    delaySend: 0.06,
    compressionRatio: 3.2,
    highPassHz: 80,
    beatDuckDb: 1.2,
    targetLufs: -12,
  },
  afrobeats: {
    id: "afrobeats",
    label: "Afrobeats",
    vocalPresenceDb: 3.2,
    warmthDb: 0.5,
    reverbSend: 0.1,
    delaySend: 0.08,
    compressionRatio: 3.5,
    highPassHz: 90,
    beatDuckDb: 1.5,
    targetLufs: -11,
  },
  afropop: {
    id: "afropop",
    label: "Afropop",
    vocalPresenceDb: 3,
    warmthDb: 0.8,
    reverbSend: 0.12,
    delaySend: 0.07,
    compressionRatio: 3.3,
    highPassHz: 85,
    beatDuckDb: 1.4,
    targetLufs: -11.5,
  },
  hiphop: {
    id: "hiphop",
    label: "Hip-hop",
    vocalPresenceDb: 3.5,
    warmthDb: 0.3,
    reverbSend: 0.08,
    delaySend: 0.05,
    compressionRatio: 3.8,
    highPassHz: 95,
    beatDuckDb: 1.8,
    targetLufs: -11,
  },
  amapiano: {
    id: "amapiano",
    label: "Amapiano",
    vocalPresenceDb: 2.8,
    warmthDb: 1,
    reverbSend: 0.16,
    delaySend: 0.1,
    compressionRatio: 3,
    highPassHz: 85,
    beatDuckDb: 1.3,
    targetLufs: -12,
  },
  pop: {
    id: "pop",
    label: "Pop",
    vocalPresenceDb: 3.2,
    warmthDb: 0.6,
    reverbSend: 0.12,
    delaySend: 0.08,
    compressionRatio: 3.4,
    highPassHz: 90,
    beatDuckDb: 1.5,
    targetLufs: -11,
  },
  ballad: {
    id: "ballad",
    label: "Ballad",
    vocalPresenceDb: 2.2,
    warmthDb: 1.8,
    reverbSend: 0.18,
    delaySend: 0.05,
    compressionRatio: 2.6,
    highPassHz: 75,
    beatDuckDb: 1,
    targetLufs: -13,
  },
  hausa_rnb: {
    id: "hausa_rnb",
    label: "Hausa R&B",
    vocalPresenceDb: 2.6,
    warmthDb: 1.6,
    reverbSend: 0.15,
    delaySend: 0.06,
    compressionRatio: 3,
    highPassHz: 80,
    beatDuckDb: 1.2,
    targetLufs: -12,
  },
};

export function resolveGenreProfile(genre?: string | null): GenreProfile {
  const g = (genre || "rnb").toLowerCase();
  if (g.includes("hausa")) return PROFILES.hausa_rnb;
  if (g.includes("amapiano") || g.includes("piano")) return PROFILES.amapiano;
  if (g.includes("afrobeat") || g.includes("afrobeats")) return PROFILES.afrobeats;
  if (g.includes("afropop") || g.includes("afro pop")) return PROFILES.afropop;
  if (g.includes("hip") || g.includes("rap") || g.includes("trap")) return PROFILES.hiphop;
  if (g.includes("ballad") || g.includes("slow")) return PROFILES.ballad;
  if (g.includes("pop")) return PROFILES.pop;
  if (g.includes("r&b") || g.includes("rnb") || g.includes("soul")) return PROFILES.rnb;
  return PROFILES.rnb;
}

export function listGenreProfiles(): GenreProfile[] {
  return Object.values(PROFILES);
}
