/**
 * Minimal PCM16 LE WAV encode/decode (no external deps).
 * Used for timeline-aligned stem rendering before RoEx.
 */

export type PcmAudio = {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
};

function readU32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}
function readU16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

/** Decode a standard PCM WAV buffer to mono Float32 samples (-1..1). */
export function decodeWav(buffer: Buffer | ArrayBuffer | Uint8Array): PcmAudio {
  const u8 = buffer instanceof Buffer ? new Uint8Array(buffer) : new Uint8Array(buffer);
  if (u8.byteLength < 44) throw new Error("WAV too small");
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const riff = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  const wave = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file — re-record or upload WAV for produce alignment");
  }

  let offset = 12;
  let sampleRate = 44100;
  let channels = 1;
  let bitsPerSample = 16;
  let audioFormat = 1;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= u8.byteLength) {
    const id = String.fromCharCode(u8[offset], u8[offset + 1], u8[offset + 2], u8[offset + 3]);
    const size = readU32(view, offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      audioFormat = readU16(view, body);
      channels = readU16(view, body + 2);
      sampleRate = readU32(view, body + 4);
      bitsPerSample = readU16(view, body + 14);
    } else if (id === "data") {
      dataOffset = body;
      dataSize = size;
      break;
    }
    offset = body + size + (size % 2);
  }

  if (dataOffset < 0) throw new Error("WAV missing data chunk");
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`Unsupported WAV format ${audioFormat} (need PCM or float)`);
  }

  const frameCount = Math.floor(dataSize / (channels * (bitsPerSample / 8)));
  const mono = new Float32Array(frameCount);

  if (audioFormat === 3 && bitsPerSample === 32) {
    for (let i = 0; i < frameCount; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) {
        sum += view.getFloat32(dataOffset + (i * channels + c) * 4, true);
      }
      mono[i] = sum / channels;
    }
  } else if (bitsPerSample === 16) {
    for (let i = 0; i < frameCount; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) {
        sum += view.getInt16(dataOffset + (i * channels + c) * 2, true) / 32768;
      }
      mono[i] = sum / channels;
    }
  } else if (bitsPerSample === 8) {
    for (let i = 0; i < frameCount; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) {
        sum += (u8[dataOffset + i * channels + c] - 128) / 128;
      }
      mono[i] = sum / channels;
    }
  } else if (bitsPerSample === 24) {
    for (let i = 0; i < frameCount; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) {
        const o = dataOffset + (i * channels + c) * 3;
        let v = u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16);
        if (v & 0x800000) v |= ~0xffffff;
        sum += v / 8388608;
      }
      mono[i] = sum / channels;
    }
  } else {
    throw new Error(`Unsupported bitsPerSample ${bitsPerSample}`);
  }

  return { samples: mono, sampleRate, channels: 1 };
}

/** Encode mono Float32 PCM as 16-bit LE WAV. */
export function encodeWavMono(samples: Float32Array, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    const v = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, v)), o);
    o += 2;
  }
  return buffer;
}

export function isWavBuffer(buffer: Buffer | Uint8Array): boolean {
  if (buffer.byteLength < 12) return false;
  const u8 = buffer instanceof Buffer ? buffer : Buffer.from(buffer);
  return u8.toString("ascii", 0, 4) === "RIFF" && u8.toString("ascii", 8, 12) === "WAVE";
}

/** Encode mono Float32 as stereo 16-bit LE WAV (L=R). RoEx mix requires stereo. */
export function encodeWavStereoFromMono(samples: Float32Array, sampleRate: number): Buffer {
  const channels = 2;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    const v = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    const clipped = Math.max(-32768, Math.min(32767, v));
    buffer.writeInt16LE(clipped, o);
    buffer.writeInt16LE(clipped, o + 2);
    o += 4;
  }
  return buffer;
}

/**
 * RoEx mixpreview expects stereo WAV (44.1/48 kHz, 16-bit).
 * Convert mono PCM WAV → stereo L=R; leave already-stereo WAV as-is if valid.
 */
export function ensureStereoWavForRoex(buffer: Buffer): Buffer {
  if (!isWavBuffer(buffer)) return buffer;
  const pcm = decodeWav(buffer);
  // Always re-encode as stereo 16-bit at source rate (or clamp to 48k if exotic)
  let rate = pcm.sampleRate;
  if (rate !== 44100 && rate !== 48000) {
    // Keep rate; RoEx docs prefer 44.1/48 but Tonn may accept others
  }
  return encodeWavStereoFromMono(pcm.samples, rate);
}

