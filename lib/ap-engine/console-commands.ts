import { findPresetByPhrase, applyFxPreset, FX_DEFAULTS } from "./fx-presets";
import type { AutomationParamKey } from "./fx-automation";

/**
 * Console DAW mindset — map plain language → local actions AP can execute
 * instantly in the Console (mute/solo/pan/gain/fx/transport/selection).
 * Server /tweak still handles offline take/master processing.
 */

export type ConsoleTrackRef = {
  id: string;
  label: string;
  kind: "beat" | "vocal";
  hasAudio?: boolean;
};

export type ConsoleSectionRef = {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
};

export type DawAction =
  | { type: "mute"; trackId: string; value: boolean; label: string }
  | { type: "solo"; trackId: string | null; label: string }
  | { type: "pan"; trackId: string; value: number; label: string }
  | { type: "gain"; trackId: string; deltaDb: number; label: string }
  | {
      type: "fx";
      trackId: string;
      key:
        | "reverb"
        | "delay"
        | "compress"
        | "saturation"
        | "eqLowDb"
        | "eqMidDb"
        | "eqHighDb"
        | "width"
        | "air"
        | "deEss"
        | "gate"
        | "chorus"
        | "doubler"
        | "plateReverb"
        | "slapDelay"
        | "telephone"
        | "limiter"
        | "rotorMix"
        | "springMix";
      delta: number;
      label: string;
    }
  | { type: "fx_set"; trackId: string; patch: Record<string, number>; label: string }
  | { type: "fx_preset"; trackId: string; presetId: string; label: string }
  | {
      type: "automation_ramp";
      trackId: string;
      param: AutomationParamKey;
      startMs: number;
      endMs: number;
      startValue: number;
      endValue: number;
      label: string;
    }
  | {
      type: "automation_clear";
      trackId: string;
      param: AutomationParamKey;
      label: string;
    }
  | { type: "select"; trackId: string; label: string }
  | { type: "arm"; trackId: string; label: string }
  | { type: "play"; label: string }
  | { type: "pause"; label: string }
  | { type: "seek"; ms: number; label: string }
  | { type: "expand"; trackId: string; label: string }
  | { type: "open_fx"; trackId: string; label: string }
  | {
      type: "choir";
      trackId: string;
      mode: "double" | "choir_light" | "choir_full" | "chorus_lift";
      label: string;
    }
  | { type: "rename"; trackId: string; title: string; label: string }
  | { type: "color"; trackId: string | "all"; color: string; label: string };

export type ConsoleCommandPlan = {
  actions: DawAction[];
  /** Still call /tweak for offline take/master processing */
  needsServer: boolean;
  /** User-facing one-liner */
  summary: string;
  matchedTrackIds: string[];
};

function norm(s: string) {
  return s.toLowerCase().replace(/[_-]+/g, " ").trim();
}

function findTracks(
  prompt: string,
  tracks: ConsoleTrackRef[],
  selectedId: string | null
): ConsoleTrackRef[] {
  const p = norm(prompt);
  const vocals = tracks.filter((t) => t.kind === "vocal");
  const hits: ConsoleTrackRef[] = [];

  for (const t of tracks) {
    const label = norm(t.label);
    if (!label) continue;
    // whole-word-ish match on label tokens
    const tokens = label.split(/\s+/).filter((x) => x.length > 2);
    if (tokens.some((tok) => new RegExp(`\\b${tok}\\b`, "i").test(p))) {
      hits.push(t);
      continue;
    }
    if (label.length > 2 && p.includes(label)) hits.push(t);
  }

  // Role keywords
  const roleMap: [RegExp, RegExp][] = [
    [/\b(lead|main|melody)\b/, /\blead|main|melody\b/],
    [/\b(harmony|harm|bgv|back(ing)?)\b/, /\bharmon|bgv|back\b/],
    [/\b(adlib|ad[- ]?lib|ad libs)\b/, /\badlib|ad[- ]?lib\b/],
    [/\b(double|stack)\b/, /\bdouble|stack\b/],
    [/\bbeat|instrumental|instrument\b/, /\bbeat\b/],
  ];
  for (const [promptRe, labelRe] of roleMap) {
    if (promptRe.test(p)) {
      for (const t of tracks) {
        if (labelRe.test(norm(t.label)) || (promptRe.source.includes("beat") && t.kind === "beat")) {
          if (!hits.find((h) => h.id === t.id)) hits.push(t);
        }
      }
    }
  }

  if (hits.length) return hits;
  // "this track" / no name → selected vocal, else all vocals for mix verbs
  if (/\b(this track|this layer|selected|current)\b/.test(p) && selectedId) {
    const sel = tracks.find((t) => t.id === selectedId);
    if (sel) return [sel];
  }
  if (selectedId && selectedId !== "beat") {
    const sel = tracks.find((t) => t.id === selectedId);
    if (sel && !/\b(song|mix|master|everything|all tracks)\b/.test(p)) return [sel];
  }
  return [];
}

