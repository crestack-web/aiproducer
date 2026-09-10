import type { ApStage } from "../types";

export const AP_STAGE_ORDER: ApStage[] = [
  "queued",
  "analyzing",
  "restoring",
  "polishing",
  "producing",
  "mixing",
  "mastering",
  "quality_check",
  "completed",
  "failed",
];

export function humanApStage(stage: string | null | undefined): string {
  const s = (stage || "").toLowerCase().trim();
  switch (s) {
    case "queued":
    case "prepare_vocals":
    case "arrange":
    case "render_stems":
      return "AP is getting everything ready…";
    case "analyzing":
      return "AP is listening to your recording…";
    case "restoring":
      return "Cleaning up your vocal…";
    case "polishing":
      return "AP is polishing your pitch and performance…";
    case "producing":
      return "Building your vocal sound…";
    case "mixing":
    case "mix_submit":
    case "mix":
    case "mix_poll":
    case "mix_store":
      return "Blending your voice with the beat…";
    case "mastering":
    case "master_submit":
    case "master_poll":
      return "Adding the final polish…";
    case "quality_check":
      return "AP is checking your final mix…";
    case "completed":
    case "complete":
      return "Your song is ready.";
    case "failed":
      return "Production could not finish.";
    default:
      return s ? s.replace(/_/g, " ") : "Starting…";
  }
}
