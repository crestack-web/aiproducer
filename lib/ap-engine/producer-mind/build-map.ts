import { analyzeVocalPhrases } from "../edit/phrase-detect";
import type { PcmStereo } from "../types";
import type { VocalRole, SongSectionKind } from "../roles";
import { readSongLevel } from "./song-read";
import { readSectionLevel } from "./section-read";
import { readPhraseLevel } from "./phrase-read";
import { decideCreativeFxForPhrase, enforceCreativeFxDensity } from "./creative-fx";
import type { DecisionMap, ProducerMindInput } from "./types";

export type LayerAudio = {
  role: VocalRole;
  section: SongSectionKind;
  startMs: number;
  pcm: PcmStereo;
  lyrics?: Array<{ text: string; startMs: number; endMs: number; confidence?: number }> | null;
};

/**
 * Build the full decision map: song → section → phrase.
 * Transcription optional; energy phrases always available as safety net.
 */
export function buildDecisionMap(
  input: ProducerMindInput,
  layerAudio?: LayerAudio[]
): DecisionMap {
  const song = readSongLevel(input.genre, input.vocalRms, input.beatRms);

  const sectionMap = new Map<string, { section: SongSectionKind; startMs: number; endMs: number }>();
  for (const layer of input.layers) {
    const key = `${layer.section}_${Math.round(layer.startMs)}`;
    const end = layer.startMs + layer.durationMs;
    const prev = sectionMap.get(key);
    if (!prev) sectionMap.set(key, { section: layer.section, startMs: layer.startMs, endMs: end });
    else prev.endMs = Math.max(prev.endMs, end);
  }
  if (!sectionMap.size) {
    sectionMap.set("other_0", {
      section: "other",
      startMs: 0,
      endMs: input.beatDurationMs || 60000,
    });
  }

  const sections = readSectionLevel(song, [...sectionMap.values()]);

  // Corpus of all lyric lines for repetition detection
  const songLyricCorpus: string[] = [];
  for (const layer of input.layers) {
    for (const line of layer.lyrics || []) {
      if (line.text?.trim()) songLyricCorpus.push(line.text.trim());
    }
  }
  if (layerAudio) {
    for (const la of layerAudio) {
      for (const line of la.lyrics || []) {
        if (line.text?.trim()) songLyricCorpus.push(line.text.trim());
      }
    }
  }

  const phrases = [];
  for (let li = 0; li < input.layers.length; li++) {
    const layer = input.layers[li];
    const audio = layerAudio?.[li];
    const lyrics = layer.lyrics || audio?.lyrics || null;

    let localPhrases = layer.phrasesLocal;

    if ((!localPhrases || !localPhrases.length) && audio) {
      const analysis = analyzeVocalPhrases(audio.pcm);
      localPhrases = analysis.phrases.map((p) => ({
        startMs: p.startMs,
        endMs: p.endMs,
        energy: p.energy,
      }));
    }

    // Prefer ASR phrase boundaries when available
    if (lyrics?.length) {
      localPhrases = lyrics.map((l) => {
        // energy proxy: unknown from text alone — neutral mid
        return { startMs: l.startMs, endMs: l.endMs, energy: 0.12, lyric: l.text, confidence: (l as { confidence?: number }).confidence };
      });
    } else if (!localPhrases?.length) {
      localPhrases = [{ startMs: 0, endMs: layer.durationMs, energy: 0.15 }];
    } else {
      // Attach lyrics to nearest energy phrase
      localPhrases = localPhrases.map((ph) => {
        let lyric: string | null = null;
        let confidence: number | undefined;
        if (lyrics?.length) {
          const mid = (ph.startMs + ph.endMs) / 2;
          const hit = lyrics.find((l) => mid >= l.startMs && mid <= l.endMs);
          lyric = hit?.text ?? null;
          confidence = hit ? (hit as { confidence?: number }).confidence : undefined;
        }
        return { ...ph, lyric, confidence };
      });
    }

    phrases.push(
      ...readPhraseLevel({
        song,
        sections,
        role: layer.role,
        section: layer.section,
        layerStartMs: layer.startMs,
        phrases: localPhrases,
        songLyricCorpus,
      })
    );
  }

  const summary: string[] = [
    `Song read: ${song.mood} (${song.genre}), restraint ${song.restraintVsPolish.toFixed(2)}`,
    ...sections.map((s) => `${s.section}: ${s.density} (${s.rationale})`),
  ];

  // Creative FX (default off, density capped)
  let throwCount = 0;
  let filterCount = 0;
  const styleIntimate = song.restraintVsPolish < 0.42;
  for (const ph of phrases) {
    const sec = sections.find((s) => s.section === ph.section);
    const fx = decideCreativeFxForPhrase({
      phrase: ph,
      song,
      section: sec,
      role: ph.role,
      styleIntimate,
      delayThrowsUsed: throwCount,
      filterMomentsUsed: filterCount,
    });
    if (fx.delayThrow?.enabled) throwCount += 1;
    if (fx.filterAutomation) filterCount += 1;
    ph.creativeFx = fx;
  }
  const densified = enforceCreativeFxDensity(
    phrases.map((p) => ({ phraseId: p.phraseId, fx: p.creativeFx! }))
  );
  for (const d of densified) {
    const ph = phrases.find((x) => x.phraseId === d.phraseId);
    if (ph) ph.creativeFx = d.fx;
  }

  const lyricDriven = phrases.filter((p) => p.weightSource === "lyric" || p.weightSource === "blended");
  const vuln = phrases.filter((p) => p.emotionalWeight === "vulnerable" || p.instructions.restraint === "preserve");
  const hooks = phrases.filter((p) => p.emotionalWeight === "hook");
  if (lyricDriven.length) {
    summary.push(`Lyric-informed phrases: ${lyricDriven.length}/${phrases.length}`);
  }
  for (const p of phrases.slice(0, 12)) {
    if (p.lyric && (p.weightSource === "lyric" || p.emotionalWeight === "vulnerable" || p.emotionalWeight === "hook")) {
      const snippet = p.lyric.length > 42 ? p.lyric.slice(0, 40) + "…" : p.lyric;
      summary.push(
        `${p.instructions.vocalFaderRideDb >= 0 ? "Pushed" : "Pulled back"} “${snippet}” (${p.emotionalWeight}, ${p.weightSource})`
      );
    }
  }
  if (vuln.length) summary.push(`Restraint on ${vuln.length} intimate/vulnerable phrase(s)`);
  if (hooks.length) summary.push(`Hook treatment on ${hooks.length} phrase(s)`);

  return {
    version: "1.0",
    engine: "producer-mind",
    song,
    sections,
    phrases,
    summary,
  };
}
