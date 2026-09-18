/**
 * Curated welcome-page listening rail.
 * Prefer real AP assets via SHOWCASE_TRACKS_JSON env (see /api/public/showcase).
 * Fallbacks use publicly hostable demo instrumentals for layout/playback QA.
 */

export type ShowcaseTrack = {
  id: string;
  title: string;
  artist: string;
  kind: "beat" | "song";
  /** Gradient stops for cover when no imageUrl */
  cover: [string, string];
  /** Optional art URL */
  imageUrl?: string | null;
  /** Playback URL (same-origin or CORS-friendly) */
  audioUrl: string;
  playsLabel?: string;
};

/** Static demos — swapped at runtime when /api/public/showcase returns real tracks. */
export const FALLBACK_SHOWCASE_TRACKS: ShowcaseTrack[] = [
  {
    id: "demo-afro-pulse",
    title: "Midnight Pulse",
    artist: "AP · Afrobeats",
    kind: "beat",
    cover: ["#1a0f2e", "#e7a961"],
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    playsLabel: "AP beat",
  },
  {
    id: "demo-rnb-glow",
    title: "Soft Lights",
    artist: "AP · R&B",
    kind: "beat",
    cover: ["#0d1b2a", "#7bebd4"],
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    playsLabel: "AP beat",
  },
  {
    id: "demo-trap-night",
    title: "City Glass",
    artist: "AP · Trap",
    kind: "beat",
    cover: ["#1c0a0a", "#f07167"],
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    playsLabel: "AP beat",
  },
  {
    id: "demo-gospel-rise",
    title: "Open Sky",
    artist: "AP · Gospel",
    kind: "beat",
    cover: ["#0f1f1a", "#c4a574"],
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
    playsLabel: "AP beat",
  },
  {
    id: "demo-soul-warm",
    title: "Warm Keys",
    artist: "AP · Soul",
    kind: "beat",
    cover: ["#1a1208", "#e7a961"],
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
    playsLabel: "AP beat",
  },
  {
    id: "demo-amapiano",
    title: "Log Drum Evening",
    artist: "AP · Amapiano",
    kind: "beat",
    cover: ["#0a1628", "#5b8def"],
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3",
    playsLabel: "AP beat",
  },
];
