import type { DetectedNote, PitchAnalysisResult, PitchFrame } from "./types";
import { centsBetween, detectPitchYin, hzToMidi, midiToHz } from "./detector";
import { estimateKeyFromFrames } from "./scale";

function median(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

function stddev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  let s = 0;
  for (const v of vals) s += (v - mean) * (v - mean);
  return Math.sqrt(s / vals.length);
}

export function segmentNotes(frames: PitchFrame[]): DetectedNote[] {
  const notes: DetectedNote[] = [];
  let i = 0;
  while (i < frames.length) {
    while (i < frames.length && !frames[i].voiced) i++;
    if (i >= frames.length) break;
    const start = i;
    const freqs: number[] = [];
    const confs: number[] = [];
    while (i < frames.length && frames[i].voiced && frames[i].frequencyHz != null) {
      if (freqs.length > 0) {
        const last = freqs[freqs.length - 1];
        const cur = frames[i].frequencyHz!;
        if (Math.abs(centsBetween(cur, last)) > 90 && freqs.length >= 3) break;
      }
      freqs.push(frames[i].frequencyHz!);
      confs.push(frames[i].confidence);
      i++;
    }
    if (freqs.length < 2) continue;
    const end = i - 1;
    const medHz = median(freqs);
    const midi = hzToMidi(medHz);
    const nearest = Math.round(midi);
    const deviations = freqs.map((f) => Math.abs(centsBetween(f, midiToHz(nearest))));
    const meanDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const stab = Math.max(0, Math.min(1, 1 - stddev(freqs.map((f) => hzToMidi(f))) / 0.35));

    let hasVibrato = false;
    if (freqs.length >= 8) {
      const midis = freqs.map((f) => hzToMidi(f));
      const center = median(midis);
      let crossings = 0;
      for (let k = 1; k < midis.length; k++) {
        if ((midis[k - 1] - center) * (midis[k] - center) < 0) crossings++;
      }
      const dur = frames[end].time - frames[start].time;
      const rate = dur > 0.05 ? crossings / 2 / dur : 0;
      const amp = stddev(midis);
      if (rate >= 3.5 && rate <= 9 && amp > 0.05 && amp < 0.45) hasVibrato = true;
    }

    const firstThird = freqs.slice(0, Math.max(1, Math.floor(freqs.length / 3)));
    const lastThird = freqs.slice(Math.floor((freqs.length * 2) / 3));
    const edgeMove = Math.abs(centsBetween(median(lastThird), median(firstThird)));
    const isSlide = edgeMove > 80 && stab < 0.55;

    notes.push({
      startTime: frames[start].time,
      endTime: frames[end].time,
      frequencyHz: medHz,
      midiNote: midi,
      confidence: confs.reduce((a, b) => a + b, 0) / confs.length,
      pitchDeviationCents: meanDev,
      pitchStability: stab,
      hasVibrato,
      isSlide,
      frameCount: freqs.length,
    });
  }
  return notes;
}

export function analyzePitch(mono: Float32Array, sampleRate: number): PitchAnalysisResult {
  const frames = detectPitchYin(mono, sampleRate, { hopMs: 10, frameMs: 42 });
  const notes = segmentNotes(frames);
  const key = estimateKeyFromFrames(frames);
  let voiced = 0;
  let confSum = 0;
  for (const f of frames) {
    if (f.voiced) {
      voiced++;
      confSum += f.confidence;
    }
  }
  const voicedRatio = frames.length ? voiced / frames.length : 0;
  const meanConfidence = voiced ? confSum / voiced : 0;
  const meanStability =
    notes.length > 0 ? notes.reduce((a, n) => a + n.pitchStability, 0) / notes.length : 0;
  const longNotes = notes.filter((n) => n.endTime - n.startTime > 0.18).length;
  const likelySpoken =
    voicedRatio < 0.12 ||
    (meanConfidence < 0.4 && longNotes < 2) ||
    (notes.length > 0 && notes.every((n) => n.endTime - n.startTime < 0.12));

  return {
    frames,
    notes,
    keyMidiRoot: key.keyMidiRoot,
    scale: key.scale,
    voicedRatio,
    meanConfidence,
    meanStability,
    likelySpoken,
  };
}
