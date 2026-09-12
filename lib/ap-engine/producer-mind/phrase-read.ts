/**
 * Phrase-level emotional read.
 * Prefer lyric meaning when ASR provides text; fall back to energy + section.
 * Never fails the whole pass on missing/low-confidence ASR.
 */
import type { VocalRole, SongSectionKind } from "../roles";
import type {
  EmotionalWeight,
  PhraseDecision,
  PhraseInstructions,
  RestraintLevel,
  SongRead,
  SectionDecision,
} from "./types";

export type WeightSource = "lyric" | "energy" | "blended";

const HOOK_WORDS =
  /\b(love|baby|yeah|yea|whoa|oh+|night|heart|feel|dance|run|stay|never|always|tonight|forever|want|need|call|name)\b/i;
const VULN_WORDS =
  /\b(sorry|miss|alone|cry|hurt|afraid|please|lost|broken|tear|goodbye|empty|pain|scared|lonely|leave|left)\b/i;
const AGGR_WORDS =
  /\b(fight|fire|power|kill|strong|win|hate|rage|boss|money|flex|hard|war|enemy|rise)\b/i;

const CONFIDENCE_FLOOR = 0.45;

function normalizeLine(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function weightFromLyricText(text: string | null, section: SongSectionKind): {
  weight: EmotionalWeight;
  keywordHit: boolean;
} {
  if (!text || !text.trim()) return { weight: "neutral", keywordHit: false };
  if (VULN_WORDS.test(text)) return { weight: "vulnerable", keywordHit: true };
  if (AGGR_WORDS.test(text)) return { weight: "aggressive", keywordHit: true };
  if (HOOK_WORDS.test(text) && (section === "chorus" || section === "pre_chorus")) {
    return { weight: "hook", keywordHit: true };
  }
  if (HOOK_WORDS.test(text)) return { weight: "hook", keywordHit: true };
  if (section === "chorus") return { weight: "hook", keywordHit: false };
  if (section === "verse") return { weight: "intimate", keywordHit: false };
  if (section === "bridge") return { weight: "transitional", keywordHit: false };
  if (section === "outro" || section === "intro") return { weight: "intimate", keywordHit: false };
  return { weight: "neutral", keywordHit: false };
}

function weightFromEnergy(
  section: SongSectionKind,
  energy: number,
  wordsPerSec: number | null,
  songAvgWps: number | null
): EmotionalWeight {
  if (section === "chorus") return "hook";
  if (section === "bridge") return "transitional";
  if (section === "outro" || section === "intro") return "intimate";
  if (section === "verse") {
    if (wordsPerSec != null && songAvgWps != null && wordsPerSec < songAvgWps * 0.7) return "intimate";
    if (energy < 0.08) return "intimate";
    return "neutral";
  }
  if (wordsPerSec != null && songAvgWps != null && wordsPerSec > songAvgWps * 1.35) return "aggressive";
  return "neutral";
}

function instructionsFor(
  weight: EmotionalWeight,
  song: SongRead,
  sectionDec: SectionDecision | undefined,
  role: VocalRole
): { instructions: PhraseInstructions; rationale: string } {
  let vocalFaderRideDb = sectionDec?.vocalFaderRideDb ?? 0;
  let reverbSendScale = sectionDec?.reverbSendScale ?? 1;
  let deEssScale = 1;
  let preserveBreath = false;
  let compressionScale = 1;
  let restraint: RestraintLevel = "standard";
  let rationale = `weight:${weight}`;

  if (weight === "vulnerable" || weight === "intimate") {
    restraint = song.restraintVsPolish < 0.55 ? "preserve" : "standard";
    preserveBreath = true;
    compressionScale = 0.75;
    reverbSendScale *= 0.75;
    vocalFaderRideDb -= 0.6;
    deEssScale = 0.85;
    rationale += ",restraint_pull_back";
  } else if (weight === "hook") {
    restraint = "polish";
    vocalFaderRideDb += 0.7;
    reverbSendScale *= 1.1;
    compressionScale = 1.1;
    deEssScale = 1.05;
    rationale += ",hook_push";
  } else if (weight === "aggressive") {
    restraint = "polish";
    vocalFaderRideDb += 0.4;
    reverbSendScale *= 0.7;
    compressionScale = 1.2;
    deEssScale = 1.15;
    rationale += ",aggressive_forward";
  } else if (weight === "transitional") {
    vocalFaderRideDb -= 0.2;
    reverbSendScale *= 1.15;
    rationale += ",transition_space";
  }

  if (role !== "lead") {
    vocalFaderRideDb = Math.min(vocalFaderRideDb, 0.2);
  }

  return {
    instructions: {
      vocalFaderRideDb,
      reverbSendScale,
      deEssScale,
      preserveBreath,
      compressionScale,
      restraint,
    },
    rationale,
  };
}

function blendInstructions(
  lyricInst: PhraseInstructions,
  energyInst: PhraseInstructions
): PhraseInstructions {
  // Energy drives push/hold when lyric is ambiguous; lyric still wins breath/reverb nuance
  return {
    vocalFaderRideDb: energyInst.vocalFaderRideDb,
    reverbSendScale: lyricInst.reverbSendScale,
    deEssScale: lyricInst.deEssScale,
    preserveBreath: lyricInst.preserveBreath || energyInst.preserveBreath,
    compressionScale: (lyricInst.compressionScale + energyInst.compressionScale) / 2,
    restraint: lyricInst.preserveBreath ? lyricInst.restraint : energyInst.restraint,
  };
}

export function readPhraseLevel(opts: {
  song: SongRead;
  sections: SectionDecision[];
  role: VocalRole;
  section: SongSectionKind;
  layerStartMs: number;
  phrases: Array<{
    startMs: number;
    endMs: number;
    energy: number;
    lyric?: string | null;
    confidence?: number | null;
  }>;
  /** All normalized lyric lines in the song for repetition detection */
  songLyricCorpus?: string[];
}): PhraseDecision[] {
  const sectionDec = opts.sections.find((s) => s.section === opts.section);
  const corpus = (opts.songLyricCorpus || [])
    .map(normalizeLine)
    .filter((s) => s.length > 3);

  // Song average words/sec for pacing
  let songAvgWps: number | null = null;
  {
    const rates: number[] = [];
    for (const ph of opts.phrases) {
      const dur = Math.max(0.05, (ph.endMs - ph.startMs) / 1000);
      const wc = (ph.lyric || "").trim().split(/\s+/).filter(Boolean).length;
      if (wc > 0) rates.push(wc / dur);
    }
    if (rates.length) songAvgWps = rates.reduce((a, b) => a + b, 0) / rates.length;
  }

  const out: PhraseDecision[] = [];

  opts.phrases.forEach((ph, i) => {
    const absStart = opts.layerStartMs + ph.startMs;
    const absEnd = opts.layerStartMs + ph.endMs;
    const lyric = ph.lyric?.trim() ? ph.lyric.trim() : null;
    const conf = ph.confidence;
    const lyricUsable =
      Boolean(lyric) && (conf == null || conf >= CONFIDENCE_FLOOR);

    const durSec = Math.max(0.05, (ph.endMs - ph.startMs) / 1000);
    const wordCount = lyric ? lyric.split(/\s+/).filter(Boolean).length : 0;
    const wordsPerSec = wordCount > 0 ? wordCount / durSec : null;

    const energyWeight = weightFromEnergy(opts.section, ph.energy, wordsPerSec, songAvgWps);
    const energyPack = instructionsFor(energyWeight, opts.song, sectionDec, opts.role);

    let weight: EmotionalWeight = energyWeight;
    let weightSource: WeightSource = "energy";
    let instructions = energyPack.instructions;
    let rationale = energyPack.rationale + ",src:energy";

    if (lyricUsable && lyric) {
      const { weight: lw, keywordHit } = weightFromLyricText(lyric, opts.section);
      const norm = normalizeLine(lyric);
      const repeated =
        corpus.filter((line) => line === norm || (norm.length > 8 && line.includes(norm))).length >= 2;

      // Quiet repeated line in/near chorus → hook
      let lyricWeight = lw;
      if (repeated && (opts.section === "chorus" || opts.section === "pre_chorus" || repeated)) {
        lyricWeight = "hook";
      }

      const highConfidence =
        (keywordHit && repeated) ||
        (keywordHit && opts.section === "chorus") ||
        (repeated && opts.section === "chorus");

      const lyricPack = instructionsFor(lyricWeight, opts.song, sectionDec, opts.role);

      if (highConfidence) {
        weight = lyricWeight;
        weightSource = "lyric";
        instructions = lyricPack.instructions;
        rationale = lyricPack.rationale + ",src:lyric" + (repeated ? ",repeated" : "");
      } else if (keywordHit || repeated) {
        weight = lyricWeight;
        weightSource = "blended";
        instructions = blendInstructions(lyricPack.instructions, energyPack.instructions);
        rationale = lyricPack.rationale + ",src:blended" + (repeated ? ",repeated" : "");
      } else {
        // Ambiguous lyric — energy push/hold, lyric nuance for breath/reverb
        weight = energyWeight;
        weightSource = "blended";
        instructions = blendInstructions(lyricPack.instructions, energyPack.instructions);
        rationale = energyPack.rationale + ",src:blended_ambiguous";
      }
    }

    // Quiet energy in verse still softens even without lyrics
    if (weightSource === "energy" && opts.section === "verse" && ph.energy < 0.08) {
      instructions = {
        ...instructions,
        preserveBreath: true,
        vocalFaderRideDb: instructions.vocalFaderRideDb - 0.3,
        restraint: "preserve",
      };
    }

    out.push({
      phraseId: `${opts.role}_${opts.section}_p${i}`,
      timeRangeMs: [absStart, absEnd],
      lyric,
      emotionalWeight: weight,
      weightSource,
      role: opts.role,
      section: opts.section,
      instructions,
      rationale,
    });
  });

  return out;
}
