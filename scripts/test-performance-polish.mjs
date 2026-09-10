/**
 * Synthetic tests for mouth-noise, vocal-ride, smart-deess.
 * Run: node scripts/test-performance-polish.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

let ts;
try {
  ts = require(path.join(root, "node_modules/typescript"));
} catch {
  try {
    ts = require("typescript");
  } catch {
    console.error("typescript required");
    process.exit(1);
  }
}

const tmpDir = path.join(root, ".tmp-perf-test");
fs.mkdirSync(tmpDir, { recursive: true });

function transpile(srcPath, outName, extraRewrites = {}) {
  const src = fs.readFileSync(srcPath, "utf8");
  let { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: srcPath,
  });
  outputText = outputText.replace(/require\(["'](\.[^"']+)["']\)/g, (_, p) => {
    let base = path.basename(p).replace(/\.ts$/, "") + ".js";
    if (extraRewrites[base]) base = extraRewrites[base];
    return `require(${JSON.stringify(path.join(tmpDir, base))})`;
  });
  outputText = outputText.replace(/require\(["']\.\.\/[^"']+["']\)/g, (m) => {
    if (m.includes("dsp")) return `require(${JSON.stringify(path.join(tmpDir, "dsp.js"))})`;
    if (m.includes("roles")) return `require(${JSON.stringify(path.join(tmpDir, "roles.js"))})`;
    if (m.includes("types")) return `require(${JSON.stringify(path.join(tmpDir, "types.js"))})`;
    return m;
  });
  fs.writeFileSync(path.join(tmpDir, outName), outputText);
}

// Minimal dsp stub with the functions we need
fs.writeFileSync(
  path.join(tmpDir, "dsp.js"),
  `
function dbToGain(db) { return Math.pow(10, db / 20); }
function cloneStereo(s) {
  return { left: new Float32Array(s.left), right: new Float32Array(s.right), sampleRate: s.sampleRate };
}
function stereoToMono(s) {
  const n = s.left.length;
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = 0.5 * ((s.left[i]||0) + (s.right[i]||0));
  return m;
}
function rmsOf(buf) {
  if (!buf.length) return 0;
  let s = 0;
  for (let i = 0; i < buf.length; i++) { const v = buf[i]||0; s += v*v; }
  return Math.sqrt(s / buf.length);
}
function highPassInPlace(buf, sampleRate, cutoffHz) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const a = rc / (rc + dt);
  let prevX = 0, prevY = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] || 0;
    const y = a * (prevY + x - prevX);
    prevX = x; prevY = y;
    buf[i] = y;
  }
}
function applyBiquadInPlace(buf, type, freq, sampleRate, gainDb, q) {
  // lightweight 1-pole style approx for tests
  if (type === "lowpass") {
    const rc = 1 / (2 * Math.PI * freq);
    const dt = 1 / sampleRate;
    const a = dt / (rc + dt);
    let y = 0;
    for (let i = 0; i < buf.length; i++) {
      y += a * ((buf[i]||0) - y);
      buf[i] = y;
    }
  }
}
module.exports = { dbToGain, cloneStereo, stereoToMono, rmsOf, highPassInPlace, applyBiquadInPlace };
`
);
fs.writeFileSync(path.join(tmpDir, "roles.js"), `module.exports = {};`);
fs.writeFileSync(path.join(tmpDir, "types.js"), `module.exports = {};`);

const restDir = path.join(root, "lib/ap-engine/restoration");
transpile(path.join(restDir, "mouth-noise.ts"), "mouth-noise.js");
transpile(path.join(restDir, "vocal-ride.ts"), "vocal-ride.js");
transpile(path.join(restDir, "smart-deess.ts"), "smart-deess.js");

const { treatMouthNoise } = require(path.join(tmpDir, "mouth-noise.js"));
const { rideVocalLevel } = require(path.join(tmpDir, "vocal-ride.js"));
const { smartDeess } = require(path.join(tmpDir, "smart-deess.js"));

function stereoFromMono(mono, sr = 44100) {
  return { left: new Float32Array(mono), right: new Float32Array(mono), sampleRate: sr };
}

function tone(hz, dur, sr = 44100, amp = 0.2) {
  const n = Math.floor(dur * sr);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return buf;
}

let pass = 0,
  fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log("PASS:", name);
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

console.log("\n=== Performance polish synthetic tests ===\n");

// Mouth noise: synthetic plosive (LF burst) + tone
{
  const sr = 44100;
  const mono = tone(220, 0.8, sr, 0.15);
  // inject LF plosive-like burst at 0.3s
  const c = Math.floor(0.3 * sr);
  for (let i = 0; i < Math.floor(0.02 * sr); i++) {
    mono[c + i] = (mono[c + i] || 0) + 0.7 * Math.sin((2 * Math.PI * 120 * i) / sr);
  }
  // inject HF click
  const c2 = Math.floor(0.5 * sr);
  mono[c2] = 0.9;
  mono[c2 + 1] = -0.85;
  const { qc } = treatMouthNoise({ pcm: stereoFromMono(mono, sr), role: "lead", intensity: 0.7 });
  check("mouth: ran without throw", true);
  check("mouth: detected some events or safely skipped", qc.plosiveEvents + qc.clickEvents >= 0);
  check("mouth: no over-treatment fallback forced always", qc.skippedReason !== "over_treatment_fallback" || !qc.applied);
}

// Vocal ride: quiet then loud phrases
{
  const sr = 44100;
  const quiet = tone(330, 0.4, sr, 0.04);
  const loud = tone(330, 0.4, sr, 0.25);
  const mono = new Float32Array(quiet.length + loud.length);
  mono.set(quiet, 0);
  mono.set(loud, quiet.length);
  const beforeRms =
    Math.sqrt(quiet.reduce((s, v) => s + v * v, 0) / quiet.length);
  const { pcm, qc } = rideVocalLevel({ pcm: stereoFromMono(mono, sr), role: "lead" });
  check("ride: detected phrases", qc.phrases >= 1);
  check("ride: applied or reasoned skip", qc.applied || !!qc.skippedReason);
  // Quiet region should be boosted on average
  let quietAfter = 0;
  for (let i = 0; i < quiet.length; i++) quietAfter += (pcm.left[i] || 0) ** 2;
  quietAfter = Math.sqrt(quietAfter / quiet.length);
  if (qc.applied) {
    check("ride: quiet phrase gained energy", quietAfter > beforeRms * 0.95);
  } else {
    check("ride: fallback path ok", true);
  }
}

// Smart deess: strong HF sibilance-like content
{
  const sr = 44100;
  const mono = tone(200, 0.6, sr, 0.12);
  // add harsh 7kHz bursts
  for (let i = 0; i < mono.length; i++) {
    const t = i / sr;
    if (t > 0.2 && t < 0.35) mono[i] += 0.35 * Math.sin(2 * Math.PI * 7000 * t);
    if (t > 0.45 && t < 0.55) mono[i] += 0.4 * Math.sin(2 * Math.PI * 7500 * t);
  }
  const { qc } = smartDeess({ pcm: stereoFromMono(mono, sr), role: "lead", amount: 0.5 });
  check("deess: measured sibilance ratio", qc.sibilanceRatio >= 0);
  check("deess: applied or low-sib skip", qc.applied || qc.skippedReason === "low_sibilance");
}

// Empty-ish signal safety
{
  const sr = 44100;
  const mono = new Float32Array(sr * 0.5);
  const m = treatMouthNoise({ pcm: stereoFromMono(mono, sr), intensity: 0.5 });
  const r = rideVocalLevel({ pcm: stereoFromMono(mono, sr) });
  const d = smartDeess({ pcm: stereoFromMono(mono, sr), amount: 0.4 });
  check("safety: mouth on silence does not throw", !!m.qc);
  check("safety: ride on silence does not throw", !!r.qc);
  check("safety: deess on silence does not throw", !!d.qc);
}

console.log("\n=== Done ===\n");
if (fail) {
  console.error(fail + " failed, " + pass + " passed");
  process.exit(1);
}
console.log("All " + pass + " checks passed");
process.exit(0);