function matchSection(prompt: string, sections: ConsoleSectionRef[]): ConsoleSectionRef | null {
  const p = norm(prompt);
  const tests: [RegExp, RegExp][] = [
    [/\bchorus|hook\b/, /chorus|hook/i],
    [/\bverse\s*1\b/, /verse\s*1/i],
    [/\bverse\s*2\b/, /verse\s*2/i],
    [/\bverse\b/, /verse/i],
    [/\bbridge\b/, /bridge/i],
    [/\bintro\b/, /intro/i],
    [/\boutro|ending\b/, /outro|end/i],
  ];
  for (const [pr, lr] of tests) {
    if (pr.test(p)) {
      const hit = sections.find((s) => lr.test(s.label));
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Parse artist language into Console DAW actions.
 * Prefer local execution; flag needsServer when offline audio work is implied.
 */

/** Map natural language effect names → automation/FX param + default amount */
const EFFECT_PHRASES: {
  re: RegExp;
  param: AutomationParamKey;
  amount: number;
  label: string;
}[] = [
  { re: /\btelephone|phone\s*effect|lo-?fi\s*phone\b/, param: "telephone", amount: 0.65, label: "Telephone" },
  { re: /\b(room\s+)?reverb|wetter|more\s+space\b/, param: "reverb", amount: 0.4, label: "Reverb" },
  { re: /\bplate(\s+reverb)?\b/, param: "plateReverb", amount: 0.4, label: "Plate" },
  { re: /\b(echo\s+)?delay\b/, param: "delay", amount: 0.35, label: "Delay" },
  { re: /\bslap(back)?(\s+delay)?\b/, param: "slapDelay", amount: 0.4, label: "Slap" },
  { re: /\bchorus(\s+effect)?\b/, param: "chorus", amount: 0.4, label: "Chorus" },
  { re: /\b(vocal\s+)?doubler|double(r)?\b/, param: "doubler", amount: 0.45, label: "Doubler" },
  { re: /\bcompress(or|ion)?|glue\b/, param: "compress", amount: 0.5, label: "Compress" },
  { re: /\bsaturat(e|ion)|warmth|drive\b/, param: "saturation", amount: 0.4, label: "Saturation" },
  { re: /\bde-?ess(er)?\b/, param: "deEss", amount: 0.45, label: "De-ess" },
  { re: /\blimiter|limit(ing)?\b/, param: "limiter", amount: 0.5, label: "Limiter" },
  { re: /\bwidth|wider|stereo\s*width\b/, param: "width", amount: 0.45, label: "Width" },
  { re: /\bair|brightness|brighter\b/, param: "air", amount: 0.4, label: "Air" },
  { re: /\bhigh-?pass|hpf\b/, param: "highPassHz", amount: 120, label: "High-pass" },
  { re: /\blow-?pass|lpf\b/, param: "lowPassHz", amount: 4000, label: "Low-pass" },
  { re: /\beq\s*low|bass\s*(up|boost)\b/, param: "eqLowDb", amount: 2, label: "EQ low" },
  { re: /\beq\s*mid|presence\b/, param: "eqMidDb", amount: 2, label: "EQ mid" },
  { re: /\beq\s*high|treble\b/, param: "eqHighDb", amount: 2, label: "EQ high" },
];

function matchEffectPhrase(prompt: string): (typeof EFFECT_PHRASES)[number] | null {
  const p = prompt.toLowerCase();
  for (const e of EFFECT_PHRASES) {
    if (e.re.test(p)) return e;
  }
  return null;
}

/** Amount from “a little / heavy / full” modifiers */
function effectAmountFromPrompt(prompt: string, base: number, param: AutomationParamKey): number {
  const p = prompt.toLowerCase();
  let m = 1;
  if (/\b(a little|slight|subtle|light|soft)\b/.test(p)) m = 0.55;
  else if (/\b(heavy|hard|full|max|extreme|lots)\b/.test(p)) m = 1.25;
  const v = base * m;
  if (param === "highPassHz") return Math.max(0, Math.min(400, v));
  if (param === "lowPassHz") return Math.max(0, Math.min(18000, v));
  if (param === "eqLowDb" || param === "eqMidDb" || param === "eqHighDb")
    return Math.max(-12, Math.min(12, v));
  if (param === "gainDb") return Math.max(-24, Math.min(12, v));
  return Math.max(0, Math.min(1, v));
}

export function parseConsoleCommands(opts: {
  prompt: string;
  tracks: ConsoleTrackRef[];
  sections: ConsoleSectionRef[];
  selectedTrackId: string | null;
  playheadMs?: number;
}): ConsoleCommandPlan {
  const request = (opts.prompt || "").trim();
  const p = norm(request);
  const actions: DawAction[] = [];
  const targets = findTracks(request, opts.tracks, opts.selectedTrackId);
  const matchedTrackIds = targets.map((t) => t.id);

  // Resolve default target: first matched vocal, or selected, or first vocal
  const defaultTarget =
    targets[0] ||
    opts.tracks.find((t) => t.id === opts.selectedTrackId) ||
    opts.tracks.find((t) => t.kind === "vocal") ||
    opts.tracks[0];

  // —— Section-scoped OR whole-track effect by name (all automatable FX) ——
  // e.g. "add telephone to the chorus", "reverb on the verse", "telephone effect"
  {
    const effect = matchEffectPhrase(p);
    const section = matchSection(request, opts.sections);
    const wantsEffect =
      effect &&
      (/\b(add|put|apply|use|with|enable)\b/.test(p) ||
        /\b(on|in|during|to)\s+(the\s+)?(chorus|hook|verse|intro|outro|bridge)\b/.test(p) ||
        /\btelephone|phone\s*effect|plate|doubler|de-?ess|limiter\b/.test(p));
    if (effect && wantsEffect) {
      const amount = effectAmountFromPrompt(p, effect.amount, effect.param);
      const fxTargets =
        targets.length > 0
          ? targets
          : defaultTarget
            ? [defaultTarget]
            : opts.tracks.filter((x) => x.kind === "vocal");
      const list = fxTargets.filter((t) => t.kind !== "beat");
      const applyTo = list.length ? list : fxTargets;

      if (section) {
        // Plateau on the section: ramp in at start, hold end value through section start+span
        const fade = Math.min(400, Math.max(120, (section.endMs - section.startMs) * 0.08));
        const base =
          effect.param === "highPassHz" || effect.param === "lowPassHz"
            ? 0
            : effect.param.startsWith("eq")
              ? 0
              : 0.02;
        for (const tr of applyTo) {
          actions.push({
            type: "automation_ramp",
            trackId: tr.id,
            param: effect.param,
            startMs: section.startMs,
            endMs: Math.min(section.endMs, section.startMs + fade),
            startValue: base,
            endValue: amount,
            label: `${effect.label} on ${tr.label} in ${section.label}`,
          });
          // Hold then ease out near section end
          if (section.endMs - section.startMs > fade * 3) {
            actions.push({
              type: "automation_ramp",
              trackId: tr.id,
              param: effect.param,
              startMs: Math.max(section.startMs + fade, section.endMs - fade),
              endMs: section.endMs,
              startValue: amount,
              endValue: base,
              label: `${effect.label} out on ${tr.label} after ${section.label}`,
            });
          }
          // Also set static baseline so the effect is audible even without playhead automation sampling gaps
          actions.push({
            type: "fx_set",
            trackId: tr.id,
            patch: { [effect.param]: Math.max(0.08, amount * 0.35) },
            label: `${effect.label} baseline on ${tr.label}`,
          });
        }
      } else {
        // Whole-track static amount
        for (const tr of applyTo) {
          actions.push({
            type: "fx_set",
            trackId: tr.id,
            patch: { [effect.param]: amount },
            label: `${effect.label} on ${tr.label}`,
          });
        }
      }
    }
  }



  // —— Phrase cleanup (close gaps) — static FX, not timeline automation ——
  if (/\b(phrase\s*)?cleanup\b/.test(p) || /\bclose\s+gaps?\b/.test(p) || /\btighten\s+(the\s+)?phrases?\b/.test(p) || /\bremove\s+gaps?\b/.test(p)) {
    let amount = 0.6;
    if (/\b(a little|slight|subtle|light)\b/.test(p)) amount = 0.35;
    else if (/\b(heavy|hard|full|max|tight)\b/.test(p)) amount = 0.85;
    const fxTargets =
      targets.length > 0
        ? targets
        : defaultTarget
          ? [defaultTarget]
          : opts.tracks.filter((x) => x.kind === "vocal");
    for (const tr of fxTargets) {
      if (tr.kind === "beat") continue;
      actions.push({
        type: "fx_set",
        trackId: tr.id,
        patch: { phraseCleanup: amount },
        label: `Phrase cleanup on ${tr.label}`,
      });
    }
  }

  // —— Choir / stack (uses selected vocal + same-section placement on server) ——
  if (
    /\b(make (this |it |the vocal )?(a |into )?(full )?choir|turn (this |it )?into (a )?choir|add (a )?choir|choir (stack|layers)|stack (this |it )?(as |into )?(a )?choir|build (a )?choir)\b/.test(
      p
    ) ||
    (/\bchoir\b/.test(p) && /\b(make|add|build|create|turn|stack|full)\b/.test(p))
  ) {
    const t =
      targets.find((x) => x.kind === "vocal") ||
      (defaultTarget?.kind === "vocal" ? defaultTarget : null) ||
      opts.tracks.find((x) => x.id === opts.selectedTrackId && x.kind === "vocal") ||
      opts.tracks.find((x) => x.kind === "vocal");
    if (t) {
      let mode: "double" | "choir_light" | "choir_full" | "chorus_lift" = "choir_full";
      if (/\b(light|subtle|soft) choir\b/.test(p) || /\bchoir light\b/.test(p)) mode = "choir_light";
      else if (/\b(just |only )?double/.test(p) && !/\bchoir\b/.test(p)) mode = "double";
      else if (/\bchorus lift|lift (the )?chorus\b/.test(p)) mode = "chorus_lift";
      else mode = "choir_full";
      actions.push({
        type: "choir",
        trackId: t.id,
        mode,
        label:
          mode === "double"
            ? `Stack doubles on ${t.label}`
            : mode === "choir_light"
              ? `Light choir on ${t.label}`
              : mode === "chorus_lift"
                ? `Chorus lift on ${t.label}`
                : `Full choir on ${t.label}`,
      });
    }
  }

  // —— Transport ——
  if (/\b(play|start playback|hit play)\b/.test(p) && !/\bplay\s*back\b/.test(p)) {
    actions.push({ type: "play", label: "Start playback" });
  }
  if (/\b(pause|stop playback)\b/.test(p)) {
    actions.push({ type: "pause", label: "Pause playback" });
  }
  if (/\b(go to|jump to|seek|skip to)\b/.test(p) || /\bfrom the (chorus|verse|intro|outro|bridge)\b/.test(p)) {
    const sec = matchSection(request, opts.sections);
    if (sec) {
      actions.push({
        type: "seek",
        ms: sec.startMs,
        label: `Jump to ${sec.label}`,
      });
    } else if (/\b(start|beginning)\b/.test(p)) {
      actions.push({ type: "seek", ms: 0, label: "Jump to start" });
    }
  }

  // —— Mute / solo ——
  if (/\bunmute all|show all tracks\b/.test(p)) {
    for (const t of opts.tracks) {
      actions.push({ type: "mute", trackId: t.id, value: false, label: `Unmute ${t.label}` });
    }
    actions.push({ type: "solo", trackId: null, label: "Clear solo" });
  } else if (/\bunmute\b/.test(p)) {
    const list = targets.length ? targets : defaultTarget ? [defaultTarget] : [];
    for (const t of list) {
      actions.push({ type: "mute", trackId: t.id, value: false, label: `Unmute ${t.label}` });
    }
  } else if (/\bmute\b/.test(p)) {
    const list = targets.length ? targets : defaultTarget ? [defaultTarget] : [];
    for (const t of list) {
      if (t.kind === "beat" && /\bbeat\b/.test(p) === false && list.length === 1) continue;
      actions.push({ type: "mute", trackId: t.id, value: true, label: `Mute ${t.label}` });
    }
  }

  if (/\bunsolo|clear solo|solo off\b/.test(p)) {
    actions.push({ type: "solo", trackId: null, label: "Clear solo" });
  } else if (/\bsolo\b/.test(p)) {
    const t = targets[0] || defaultTarget;
    if (t) actions.push({ type: "solo", trackId: t.id, label: `Solo ${t.label}` });
  }

  // —— Pan ——
  if (/\bpan\s*(hard\s*)?left|hard left|to the left\b/.test(p)) {
    const t = targets[0] || defaultTarget;
    if (t) actions.push({ type: "pan", trackId: t.id, value: -0.85, label: `Pan ${t.label} left` });
  } else if (/\bpan\s*(hard\s*)?right|hard right|to the right\b/.test(p)) {
    const t = targets[0] || defaultTarget;
    if (t) actions.push({ type: "pan", trackId: t.id, value: 0.85, label: `Pan ${t.label} right` });
  } else if (/\b(center|centre|middle)\b/.test(p) && /\bpan|center it|centre it\b/.test(p)) {
    const t = targets[0] || defaultTarget;
    if (t) actions.push({ type: "pan", trackId: t.id, value: 0, label: `Center ${t.label}` });
  } else if (/\bpan\b/.test(p) && /\bleft\b/.test(p)) {
    const t = targets[0] || defaultTarget;
    if (t) actions.push({ type: "pan", trackId: t.id, value: -0.5, label: `Pan ${t.label} left` });
  } else if (/\bpan\b/.test(p) && /\bright\b/.test(p)) {
    const t = targets[0] || defaultTarget;
    if (t) actions.push({ type: "pan", trackId: t.id, value: 0.5, label: `Pan ${t.label} right` });
  }

  // —— Gain ——
  if (/\b(louder|turn up|raise|boost volume|more volume|hotter)\b/.test(p)) {
    const list = targets.length ? targets : defaultTarget ? [defaultTarget] : [];
    const amt = /\ba lot|much|way\b/.test(p) ? 3 : 1.5;
    for (const t of list) {
      actions.push({ type: "gain", trackId: t.id, deltaDb: amt, label: `Boost ${t.label} +${amt} dB` });
    }
  }
  if (/\b(quieter|turn down|lower|softer|pull back|too loud|reduce volume)\b/.test(p)) {
    const list = targets.length ? targets : defaultTarget ? [defaultTarget] : [];
    const amt = /\ba lot|much|way\b/.test(p) ? -3 : -1.5;
    for (const t of list) {
      actions.push({ type: "gain", trackId: t.id, deltaDb: amt, label: `Pull ${t.label} ${amt} dB` });
    }
  }

  // —— Monitor FX deltas (local TrackFx) ——
  const fxTargets = targets.length ? targets : defaultTarget ? [defaultTarget] : [];
  const bump = (key: DawAction extends { type: "fx" } ? never : never, delta: number, label: string) => {
    /* typed below */
  };
  void bump;

  if (/\b(more reverb|add reverb|wetter|more space|spacious)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "reverb",
        delta: 0.18,
        label: `More reverb on ${t.label}`,
      });
    }
  }
  if (/\b(less reverb|drier|dry(er)?|remove reverb)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "reverb",
        delta: -0.18,
        label: `Less reverb on ${t.label}`,
      });
    }
  }
  if (/\b(more delay|add delay|echo)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({ type: "fx", trackId: t.id, key: "delay", delta: 0.15, label: `More delay on ${t.label}` });
    }
  }
  if (/\b(less delay|no delay)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({ type: "fx", trackId: t.id, key: "delay", delta: -0.15, label: `Less delay on ${t.label}` });
    }
  }
  if (/\b(compress|more compression|tighter|glue)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "compress",
        delta: 0.15,
        label: `More compression on ${t.label}`,
      });
    }
  }
  if (/\b(brighter|more air|presence|crisp)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "eqHighDb",
        delta: 1.5,
        label: `Brighten ${t.label}`,
      });
    }
  }
  if (/\b(darker|duller|less bright)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "eqHighDb",
        delta: -1.5,
        label: `Darken ${t.label}`,
      });
    }
  }
  if (/\b(warmer|warmth|more body|thicker)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "eqLowDb",
        delta: 1.2,
        label: `Warm ${t.label}`,
      });
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "saturation",
        delta: 0.1,
        label: `Add warmth on ${t.label}`,
      });
    }
  }
  if (/\b(saturat|grit|drive|edge)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "saturation",
        delta: 0.15,
        label: `More saturation on ${t.label}`,
      });
    }
  }



  // —— Professional vocal language → multi-param patches ——
  if (/\b(clearer|clarity|less muddy|clean(er)?\s+up)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx_set",
        trackId: t.id,
        patch: { highPassHz: 100, eqMidDb: 0.8, air: 0.25, deEss: 0.2 },
        label: `Clearer vocal on ${t.label}`,
      });
    }
  }
  if (/\b(harsh|sibilan|de-?ess|less bright|too bright|lispy)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "deEss",
        delta: 0.25,
        label: `De-ess ${t.label}`,
      });
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "eqHighDb",
        delta: -1,
        label: `Tame highs on ${t.label}`,
      });
    }
  }
  if (/\b(wider|more width|stereo wider|spread)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "width",
        delta: 0.2,
        label: `Widen ${t.label}`,
      });
    }
  }
  if (/\b(narrower|mono|centered|center the|keep (the )?lead centered)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx_set",
        trackId: t.id,
        patch: { width: 0.05, pan: 0 },
        label: `Center ${t.label}`,
      });
    }
  }
  if (/\b(plate reverb|subtle plate|add plate)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      const amt = /\bsubtle|light|soft\b/.test(p) ? 0.18 : 0.3;
      actions.push({
        type: "fx_set",
        trackId: t.id,
        patch: { plateReverb: amt, reverb: Math.min(0.2, amt * 0.5) },
        label: `Plate reverb on ${t.label}`,
      });
    }
  }
  if (/\b(slap(back)? delay|short delay)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "slapDelay",
        delta: 0.25,
        label: `Slap delay on ${t.label}`,
      });
    }
  }
  if (/\b(double|doubler|thicken vocal)\b/.test(p) && !/\bchoir\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "doubler",
        delta: 0.25,
        label: `Vocal doubler on ${t.label}`,
      });
    }
  }
  if (/\b(chorus effect|add chorus)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "chorus",
        delta: 0.22,
        label: `Chorus on ${t.label}`,
      });
    }
  }
  if (/\b(gate|noise gate|cut noise|less noise)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx",
        trackId: t.id,
        key: "gate",
        delta: 0.3,
        label: `Gate ${t.label}`,
      });
    }
  }
  if (/\b(spacious|more spacious|bigger room)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx_set",
        trackId: t.id,
        patch: { reverb: 0.28, plateReverb: 0.15, width: 0.25 },
        label: `More space on ${t.label}`,
      });
    }
  }
  if (/\b(professional|pro vocal|radio ready|mix ready)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx_preset",
        trackId: t.id,
        presetId: "clean_studio",
        label: `Pro vocal chain on ${t.label}`,
      });
    }
  }

  // Named presets from phrase
  {
    const preset = findPresetByPhrase(p);
    if (preset) {
      for (const t of fxTargets) {
        if (t.kind === "beat") continue;
        actions.push({
          type: "fx_preset",
          trackId: t.id,
          presetId: preset.id,
          label: `Apply “${preset.label}” on ${t.label}`,
        });
      }
    }
  }

  // Compound: warmer + clearer + spacious
  if (/\bwarmer\b/.test(p) && /\b(clearer|clarity)\b/.test(p)) {
    for (const t of fxTargets) {
      if (t.kind === "beat") continue;
      actions.push({
        type: "fx_set",
        trackId: t.id,
        patch: {
          eqLowDb: 1.5,
          saturation: 0.22,
          highPassHz: 90,
          air: 0.2,
          deEss: 0.2,
          plateReverb: /\breverb|space\b/.test(p) ? 0.2 : 0.12,
          width: /\bwid/.test(p) ? 0.22 : 0.1,
        },
        label: `Warm clear vocal on ${t.label}`,
      });
    }
  }



  // —— Automation ramps (volume fades, reverb in, etc.) ——
  {
    const list = targets.length ? targets : defaultTarget ? [defaultTarget] : [];
    const vocals = list.filter((x) => x.kind === "vocal");
    const bpm = 120; // refined by producer-view if available via prompt context later
    const songEnd = Math.max(
      ...opts.sections.map((s) => s.endMs),
      60_000
    );

    // Fade out over last N bars / end of song
    if (/\bfade\s+(the\s+)?(lead\s+)?(vocal\s+)?out\b|\bfade\s+out\b/.test(p)) {
      const barsM = p.match(/\blast\s+(\d+)\s+bars?\b/);
      const bars = barsM ? Math.max(1, parseInt(barsM[1], 10)) : 4;
      const dur = (bars * 4 * 60_000) / bpm;
      const endMs = songEnd;
      const startMs = Math.max(0, endMs - dur);
      for (const tr of vocals.length ? vocals : list) {
        if (tr.kind === "beat") continue;
        actions.push({
          type: "automation_ramp",
          trackId: tr.id,
          param: "gainDb",
          startMs,
          endMs,
          startValue: 0,
          endValue: -24,
          label: `Fade out ${tr.label} over last ${bars} bars`,
        });
      }
    }

    // Fade in
    if (/\bfade\s+(the\s+)?(lead\s+)?(vocal\s+)?in\b|\bfade\s+in\b/.test(p)) {
      const barsM = p.match(/\bover\s+(\d+)\s+bars?\b/);
      const bars = barsM ? Math.max(1, parseInt(barsM[1], 10)) : 2;
      const dur = (bars * 4 * 60_000) / bpm;
      for (const tr of vocals.length ? vocals : list) {
        if (tr.kind === "beat") continue;
        actions.push({
          type: "automation_ramp",
          trackId: tr.id,
          param: "gainDb",
          startMs: 0,
          endMs: dur,
          startValue: -18,
          endValue: 0,
          label: `Fade in ${tr.label}`,
        });
      }
    }

    // Increase reverb during chorus / section
    if (/\b(increase|add|more)\s+(the\s+)?reverb\b/.test(p) || /\breverb\s+(in|up|during)\b/.test(p)) {
      const chorus = opts.sections.find((s) => /chorus/i.test(s.label));
      if (chorus) {
        for (const tr of vocals.length ? vocals : list) {
          if (tr.kind === "beat") continue;
          actions.push({
            type: "automation_ramp",
            trackId: tr.id,
            param: "reverb",
            startMs: chorus.startMs,
            endMs: Math.min(chorus.endMs, chorus.startMs + 2000),
            startValue: 0.1,
            endValue: 0.45,
            label: `Reverb up on ${tr.label} in ${chorus.label}`,
          });
        }
      }
    }

    // Filter open (muffled → open)
    if (/\bfilter\s+sweep\b|\bopen\s+(it\s+)?up\b|\bmuffled.*open\b/.test(p)) {
      const chorus = opts.sections.find((s) => /chorus/i.test(s.label));
      const start = chorus ? Math.max(0, chorus.startMs - 3000) : 0;
      const end = chorus ? chorus.startMs : 8000;
      for (const tr of vocals.length ? vocals : list) {
        if (tr.kind === "beat") continue;
        actions.push({
          type: "automation_ramp",
          trackId: tr.id,
          param: "lowPassHz",
          startMs: start,
          endMs: end,
          startValue: 1200,
          endValue: 16000,
          label: `Filter open on ${tr.label}`,
        });
      }
    }

    // Wider in final chorus
    if (/\bwider\b/.test(p) && /\b(final|last)\s+chorus\b/.test(p)) {
      const choruses = opts.sections.filter((s) => /chorus/i.test(s.label));
      const ch = choruses[choruses.length - 1];
      if (ch) {
        for (const tr of vocals.length ? vocals : list) {
          if (tr.kind === "beat") continue;
          actions.push({
            type: "automation_ramp",
            trackId: tr.id,
            param: "width",
            startMs: ch.startMs,
            endMs: Math.min(ch.endMs, ch.startMs + 1500),
            startValue: 0.15,
            endValue: 0.65,
            label: `Widen ${tr.label} in final chorus`,
          });
        }
      }
    }

    // Remove / clear volume automation
    if (/\b(remove|clear|delete)\s+(the\s+)?(volume\s+)?automation\b|\bdisable\s+volume\s+automation\b/.test(p)) {
      for (const tr of vocals.length ? vocals : list) {
        if (tr.kind === "beat") continue;
        actions.push({
          type: "automation_clear",
          trackId: tr.id,
          param: "gainDb",
          label: `Clear volume automation on ${tr.label}`,
        });
      }
    }
  }


  // —— Rename track ——
  {
    const renameRe =
      /\b(?:rename|call|name)\s+(?:this\s+(?:track|layer|vocal)?|it|the\s+\w+)?\s*(?:to|as)?\s*["“]?([^"”\n]{1,60})["”]?$/i;
    const renameRe2 =
      /\b(?:change\s+(?:the\s+)?name\s+(?:of\s+)?(?:this\s+)?(?:track|layer)?\s+to|set\s+(?:track\s+)?name\s+to)\s*["“]?([^"”\n]{1,60})["”]?/i;
    const renameRe3 =
      /\b(?:rename\s+(?:this\s+)?(?:track|layer)?\s+to)\s*["“]?([^"”\n]{1,60})["”]?/i;
    let newName: string | null = null;
    for (const re of [renameRe3, renameRe2, renameRe]) {
      const m = request.match(re);
      if (m?.[1]) {
        newName = m[1].trim().replace(/^["'“”]+|["'“”]+$/g, "").slice(0, 80);
        break;
      }
    }
    // “name this Chorus Lead”
    if (!newName) {
      const m = request.match(
        /\bname\s+(?:this|it|selected)\s+(?:track\s+)?["“]?([A-Za-z0-9][^"”\n]{0,50})["”]?$/i
      );
      if (m?.[1] && !/\b(to|as)\b/i.test(m[1])) {
        newName = m[1].trim().slice(0, 80);
      }
    }
    if (newName && newName.length >= 1 && !/\b(choir|mute|solo|pan|reverb)\b/i.test(newName)) {
      const t =
        targets.find((x) => x.kind === "vocal") ||
        (defaultTarget?.kind === "vocal" ? defaultTarget : null) ||
        opts.tracks.find((x) => x.id === opts.selectedTrackId && x.kind === "vocal");
      if (t && t.id !== "beat") {
        actions.push({
          type: "rename",
          trackId: t.id,
          title: newName,
          label: `Rename ${t.label} → ${newName}`,
        });
      }
    }
  }

  // —— Track color (one track or all) ——
  {
    const COLOR_MAP: Record<string, string> = {
      red: "#F87171",
      crimson: "#FB7185",
      pink: "#F472B6",
      magenta: "#E879F9",
      purple: "#A78BFA",
      violet: "#C084FC",
      indigo: "#818CF8",
      blue: "#38BDF8",
      cyan: "#67E8F9",
      teal: "#34D399",
      green: "#4ADE80",
      lime: "#4ADE80",
      yellow: "#FBBF24",
      gold: "#E7A961",
      brass: "#E7A961",
      orange: "#F59E0B",
      amber: "#F59E0B",
      gray: "#94A3B8",
      grey: "#94A3B8",
      silver: "#94A3B8",
      white: "#E2E8F0",
    };
    const hexM = p.match(/#([0-9a-f]{6})\b/);
    let colorHex: string | null = hexM ? `#${hexM[1].toUpperCase()}` : null;
    if (!colorHex) {
      for (const [name, hex] of Object.entries(COLOR_MAP)) {
        if (new RegExp(`\\b${name}\\b`).test(p)) {
          // avoid "green room" false positives unless color intent
          colorHex = hex;
          break;
        }
      }
    }
    const colorIntent =
      /\b(color|colour|paint|tint|recolor|recolour)\b/.test(p) ||
      /\b(make|set|change)\b.+\b(tracks?|layers?|vocals?)\b.+\b(red|blue|green|purple|pink|orange|gold|yellow|cyan|teal|gray|grey|violet|indigo|brass|amber)\b/.test(
        p
      ) ||
      /\b(all tracks?|every track|all layers?)\b.+\b(red|blue|green|purple|pink|orange|gold|yellow|cyan|teal|gray|grey|violet)\b/.test(
        p
      ) ||
      (/\b(red|blue|green|purple|pink|orange|gold|brass)\b/.test(p) &&
        /\b(track|layer|color|colour|make this|make it|make all)\b/.test(p));

    if (colorHex && colorIntent) {
      const allTracks =
        /\b(all tracks?|every track|all layers?|all vocals?|every layer)\b/.test(p);
      if (allTracks) {
        actions.push({
          type: "color",
          trackId: "all",
          color: colorHex,
          label: `Color all tracks ${colorHex}`,
        });
      } else {
        const list =
          targets.length > 0
            ? targets.filter((x) => x.kind === "vocal")
            : defaultTarget?.kind === "vocal"
              ? [defaultTarget]
              : opts.tracks.filter((x) => x.id === opts.selectedTrackId && x.kind === "vocal");
        for (const tr of list.length ? list : []) {
          if (tr.id === "beat") continue;
          actions.push({
            type: "color",
            trackId: tr.id,
            color: colorHex,
            label: `Color ${tr.label} ${colorHex}`,
          });
        }
        if (!list.length && opts.selectedTrackId && opts.selectedTrackId !== "beat") {
          actions.push({
            type: "color",
            trackId: opts.selectedTrackId,
            color: colorHex,
            label: `Color track ${colorHex}`,
          });
        }
      }
    }
  }

  // —— Selection / arm / FX panel ——
  if (/\b(select|focus|show|open)\b/.test(p) && targets[0]) {
    actions.push({ type: "select", trackId: targets[0].id, label: `Select ${targets[0].label}` });
    actions.push({ type: "expand", trackId: targets[0].id, label: `Expand ${targets[0].label}` });
  }
  if (/\b(arm|ready to record|record on)\b/.test(p)) {
    const t = targets.find((x) => x.kind === "vocal") || opts.tracks.find((x) => x.kind === "vocal");
    if (t) {
      actions.push({ type: "select", trackId: t.id, label: `Select ${t.label}` });
      actions.push({ type: "arm", trackId: t.id, label: `Arm ${t.label}` });
    }
  }
  if (/\b(open (the )?fx|show (the )?fx|effects panel)\b/.test(p)) {
    const t = targets[0] || defaultTarget;
    if (t) {
      actions.push({ type: "select", trackId: t.id, label: `Select ${t.label}` });
      actions.push({ type: "open_fx", trackId: t.id, label: `Open FX for ${t.label}` });
    }
  }

  // Server needed for offline processing language that goes beyond monitor FX
  const hasLocalChrome = actions.some(
    (a) => a.type === "choir" || a.type === "rename" || a.type === "color"
  );
  const needsServer =
    !hasLocalChrome &&
    (/\b(fix|pitch|tune|align|timing|master|mix down|render|produce|stem|denoise|noise|restore|take|re-?record|generate)\b/.test(
      p
    ) ||
      // explicit process verbs without only local UI intent
      (/\b(process|apply to (the )?take|print|bounce)\b/.test(p) && actions.length === 0));

  // Pure creative language with no local match → still try server
  const needsServerFallback =
    !hasLocalChrome &&
    actions.length === 0 &&
    request.length > 2 &&
    !/\b(play|pause|stop)\b/.test(p);

  const summary =
    actions.length > 0
      ? actions
          .slice(0, 4)
          .map((a) => a.label)
          .join(" · ")
      : needsServer || needsServerFallback
        ? "Sending to AP engine…"
        : "Nothing matched — try “mute lead”, “pan harmony left”, “more reverb”";

  return {
    actions: actions.slice(0, 8),
    needsServer: needsServer || needsServerFallback,
    summary,
    matchedTrackIds,
  };
}

/** Suggestion chips shown in the AP command dock */
export const AP_SUGGESTIONS = [
  "Mute the beat",
  "Solo lead",
  "Make this a full choir",
  "Rename this to Lead V1",
  "Make all tracks purple",
  "Color this gold",
  "Pan harmony left",
  "More reverb on lead",
  "Add telephone to the chorus",
  "Phrase cleanup on lead",
  "Plate on the verse",
  "Go to chorus",
] as const;
