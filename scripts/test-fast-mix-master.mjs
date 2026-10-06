/**
 * Fast path mix vs master: separation, loudness lift, peak safety.
 * Run: node scripts/test-fast-mix-master.mjs
 * Uses tsx if available to import TS, else pure buffer checks on encoded WAV helpers.
 */
import { createRequire } from "module";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function makeQuietStereoWav(seconds = 1.5, sampleRate = 44100, amp = 0.05) {
  const n = Math.floor(seconds * sampleRate);
  const dataSize = n * 2 * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2 * 2, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const s = Math.sin(2 * Math.PI * 220 * t) * amp;
    const v = Math.max(-1, Math.min(1, s));
    const sample = Math.round(v * 32767);
    buf.writeInt16LE(sample, 44 + i * 4);
    buf.writeInt16LE(sample, 44 + i * 4 + 2);
  }
  return buf;
}

function peakFromWav(wav) {
  let peak = 0;
  for (let i = 44; i + 1 < wav.length; i += 2) {
    const s = Math.abs(wav.readInt16LE(i) / 32768);
    if (s > peak) peak = s;
  }
  return peak;
}

function rmsFromWav(wav) {
  let sum = 0;
  let count = 0;
  for (let i = 44; i + 1 < wav.length; i += 2) {
    const s = wav.readInt16LE(i) / 32768;
    sum += s * s;
    count++;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

const runner = `
import { runFastArrangement } from "./lib/ap-engine/jobs/fast-produce.ts";

const beat = ${JSON.stringify([...makeQuietStereoWav(2, 44100, 0.15)])};
const vocal = ${JSON.stringify([...makeQuietStereoWav(1.2, 44100, 0.04)])};

const beatBuf = Buffer.from(beat);
const vocalBuf = Buffer.from(vocal);

const result = await runFastArrangement({
  beatPath: "test-beat.wav",
  // pass buffers via pathHint won't work — need buffer field
  vocals: [{ buffer: vocalBuf, pathHint: "v.wav", taskType: "lead", startMs: 200, role: "lead" }],
  genre: "afrobeats",
});

// Monkey: runFastArrangement loads beat from path — will fail without storage.
// So this runner is only valid when we inject via a test harness.
console.log(JSON.stringify({ ok: false, reason: "integration needs mock load" }));
`;

// Unit-level: verify encode path logic using dynamic import of loudness + dsp via tsx
const tsxCheck = spawnSync(
  "npx",
  [
    "--yes",
    "tsx",
    "-e",
    `
import { encodeStereoWav, cloneStereo, peakOf, applyGainStereo, limitStereo, dbToGain } from "./lib/ap-engine/dsp.ts";
import { normalizeToStreamingTarget, truePeakLimit, estimateLoudnessProxyDb } from "./lib/ap-engine/master/loudness.ts";
import type { PcmStereo } from "./lib/ap-engine/types.ts";

function makePcm(seconds, amp, sr = 44100): PcmStereo {
  const n = Math.floor(seconds * sr);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.sin(2 * Math.PI * 220 * (i / sr)) * amp;
    left[i] = s;
    right[i] = s * 0.98;
  }
  return { left, right, sampleRate: sr };
}

const mix = makePcm(1.5, 0.06);
const mixPeak = Math.max(peakOf(mix.left), peakOf(mix.right));
const mixRms = estimateLoudnessProxyDb(mix);
const mixWav = encodeStereoWav(mix);

const master = cloneStereo(mix);
const before = estimateLoudnessProxyDb(master);
const loud = normalizeToStreamingTarget(master, -11.5, -1.0, 0.35);
truePeakLimit(master, -1.0, 0.35);
const after = estimateLoudnessProxyDb(master);
const masterPeak = Math.max(peakOf(master.left), peakOf(master.right));
const masterWav = encodeStereoWav(master);

const same = mixWav.equals(masterWav);
const peakDb = 20 * Math.log10(masterPeak + 1e-12);
const clipped = [...master.left, ...master.right].some((x) => x > 1.001 || x < -1.001);

const report = {
  mixMasterBuffersEqual: same,
  mixRmsProxyDb: Math.round(mixRms * 10) / 10,
  masterRmsProxyDb: Math.round(after * 10) / 10,
  loudnessGainDb: Math.round(loud.totalGainDb * 100) / 100,
  masterPeakDb: Math.round(peakDb * 10) / 10,
  ceilingOk: peakDb <= -0.5, // approx -1 with tolerance
  noClip: !clipped,
  masterLouderThanMix: after > mixRms + 1.5,
};
console.log(JSON.stringify(report, null, 2));
if (same) process.exit(1);
if (!report.masterLouderThanMix) process.exit(2);
if (!report.ceilingOk || !report.noClip) process.exit(3);
process.exit(0);
`,
  ],
  { cwd: root, encoding: "utf8", timeout: 120000 }
);

console.log(tsxCheck.stdout || "");
if (tsxCheck.stderr) console.error(tsxCheck.stderr.slice(0, 800));
console.log("exit", tsxCheck.status);
process.exit(tsxCheck.status ?? 1);
