import type { MasterDecision, PcmStereo } from "../types";
import {
  runMasteringAgent,
  runMasteringAgentWithReference,
  type MasterAgentResult,
  type MasterAgentOptions,
} from "./agent";
import { estimateLoudnessProxyDb } from "./loudness";
import { applyFeedbackTag, type ArtistMasterProfile } from "./artist-profile";
import { extractSongFingerprint } from "./song-fingerprint";
import { resolveStyleAxis, styleLabel } from "./style-axis";

export type MasterMixOptions = MasterAgentOptions;

export function masterMix(
  pcm: PcmStereo,
  decision: MasterDecision,
  opts?: MasterMixOptions
): PcmStereo {
  return runMasteringAgent(pcm, decision, opts).pcm;
}

export function masterMixDetailed(
  pcm: PcmStereo,
  decision: MasterDecision,
  opts?: MasterMixOptions
): MasterAgentResult {
  return runMasteringAgent(pcm, decision, opts);
}

export {
  estimateLoudnessProxyDb,
  applyFeedbackTag,
  extractSongFingerprint,
  resolveStyleAxis,
  styleLabel,
};
export type { MasterAgentResult, MasterAgentOptions, ArtistMasterProfile };


/** Async master: rule-based chain + optional Matchering reference stage. */
export async function masterMixWithReference(
  pcm: PcmStereo,
  decision: MasterDecision,
  opts?: MasterMixOptions
): Promise<PcmStereo> {
  return (await runMasteringAgentWithReference(pcm, decision, opts)).pcm;
}

export async function masterMixWithReferenceDetailed(
  pcm: PcmStereo,
  decision: MasterDecision,
  opts?: MasterMixOptions
): Promise<MasterAgentResult> {
  return runMasteringAgentWithReference(pcm, decision, opts);
}
