import type { MasterDecision, PcmStereo } from "../types";
import { runMasteringAgent, type MasterAgentResult } from "./agent";
import { estimateLoudnessProxyDb } from "./loudness";

export type MasterMixOptions = {
  genre?: string | null;
  mood?: string | null;
  vocalSit?: string | null;
  platform?: string | null;
  knownIssues?: string[] | null;
};

/**
 * Master the full mix via the Mastering Agent.
 * Returns PCM; call masterMixDetailed for before/after report.
 */
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

export { estimateLoudnessProxyDb };
export type { MasterAgentResult };
