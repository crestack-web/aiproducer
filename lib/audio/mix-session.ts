/**
 * AP Studio mix session — non-destructive mix versions + Auto Mix proposals.
 * Same TrackFx model used for Console playback and Produce/export.
 */
export type MixTrackRole =
  | "beat"
  | "lead"
  | "double"
  | "harmony"
  | "adlib"
  | "background"
  | "other";

export type MixTrackInput = {
  id: string;
  label: string;
  kind: "beat" | "vocal";
  roleHint?: string | null;
};

export type MixProposalChange = {
  trackId: string;
  label: string;
  role: MixTrackRole;
  /** Human explanation tied to actual parameter changes */
  reason: string;
  /** Partial TrackFx-like numbers */
  fx: Record<string, number>;
};

export type MixProposal = {
  id: string;
  createdAt: string;
  style: MixStyleId;
  changes: MixProposalChange[];
  summary: string[];
};

export type MixStyleId =
  | "natural"
  | "modern_rnb"
  | "afrobeats"
  | "pop"
  | "hiphop"
  | "acoustic"
  | "intimate"
  | "spacious";

export const MIX_STYLES: { id: MixStyleId; label: string }[] = [
  { id: "natural", label: "Natural" },
  { id: "modern_rnb", label: "Modern R&B" },
  { id: "afrobeats", label: "Afrobeats" },
  { id: "pop", label: "Pop" },
  { id: "hiphop", label: "Hip-Hop" },
  { id: "acoustic", label: "Acoustic" },
  { id: "intimate", label: "Warm & intimate" },
  { id: "spacious", label: "Clean & spacious" },
];

export function resolveMixRole(track: MixTrackInput): MixTrackRole {
  if (track.kind === "beat" || track.id === "beat") return "beat";
  const raw = `${track.roleHint || ""} ${track.label || ""}`.toLowerCase();
  if (/\badlib\b|\bad-lib\b|\bad lib\b/.test(raw)) return "adlib";
  if (/\bharmon|high harm|low harm|stack\b/.test(raw)) return "harmony";
  if (/\bdouble|dbl\b/.test(raw)) return "double";
  if (/\bback(ground)?|bgv|choir\b/.test(raw)) return "background";
  if (/\blead|main|verse|chorus|hook|melody\b/.test(raw)) return "lead";
  return "other";
}

type StyleBias = {
  leadGain: number;
  doubleGain: number;
  harmonyGain: number;
  adlibGain: number;
  beatGain: number;
  leadComp: number;
  leadReverb: number;
  harmonyPan: number;
  doublePan: number;
  deEss: number;
};

function styleBias(style: MixStyleId): StyleBias {
  switch (style) {
    case "modern_rnb":
      return {
        leadGain: 1.5,
        doubleGain: -3.5,
        harmonyGain: -4.5,
        adlibGain: -5,
        beatGain: -1.5,
        leadComp: 0.42,
        leadReverb: 0.22,
        harmonyPan: 0.55,
        doublePan: 0.25,
        deEss: 0.35,
      };
    case "afrobeats":
      return {
        leadGain: 1.2,
        doubleGain: -3,
        harmonyGain: -4,
        adlibGain: -3.5,
        beatGain: -0.5,
        leadComp: 0.38,
        leadReverb: 0.18,
        harmonyPan: 0.5,
        doublePan: 0.2,
        deEss: 0.28,
      };
    case "pop":
      return {
        leadGain: 2,
        doubleGain: -2.5,
        harmonyGain: -3.5,
        adlibGain: -4,
        beatGain: -1.2,
        leadComp: 0.48,
        leadReverb: 0.2,
        harmonyPan: 0.6,
        doublePan: 0.3,
        deEss: 0.4,
      };
    case "hiphop":
      return {
        leadGain: 2.2,
        doubleGain: -2,
        harmonyGain: -5,
        adlibGain: -2.5,
        beatGain: -0.8,
        leadComp: 0.5,
        leadReverb: 0.12,
        harmonyPan: 0.45,
        doublePan: 0.15,
        deEss: 0.32,
      };
    case "acoustic":
      return {
        leadGain: 0.8,
        doubleGain: -4,
        harmonyGain: -3,
        adlibGain: -5,
        beatGain: -2.5,
        leadComp: 0.22,
        leadReverb: 0.28,
        harmonyPan: 0.4,
        doublePan: 0.18,
        deEss: 0.2,
      };
    case "intimate":
      return {
        leadGain: 1,
        doubleGain: -4.5,
        harmonyGain: -5,
        adlibGain: -6,
        beatGain: -3,
        leadComp: 0.28,
        leadReverb: 0.32,
        harmonyPan: 0.35,
        doublePan: 0.12,
        deEss: 0.22,
      };
    case "spacious":
      return {
        leadGain: 1.2,
        doubleGain: -3.5,
        harmonyGain: -3,
        adlibGain: -4,
        beatGain: -2,
        leadComp: 0.3,
        leadReverb: 0.38,
        harmonyPan: 0.7,
        doublePan: 0.35,
        deEss: 0.25,
      };
    case "natural":
    default:
      return {
        leadGain: 1,
        doubleGain: -3.5,
        harmonyGain: -4,
        adlibGain: -4.5,
        beatGain: -1.5,
        leadComp: 0.32,
        leadReverb: 0.16,
        harmonyPan: 0.5,
        doublePan: 0.22,
        deEss: 0.28,
      };
  }
}

