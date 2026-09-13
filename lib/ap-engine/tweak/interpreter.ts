/**
 * Prompt interpreter — maps plain language → decision map edits.
 * Deterministic rules first (no LLM required). Bounded safety caps.
 */
import type { InterpretedEdit, PromptInterpretResult } from "./types";

export type SectionHint = {
  id: string;
  label: string; // chorus, verse, ...
  startMs: number;
  endMs: number;
};

const LOUD_UP =
  /\b(loud(er|er)?|boost|push|hotter|bigger|more energy|turn up|raise|hit harder|more volume)\b/i;
const LOUD_DOWN =
  /\b(quiet(er)?|softer|pull back|turn down|lower|less loud|reduce volume|quieter)\b/i;
const PRESENCE_UP =
  /\b(forward|presence|up front|clear(er)?|crisp(er)?|intelligib|more vocal|vocal up)\b/i;
const PRESENCE_DOWN =
  /\b(back( in the mix)?|recess|less presence|vocal down|drown)\b/i;
const REVERB_UP =
  /\b(more reverb|wetter|more space|more room|ambient|wash(y)?)\b/i;
const REVERB_DOWN =
  /\b(less reverb|drier|dry(er)?|less space|less room|too wet|too much reverb)\b/i;
const CHORUS = /\b(chorus|hook|drop)\b/i;
const VERSE = /\b(verse)\b/i;
const BRIDGE = /\b(bridge)\b/i;
const INTRO = /\b(intro)\b/i;
const OUTRO = /\b(outro|ending)\b/i;
const ALL = /\b(whole (song|track)|everything|overall|all (of )?it|the mix)\b/i;

const MAX_GAIN_DB = 3.5;
const MIN_GAIN_DB = -4;
const MAX_PRESENCE_DB = 2.5;
const MAX_REVERB_DELTA = 0.35;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function matchSections(
  prompt: string,
  sections: SectionHint[],
  playbackMs?: number | null
): SectionHint[] {
  const p = prompt.toLowerCase();
  if (ALL.test(p) || (!CHORUS.test(p) && !VERSE.test(p) && !BRIDGE.test(p) && !INTRO.test(p) && !OUTRO.test(p))) {
    // If specific section words missing but playback position given for "this part"
    if (/\b(this part|that part|here|this bit)\b/i.test(p) && playbackMs != null) {
      const hit = sections.find(
        (s) => playbackMs >= s.startMs && playbackMs <= s.endMs
      );
      if (hit) return [hit];
    }
  }

  const picked: SectionHint[] = [];
  if (CHORUS.test(p)) {
    picked.push(...sections.filter((s) => /chorus|hook/i.test(s.label)));
  }
  if (VERSE.test(p)) {
    picked.push(...sections.filter((s) => /verse/i.test(s.label)));
  }
  if (BRIDGE.test(p)) {
    picked.push(...sections.filter((s) => /bridge/i.test(s.label)));
  }
  if (INTRO.test(p)) {
    picked.push(...sections.filter((s) => /intro/i.test(s.label)));
  }
  if (OUTRO.test(p)) {
    picked.push(...sections.filter((s) => /outro|end/i.test(s.label)));
  }

  if (picked.length) {
    // unique by id
    const seen = new Set<string>();
    return picked.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }

  // Default: song-level if no section keyword
  return [];
}

/**
 * Interpret a natural-language tweak request into bounded decision-map edits.
 */
