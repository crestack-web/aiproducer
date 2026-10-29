/**
 * Phase 4 — Export / cleanup regression tests with synthetic audio fixtures.
 *
 * Runs in Node without OfflineAudioContext:
 * - Generates deterministic WAV fixtures (clean, noisy, quiet, silence, layered)
 * - Validates WAV structure, duration, peak, channel integrity
 * - Validates multi-clip automation track-id resolution (source contract)
 * - Validates silence policy (quiet ≠ fail; content+silent mix = fail signal)
 * - Validates cleanup policy constants
 *
 * Browser OfflineAudioContext parity is documented below when unavailable.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const fixDir = join(root, "scripts", "audio-fixtures");
mkdirSync(fixDir, { recursive: true });

// --- Minimal WAV writer / reader (PCM 16-bit stereo/mono) ---

function writeWav(path, samples, sampleRate, channels = 1) {
  const n = samples.length / channels;
  const dataSize = n * channels * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] || 0));
    buf.writeInt16LE(v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), o);
    o += 2;
  }
  writeFileSync(path, buf);
  return buf;
}

function readWav(path) {
  const buf = readFileSync(path);
  assert.equal(buf.toString("ascii", 0, 4), "RIFF");
  assert.equal(buf.toString("ascii", 8, 12), "WAVE");
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  assert.equal(bits, 16);
  const dataSize = buf.readUInt32LE(40);
  const nFrames = dataSize / (channels * 2);
  const samples = new Float32Array(nFrames * channels);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buf.readInt16LE(o) / 32768;
    o += 2;
  }
  return { channels, sampleRate, nFrames, samples, byteSize: buf.length };
}

function peakOf(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) p = Math.max(p, Math.abs(samples[i] || 0));
  return p;
}

function rmsOf(samples) {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += (samples[i] || 0) ** 2;
  return Math.sqrt(s / Math.max(1, samples.length));
}

// --- Fixtures ---
const SR = 44100;

function tone(freq, seconds, amp = 0.25) {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  }
  return out;
}

function noise(seconds, amp = 0.08) {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (Math.random() * 2 - 1) * amp;
  return out;
}

function withGaps(signal, gapStart, gapEnd) {
  const out = new Float32Array(signal);
  const a = Math.floor(gapStart * SR);
  const b = Math.floor(gapEnd * SR);
  for (let i = a; i < b && i < out.length; i++) out[i] = 0;
  return out;
}

function mix(a, b) {
  const n = Math.max(a.length, b.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (a[i] || 0) + (b[i] || 0);
  return out;
}

// Deterministic PRNG for stable noise across runs
function seededNoise(seconds, amp, seed = 42) {
  let s = seed;
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = ((s / 0xffffffff) * 2 - 1) * amp;
  }
  return out;
}

const fixtures = {
  clean_vocal: tone(220, 1.0, 0.3),
  noisy_vocal: mix(tone(220, 1.0, 0.28), seededNoise(1.0, 0.12, 7)),
  quiet_vocal: tone(220, 1.0, 0.02),
  intentional_silence: new Float32Array(SR * 0.5),
  gapped_vocal: withGaps(tone(220, 2.0, 0.3), 0.7, 1.3),
  layered: mix(tone(220, 1.5, 0.2), tone(330, 1.5, 0.15)),
};

for (const [name, samples] of Object.entries(fixtures)) {
  writeWav(join(fixDir, `${name}.wav`), samples, SR, 1);
}

// Stereo fixture
{
  const L = tone(180, 1.0, 0.2);
  const R = tone(240, 1.0, 0.2);
  const stereo = new Float32Array(L.length * 2);
  for (let i = 0; i < L.length; i++) {
    stereo[i * 2] = L[i];
    stereo[i * 2 + 1] = R[i];
  }
  writeWav(join(fixDir, "stereo_pair.wav"), stereo, SR, 2);
}

console.log("fixtures written →", fixDir);

// --- Assertions on fixtures ---
{
  const clean = readWav(join(fixDir, "clean_vocal.wav"));
  assert.equal(clean.sampleRate, SR);
  assert.equal(clean.channels, 1);
  assert.ok(Math.abs(clean.nFrames - SR) < 2);
  assert.ok(peakOf(clean.samples) > 0.2 && peakOf(clean.samples) < 0.35);

  const quiet = readWav(join(fixDir, "quiet_vocal.wav"));
  assert.ok(peakOf(quiet.samples) < 0.05 && peakOf(quiet.samples) > 0.01);

  const silence = readWav(join(fixDir, "intentional_silence.wav"));
  assert.ok(peakOf(silence.samples) < 1e-4);

  const stereo = readWav(join(fixDir, "stereo_pair.wav"));
  assert.equal(stereo.channels, 2);
  assert.ok(peakOf(stereo.samples) > 0.1);

  // Duration integrity: byte size matches frames
  for (const name of Object.keys(fixtures)) {
    const w = readWav(join(fixDir, `${name}.wav`));
    assert.equal(w.byteSize, 44 + w.nFrames * w.channels * 2);
  }
  console.log("fixture structure: ok");
}

// --- Silence policy (mirrors session-bounce intent) ---
function shouldFailSilentExport(sourcePeak, mixPeak) {
  return sourcePeak > 0.02 && mixPeak < 1e-5;
}
assert.equal(shouldFailSilentExport(0.3, 1e-6), true); // bug: content → silence
assert.equal(shouldFailSilentExport(0.3, 0.1), false); // normal
assert.equal(shouldFailSilentExport(0.01, 1e-6), false); // quiet/intentional
assert.equal(shouldFailSilentExport(0, 0), false);
console.log("silence policy: ok");

// --- Multi-clip automation id resolution (source contract) ---
{
  const src = readFileSync(join(root, "lib/client/session-bounce.ts"), "utf8");
  assert.match(src, /automationTrackId/);
  assert.match(src, /autoTrackId = layer\.automationTrackId \|\| layer\.id/);
  const pv = readFileSync(join(root, "components/producer-view.tsx"), "utf8");
  assert.match(pv, /automationTrackId: l\.id/);
  assert.match(pv, /automationTrackId: "beat"/);
  console.log("multi-clip automation mapping: ok");
}

// --- Cleanup order contract ---
{
  const policy = readFileSync(join(root, "lib/audio/cleanup-policy.ts"), "utf8");
  assert.match(policy, /CLEANUP_POLICY_VERSION/);
  assert.match(policy, /noiseReduce/);
  assert.match(policy, /gate/);
  const preview = readFileSync(join(root, "lib/audio/preview-clean.ts"), "utf8");
  assert.match(preview, /phraseCleanup/);
  assert.match(preview, /closePhraseGapsMono/);
  const fp = readFileSync(join(root, "lib/ap-engine/jobs/fast-produce.ts"), "utf8");
  assert.match(fp, /artistCleanup/);
  console.log("cleanup contract: ok");
}

// --- Tail pad grows with reverb/delay (source formula check) ---
{
  const src = readFileSync(join(root, "lib/client/session-bounce.ts"), "utf8");
  assert.match(src, /400 \+ rev \* 2800 \+ del \* 1200/);
  console.log("tail pad formula: ok");
}

// --- Browser OfflineAudioContext availability ---
const hasOffline =
  typeof globalThis.OfflineAudioContext === "function" ||
  typeof globalThis.webkitOfflineAudioContext === "function";
if (hasOffline) {
  console.log("OfflineAudioContext: available — full graph render tests can run here");
} else {
  console.log(
    "OfflineAudioContext: NOT available in this Node environment.\n" +
      "  Browser procedure for full Preview/Export parity:\n" +
      "  1. Open Console with clean_vocal + noisy_vocal fixtures uploaded.\n" +
      "  2. Set identical FX on a track; Play then Export.\n" +
      "  3. Compare duration (± tail pad), peak (±1 dB), and listen for cleanup/FX match.\n" +
      "  4. Solo one track; Export must contain only that track + policy.\n" +
      "  5. Split a clip; automation on parent task must still ride both halves."
  );
}

console.log("\ntest-export-audio-render: PASS");
console.log("Fixtures:", Object.keys(fixtures).concat("stereo_pair").join(", "));
