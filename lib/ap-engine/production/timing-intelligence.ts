/**
 * Timing Intelligence — feel with the beat, don't quantize to death.
 * Role + section aware. Lead can move more; ad-libs may stay late on purpose.
 */
import { cloneStereo, stereoToMono } from "../dsp";
import type { PcmStereo } from "../types";
import type { VocalRole, SongSectionKind } from "../roles";
import { lockVocalToBeat } from "../mix/beat-lock";

export type TimingPolicy = {
  maxShiftMs: number;
  /** 0–1 how aggressively to pull toward groove (1 = full correction) */
  pull: number;
  preserveLateFeel: boolean;
};

export function timingPolicyFor(
  role: VocalRole,
  section: SongSectionKind
): TimingPolicy {
  // Chorus stacks tighter; verse more human
  const chorusTight = section === "chorus" || section === "pre_chorus";

  if (role === "lead") {
    return {
      maxShiftMs: chorusTight ? 55 : 48,
      pull: chorusTight ? 0.85 : 0.7,
      preserveLateFeel: false,
    };
  }
  if (role === "double") {
    return {
      maxShiftMs: chorusTight ? 45 : 38,
      pull: 0.9,
      preserveLateFeel: false,
    };
  }
  if (role.startsWith("harmony")) {
    return {
      maxShiftMs: 35,
      pull: 0.55, // leave some width from micro-timing
      preserveLateFeel: true,
    };
  }
  if (role === "adlib") {
    return {
      maxShiftMs: 25,
      pull: 0.25, // intentional late answers stay late
      preserveLateFeel: true,
    };
  }
  if (role === "background") {
    return { maxShiftMs: 30, pull: 0.5, preserveLateFeel: true };
  }
  return { maxShiftMs: 40, pull: 0.65, preserveLateFeel: false };
}

/**
 * Apply musical timing correction for one layer against beat (and optional lead).
 * Positive shiftMs = delayed; negative = advanced (fixes "late" vocals).
 */
export function applyTimingIntelligence(opts: {
  vocal: PcmStereo;
  beat: PcmStereo;
  role: VocalRole;
  section: SongSectionKind;
  leadReference?: PcmStereo | null;
}): { pcm: PcmStereo; shiftMs: number; policy: TimingPolicy; notes: string[] } {
  const policy = timingPolicyFor(opts.role, opts.section);
  const notes: string[] = [`timing_role:${opts.role}`, `timing_section:${opts.section}`];

  // Primary: lock to beat groove
  const locked = lockVocalToBeat(opts.vocal, opts.beat, policy.maxShiftMs);
  let shift = locked.shiftMs * policy.pull;

  // If preserve late feel, only correct if more than ~25ms late (behind)
  // Convention: positive shiftMs from lockVocalToBeat means we delayed the vocal.
  // When vocal is late relative to beat, cross-corr advances it → negative shiftMs.
  if (policy.preserveLateFeel && shift < -12) {
    // Allow partial advance only
    shift = shift * 0.4;
    notes.push("preserve_late_feel");
  }

  // Re-apply scaled shift from original if pull < 1
  let pcm = opts.vocal;
  if (Math.abs(shift) >= 3) {
    const samples = Math.round((shift / 1000) * opts.vocal.sampleRate);
    pcm = shiftBySamples(opts.vocal, samples);
    notes.push(`shift_ms:${shift.toFixed(1)}`);
  } else {
    pcm = locked.pcm;
    shift = locked.shiftMs;
    if (Math.abs(shift) < 3) notes.push("timing_ok");
  }

  return { pcm, shiftMs: shift, policy, notes };
}

function shiftBySamples(pcm: PcmStereo, samples: number): PcmStereo {
  const n = pcm.left.length;
  const out = cloneStereo(pcm);
  const o = Math.round(samples);
  if (o === 0) return out;
  out.left.fill(0);
  out.right.fill(0);
  for (let i = 0; i < n; i++) {
    const src = i - o;
    if (src < 0 || src >= n) continue;
    out.left[i] = pcm.left[src] || 0;
    out.right[i] = pcm.right[src] || 0;
  }
  return out;
}

/** Stronger bus-level lock for the summed vocal against the beat (fixes late lead). */
export function applyBusGrooveLock(
  vocalBus: PcmStereo,
  beat: PcmStereo,
  maxMs = 60
): { pcm: PcmStereo; shiftMs: number } {
  // Prefer advancing late vocals: allow more range forward than back
  const locked = lockVocalToBeat(vocalBus, beat, maxMs);
  // If result delayed the bus further (positive), reduce; if advanced (negative), keep
  if (locked.shiftMs > 15) {
    // Don't push vocals later into the beat
    return { pcm: vocalBus, shiftMs: 0 };
  }
  return locked;
}
