/**
 * Phrase-level emotional read.
 * Uses lyric text when available; otherwise energy + section position heuristics.
 * LLM may later refine EmotionalWeight from lyrics only (never audio bytes).
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

const HOOK_WORDS = /\b(love|baby|yeah|whoa|oh|night|heart|feel|dance|run|stay|never|always)\b/i;
const VULN_WORDS = /\b(sorry|miss|alone|cry|hurt|afraid|please|lost|broken|tear)\b/i;
const AGGR_WORDS = /\b(fight|fire|power|kill|strong|win|hate|rage|boss)\b/i;

function weightFromLyric(text: string | null, section: SongSectionKind): EmotionalWeight {
  if (text) {
    if (VULN_WORDS.test(text)) return "vulnerable";
    if (AGGR_WORDS.test(text)) return "aggressive";
    if (HOOK_WORDS.test(text) && (section === "chorus" || section === "pre_chorus")) return "hook";
  }
  if (section === "chorus") return "hook";
  if (section === "verse") return "intimate";
  if (section === "bridge") return "transitional";
  if (section === "outro" || section === "intro") return "intimate";
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

  // Support roles never out-push lead hooks
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

export function readPhraseLevel(opts: {
  song: SongRead;
  sections: SectionDecision[];
  role: VocalRole;
  section: SongSectionKind;
  layerStartMs: number;
  phrases: Array<{ startMs: number; endMs: number; energy: number; lyric?: string | null }>;
}): PhraseDecision[] {
  const sectionDec = opts.sections.find((s) => s.section === opts.section);
  const out: PhraseDecision[] = [];

  opts.phrases.forEach((ph, i) => {
    const absStart = opts.layerStartMs + ph.startMs;
    const absEnd = opts.layerStartMs + ph.endMs;
    const lyric = ph.lyric ?? null;
    const weight = weightFromLyric(lyric, opts.section);
    const { instructions, rationale } = instructionsFor(weight, opts.song, sectionDec, opts.role);

    // Quiet phrases in verse → lean vulnerable
    if (weight === "neutral" && opts.section === "verse" && ph.energy < 0.08) {
      instructions.preserveBreath = true;
      instructions.vocalFaderRideDb -= 0.3;
      instructions.restraint = "preserve";
    }

    out.push({
      phraseId: `${opts.role}_${opts.section}_p${i}`,
      timeRangeMs: [absStart, absEnd],
      lyric,
      emotionalWeight: weight,
      role: opts.role,
      section: opts.section,
      instructions,
      rationale,
    });
  });

  return out;
}
