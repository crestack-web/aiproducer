"use client";

/**
 * Browser: decode any supported audio blob → 16-bit mono WAV.
 * Ensures produce pipeline can timeline-align takes server-side.
 */
export async function audioBlobToWav(blob: Blob, targetSampleRate = 44100): Promise<Blob> {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const raw = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw.slice(0));
    const chans: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      chans.push(decoded.getChannelData(c));
    }
    let mono: Float32Array;
    if (chans.length <= 1) mono = chans[0] || new Float32Array(0);
    else {
      mono = new Float32Array(chans[0].length);
      const inv = 1 / chans.length;
      for (let i = 0; i < mono.length; i++) {
        let s = 0;
        for (let c = 0; c < chans.length; c++) s += chans[c][i] || 0;
        mono[i] = s * inv;
      }
    }

    // Resample if needed
    let samples = mono;
    const srcRate = decoded.sampleRate || targetSampleRate;
    if (srcRate !== targetSampleRate && samples.length > 0) {
      const ratio = targetSampleRate / srcRate;
      const next = new Float32Array(Math.max(1, Math.round(samples.length * ratio)));
      for (let i = 0; i < next.length; i++) {
        const src = i / ratio;
        const i0 = Math.floor(src);
        const i1 = Math.min(samples.length - 1, i0 + 1);
        const t = src - i0;
        next[i] = (samples[i0] || 0) * (1 - t) + (samples[i1] || 0) * t;
      }
      samples = next;
    }

    const channels = 1;
    const bitsPerSample = 16;
    const blockAlign = 2;
    const dataSize = samples.length * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    const writeStr = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) u8[o + i] = s.charCodeAt(i);
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, targetSampleRate, true);
    view.setUint32(28, targetSampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);
    let o = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i] || 0));
      const v = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
      view.setInt16(o, Math.max(-32768, Math.min(32767, v)), true);
      o += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}
