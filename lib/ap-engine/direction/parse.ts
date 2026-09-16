/**
 * Rule-based production direction parser. No LLM on the audio path.
 */
import type { ProductionDirection } from "./types";
import { clampUnit } from "./validate";

function n(s: string) {
  return s.toLowerCase().replace(/[_-]+/g, " ").trim();
}

type ParseResult = {
  direction: ProductionDirection;
  confidence: number;
  plainSummary: string;
  matched: string[];
};

/**
 * Parse natural language into a partial ProductionDirection (deltas -1..1).
 */
export function parseProductionDirection(prompt: string): ParseResult {
  const p = n(prompt);
  const matched: string[] = [];
  const d: ProductionDirection = {};
  let conf = 0.35;

  if (!p) {
    return {
      direction: {},
      confidence: 0,
      plainSummary: "No direction yet.",
      matched: [],
    };
  }

  const has = (re: RegExp) => re.test(p);

  // Sections in scope
  const sections: string[] = [];
  if (has(/\bchorus|hook|drop\b/)) sections.push("chorus");
  if (has(/\bverse\b/)) sections.push("verse");
  if (has(/\bbridge\b/)) sections.push("bridge");
  if (has(/\bintro\b/)) sections.push("intro");
  if (has(/\boutro|ending\b/)) sections.push("outro");
  if (sections.length) {
    d.scope = { ...(d.scope || {}), sections };
    conf = Math.max(conf, 0.7);
  }

  // Roles
  const roles: string[] = [];
  if (has(/\blead|main vocal|my voice|the vocal\b/)) roles.push("lead");
  if (has(/\bdouble|stack\b/)) roles.push("double");
  if (has(/\bharmon/)) roles.push("harmony");
  if (has(/\bad[- ]?lib/)) roles.push("adlib");
  if (has(/\bbackground|bgv|backs\b/)) roles.push("background");
  if (roles.length) {
    d.scope = { ...(d.scope || {}), roles };
    conf = Math.max(conf, 0.72);
  }

  const touchSection = (key: string, patch: NonNullable<ProductionDirection["sections"]>[string]) => {
    d.sections = d.sections || {};
    d.sections[key] = { ...(d.sections[key] || {}), ...patch };
  };
  const touchRole = (key: string, patch: NonNullable<ProductionDirection["roles"]>[string]) => {
    d.roles = d.roles || {};
    d.roles[key] = { ...(d.roles[key] || {}), ...patch };
  };

  // --- Vocal presence ---
  if (has(/\b(bring .{0,20}(voice|vocal).{0,12}forward|vocal (up|forward|present)|more presence|voice (up|forward)|too (quiet|buried|hidden)|buried)\b/)) {
    d.vocal = { ...(d.vocal || {}), leadPresence: 0.55 };
    d.beatIntegration = { ...(d.beatIntegration || {}), vocalForwardness: 0.45 };
    matched.push("lead_presence_up");
    conf = Math.max(conf, 0.9);
  }
  if (has(/\b(sit (back|inside|in the mix)|too present|on top of the beat|stuck on top|blend (in|more)|less presence)\b/)) {
    d.vocal = { ...(d.vocal || {}), leadPresence: -0.35 };
    d.beatIntegration = {
      ...(d.beatIntegration || {}),
      vocalForwardness: -0.35,
      beatRespect: 0.4,
      masking: 0.25,
    };
    matched.push("integrate_with_beat");
    conf = Math.max(conf, 0.88);
  }
  if (has(/\b(breathe around|room for the vocal|beat breathe|make (the )?beat breathe)\b/)) {
    d.beatIntegration = {
      ...(d.beatIntegration || {}),
      ducking: 0.35,
      masking: 0.3,
      beatRespect: 0.25,
    };
    matched.push("beat_breathe");
    conf = Math.max(conf, 0.86);
  }

  // --- Space ---
  if (has(/\b(too dry|more space|more room|more atmosphere|wetter|more reverb|give .{0,12}space)\b/)) {
    d.space = { ...(d.space || {}), dryness: -0.45, ambience: 0.45, reverb: 0.4 };
    matched.push("space_up");
    conf = Math.max(conf, 0.9);
  }
  if (has(/\b(too wet|too much (reverb|space)|drier|less reverb|less space|closer)\b/)) {
    d.space = { ...(d.space || {}), dryness: 0.45, ambience: -0.4, reverb: -0.35 };
    d.vocal = { ...(d.vocal || {}), intimacy: 0.35 };
    matched.push("space_down_closer");
    conf = Math.max(conf, 0.88);
  }
  if (has(/\bwider|more width|open (it|up)|stereo\b/)) {
    d.space = { ...(d.space || {}), width: 0.55 };
    matched.push("width_up");
    conf = Math.max(conf, 0.92);
  }
  if (has(/\bnarrower|centered|keep .{0,10}center|center(ed)?\b/)) {
    // lead centered often paired with harmony wide
    if (has(/\blead\b/) || has(/\bkeep the lead\b/)) {
      touchRole("lead", { width: -0.5 });
      matched.push("lead_centered");
    } else if (!has(/\bharmon|ad[- ]?lib|background/)) {
      d.space = { ...(d.space || {}), width: -0.35 };
      matched.push("width_down");
    }
    conf = Math.max(conf, 0.85);
  }

  // --- Layers ---
  if (has(/\b(harmon).{0,30}(out|forward|up|bigger|shine|wider)\b/) || has(/\bbring the harmon/)) {
    touchRole("harmony", {
      presence: 0.45,
      width: has(/\bwide/) ? 0.5 : 0.25,
      space: 0.2,
    });
    d.layers = { ...(d.layers || {}), harmonies: 0.45 };
    matched.push("harmony_forward");
    conf = Math.max(conf, 0.9);
  }
  if (has(/\b(ad[- ]?lib).{0,30}(out|forward|up|shine|bigger)\b/) || has(/\bbring the ad/)) {
    touchRole("adlib", { presence: 0.5, space: 0.25 });
    d.layers = { ...(d.layers || {}), adlibs: 0.5 };
    matched.push("adlib_forward");
    conf = Math.max(conf, 0.9);
  }
  if (has(/\b(double).{0,25}(less|soft|tight|quiet)\b/)) {
    touchRole("double", { presence: -0.4 });
    d.layers = { ...(d.layers || {}), doubles: -0.35 };
    matched.push("doubles_down");
    conf = Math.max(conf, 0.86);
  }
  if (has(/\bbackground.{0,20}(wide|wider|open)\b/)) {
    touchRole("background", { width: 0.55, space: 0.35 });
    d.layers = { ...(d.layers || {}), backgrounds: 0.3 };
    matched.push("bg_wide");
    conf = Math.max(conf, 0.86);
  }

  // --- Arrangement / section energy ---
  if (has(/\bchorus.{0,40}(harder|bigger|more energy|hit|lift|stronger|open)\b/) || has(/\b(make the )?chorus (hit|bigger|stronger)/)) {
    touchSection("chorus", { energy: 0.55, width: 0.4, space: 0.35 });
    d.arrangement = { ...(d.arrangement || {}), chorusEnergy: 0.55 };
    d.character = { ...(d.character || {}), energetic: 0.4 };
    matched.push("chorus_lift");
    conf = Math.max(conf, 0.91);
  }
  if (has(/\bverse.{0,40}(intimate|close|softer|quieter|dry)\b/) || has(/\bmake the verse intimate\b/)) {
    touchSection("verse", { intimacy: 0.55, space: -0.25, energy: -0.2, width: -0.25 });
    d.arrangement = { ...(d.arrangement || {}), verseEnergy: -0.25 };
    d.character = { ...(d.character || {}), intimate: 0.5 };
    matched.push("verse_intimate");
    conf = Math.max(conf, 0.9);
  }
  if (has(/\bverse.{0,30}(space|atmosphere|room)\b/) && has(/\bverse\b/)) {
    touchSection("verse", { space: 0.4, intimacy: 0.2 });
    matched.push("verse_space");
    conf = Math.max(conf, 0.85);
  }
  if (has(/\b(build into|build to) the chorus\b/)) {
    touchSection("pre_chorus", { energy: 0.35, width: 0.25, space: 0.2 });
    touchSection("chorus", { energy: 0.4, width: 0.3 });
    matched.push("build_to_chorus");
    conf = Math.max(conf, 0.82);
  }

  // --- Character ---
  if (has(/\bintimate\b/)) {
    d.character = { ...(d.character || {}), intimate: 0.55 };
    d.vocal = { ...(d.vocal || {}), intimacy: 0.45 };
    conf = Math.max(conf, 0.8);
  }
  if (has(/\batmospheric|dreamy|airy\b/)) {
    d.character = { ...(d.character || {}), atmospheric: 0.5 };
    d.space = { ...(d.space || {}), ambience: 0.4, reverb: 0.35 };
    conf = Math.max(conf, 0.8);
  }
  if (has(/\bpolished|clean(er)?|pro(fessional)?\b/)) {
    d.character = { ...(d.character || {}), polished: 0.45 };
    conf = Math.max(conf, 0.7);
  }
  if (has(/\braw|gritty|aggressive\b/)) {
    d.character = { ...(d.character || {}), raw: 0.4, energetic: 0.25 };
    d.vocal = { ...(d.vocal || {}), aggression: 0.35 };
    conf = Math.max(conf, 0.75);
  }

  // --- Vague ---
  if (has(/\bmake it better|improve (it|the mix|the song)|fix it\b/) && matched.length === 0) {
    d.character = { ...(d.character || {}), polished: 0.25 };
    d.beatIntegration = { ...(d.beatIntegration || {}), masking: 0.15, vocalForwardness: 0.1 };
    d.vocal = { ...(d.vocal || {}), leadPresence: 0.12 };
    matched.push("conservative_polish");
    conf = 0.4;
  }

  // Section-specific width on chorus
  if (has(/\bchorus\b/) && has(/\bwider|width|open\b/)) {
    touchSection("chorus", { width: 0.55, space: 0.3 });
  }
  if (has(/\bchorus\b/) && has(/\bmore space|atmosphere\b/)) {
    touchSection("chorus", { space: 0.5, width: 0.25 });
  }

  // Clamp nested values
  const clampObj = (o?: Record<string, number | undefined>) => {
    if (!o) return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === "number") o[k] = clampUnit(v);
    }
  };
  clampObj(d.vocal as Record<string, number | undefined>);
  clampObj(d.layers as Record<string, number | undefined>);
  clampObj(d.space as Record<string, number | undefined>);
  clampObj(d.arrangement as Record<string, number | undefined>);
  clampObj(d.beatIntegration as Record<string, number | undefined>);
  clampObj(d.dynamics as Record<string, number | undefined>);
  clampObj(d.character as Record<string, number | undefined>);

  d.confidence = conf;
  d.sourcePrompt = prompt.trim().slice(0, 500);

  const plainSummary = summarize(d, matched);
  d.plainSummary = plainSummary;

  return { direction: d, confidence: conf, plainSummary, matched };
}