/**
 * Build a non-destructive mix proposal from track roles + style.
 * Does not invent DSP without validation — outputs bounded TrackFx numbers only.
 */
export function buildAutoMixProposal(
  tracks: MixTrackInput[],
  style: MixStyleId = "natural"
): MixProposal {
  const bias = styleBias(style);
  const changes: MixProposalChange[] = [];
  const summary: string[] = [];
  let harmonySide = 1;

  for (const t of tracks) {
    const role = resolveMixRole(t);
    const fx: Record<string, number> = {};
    let reason = "";

    if (role === "beat") {
      fx.gainDb = bias.beatGain;
      fx.eqLowDb = -0.5;
      fx.eqMidDb = -0.8;
      fx.eqHighDb = 0;
      reason =
        "Instrumental slightly lowered and mid scooped so vocals sit in front without losing groove.";
    } else if (role === "lead") {
      fx.gainDb = bias.leadGain;
      fx.compress = bias.leadComp;
      fx.reverb = bias.leadReverb;
      fx.deEss = bias.deEss;
      fx.eqMidDb = 1.2;
      fx.eqHighDb = 0.8;
      fx.pan = 0;
      fx.highPassHz = 80;
      reason =
        "Lead vocal brought forward with gentle compression, presence EQ, and de-essing.";
    } else if (role === "double") {
      fx.gainDb = bias.doubleGain;
      fx.pan = bias.doublePan * (harmonySide > 0 ? 1 : -1);
      fx.compress = Math.min(0.45, bias.leadComp * 0.85);
      fx.reverb = bias.leadReverb * 0.7;
      reason = "Double sits under the lead with a light stereo offset so it thickens without competing.";
    } else if (role === "harmony") {
      const pan = bias.harmonyPan * harmonySide;
      harmonySide *= -1;
      fx.gainDb = bias.harmonyGain;
      fx.pan = pan;
      fx.reverb = Math.min(0.45, bias.leadReverb + 0.08);
      fx.eqMidDb = -1;
      fx.eqHighDb = 0.5;
      reason =
        "Harmony level reduced and widened so it supports the lead without masking midrange.";
    } else if (role === "adlib") {
      fx.gainDb = bias.adlibGain;
      fx.pan = (Math.random() > 0.5 ? 1 : -1) * 0.35;
      fx.reverb = Math.min(0.4, bias.leadReverb + 0.1);
      fx.delay = 0.12;
      reason = "Ad-lib tucked back with space so it accents phrases without competing with the lead.";
    } else if (role === "background") {
      fx.gainDb = bias.harmonyGain - 1;
      fx.width = 0.4;
      fx.reverb = bias.leadReverb + 0.05;
      reason = "Background vocals lowered and widened for depth behind the lead.";
    } else {
      fx.gainDb = -1;
      fx.pan = 0;
      reason = "Supporting layer balanced slightly under the lead.";
    }

    // Clamp to Console TrackFx ranges
    if (typeof fx.gainDb === "number") fx.gainDb = Math.max(-12, Math.min(12, fx.gainDb));
    if (typeof fx.pan === "number") fx.pan = Math.max(-1, Math.min(1, fx.pan));
    if (typeof fx.compress === "number") fx.compress = Math.max(0, Math.min(1, fx.compress));
    if (typeof fx.reverb === "number") fx.reverb = Math.max(0, Math.min(1, fx.reverb));
    if (typeof fx.deEss === "number") fx.deEss = Math.max(0, Math.min(1, fx.deEss));

    changes.push({ trackId: t.id, label: t.label, role, reason, fx });
    summary.push(`${t.label || role}: ${reason}`);
  }

  return {
    id: `mix_${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    style,
    changes,
    summary: summary.slice(0, 12),
  };
}

/** Map CorrectionProfile-ish UI mode to polish forceProfile string */
export type AutoTuneModeId = "natural" | "modern" | "hard";

export function autoTuneModeToProfile(mode: AutoTuneModeId): "natural" | "modern" | "hard_tune" {
  if (mode === "hard") return "hard_tune";
  if (mode === "modern") return "modern";
  return "natural";
}

export function autoTuneModeLabel(mode: AutoTuneModeId): string {
  if (mode === "hard") return "Hard Tune";
  if (mode === "modern") return "Modern";
  return "Natural";
}
