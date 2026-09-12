import { resolveGenreProfile } from "../profiles/genre-profiles";
import type { SongRead } from "./types";

export function readSongLevel(genre?: string | null, vocalRms?: number, beatRms?: number): SongRead {
  const profile = resolveGenreProfile(genre);
  const notes: string[] = [`genre:${profile.id}`];

  // 0 restraint … 1 polish
  let restraintVsPolish = 1 - profile.preserveDynamics * 0.85;
  if (profile.id === "ballad" || profile.id === "rnb" || profile.id === "afro_rnb") {
    restraintVsPolish = Math.min(restraintVsPolish, 0.45);
    notes.push("favor_emotion_over_polish");
  }
  if (profile.id === "hiphop" || profile.id === "trap" || profile.id === "pop") {
    restraintVsPolish = Math.max(restraintVsPolish, 0.65);
    notes.push("favor_clarity_punch");
  }

  if (vocalRms != null && beatRms != null && beatRms > 1e-6) {
    const ratio = vocalRms / beatRms;
    if (ratio < 0.4) notes.push("vocal_may_need_presence");
    if (ratio > 1.5) notes.push("vocal_already_forward");
  }

  const mood =
    profile.id === "ballad"
      ? "intimate"
      : profile.id === "hiphop" || profile.id === "trap"
        ? "assertive"
        : profile.id === "afrobeats" || profile.id === "amapiano"
          ? "rhythmic"
          : "expressive";

  return {
    mood,
    genre: profile.id,
    restraintVsPolish,
    overallNotes: notes,
  };
}
