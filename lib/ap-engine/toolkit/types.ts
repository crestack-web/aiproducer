/**
 * Producer Toolkit — tool-call contract for Producer Mind / prompt-to-tweak.
 * Fixed schema fields (fullness, creative_fx, …) are subsets of this palette.
 */

export type ToolName =
  | "eq"
  | "compressor"
  | "reverb"
  | "delay"
  | "saturation"
  | "deesser"
  | "filter"
  | "stereo_width"
  | "limiter";

export type ToolCall = {
  tool: ToolName;
  params: Record<string, string | number | boolean>;
  /** phrase_id | section_id | "song" */
  target?: string;
  scope?: "song" | "section" | "phrase";
  reasoning: string;
};

export type ToolKnowledge = {
  tool: ToolName;
  summary: string;
  useCases: string[];
  /** Safe ranges by rough context */
  safeRanges: Record<string, string>;
  avoidWith?: string[];
  genreNotes?: string[];
};

export type ToolkitDecision = {
  version: "toolkit-1";
  tool_calls: ToolCall[];
  /** Cap simultaneous changes */
  capped?: boolean;
  plain_summary: string;
};
