/**
 * Prompt-to-tweak — decision map diffs and version history.
 */

export type TweakScope = "song" | "section" | "phrase";

export type TweakField =
  | "loudness_target"
  | "vocal_presence_bias"
  | "reverb_send_scale"
  | "vocal_fader_ride_db"
  | "density";

export type InterpretedEdit = {
  scope: TweakScope;
  /** section id, phrase id, or "song" */
  target: string;
  /** human label e.g. chorus */
  targetLabel?: string;
  field: TweakField;
  /** relative change e.g. "+1.5dB", "+moderate", "-20%" */
  change: string;
  /** numeric delta when applicable */
  deltaDb?: number;
  deltaScale?: number;
};

export type PromptInterpretResult = {
  request: string;
  interpreted_edits: InterpretedEdit[];
  ambiguity_flags: string[];
  confirmation_needed: boolean;
  clarification?: string | null;
  plain_summary: string;
};

export type DecisionMapVersion = {
  version: number;
  at: string;
  prompt?: string | null;
  edits?: InterpretedEdit[];
  summary?: string;
  /** Snapshot of section rides used for partial render */
  sectionAdjustments: SectionAdjustment[];
};

export type SectionAdjustment = {
  sectionKey: string;
  startMs: number;
  endMs: number;
  gainDb: number;
  presenceDb: number;
  reverbScale: number;
};

export type TweakHistory = {
  versions: DecisionMapVersion[];
  currentVersion: number;
};
