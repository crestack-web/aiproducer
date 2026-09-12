export type HarmonyInterval = "major3rd" | "minor3rd" | "perfect5th" | "none";

export type FullnessDecision = {
  doubles: boolean;
  harmony: { interval: HarmonyInterval; confidence: "high" | "medium" | "low" | "none" };
  adlibs: boolean;
  reasoning: string;
};

export type GeneratedLayer = {
  kind: "double" | "harmony" | "adlib";
  pcm: import("../types").PcmStereo;
  startMs: number;
  role: import("../roles").VocalRole;
  section: import("../roles").SongSectionKind;
  gainDb: number;
  pan: number;
};
