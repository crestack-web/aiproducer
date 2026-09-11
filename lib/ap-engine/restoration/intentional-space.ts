/**
 * Bad room → reduce → intentional musical space by section.
 * DSP-only, budget-limited, identity-preserving.
 */
import {
  applyBiquadInPlace,
  cloneStereo,
  rmsOf,
  stereoToMono,
  addReverbStereo,
  addDelayStereo,
  applyGainStereo,
  dbToGain,
} from "../dsp";
import type { PcmStereo } from "../types";
import type { SongSectionKind } from "../roles";
import { softDeReverb, treatRoomTone, type RoomToneQC } from "./room-tone";

export type SpaceQC = {
  room: RoomToneQC | null;
  deReverbApplied: boolean;
  section: SongSectionKind;
  reverbWet: number;
  delayWet: number;
  reverted: boolean;
};

/** Stronger room cleanup still under over-clean guard. */
export function reduceNaturalRoom(pcm: PcmStereo, intensity = 0.55): {
  pcm: PcmStereo;
  room: RoomToneQC;
  deReverbApplied: boolean;
} {
  let out = pcm;
  const room = treatRoomTone({ pcm: out, intensity });
  if (room.qc.applied) out = room.pcm;

  // Extra mid-band room wash control (bedroom boom)
  if (room.qc.applied || intensity > 0.4) {
    const tmp = cloneStereo(out);
    const sr = tmp.sampleRate;
    const mono = stereoToMono(tmp);
    const floor = room.qc.noiseFloor || 0.001;
    const n = tmp.left.length;
    const atk = Math.exp(-1 / (0.004 * sr));
    const rel = Math.exp(-1 / (0.12 * sr));
    let env = 0;
    const midL = new Float32Array(tmp.left);
    const midR = new Float32Array(tmp.right);
    applyBiquadInPlace(midL, "peak", 600, sr, 4, 0.8);
    applyBiquadInPlace(midR, "peak", 600, sr, 4, 0.8);
    for (let i = 0; i < n; i++) {
      const a = Math.max(Math.abs(tmp.left[i] || 0), Math.abs(tmp.right[i] || 0));
      env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a;
      if (env < floor * 4) {
        const g = 1 - 0.4 * intensity;
        tmp.left[i] = (tmp.left[i] || 0) - (midL[i] || 0) * (1 - g) * 0.5;
        tmp.right[i] = (tmp.right[i] || 0) - (midR[i] || 0) * (1 - g) * 0.5;
      }
    }
    const before = rmsOf(mono);
    const after = rmsOf(stereoToMono(tmp));
    if (after > before * 0.5) out = tmp;
  }

  const der = softDeReverb({ pcm: out, intensity: intensity * 0.85 });
  if (der.applied) out = der.pcm;

  return { pcm: out, room: room.qc, deReverbApplied: der.applied };
}

/** Musical space by section — replaces leftover bedroom with intentional FX. */
export function applyIntentionalSpace(
  pcm: PcmStereo,
  section: SongSectionKind,
  role: string
): { pcm: PcmStereo; reverbWet: number; delayWet: number } {
  const out = cloneStereo(pcm);
  let reverbWet = 0.1;
  let delayWet = 0.05;

  switch (section) {
    case "verse":
      reverbWet = 0.06;
      delayWet = 0.03;
      break;
    case "pre_chorus":
      reverbWet = 0.12;
      delayWet = 0.08;
      break;
    case "chorus":
      reverbWet = 0.18;
      delayWet = 0.1;
      break;
    case "bridge":
      reverbWet = 0.2;
      delayWet = 0.12;
      break;
    case "outro":
      reverbWet = 0.24;
      delayWet = 0.16;
      break;
    case "intro":
      reverbWet = 0.14;
      delayWet = 0.1;
      break;
    default:
      reverbWet = 0.1;
      delayWet = 0.06;
  }

  if (role === "adlib") {
    reverbWet *= 1.35;
    delayWet *= 1.5;
  } else if (role === "background" || role.startsWith("harmony")) {
    reverbWet *= 1.2;
  } else if (role === "double") {
    reverbWet *= 0.9;
  }

  addReverbStereo(out, Math.min(0.32, reverbWet));
  addDelayStereo(out, Math.min(0.22, delayWet), role === "adlib" ? 180 : 130);
  return { pcm: out, reverbWet, delayWet };
}

export function restoreThenSpace(opts: {
  pcm: PcmStereo;
  section: SongSectionKind;
  role: string;
  intensity?: number;
}): { pcm: PcmStereo; qc: SpaceQC } {
  const intensity = opts.intensity ?? 0.55;
  const reduced = reduceNaturalRoom(opts.pcm, intensity);
  // If room path reverted hard, still apply light intentional space
  const spaced = applyIntentionalSpace(reduced.pcm, opts.section, opts.role);
  return {
    pcm: spaced.pcm,
    qc: {
      room: reduced.room,
      deReverbApplied: reduced.deReverbApplied,
      section: opts.section,
      reverbWet: spaced.reverbWet,
      delayWet: spaced.delayWet,
      reverted: reduced.room.reverted,
    },
  };
}
