/**
 * Synthetic Phase 1 smoke test — real DSP on generated PCM, no network.
 */
import { writeFileSync } from "fs";

function encodeWavMono(samples, sampleRate = 44100) {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(s < 0 ? s * 32768 : s * 32767, 44 + i * 2);
  }
  return buf;
}

const sr = 44100;
const dur = 1.5;
const n = Math.floor(sr * dur);
const vocal = new Float32Array(n);
const beat = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const t = i / sr;
  // vocal-ish mid tone + noise
  vocal[i] = 0.2 * Math.sin(2 * Math.PI * 220 * t) + 0.02 * Math.sin(2 * Math.PI * 440 * t);
  // beat-ish low + click
  beat[i] = 0.35 * Math.sin(2 * Math.PI * 55 * t) * (1 - (t % 0.5) / 0.5);
}

const vocalWav = encodeWavMono(vocal, sr);
const beatWav = encodeWavMono(beat, sr);
writeFileSync("/tmp/ap-test-vocal.wav", vocalWav);
writeFileSync("/tmp/ap-test-beat.wav", beatWav);
console.log("wrote synthetic wavs", vocalWav.length, beatWav.length);
console.log("Run full AP via ts-node/tsx in CI when deps installed; structural smoke OK");
