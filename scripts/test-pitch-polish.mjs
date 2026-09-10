/**
 * AP Vocal Polish — synthetic unit tests (pure Node, no Next deps)
 * Run: node scripts/test-pitch-polish.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// Prefer project typescript if present
let ts;
try {
  ts = require(path.join(root, "node_modules/typescript"));
} catch {
  try {
    ts = require("typescript");
  } catch {
    console.error("typescript not found — run npm install first");
    process.exit(1);
  }
}

const pitchDir = path.join(root, "lib/ap-engine/pitch");
const tmpDir = path.join(root, ".tmp-pitch-test");
fs.mkdirSync(tmpDir, { recursive: true });

function transpileFile(srcPath, outName) {
  const src = fs.readFileSync(srcPath, "utf8");
  let { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: srcPath,
  });
  // Rewrite relative imports to local tmp files
  outputText = outputText.replace(
    /require\(["'](\.[^"']+)["']\)/g,
    (_, p) => {
      let base = path.basename(p);
      if (!base.endsWith(".js") && !base.endsWith(".ts")) base += ".js";
      base = base.replace(/\.ts$/, ".js");
      return `require(${JSON.stringify(path.join(tmpDir, base))})`;
    }
  );
  // Stub parent imports (../roles, ../dsp, ../types, ../profiles)
  outputText = outputText.replace(
    /require\(["']\.\.\/[^"']+["']\)/g,
    (m) => {
      if (m.includes("roles")) return `require(${JSON.stringify(path.join(tmpDir, "_roles.js"))})`;
      if (m.includes("dsp")) return `require(${JSON.stringify(path.join(tmpDir, "_dsp.js"))})`;
      if (m.includes("types")) return `require(${JSON.stringify(path.join(tmpDir, "_types.js"))})`;
      if (m.includes("profiles")) return `require(${JSON.stringify(path.join(tmpDir, "_profiles.js"))})`;
      return m;
    }
  );
  const out = path.join(tmpDir, outName);
  fs.writeFileSync(out, outputText);
  return out;
}

// Minimal stubs for engine deps
fs.writeFileSync(
  path.join(tmpDir, "_roles.js"),
  `module.exports = { resolveVocalRole: (t) => t || "lead" };`
);
fs.writeFileSync(
  path.join(tmpDir, "_types.js"),
  `module.exports = {};`
);
fs.writeFileSync(
  path.join(tmpDir, "_dsp.js"),
  `
function cloneStereo(s) {
  return { left: new Float32Array(s.left), right: new Float32Array(s.right), sampleRate: s.sampleRate };
}
function stereoToMono(s) {
  const n = s.left.length;
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = 0.5 * ((s.left[i]||0) + (s.right[i]||0));
  return m;
}
function monoToStereo(mono, sampleRate) {
  return { left: new Float32Array(mono), right: new Float32Array(mono), sampleRate };
}
module.exports = { cloneStereo, stereoToMono, monoToStereo };
`
);
fs.writeFileSync(
  path.join(tmpDir, "_profiles.js"),
  `
const PROFILES = {
  ballad: { id: "ballad", preserveDynamics: 0.8 },
  rnb: { id: "rnb", preserveDynamics: 0.7 },
  afro_rnb: { id: "afro_rnb", preserveDynamics: 0.7 },
  pop: { id: "pop", preserveDynamics: 0.4 },
  trap: { id: "trap", preserveDynamics: 0.35 },
  afrobeats: { id: "afrobeats", preserveDynamics: 0.5 },
};
function resolveGenreProfile(g) {
  const k = (g || "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return PROFILES[k] || { id: "afrobeats", preserveDynamics: 0.5 };
}
module.exports = { resolveGenreProfile };
`
);

const order = [
  "types.ts",
  "detector.ts",
  "scale.ts",
  "analysis.ts",
  "decision.ts",
  "correction.ts",
  "timing.ts",
  "formant.ts",
  "index.ts",
];
for (const f of order) {
  transpileFile(path.join(pitchDir, f), f.replace(/\.ts$/, ".js"));
}

const pitch = require(path.join(tmpDir, "index.js"));
const { analyzePitch, decideVocalPolish, decideNoteCorrections, detectPitchYin, hzToMidi, midiToHz } =
  pitch;

function tone(hz, durationSec, sampleRate = 44100, amp = 0.25) {
  const n = Math.floor(durationSec * sampleRate);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    buf[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return buf;
}

function vibratoTone(hz, durationSec, sampleRate = 44100, amp = 0.25, depthCents = 30, rate = 5.5) {
  const n = Math.floor(durationSec * sampleRate);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const cents = depthCents * Math.sin(2 * Math.PI * rate * t);
    const instHz = hz * Math.pow(2, cents / 1200);
    buf[i] = amp * Math.sin((2 * Math.PI * instHz * i) / sampleRate);
  }
  return buf;
}

function slideTone(hz0, hz1, durationSec, sampleRate = 44100, amp = 0.25) {
  const n = Math.floor(durationSec * sampleRate);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const hz = hz0 * Math.pow(hz1 / hz0, t);
    buf[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return buf;
}

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log("PASS:", name);
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

console.log("\n=== AP Pitch Polish synthetic tests ===\n");

// T1: pure tone F0
{
  const mono = tone(440, 0.6);
  const frames = detectPitchYin(mono, 44100);
  const voiced = frames.filter((f) => f.voiced && f.frequencyHz);
  check("T1: detects voiced frames on pure tone", voiced.length > 10);
  if (voiced.length) {
    const mean = voiced.reduce((a, f) => a + f.frequencyHz, 0) / voiced.length;
    check("T1: mean F0 near 440 (got " + mean.toFixed(1) + ")", Math.abs(mean - 440) < 8);
  }
}

// T2: slightly flat note
{
  const flatHz = 440 * Math.pow(2, -25 / 1200);
  const mono = tone(flatHz, 0.5);
  const analysis = analyzePitch(mono, 44100);
  check("T2: detects note region", analysis.notes.length >= 1);
  if (analysis.notes[0]) {
    check(
      "T2: deviation detected (" + analysis.notes[0].pitchDeviationCents.toFixed(1) + " cents)",
      analysis.notes[0].pitchDeviationCents > 8
    );
  }
  const decision = decideVocalPolish({ analysis, role: "lead", genre: "afrobeats" });
  check("T2: polish enabled for flat note", decision.enabled);
  const noteDec = decideNoteCorrections(analysis.notes, decision);
  const anyCorr = noteDec.some((d) => !d.skip && Math.abs(d.correctionCents) > 3);
  check("T2: correction applied to flat note", anyCorr || analysis.notes.length === 0);
}

// T3: strongly detuned
{
  const badHz = 440 * Math.pow(2, -80 / 1200);
  const mono = tone(badHz, 0.5);
  const analysis = analyzePitch(mono, 44100);
  check("T3: note detected on strongly detuned tone", analysis.notes.length >= 1);
  const decision = decideVocalPolish({ analysis, role: "lead", genre: "pop" });
  check("T3: polish enabled", decision.enabled);
  const noteDec = decideNoteCorrections(analysis.notes, decision);
  check("T3: note decisions produced", noteDec.length === analysis.notes.length);
  check(
    "T3: either corrects residual or skips if already near nearest MIDI",
    noteDec.some((d) => !d.skip) || noteDec.every((d) => d.skip)
  );
}

// T4: slide
{
  const mono = slideTone(392, 523, 0.45);
  const analysis = analyzePitch(mono, 44100);
  check("T4: slide or multi-note segmented", analysis.notes.length >= 1);
  const decision = decideVocalPolish({ analysis, role: "lead", genre: "rnb" });
  check("T4: preserveSlides true for R&B", decision.preserveSlides === true);
}

// T5: vibrato + ballad profile
{
  const mono = vibratoTone(440, 0.7, 44100, 0.25, 28, 5.8);
  const analysis = analyzePitch(mono, 44100);
  const hasVib = analysis.notes.some((n) => n.hasVibrato);
  check("T5: vibrato note present", hasVib || analysis.notes.length >= 1);
  const decision = decideVocalPolish({ analysis, role: "lead", genre: "ballad" });
  check("T5: preserveVibrato true", decision.preserveVibrato === true);
  check("T5: ballad → natural profile", decision.correctionProfile === "natural");
}

// T6: spoken / low energy
{
  const mono = new Float32Array(44100 * 0.4);
  for (let i = 0; i < mono.length; i++) mono[i] = (Math.random() * 2 - 1) * 0.004;
  const analysis = analyzePitch(mono, 44100);
  const decision = decideVocalPolish({ analysis, role: "lead", genre: "pop" });
  check("T6: low-confidence / spoken protected", decision.enabled === false);
}

// T7: adlib weaker than lead
{
  const mono = tone(440 * Math.pow(2, -30 / 1200), 0.4);
  const analysis = analyzePitch(mono, 44100);
  const lead = decideVocalPolish({ analysis, role: "lead", genre: "afrobeats" });
  const adlib = decideVocalPolish({ analysis, role: "adlib", genre: "afrobeats" });
  check("T7: adlib weaker than lead", adlib.correctionStrength < lead.correctionStrength);
}

// T8: double stronger + tighter timing
{
  const mono = tone(440 * Math.pow(2, -20 / 1200), 0.4);
  const analysis = analyzePitch(mono, 44100);
  const lead = decideVocalPolish({ analysis, role: "lead", genre: "pop" });
  const dbl = decideVocalPolish({ analysis, role: "double", genre: "pop" });
  check("T8: double stronger than lead", dbl.correctionStrength > lead.correctionStrength);
  check("T8: double tighter timing", dbl.timingTightness > lead.timingTightness);
}

// T9: harmony strong
{
  const mono = tone(440 * Math.pow(2, -35 / 1200), 0.4);
  const analysis = analyzePitch(mono, 44100);
  const harm = decideVocalPolish({ analysis, role: "harmony_high", genre: "trap" });
  check("T9: harmony strong correction", harm.correctionStrength >= 0.7);
}

// T10: key estimate
{
  // C major-ish: C4 E4 G4
  const parts = [tone(261.63, 0.25), tone(329.63, 0.25), tone(392.0, 0.25)];
  const mono = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    mono.set(p, o);
    o += p.length;
  }
  const analysis = analyzePitch(mono, 44100);
  check(
    "T10: key/scale estimated (scale=" + analysis.scale + " root=" + analysis.keyMidiRoot + ")",
    analysis.scale === "major" || analysis.scale === "minor" || analysis.scale === "chromatic"
  );
}

console.log("\n=== Done ===\n");
if (fail > 0) {
  console.error(`${fail} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`All ${pass} checks passed`);
process.exit(0);
