/**
 * Taste & Iteration Agent — sits between artist prompts and the tweak/render path.
 */
import type { PromptInterpretResult } from "./types";
import { interpretTweakPrompt, type SectionHint } from "./interpreter";
import { buildVariations, isAmbiguousRequest, type TweakVariation } from "./variations";
import {
  parseTasteProfile,
  logTweakIntoTaste,
  tasteDefaultHints,
  detectIterationLoop,
  type TasteProfile,
} from "./taste-profile";
import type { CommercialCheck } from "./commercial-readiness";

export type IterationAdvice = {
  interpret: PromptInterpretResult | null;
  variations: TweakVariation[] | null;
  useVariations: boolean;
  tasteHints: string[];
  loopNote: string | null;
  doneSignal: string | null;
  plain: string;
};

export function runIterationAgent(opts: {
  request: string;
  sections: SectionHint[];
  playbackMs?: number | null;
  tasteRaw?: unknown;
  /** Artist picked a variation id */
  variationId?: string | null;
  commercial?: CommercialCheck | null;
  /** How close to "settled" (e.g. after N successful non-revert tweaks) */
  settledScore?: number;
}): IterationAdvice {
  const taste = parseTasteProfile(opts.tasteRaw);
  const tasteHints = tasteDefaultHints(taste);
  const loopNote = detectIterationLoop(taste);

  const request = (opts.request || "").trim();

  // Variation path
  if (isAmbiguousRequest(request) && !opts.variationId) {
    const variations = buildVariations({
      request,
      sections: opts.sections,
      playbackMs: opts.playbackMs,
    });
    return {
      interpret: null,
      variations,
      useVariations: true,
      tasteHints,
      loopNote,
      doneSignal: null,
      plain:
        "That could mean a few different things — pick the direction that matches what you hear:",
    };
  }

  let interpret: PromptInterpretResult;
  if (opts.variationId && isAmbiguousRequest(request)) {
    const variations = buildVariations({
      request,
      sections: opts.sections,
      playbackMs: opts.playbackMs,
    });
    const picked = variations?.find((v) => v.id === opts.variationId) || variations?.[0];
    interpret = picked?.interpret || interpretTweakPrompt({
      request,
      sections: opts.sections,
      playbackMs: opts.playbackMs,
    });
  } else {
    interpret = interpretTweakPrompt({
      request,
      sections: opts.sections,
      playbackMs: opts.playbackMs,
    });
  }

  // Done signal (never "stop")
  let doneSignal: string | null = null;
  const settled = opts.settledScore ?? 0;
  const commercialOk = opts.commercial?.passed !== false && !(opts.commercial?.issues?.length);
  if (settled >= 2 && commercialOk && !loopNote) {
    doneSignal =
      "This one’s tracking well against what you usually go for, and it’s clean for export — your call if you want to keep exploring.";
  } else if (commercialOk && settled >= 1) {
    doneSignal = null;
  }

  return {
    interpret,
    variations: null,
    useVariations: false,
    tasteHints,
    loopNote,
    doneSignal,
    plain: interpret.plain_summary,
  };
}

export function applyTasteLog(
  tasteRaw: unknown,
  interpret: PromptInterpretResult,
  newSession: boolean
): TasteProfile {
  let profile = parseTasteProfile(tasteRaw);
  for (const e of interpret.interpreted_edits) {
    profile = logTweakIntoTaste(profile, {
      prompt: interpret.request,
      field: e.field,
      deltaDb: e.deltaDb,
      deltaScale: e.deltaScale,
      newSession,
    });
    newSession = false;
  }
  if (!interpret.interpreted_edits.length) {
    profile = logTweakIntoTaste(profile, {
      prompt: interpret.request,
      newSession,
    });
  }
  return profile;
}

export type { TasteProfile, TweakVariation, CommercialCheck };