function summarize(d: ProductionDirection, matched: string[]): string {
  const bits: string[] = [];
  if (matched.includes("verse_intimate")) bits.push("keep the verse more intimate");
  if (matched.includes("chorus_lift")) bits.push("give the chorus more lift");
  if (matched.includes("space_up")) bits.push("open up the space a bit");
  if (matched.includes("space_down_closer")) bits.push("bring the vocal closer");
  if (matched.includes("width_up")) bits.push("add width");
  if (matched.includes("lead_centered")) bits.push("keep the lead centered");
  if (matched.includes("harmony_forward")) bits.push("bring the harmonies forward");
  if (matched.includes("adlib_forward")) bits.push("let the ad-libs come forward");
  if (matched.includes("doubles_down")) bits.push("soften the doubles");
  if (matched.includes("bg_wide")) bits.push("widen the backgrounds");
  if (matched.includes("lead_presence_up")) bits.push("bring the lead forward");
  if (matched.includes("integrate_with_beat")) bits.push("sit the vocal more inside the beat");
  if (matched.includes("beat_breathe")) bits.push("let the beat breathe around the vocal");
  if (matched.includes("conservative_polish")) bits.push("add a light polish overall");
  if (matched.includes("build_to_chorus")) bits.push("build into the chorus");
  if (matched.includes("verse_space")) bits.push("give the verse a little more air");

  if (!bits.length) {
    if ((d.confidence || 0) < 0.45) {
      return "I’ll keep production tasteful and balanced unless you get more specific.";
    }
    return "I’ll carry that into the next production.";
  }
  if (bits.length === 1) return `Got it — I’ll ${bits[0]}.`;
  if (bits.length === 2) return `Got it — I’ll ${bits[0]} and ${bits[1]}.`;
  return `Got it — I’ll ${bits.slice(0, -1).join(", ")}, and ${bits[bits.length - 1]}.`;
}
