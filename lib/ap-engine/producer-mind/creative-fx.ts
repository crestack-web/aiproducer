/**
 * Creative FX — stylistic decisions only (default OFF).
 * Not corrective. Sparse, density-capped, needs a structural reason.
 */
import type { PhraseDecision, SectionDecision, SongRead } from "./types";
import type { VocalRole } from "../roles";

export type DelayThrowType = "eighth_note_echo" | "quarter_echo" | "slap";

export type CreativeFxDecision = {
  delayThrow: {
    enabled: boolean;
    target: "last_word";
    type: DelayThrowType;
  } | null;
  filterAutomation: boolean;
  reverbCharacter: "default" | "ambient_large" | "none";
  stereoMovement: boolean;
  genreFx: string | null;
  reasoning: string;
};

const MAX_DELAY_THROWS_PER_SONG = 6;
const MAX_FILTER_MOMENTS = 2;

export function decideCreativeFxForPhrase(opts: {
  phrase: PhraseDecision;
  song: SongRead;
  section?: SectionDecision;
  role: VocalRole;
  styleIntimate: boolean;
  delayThrowsUsed: number;
  filterMomentsUsed: number;
  bpm?: number | null;
}): CreativeFxDecision {
  const { phrase, song, section, role, styleIntimate, delayThrowsUsed, filterMomentsUsed } =
    opts;

  const off: CreativeFxDecision = {
    delayThrow: null,
    filterAutomation: false,
    reverbCharacter: "default",
    stereoMovement: false,
    genreFx: null,
    reasoning: "default_off",
  };

  // Intimate / vulnerable: never creative FX
  if (
    phrase.emotionalWeight === "vulnerable" ||
    phrase.emotionalWeight === "intimate" ||
    phrase.instructions.restraint === "preserve" ||
    styleIntimate
  ) {
    return { ...off, reasoning: "restraint_no_fx" };
  }

  // Creative reverb only for atmospheric sections
  if (
    phrase.section === "bridge" ||
    phrase.section === "outro" ||
    phrase.section === "intro" ||
    section?.density === "release"
  ) {
    off.reverbCharacter = "ambient_large";
    off.reasoning = "atmospheric_section";
  }

  // Delay throw: last phrase of hook/chorus only, density capped
  const isHook =
    phrase.emotionalWeight === "hook" ||
    phrase.section === "chorus" ||
    section?.density === "push";

  const isLead = role === "lead";

  if (
    isHook &&
    isLead &&
    delayThrowsUsed < MAX_DELAY_THROWS_PER_SONG &&
    song.restraintVsPolish > 0.45
  ) {
    // Prefer end-of-section feel: later phrases in chorus (heuristic via phrase id index)
    const idNum = Number((phrase.phraseId.match(/p(\d+)$/) || [])[1] ?? 0);
    if (idNum >= 1 || phrase.emotionalWeight === "hook") {
      return {
        delayThrow: {
          enabled: true,
          target: "last_word",
          type: song.restraintVsPolish > 0.7 ? "eighth_note_echo" : "slap",
        },
        filterAutomation: false,
        reverbCharacter: off.reverbCharacter,
        stereoMovement: false,
        genreFx: null,
        reasoning: "hook_line_delay_throw",
      };
    }
  }

  // Filter automation: rare, structural only (pre-chorus → chorus transition)
  if (
    phrase.section === "pre_chorus" &&
    section?.density === "build" &&
    filterMomentsUsed < MAX_FILTER_MOMENTS &&
    isLead
  ) {
    return {
      ...off,
      filterAutomation: true,
      reasoning: "pre_drop_filter",
    };
  }

  // Stereo movement only on adlibs
  if (role === "adlib" && song.restraintVsPolish > 0.6) {
    return {
      ...off,
      stereoMovement: true,
      reasoning: "adlib_stereo_motion",
    };
  }

  return off;
}

/** Cap delay throws across phrases after independent decisions. */
export function enforceCreativeFxDensity(
  decisions: Array<{ phraseId: string; fx: CreativeFxDecision }>
): Array<{ phraseId: string; fx: CreativeFxDecision }> {
  let throws = 0;
  let filters = 0;
  return decisions.map((d) => {
    let fx = { ...d.fx };
    if (fx.delayThrow?.enabled) {
      throws += 1;
      if (throws > MAX_DELAY_THROWS_PER_SONG) {
        fx = { ...fx, delayThrow: null, reasoning: fx.reasoning + ",density_cap_throw" };
      }
    }
    if (fx.filterAutomation) {
      filters += 1;
      if (filters > MAX_FILTER_MOMENTS) {
        fx = { ...fx, filterAutomation: false, reasoning: fx.reasoning + ",density_cap_filter" };
      }
    }
    return { phraseId: d.phraseId, fx };
  });
}

export { MAX_DELAY_THROWS_PER_SONG, MAX_FILTER_MOMENTS };
