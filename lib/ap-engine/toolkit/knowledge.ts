/**
 * Producer knowledge attached to each tool — use-cases, safe ranges, genre cues.
 */
import type { ToolKnowledge, ToolName } from "./types";

export const TOOL_KNOWLEDGE: Record<ToolName, ToolKnowledge> = {
  eq: {
    tool: "eq",
    summary: "Parametric tonal shaping — carve mud, add air, fix harshness.",
    useCases: [
      "give the vocal more air (high shelf ~10–12 kHz)",
      "cut mud (~200–400 Hz)",
      "tame harshness (~2–5 kHz dip)",
    ],
    safeRanges: {
      gainDb: "typically ±1 to ±4 dB on vocals; avoid >6 dB boosts",
      q: "0.5–1.5 broad; 2–6 for surgical cuts",
    },
    avoidWith: ["heavy bit-crush on the same band"],
    genreNotes: ["R&B/Pop often gentle air; rock may push mid presence"],
  },
  compressor: {
    tool: "compressor",
    summary: "Level evening and punch — ratio/attack/release matter.",
    useCases: ["more punch", "tighter vocal", "glue the bus"],
    safeRanges: {
      ratio: "2:1–4:1 vocals; higher only briefly",
      attackMs: "5–30 ms vocals",
      releaseMs: "50–200 ms",
    },
    genreNotes: ["Hip-hop vocals often faster attack; ballads slower"],
  },
  reverb: {
    tool: "reverb",
    summary: "Space — plate/hall/room/spring with real decay and mix.",
    useCases: [
      "more space on a line",
      "ambient bridge",
      "drier verse",
    ],
    safeRanges: {
      wet_mix: "8–25% on lead vocals; higher only on atmospheres",
      decay: "0.6–2.2s typical lead; up to ~3.5s ambient bridge",
      pre_delay: "10–40 ms keeps lyrics clear",
    },
    avoidWith: ["stacked long delays at high feedback"],
    genreNotes: [
      "plate: vocals general",
      "hall: ballad / ambient",
      "spring: surf / retro",
      "room: intimate",
    ],
  },
  delay: {
    tool: "delay",
    summary: "Echo — slap, ping-pong, tape-style feedback.",
    useCases: ["delay throw on last word", "subtle width", "rhythmic echo"],
    safeRanges: {
      feedback: "15–35% throws; higher risks wash",
      wet_mix: "10–30%",
      delay_ms: "80–120 slap; tempo-sync 1/8–1/4 notes",
    },
    genreNotes: ["tape delay reads warmer / slightly unstable"],
  },
  saturation: {
    tool: "saturation",
    summary: "Harmonic density — tape/tube warmth without clipping.",
    useCases: ["more warmth", "fatter vocal", "subtle drive"],
    safeRanges: { drive: "0.1–0.35 on leads; higher on buses carefully" },
    genreNotes: ["tape: lo-fi / indie; tube: warmer R&B"],
  },
  deesser: {
    tool: "deesser",
    summary: "Tame sibilance without dulling the whole vocal.",
    useCases: ["harsh S sounds", "bright mic"],
    safeRanges: { amount: "light–medium on most leads" },
  },
  filter: {
    tool: "filter",
    summary: "HPF/LPF / telephone-style for creative or corrective moves.",
    useCases: ["underwater moment", "radio/phone vocal", "cut rumble"],
    safeRanges: {
      hpf: "70–120 Hz vocals typical",
      lpf_creative: "temporary; open back after the moment",
    },
  },
  stereo_width: {
    tool: "stereo_width",
    summary: "Widen or narrow the image; keep mono solid.",
    useCases: ["wider ad-libs", "tighter lead center"],
    safeRanges: { width: "0.7–1.3 around unity" },
  },
  limiter: {
    tool: "limiter",
    summary: "Ceiling protection — never a loudness substitute alone.",
    useCases: ["catch peaks after a boost"],
    safeRanges: { ceilingDb: "≤ -1 dBTP" },
  },
};

export function knowledgeFor(tool: ToolName): ToolKnowledge {
  return TOOL_KNOWLEDGE[tool];
}
