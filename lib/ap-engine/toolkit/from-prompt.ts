/**
 * Map plain-language requests → tool calls (parametric, not fixed schema).
 */
import type { ToolCall, ToolkitDecision } from "./types";
import type { SectionHint } from "../tweak/interpreter";

const MAX_CALLS = 4;

function matchSections(prompt: string, sections: SectionHint[]): SectionHint[] {
  const p = prompt.toLowerCase();
  const picked: SectionHint[] = [];
  if (/\bchorus|hook\b/.test(p)) picked.push(...sections.filter((s) => /chorus|hook/i.test(s.label)));
  if (/\bverse\b/.test(p)) picked.push(...sections.filter((s) => /verse/i.test(s.label)));
  if (/\bbridge\b/.test(p)) picked.push(...sections.filter((s) => /bridge/i.test(s.label)));
  if (/\bintro\b/.test(p)) picked.push(...sections.filter((s) => /intro/i.test(s.label)));
  if (/\boutro|ending\b/.test(p)) picked.push(...sections.filter((s) => /outro|end/i.test(s.label)));
  // unique
  const seen = new Set<string>();
  return picked.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

export function promptToToolCalls(opts: {
  request: string;
  sections: SectionHint[];
  playbackMs?: number | null;
}): ToolkitDecision {
  const request = (opts.request || "").trim();
  const calls: ToolCall[] = [];
  const sections = matchSections(request, opts.sections);
  const scope = sections.length ? ("section" as const) : ("song" as const);
  const targets = sections.length ? sections : [{ id: "song", label: "song", startMs: 0, endMs: 0 }];

  const pushForTargets = (base: Omit<ToolCall, "target" | "scope">) => {
    for (const t of targets) {
      calls.push({
        ...base,
        scope,
        target: t.id,
        reasoning: base.reasoning,
      });
    }
  };

  // Air / presence → EQ
  if (/\b(air|brighter|more presence|forward|clear(er)?|crisp)\b/i.test(request)) {
    pushForTargets({
      tool: "eq",
      params: { type: "highshelf", freq: 11000, gainDb: 1.8, q: 0.7 },
      reasoning: "artist asked for air/presence",
    });
  }
  if (/\b(mud|boxy|boomy|muddy)\b/i.test(request)) {
    pushForTargets({
      tool: "eq",
      params: { type: "peak", freq: 280, gainDb: -2.5, q: 1.1 },
      reasoning: "cut mud",
    });
  }
  if (/\b(harsh|sibilant|sss)\b/i.test(request)) {
    pushForTargets({
      tool: "deesser",
      params: { amount: 2 },
      reasoning: "tame harshness/sibilance",
    });
  }

  // Reverb
  if (/\b(more reverb|more space|spacious|wetter|ambient)\b/i.test(request)) {
    const hall = /\b(hall|ambient|huge|wash)\b/i.test(request);
    pushForTargets({
      tool: "reverb",
      params: {
        type: hall ? "hall" : "plate",
        decay: hall ? "2.4s" : "1.6s",
        pre_delay: "25ms",
        wet_mix: hall ? "22%" : "16%",
      },
      reasoning: "more space requested",
    });
  }
  if (/\b(less reverb|drier|dry(er)?|too wet)\b/i.test(request)) {
    pushForTargets({
      tool: "reverb",
      params: { type: "room", decay: "0.7s", wet_mix: "6%" },
      reasoning: "drier vocal space",
    });
  }

  // Delay / throw
  if (/\b(delay throw|echo|slap(back)?)\b/i.test(request)) {
    pushForTargets({
      tool: "delay",
      params: { type: "slap", delay_ms: 95, wet_mix: "20%", feedback: "20%" },
      reasoning: "delay/echo request",
    });
  }

  // Dynamics
  if (/\b(punch|tighter|more compression|hit harder|glue)\b/i.test(request)) {
    pushForTargets({
      tool: "compressor",
      params: { ratio: 3.5, thresholdDb: -16, attackMs: 8, releaseMs: 100, makeupDb: 1.5 },
      reasoning: "punch/compression request",
    });
  }

  // Saturation
  if (/\b(warm(er)?|saturat|tape|tube|fatter|drive)\b/i.test(request)) {
    pushForTargets({
      tool: "saturation",
      params: { type: "tape", drive: 0.22 },
      reasoning: "warmth/saturation request",
    });
  }

  // Underwater / telephone
  if (/\b(underwater|muffled|submerged)\b/i.test(request)) {
    pushForTargets({
      tool: "filter",
      params: { type: "lowpass", freq: 1200 },
      reasoning: "underwater / muffled moment",
    });
    pushForTargets({
      tool: "reverb",
      params: { type: "hall", wet_mix: "28%", decay: "2.8s" },
      reasoning: "underwater space",
    });
  }
  if (/\b(telephone|phone|radio)\b/i.test(request)) {
    pushForTargets({
      tool: "filter",
      params: { type: "highpass", freq: 400 },
      reasoning: "telephone character HPF",
    });
    pushForTargets({
      tool: "eq",
      params: { type: "peak", freq: 1800, gainDb: 3, q: 0.9 },
      reasoning: "telephone mid bump",
    });
  }

  // Louder (gain via mild compressor makeup + limiter safety is elsewhere)
  if (/\b(loud(er)?|turn up|raise|boost volume)\b/i.test(request) && !calls.some((c) => c.tool === "compressor")) {
    pushForTargets({
      tool: "compressor",
      params: { ratio: 2.2, thresholdDb: -14, attackMs: 15, releaseMs: 120, makeupDb: 2.2 },
      reasoning: "level up via controlled makeup",
    });
  }

  // Arrangement tools (strings etc.) — not executed yet; surface as suggestion
  const arrangementSuggestions: string[] = [];
  if (/\b(strings|pads?|synth|piano|keys|guitar|extra drums?)\b/i.test(request)) {
    arrangementSuggestions.push(
      "Arrangement tool (sample instrument) is in the palette but requires confirmation before render — coming next."
    );
  }

  const capped = calls.length > MAX_CALLS;
  const finalCalls = calls.slice(0, MAX_CALLS);

  const parts = finalCalls.map(
    (c) => `${c.tool}${c.target && c.target !== "song" ? `@${c.target}` : ""}`
  );
  let plain = finalCalls.length
    ? `Toolkit: ${parts.join(", ")}.`
    : "No parametric tool matched yet — try a more specific mix request.";
  if (arrangementSuggestions.length) {
    plain += " " + arrangementSuggestions.join(" ");
  }
  if (capped) plain += " Limited to 4 tool changes for safety.";

  return {
    version: "toolkit-1",
    tool_calls: finalCalls,
    capped,
    plain_summary: plain,
  };
}
