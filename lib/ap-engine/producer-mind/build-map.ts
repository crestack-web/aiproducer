import { analyzeVocalPhrases } from "../edit/phrase-detect";
import type { PcmStereo } from "../types";
import type { VocalRole, SongSectionKind } from "../roles";
import { readSongLevel } from "./song-read";
import { readSectionLevel } from "./section-read";
import { readPhraseLevel } from "./phrase-read";
import type { DecisionMap, ProducerMindInput } from "./types";

export type LayerAudio = {
  role: VocalRole;
  section: SongSectionKind;
  startMs: number;
  pcm: PcmStereo;
  lyrics?: Array<{ text: string; startMs: number; endMs: number }> | null;
};

/**
 * Build the full decision map: song → section → phrase.
 * Transcription is optional; energy phrases always available.
 */
export function buildDecisionMap(
  input: ProducerMindInput,
  layerAudio?: LayerAudio[]
): DecisionMap {
  const song = readSongLevel(input.genre, input.vocalRms, input.beatRms);

  // Unique sections from layers
  const sectionMap = new Map<string, { section: SongSectionKind; startMs: number; endMs: number }>();
  for (const layer of input.layers) {
    const key = `${layer.section}_${Math.round(layer.startMs)}`;
    const end = layer.startMs + layer.durationMs;
    const prev = sectionMap.get(key);
    if (!prev) sectionMap.set(key, { section: layer.section, startMs: layer.startMs, endMs: end });
    else prev.endMs = Math.max(prev.endMs, end);
  }
  // Fallback whole-song section if empty
  if (!sectionMap.size) {
    sectionMap.set("other_0", {
      section: "other",
      startMs: 0,
      endMs: input.beatDurationMs || 60000,
    });
  }

  const sections = readSectionLevel(song, [...sectionMap.values()]);

  const phrases = [];
  for (let li = 0; li < input.layers.length; li++) {
    const layer = input.layers[li];
    let localPhrases = layer.phrasesLocal;

    if ((!localPhrases || !localPhrases.length) && layerAudio?.[li]) {
      const analysis = analyzeVocalPhrases(layerAudio[li].pcm);
      localPhrases = analysis.phrases.map((p) => ({
        startMs: p.startMs,
        endMs: p.endMs,
        energy: p.energy,
      }));
    }

    if (!localPhrases?.length) {
      localPhrases = [{ startMs: 0, endMs: layer.durationMs, energy: 0.15 }];
    }

    // Attach lyrics to nearest phrase when provided
    const withLyrics = localPhrases.map((ph) => {
      let lyric: string | null = null;
      if (layer.lyrics?.length) {
        const mid = (ph.startMs + ph.endMs) / 2;
        const hit = layer.lyrics.find((l) => mid >= l.startMs && mid <= l.endMs);
        lyric = hit?.text ?? null;
      }
      return { ...ph, lyric };
    });

    phrases.push(
      ...readPhraseLevel({
        song,
        sections,
        role: layer.role,
        section: layer.section,
        layerStartMs: layer.startMs,
        phrases: withLyrics,
      })
    );
  }

  const summary: string[] = [
    `Song read: ${song.mood} (${song.genre}), restraint ${song.restraintVsPolish.toFixed(2)}`,
    ...sections.map((s) => `${s.section}: ${s.density} (${s.rationale})`),
  ];

  const vuln = phrases.filter((p) => p.emotionalWeight === "vulnerable" || p.instructions.restraint === "preserve");
  const hooks = phrases.filter((p) => p.emotionalWeight === "hook");
  if (vuln.length) summary.push(`Pulled back ${vuln.length} intimate/vulnerable phrase(s)`);
  if (hooks.length) summary.push(`Pushed ${hooks.length} hook phrase(s)`);

  return {
    version: "1.0",
    engine: "producer-mind",
    song,
    sections,
    phrases,
    summary,
  };
}
