import { isDevMode } from "@/lib/env";

/** Silent-ish short WAV header + minimal payload for DEV_MODE beat placeholder. */
export function mockWavBuffer(durationSec = 2, sampleRate = 22050): Buffer {
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // pcm chunk size
  buffer.writeUInt16LE(1, 20); // audio format PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Soft sine so it is not pure silence (still cheap / free)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * 220 * t) * 0.15 * Math.exp(-t * 0.8);
    const int16 = Math.max(-32767, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(int16, 44 + i * 2);
  }

  return buffer;
}

export function assertDevOrConfigured(providerEnv: string | undefined, label: string) {
  if (isDevMode()) return;
  if (!providerEnv) {
    throw new Error(`${label} is not configured. Set DEV_MODE=true or provide API keys.`);
  }
}