export function interpretTweakPrompt(opts: {
  request: string;
  sections: SectionHint[];
  playbackMs?: number | null;
}): PromptInterpretResult {
  const request = (opts.request || "").trim();
  const ambiguity_flags: string[] = [];
  const edits: InterpretedEdit[] = [];

  if (!request) {
    return {
      request,
      interpreted_edits: [],
      ambiguity_flags: ["empty_request"],
      confirmation_needed: true,
      clarification: "What would you like to change?",
      plain_summary: "No request given.",
    };
  }

  const targets = matchSections(request, opts.sections, opts.playbackMs);
  const songLevel = targets.length === 0;

  let gainDb = 0;
  if (LOUD_UP.test(request)) gainDb += 1.5;
  if (LOUD_DOWN.test(request)) gainDb -= 1.5;
  if (/\ba lot\b|\bmuch\b|\bway\b/i.test(request) && gainDb !== 0) {
    gainDb *= 1.4;
  }
  if (/\ba (little|bit|touch)\b|\bslightly\b/i.test(request) && gainDb !== 0) {
    gainDb *= 0.55;
  }
  gainDb = clamp(gainDb, MIN_GAIN_DB, MAX_GAIN_DB);

  let presenceDb = 0;
  if (PRESENCE_UP.test(request)) presenceDb += 1.2;
  if (PRESENCE_DOWN.test(request)) presenceDb -= 1.0;
  presenceDb = clamp(presenceDb, -MAX_PRESENCE_DB, MAX_PRESENCE_DB);

  let reverbDelta = 0;
  if (REVERB_UP.test(request)) reverbDelta += 0.18;
  if (REVERB_DOWN.test(request)) reverbDelta -= 0.2;
  reverbDelta = clamp(reverbDelta, -MAX_REVERB_DELTA, MAX_REVERB_DELTA);

  // "hit harder" ambiguity → mild loudness + slight presence, report it
  if (/\bhit harder\b|\bmore punch\b/i.test(request) && gainDb === 0 && presenceDb === 0) {
    gainDb = 1.0;
    presenceDb = 0.6;
    ambiguity_flags.push("hit_harder_defaulted_to_loudness_and_presence");
  }

  if (gainDb === 0 && presenceDb === 0 && reverbDelta === 0) {
    return {
      request,
      interpreted_edits: [],
      ambiguity_flags: ["unmapped_request"],
      confirmation_needed: true,
      clarification:
        "Try something like “make the chorus louder”, “less reverb on the verse”, or “pull the vocal forward”.",
      plain_summary: "Couldn’t map that request to a mix edit yet.",
    };
  }

  const applyToTargets = (field: InterpretedEdit["field"], change: string, deltaDb?: number, deltaScale?: number) => {
    if (songLevel) {
      edits.push({
        scope: "song",
        target: "song",
        field,
        change,
        deltaDb,
        deltaScale,
      });
      return;
    }
    for (const s of targets) {
      edits.push({
        scope: "section",
        target: s.id,
        targetLabel: s.label,
        field,
        change,
        deltaDb,
        deltaScale,
      });
    }
  };

  if (gainDb !== 0) {
    const sign = gainDb > 0 ? "+" : "";
    applyToTargets("loudness_target", `${sign}${gainDb.toFixed(1)}dB`, gainDb);
  }
  if (presenceDb !== 0) {
    const sign = presenceDb > 0 ? "+" : "";
    applyToTargets(
      "vocal_presence_bias",
      presenceDb > 0 ? "+moderate" : "-moderate",
      presenceDb
    );
  }
  if (reverbDelta !== 0) {
    applyToTargets(
      "reverb_send_scale",
      reverbDelta > 0 ? `+${Math.round(reverbDelta * 100)}%` : `${Math.round(reverbDelta * 100)}%`,
      undefined,
      reverbDelta
    );
  }

  const parts: string[] = [];
  if (gainDb !== 0) {
    parts.push(
      `${gainDb > 0 ? "raised" : "lowered"} loudness by ${Math.abs(gainDb).toFixed(1)} dB` +
        (songLevel ? " overall" : ` on ${targets.map((t) => t.label).join(", ")}`)
    );
  }
  if (presenceDb !== 0) {
    parts.push(
      presenceDb > 0 ? "pulled the vocal forward a bit" : "set the vocal slightly back"
    );
  }
  if (reverbDelta !== 0) {
    parts.push(reverbDelta > 0 ? "added a touch of space" : "dried the reverb a bit");
  }
  parts.push("true peak held for safety");

  return {
    request,
    interpreted_edits: edits,
    ambiguity_flags,
    confirmation_needed: false,
    clarification: null,
    plain_summary: parts.join("; ") + ".",
  };
}
