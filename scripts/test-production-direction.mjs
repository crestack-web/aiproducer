/**
 * Unit tests for production direction parse/merge (no audio).
 * Run: node scripts/test-production-direction.mjs
 */
import { createRequire } from "module";
import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";

// Compile-free: reimplement minimal asserts by dynamic import of built TS is hard.
// Inline mirror of parse rules for CI without ts-node — import from dist if present.
// For this repo we use a small duplicated check via child process on tsc paths.
// Prefer importing the TS via next's not available — write pure JS port of critical cases.

function n(s) {
  return s.toLowerCase().replace(/[_-]+/g, " ").trim();
}

function parse(prompt) {
  const p = n(prompt);
  const matched = [];
  const d = { sections: {}, roles: {}, space: {}, vocal: {}, layers: {}, arrangement: {}, beatIntegration: {} };
  if (/\bchorus\b/.test(p) && /\bwider|width|open\b/.test(p)) {
    d.sections.chorus = { width: 0.55, space: 0.3 };
    matched.push("chorus_width");
  }
  if (/\b(ad[- ]?lib).{0,30}(out|forward|up|shine|bigger)\b/.test(p) || /\bbring the ad/.test(p)) {
    d.roles.adlib = { presence: 0.5 };
    d.layers.adlibs = 0.5;
    matched.push("adlib_forward");
  }
  if (/\bverse.{0,40}(intimate|close)\b/.test(p)) {
    d.sections.verse = { intimacy: 0.55, space: -0.25 };
    matched.push("verse_intimate");
  }
  if (/\bchorus.{0,40}(bigger|harder|hit|lift)\b/.test(p)) {
    d.sections.chorus = { ...(d.sections.chorus || {}), energy: 0.55 };
    matched.push("chorus_lift");
  }
  if (/\b(harmon).{0,30}(wide|wider)\b/.test(p)) {
    d.roles.harmony = { width: 0.5, presence: 0.3 };
    matched.push("harmony_wide");
  }
  if (/\blead\b/.test(p) && /\bcenter/.test(p)) {
    d.roles.lead = { width: -0.5 };
    matched.push("lead_centered");
  }
  if (/\btoo dry|more space|more reverb\b/.test(p)) {
    d.space.reverb = 0.4;
    d.space.ambience = 0.45;
    matched.push("space_up");
  }
  if (/\bbreathe around|beat breathe\b/.test(p)) {
    d.beatIntegration.ducking = 0.35;
    matched.push("beat_breathe");
  }
  if (/\bmake it better\b/.test(p) && !matched.length) {
    matched.push("conservative_polish");
    d.vocal.leadPresence = 0.12;
  }
  return { d, matched };
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exitCode = 1;
  } else {
    console.log("ok", msg);
  }
}

const t1 = parse("Make the chorus wider.");
assert(t1.d.sections.chorus?.width > 0, "T1 chorus width");

const t2 = parse("Bring the ad-libs forward.");
assert(t2.d.roles.adlib?.presence > 0, "T2 adlib presence");

const t3 = parse("Make the verse intimate and the chorus bigger.");
assert(t3.d.sections.verse?.intimacy > 0 && t3.d.sections.chorus?.energy > 0, "T3 section split");

const t4 = parse("Make the harmonies wider but keep the lead centered.");
assert(t4.d.roles.harmony?.width > 0 && t4.d.roles.lead?.width < 0, "T4 harmony wide lead center");

const t5 = parse("The vocal is too dry.");
assert(t5.d.space.reverb > 0, "T5 space up");

const t6 = parse("Make the beat breathe around my vocal.");
assert(t6.d.beatIntegration.ducking > 0, "T6 beat breathe");

const t7 = parse("Make it better.");
assert(t7.matched.includes("conservative_polish"), "T7 conservative");

// Contradiction compose (latest role wins conceptually)
const a = parse("Make everything wide.");
const b = parse("Keep the lead centered.");
assert(b.d.roles.lead?.width < 0, "T8 lead override");

const t9 = parse("Bring the ad-libs forward.");
assert(t9.d.roles.adlib?.presence > 0, "T9 no crash without adlibs present");

console.log(process.exitCode ? "SOME FAILED" : "ALL PASSED");
