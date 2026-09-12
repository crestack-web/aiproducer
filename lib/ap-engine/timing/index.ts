/**
 * AP TIME — phrase-level musical timing intelligence.
 * Analyze → decide → DSP (sample shift + micro-crossfade). Never global quantize.
 */
import type { PcmStereo } from "../types";
import type { VocalRole, SongSectionKind } from "../roles";
import { analyzeVocalPhrases } from "../edit/phrase-detect";
import { buildBeatGrid } from "./beat-grid";
import { analyzePhraseTimings, decidePhraseTiming } from "./decide";
import { applyPhraseShifts } from "./align";
import type { ApTimeResult, TimingDecision } from "./types";

export type { PhraseTimingAnalysis, TimingDecision, TimingStatus, TimingAction } from "./types";
export { buildBeatGrid } from "./beat-grid";
export { analyzePhraseTimings, decidePhraseTiming } from "./decide";

export function runApTime(opts: {
  vocal: PcmStereo;
  beat: PcmStereo;
  role: VocalRole;
  section: SongSectionKind;
  genre?: string | null;
  bpm?: number | null;
  /** Median lead offset for doubles/harmonies */
  leadOffsetMs?: number | null;
}): ApTimeResult {
  const notes: string[] = ["ap_time:v1"];
  const phrases = analyzeVocalPhrases(opts.vocal);
  notes.push(`phrases:${phrases.phrases.length}`);

  if (!phrases.phrases.length) {
    return {
      pcm: opts.vocal,
      decisions: [],
      analyses: [],
      profile: "polished",
      beatConfidence: 0,
      bpmUsed: opts.bpm ?? null,
      notes: [...notes, "no_phrases"],
    };
  }

  const grid = buildBeatGrid(opts.beat, opts.bpm ?? null);
  notes.push(`bpm:${grid.bpm.toFixed(1)}`, `beat_conf:${grid.confidence.toFixed(2)}`);

  const { analyses, limits } = analyzePhraseTimings({
    pcm: opts.vocal,
    phrases: phrases.phrases,
    noiseFloor: phrases.noiseFloor,
    grid,
    role: opts.role,
    section: opts.section,
    genre: opts.genre,
  });
  notes.push(`profile:${limits.profile}`);

  const decisions: TimingDecision[] = analyses.map((a) =>
    decidePhraseTiming(a, limits, {
      role: opts.role,
      leadOffsetMs: opts.leadOffsetMs,
      beatConfidence: grid.confidence,
    })
  );

  const moved = decisions.filter((d) => Math.abs(d.shiftMs) >= 3);
  notes.push(`moves:${moved.length}/${decisions.length}`);

  // QC: abort all moves if too many large shifts (risk of artifacts)
  const large = moved.filter((d) => Math.abs(d.shiftMs) > 40);
  if (large.length > Math.max(1, Math.floor(decisions.length * 0.5))) {
    notes.push("qc:too_many_large_shifts_preserve");
    return {
      pcm: opts.vocal,
      decisions: decisions.map((d) => ({
        ...d,
        shiftMs: 0,
        action: "keep",
        reason: d.reason + "+qc_rollback",
      })),
      analyses,
      profile: limits.profile,
      beatConfidence: grid.confidence,
      bpmUsed: grid.bpm,
      notes,
    };
  }

  const aligned = applyPhraseShifts(opts.vocal, analyses, decisions);
  notes.push(`applied_shifts:${aligned.applied}`);

  return {
    pcm: aligned.pcm,
    decisions,
    analyses,
    profile: limits.profile,
    beatConfidence: grid.confidence,
    bpmUsed: grid.bpm,
    notes,
  };
}

/** Median lead offset for stack layers */
export function medianLeadOffsetMs(result: ApTimeResult): number | null {
  const leads = result.analyses.filter((a) => a.role === "lead").map((a) => a.offsetMs);
  if (!leads.length) {
    // if this result is from lead role, use all
    if (result.analyses.length) {
      const s = [...result.analyses.map((a) => a.offsetMs)].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    }
    return null;
  }
  const s = [...leads].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
