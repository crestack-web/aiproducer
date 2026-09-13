/**
 * Ambiguous prompt → 2–3 labeled variations. Clear requests skip this.
 */
import type { InterpretedEdit, PromptInterpretResult } from "./types";
import { interpretTweakPrompt, type SectionHint } from "./interpreter";

export type TweakVariation = {
  id: string;
  label: string;
  plain: string;
  interpret: PromptInterpretResult;
};

const AMBIGUOUS =
  /\b(hit harder|more punch|make it hit|more energy|beef(ier)?|fatter|stronger|more power|more impact)\b/i;

export function isAmbiguousRequest(request: string): boolean {
  return AMBIGUOUS.test(request || "");
}

/**
 * Build variation set for ambiguous requests. Unambiguous → single path (caller skips).
 */
export function buildVariations(opts: {
  request: string;
  sections: SectionHint[];
  playbackMs?: number | null;
}): TweakVariation[] | null {
  const request = (opts.request || "").trim();
  if (!isAmbiguousRequest(request)) return null;

  const base = interpretTweakPrompt({
    request,
    sections: opts.sections,
    playbackMs: opts.playbackMs,
  });

  // Force three interpretations via synthetic prompts
  const variants: Array<{ id: string; label: string; seed: string }> = [
    {
      id: "compression",
      label: "More punch via compression",
      seed: "make it louder and tighter, more punch",
    },
    {
      id: "saturation",
      label: "More warmth via saturation / density",
      seed: "make the vocal a bit more forward and present",
    },
    {
      id: "both",
      label: "Both, moderate",
      seed: "make the chorus a little louder and pull the vocal forward a bit",
    },
  ];

  return variants.map((v) => {
    const interpret = interpretTweakPrompt({
      request: v.seed,
      sections: opts.sections,
      playbackMs: opts.playbackMs,
    });
    // Keep original request text on the result for logging
    interpret.request = request;
    interpret.plain_summary = `${v.label}: ${interpret.plain_summary}`;
    if (!interpret.interpreted_edits.length && base.interpreted_edits.length) {
      interpret.interpreted_edits = base.interpreted_edits;
      interpret.plain_summary = v.label;
    }
    return {
      id: v.id,
      label: v.label,
      plain: interpret.plain_summary,
      interpret,
    };
  });
}
