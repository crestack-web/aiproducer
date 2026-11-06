"use client";

/**
 * Studio (Console) — multitrack control environment (/app/console/[id]).
 *
 * Product split (same project data):
 *   Booth  = Create  → guided section recording at /app/studio/[id]
 *   Studio = Control → this timeline / FX / arrangement view
 *   Hub    = /app/studio (library & project entry)
 *
 * Shared source of truth: recording_tasks, takes, track_fx, console_clips, produce jobs.
 * Capture uses the same live pipeline as Booth (openRecordingStream + createVocalRecorder).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import { STUDIO_LOGO_URL } from "@/lib/brand";
import { getConsoleTransport, getCaptureLatencyCompMs } from "@/lib/audio/console-transport";
import { openRecordingStream, createVocalRecorder,
  formatMicOpenError,
} from "@/lib/audio/recording-engine";
import { MicInputPicker, SpeakerOutputPicker } from "@/components/mic-input-picker";
import {
  readPreferredMicId,
  readPreferredSpeakerId,
  writePreferredMicId,
  writePreferredSpeakerId,
  micSummaryLabel,
  speakerSummaryLabel,
} from "@/lib/audio/device-prefs";
import {
  parseConsoleCommands,
  AP_SUGGESTIONS,
  type DawAction,
} from "@/lib/ap-engine/console-commands";
import {
  applyFxPreset,
  applyEffectPluginPreset,
  EFFECT_PLUGIN_PRESETS,
  FX_PRESETS,
} from "@/lib/ap-engine/fx-presets";
import {
  createLiveTrackFxGraph,
  trackFxToLiveParams,
  isTrackFxNeutral,
  type LiveFxHandles,
} from "@/lib/audio/live-track-fx";
import ApSessionsPanel from "@/components/ap-sessions-panel";
import {
  parseFxAutomation,
  sampleTrackAutomation,
  applyLinearRamp,
  clearLane,
  upsertPoint,
  removePoint,
  updatePoint,
  AUTOMATION_PARAM_RANGE,
  barsToMs,
  type FxAutomationDoc,
  type AutomationParamKey,
  type AutomationPoint,
} from "@/lib/ap-engine/fx-automation";
import { forceDownloadFromApi } from "@/lib/download-audio";
import { bounceSessionToWavDetailed, downloadBlob } from "@/lib/client/session-bounce";
import { processPreviewBuffer } from "@/lib/audio/preview-clean";
import { ApPaywall } from "@/components/ap-paywall";
import { produceReadinessFromTasks } from "@/lib/production/readiness";
import type { PlanTaskRow } from "@/lib/plan";
import { prepareTakesForProduce } from "@/lib/client/prepare-takes-for-produce";
import { ConsoleMixer, type MixerChannel } from "@/components/console-mixer";
import type { MixProposal } from "@/lib/audio/mix-session";

import {
  parseProductionDirection,
  mergeProductionDirection,
  type ProductionDirection,
} from "@/lib/ap-engine/direction";
import {
  decodeAudioUrl,
  deleteRegionFromBuffer,
  keepRegionFromBuffer,
  spliceReplacementIntoBuffer,
  encodeWavBlob,
  bufferDurationMs,
  isValidRegion,
  normalizeRegion,
  splitBufferAtMs,
  peaksFromBuffer,
  detectOnsetMs,
  snapToBeatMs,
  type TakeRegion,
} from "@/lib/client/take-edit";
import { audioBlobToWavDetailed } from "@/lib/client/export-wav";

export type TrackFx = {
  gainDb: number;
  eqLowDb: number;
  eqMidDb: number;
  eqHighDb: number;
  compress: number; // 0–1
  reverb: number;
  delay: number;
  saturation: number;
  /** Distortion mode: 0 Soft, 1 Hard, 2 Fold, 3 Asym, 4 Sine, 5 Crush */
  satMode: number;
  satTilt: number;
  satBias: number;
  /** Wet mix 0–1 */
  satMix: number;
  /** Tone / cutoff feel 0–1 */
  satCutoff: number;
  /** Output level 0–1 */
  satOut: number;
  /** Stereo pan: -1 = full left, 0 = center, 1 = full right */
  pan: number;
  /** Stereo width 0–1 (0 = mono-ish, 1 = wide) */
  width: number;
  /** High-shelf air 0–1 */
  air: number;
  // —— Rotor Glow (modulation / rotary-style movement) ——
  rotorMix: number; // 0–1 wet
  rotorSpeed: number; // 0–1
  rotorDepth: number; // 0–1
  rotorWarmth: number; // 0–1
  /** 0 = slow, 1 = fast rotor */
  rotorFast: number;
  // —— Spring Shimmer (spring-style space) ——
  springMix: number; // 0–1
  springDelay: number; // 0–1 pre-delay feel
  springTension: number; // 0–1 brighter/tighter springs
  springDamp: number; // 0–1 high-frequency damp
  springMod: number; // 0–1 modulation on the spring
  // —— Pro dynamics / cleanup ——
  deEss: number; // 0–1
  gate: number; // 0–1 threshold intensity
  noiseReduce: number; // 0–1 spectral denoise strength
  voiceChanger: number; // 0–1 wet mix
  voicePitchSemis: number; // -12…12
  voiceCharacter: number; // 0 custom … 6 alien
  highPassHz: number; // 0 = off, else Hz
  lowPassHz: number; // 0 = off, else Hz
  limiter: number; // 0–1
  // —— Modulation / character ——
  chorus: number; // 0–1
  telephone: number; // 0–1 band-limit
  doubler: number; // 0–1 tight double feel
  slapDelay: number; // 0–1 short slap
  plateReverb: number; // 0–1 denser plate-style send
  /** Close gaps between phrases 0–1 (Produce + Export bounce) */
  phraseCleanup: number;
  /** AP Auto-Tune: 0 off, 1 on */
  autoTuneEnabled: number;
  /** Correction amount 0–1 (Natural default ~0.45) */
  autoTuneAmount: number;
  /** 0 natural, 1 modern, 2 hard tune */
  autoTuneMode: number;
  /** -1 = detect from instrumental, 0–11 = C…B */
  autoTuneKey: number;
  /** 0 major, 1 minor, 2 chromatic */
  autoTuneScale: number;
};

export const DEFAULT_TRACK_FX: TrackFx = {
  gainDb: 0,
  eqLowDb: 0,
  eqMidDb: 0,
  eqHighDb: 0,
  compress: 0,
  reverb: 0,
  delay: 0,
  saturation: 0,
  satMode: 0,
  satTilt: 0,
  satBias: 0,
  satMix: 0,
  satCutoff: 0.5,
  satOut: 0.7,
  pan: 0,
  width: 0,
  air: 0,
  rotorMix: 0,
  rotorSpeed: 0.35,
  rotorDepth: 0.45,
  rotorWarmth: 0.4,
  rotorFast: 0,
  springMix: 0,
  springDelay: 0.25,
  springTension: 0.4,
  springDamp: 0.35,
  springMod: 0.2,
  deEss: 0,
  gate: 0,
  noiseReduce: 0,
  voiceChanger: 0,
  voicePitchSemis: 0,
  voiceCharacter: 0,
  highPassHz: 0,
  lowPassHz: 0,
  limiter: 0,
  chorus: 0,
  telephone: 0,
  doubler: 0,
  slapDelay: 0,
  plateReverb: 0,
  phraseCleanup: 0,
  autoTuneEnabled: 0,
  autoTuneAmount: 0.45,
  autoTuneMode: 0,
  autoTuneKey: -1,
  autoTuneScale: 1,
};

/** Rebuild plugin rack chips from non-zero TrackFx values (after reload / presets). */
export function rackFromFx(fx: TrackFx): string[] {
  const out: string[] = [];
  const n = (v: number) => Math.abs(Number(v) || 0);
  if (n(fx.compress) > 0.02) out.push("compress");
  if (n(fx.deEss) > 0.02) out.push("deess");
  if (n(fx.gate) > 0.02) out.push("gate");
  if (n(fx.noiseReduce) > 0.02) out.push("denoise");
  if (n(fx.phraseCleanup) > 0.02) out.push("cleanup");
  if (n(fx.voiceChanger) > 0.02) out.push("voice");
  if (n(fx.limiter) > 0.02) out.push("limiter");
  if (n(fx.saturation) > 0.02) out.push("sat");
  if (n(fx.eqLowDb) > 0.05 || n(fx.eqMidDb) > 0.05 || n(fx.eqHighDb) > 0.05 || n(fx.air) > 0.02)
    out.push("eq");
  if ((Number(fx.highPassHz) || 0) > 25) out.push("hpf");
  if ((Number(fx.lowPassHz) || 0) > 500) out.push("lpf");
  if (n(fx.telephone) > 0.02) out.push("telephone");
  if (n(fx.reverb) > 0.02) out.push("reverb");
  if (n(fx.plateReverb) > 0.02) out.push("plate");
  if (n(fx.delay) > 0.02) out.push("delay");
  if (n(fx.slapDelay) > 0.02) out.push("slap");
  if (n(fx.chorus) > 0.02) out.push("chorus");
  if (n(fx.doubler) > 0.02) out.push("doubler");
  if (n(fx.rotorMix) > 0.02) out.push("rotor");
  if (n(fx.springMix) > 0.02) out.push("spring");
  return out;
}


/** One audio region on a track (split clips share the same track). */
export type ProducerClip = {
  id: string;
  startMs: number;
  endMs: number;
  audioUrl?: string | null;
  recordingId?: string | null;
  /** Non-destructive crop into source audio (Voice Memo–style) */
  offsetMs?: number;
};

/** Loose API JSON — use any for response bodies so optional fields typecheck. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiJson = any;

/** JSON body from POST /api/recording-tasks/:id/recordings (or signed upload). */
type RecordingUploadJson = {
  error?: string;
  message?: string;
  audio_url?: string;
  recording?: {
    id?: string;
    audio_url?: string;
    url?: string;
  } | null;
  upload?: {
    signedUrl?: string;
    headers?: Record<string, string>;
  };
  signedUrl?: string;
  upload_url?: string;
};


function audioUrlFromUploadJson(uj: RecordingUploadJson): string | null {
  const rec = uj.recording;
  if (rec && typeof rec.audio_url === "string" && rec.audio_url) return rec.audio_url;
  if (typeof uj.audio_url === "string" && uj.audio_url) return uj.audio_url;
  if (rec && typeof rec.url === "string" && rec.url) return rec.url;
  return null;
}

export type ProducerLayer = {
  id: string;
  label: string;
  role: string;
  sectionLabel?: string;
  startMs: number;
  endMs: number;
  audioUrl?: string | null;
  /** Saved take id from session-preview — used by Stack/choir */
  recordingId?: string | null;
  color?: string;
  trackFx?: TrackFx | null;
  /** When set, track shows multiple clips (DAW-style split) on the same lane */
  clips?: ProducerClip[];
  /** Non-destructive crop into source when no multi-clip list */
  mediaOffsetMs?: number;
  /** Local take still in browser memory — server upload did not complete */
  uploadFailed?: boolean;
};

function clipsForLayer(l: ProducerLayer): ProducerClip[] {
  if (l.clips && l.clips.length > 0) return l.clips;
  return [
    {
      id: l.recordingId || l.id,
      startMs: l.startMs,
      endMs: l.endMs,
      audioUrl: l.audioUrl,
      recordingId: l.recordingId,
      offsetMs: l.mediaOffsetMs || 0,
    },
  ];
}


/** DAW-style: place a new take at playhead on a track without wiping existing regions. */
function mergeTakeOntoLayer(
  layer: ProducerLayer,
  take: {
    id: string;
    startMs: number;
    endMs: number;
    audioUrl?: string | null;
    recordingId?: string | null;
    uploadFailed?: boolean;
  }
): ProducerLayer {
  const startMs = Math.max(0, Math.round(take.startMs));
  const endMs = Math.max(startMs + 50, Math.round(take.endMs));
  const newClip: ProducerClip = {
    id: take.id,
    startMs,
    endMs,
    audioUrl: take.audioUrl ?? null,
    recordingId: take.recordingId ?? null,
    offsetMs: 0,
  };
  const prior = (layer.clips && layer.clips.length > 0
    ? layer.clips
    : layer.audioUrl || layer.recordingId
      ? [
          {
            id: layer.recordingId || layer.id,
            startMs: layer.startMs,
            endMs: layer.endMs,
            audioUrl: layer.audioUrl,
            recordingId: layer.recordingId,
            offsetMs: layer.mediaOffsetMs || 0,
          },
        ]
      : []
  ).filter((c) => c.audioUrl || c.recordingId);

  if (prior.length === 0) {
    // First audio on this lane — single region at playhead (not forced to 0)
    return {
      ...layer,
      audioUrl: take.audioUrl ?? layer.audioUrl,
      recordingId: take.recordingId ?? layer.recordingId,
      startMs,
      endMs,
      clips: undefined,
      mediaOffsetMs: 0,
      uploadFailed: take.uploadFailed ?? false,
    };
  }

  const nextClips = [...prior, newClip].sort((a, b) => a.startMs - b.startMs);
  return {
    ...layer,
    clips: nextClips,
    startMs: nextClips[0].startMs,
    endMs: nextClips[nextClips.length - 1].endMs,
    // Keep first clip as legacy primary for APIs that still read layer.audioUrl
    audioUrl: nextClips[0].audioUrl ?? layer.audioUrl,
    recordingId: nextClips[0].recordingId ?? layer.recordingId,
    uploadFailed: take.uploadFailed ?? false,
  };
}


export type ProducerSection = {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
};

type Props = {
  projectTitle?: string;
  projectId?: string;
  beatUrl: string | null;
  beatDurationMs?: number | null;
  sections: ProducerSection[];
  layers: ProducerLayer[];
  /** BPM from project analysis when available — never invent a number */
  tempoBpm?: number | null;
  boothHref?: string | null;
  libraryHref?: string | null;
  onClose?: () => void;
  onOpenTweak?: () => void;
  /** When false, song-wide prompt stays gated; track prompts still need a take */
  tweaksEnabled?: boolean;
  tweaksGateMessage?: string;
  onLayersChanged?: () => void;
};


/** User-facing produce stages — same language as Booth session UI */
function humanProduceStage(stage: string | null | undefined): string {
  if (!stage) return "AP is getting everything ready…";
  const s = stage.toLowerCase().trim();
  const map: Record<string, string> = {
    queued: "Job queued — waiting for the studio engine…",
    starting: "Starting production…",
    prepare_vocals: "Preparing your vocal takes…",
    arrange: "Arranging vocals on the beat…",
    arranging: "Arranging vocals on the beat…",
    render_stems: "Building audio stems…",
    "preparing takes": "Preparing your vocal takes…",
    analyzing: "Listening to your recording…",
    restoring: "Cleaning up noise and room tone…",
    polishing: "Polishing vocal tone…",
    producing: "Building your vocal sound…",
    mixing: "Blending your voice with the beat…",
    mix: "Blending your voice with the beat…",
    mix_submit: "Sending mix for processing…",
    mix_poll: "Finishing the mix…",
    mix_store: "Saving the mix…",
    mastering: "Adding the final polish…",
    master: "Adding the final polish…",
    master_submit: "Mastering your track…",
    master_poll: "Finishing the master…",
    quality_check: "Checking the final mix…",
    webhook_received: "Finalizing export…",
    complete: "Your song is ready.",
    completed: "Your song is ready.",
    failed: "Production could not finish.",
  };
  if (map[s]) return map[s];
  if (s.includes("master")) return "Adding the final polish…";
  if (s.includes("mix")) return "Blending your voice with the beat…";
  if (s.includes("restor") || s.includes("clean")) return "Cleaning up your vocal…";
  if (s.includes("pitch") || s.includes("timing") || s.includes("align"))
    return "Improving vocal timing…";
  return "AP is producing your song…";
}

function humanProduceError(raw: string | null | undefined, stage?: string | null): string {
  const s = String(raw || "").trim();
  const stageHint = stage ? ` (stage: ${stage})` : "";
  if (!s) {
    return `Production stopped before a master was ready${stageHint}. Try Produce again — if it keeps failing, re-record the quietest section and ensure the beat is loaded.`;
  }
  // Already user-facing AP copy
  if (/^AP /i.test(s) || /record/i.test(s) || /beat/i.test(s) || /vocal/i.test(s)) {
    return s.replace(/\bRoEx\b/gi, "AP").slice(0, 220);
  }
  if (/RoEx produce path not loaded/i.test(s)) {
    return "Production engine was misconfigured. Please try Produce again.";
  }
  if (/No vocal|no saved vocal|no recordings/i.test(s)) {
    return "No saved vocal take found. Record at least one section, then Produce.";
  }
  if (/Beat validation|add a beat|no beat/i.test(s)) {
    return "Beat is missing or invalid. Add or regenerate a beat, then Produce.";
  }
  if (/Could not decode|decode any vocal/i.test(s)) {
    return "Could not read your vocal files. Re-save a take in Review, then Produce again.";
  }
  if (/timeout|TIMED_OUT|deadline|maxDuration/i.test(s)) {
    return "Production timed out. Tap Produce again — progress usually resumes.";
  }
  if (/storage|upload|download|not found|404/i.test(s)) {
    return "Could not load audio from storage. Check your connection and try Produce again.";
  }
  return s.replace(/\bRoEx\b/gi, "AP").replace(/\bmixer\b/gi, "production").slice(0, 220);
}

function formatPlayhead(ms: number): string {
  const totalSec = Math.max(0, ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

function ScissorsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="6" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M8.2 7.5 L20 18.5 M8.2 16.5 L20 5.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FitViewIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="8" y="8" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function LoopIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M17 1l4 4-4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 11V9a4 4 0 014-4h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 23l-4-4 4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 13v2a4 4 0 01-4 4H3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const TRACK_COLOR_PRESETS = [
  "#34D399",
  "#A78BFA",
  "#818CF8",
  "#C084FC",
  "#E879F9",
  "#F472B6",
  "#FB7185",
  "#FBBF24",
  "#F59E0B",
  "#38BDF8",
  "#67E8F9",
  "#94A3B8",
  "#E7A961",
  "#4ADE80",
  "#F87171",
];

const ROLE_COLORS: Record<string, string> = {
  lead: "#A78BFA",
  double: "#6366F1",
  harmony: "#D946EF",
  harmony_high: "#E879F9",
  harmony_mid: "#C026D3",
  harmony_low: "#9333EA",
  adlib: "#F43F5E",
  background: "#64748B",
  intro: "#22D3EE",
  outro: "#06B6D4",
  beat: "#22C55E",
  custom: "#F59E0B",
};

function roleColor(role: string) {
  const k = (role || "lead").toLowerCase().replace(/\s+/g, "_");
  if (ROLE_COLORS[k]) return ROLE_COLORS[k];
  if (k.includes("harmon")) return ROLE_COLORS.harmony;
  if (k.includes("adlib") || k.includes("ad-lib")) return ROLE_COLORS.adlib;
  if (k.includes("double")) return ROLE_COLORS.double;
  return "#7BEBD4";
}

/** Locked heights so left rail rows and timeline lanes share one grid (Suno-style). */
const TRACK_RULER_H = 36;
const TRACK_ROW_H = 64;
const TRACK_ROW_H_EXPANDED = 112;

/** Single source of truth for left header + timeline lane height — must stay in lockstep. */
function trackRowHeight(opts: {
  expanded: boolean;
  stackOpen: boolean;
  colorOpen: boolean;
  takeEditing: boolean;
  isNarrow: boolean;
  /** User-resized height — when set, this wins (DAW-style free expand). */
  customHeight?: number | null;
}): number {
  const { expanded, stackOpen, colorOpen, takeEditing, isNarrow, customHeight } = opts;
  if (typeof customHeight === "number" && Number.isFinite(customHeight)) {
    // Soft max keeps layout usable on phones; still much taller than before
    return Math.max(64, Math.min(560, Math.round(customHeight)));
  }
  if (takeEditing) {
    return isNarrow ? 132 : 148;
  }
  if (stackOpen) return Math.max(TRACK_ROW_H_EXPANDED + 120, 240);
  if (colorOpen && expanded) return isNarrow ? 128 : 140;
  if (expanded) return isNarrow ? 140 : 160;
  return TRACK_ROW_H;
}

function formatMs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** Peak buckets cached per URL — shared across zoom redraws. */
const peakCache = new Map<string, Float32Array>();
const bufferCache = new Map<string, AudioBuffer>();

async function decodeAudioArrayBuffer(
  arr: ArrayBuffer,
  liveCtx?: AudioContext | null
): Promise<AudioBuffer | null> {
  // OfflineAudioContext decodes without a user-gesture resume (critical on iOS Safari
  // where the live AudioContext stays suspended until Play — peaks were blank).
  try {
    const AC =
      typeof window !== "undefined"
        ? (window.OfflineAudioContext ||
            (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
              .webkitOfflineAudioContext)
        : null;
    if (AC) {
      const off = new AC(2, 128, 44100);
      return await off.decodeAudioData(arr.slice(0));
    }
  } catch {
    /* fall through to live context */
  }
  if (liveCtx) {
    try {
      return await liveCtx.decodeAudioData(arr.slice(0));
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchDecode(
  ctx: AudioContext,
  url: string,
  /** Same-origin fallback when signed R2/S3 URLs block CORS (AI beats). */
  sameOriginFallback?: string | null
): Promise<AudioBuffer | null> {
  if (bufferCache.has(url)) return bufferCache.get(url)!;
  if (sameOriginFallback && bufferCache.has(sameOriginFallback)) {
    const b = bufferCache.get(sameOriginFallback)!;
    bufferCache.set(url, b);
    return b;
  }
  // Prefer same-origin proxy first (avoids CORS blanks on mobile), then signed URL
  const candidates: string[] = [];
  if (sameOriginFallback) candidates.push(sameOriginFallback);
  if (url && url !== sameOriginFallback) candidates.push(url);
  if (!candidates.length && url) candidates.push(url);
  let lastErr: unknown = null;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        credentials: candidate.startsWith("/") ? "same-origin" : "omit",
        mode: candidate.startsWith("/") ? "same-origin" : "cors",
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      const arr = await res.arrayBuffer();
      if (!arr.byteLength) {
        lastErr = new Error("empty body");
        continue;
      }
      const buf = await decodeAudioArrayBuffer(arr, ctx);
      if (!buf) {
        lastErr = new Error("decode returned null");
        continue;
      }
      bufferCache.set(url, buf);
      if (candidate !== url) bufferCache.set(candidate, buf);
      return buf;
    } catch (e) {
      lastErr = e;
    }
  }
  console.warn("[producer-view] decode failed", url, lastErr);
  return null;
}

/** Downsample channel peaks into `buckets` max-abs values. */
function computePeaks(buf: AudioBuffer, buckets: number): Float32Array {
  // Max-abs across channels so stereo takes are not under-read from ch0 only.
  // Visualization only — does not alter playback audio.
  const peaks = new Float32Array(buckets);
  const n = buf.length;
  if (!n || buckets < 1) return peaks;
  const block = Math.max(1, Math.floor(n / buckets));
  const nCh = buf.numberOfChannels;
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * block;
    const end = Math.min(n, start + block);
    for (let c = 0; c < nCh; c++) {
      const ch = buf.getChannelData(c);
      for (let j = start; j < end; j++) {
        const v = Math.abs(ch[j]);
        if (v > max) max = v;
      }
    }
    peaks[i] = max;
  }
  return peaks;
}

function peaksForUrl(url: string, buf: AudioBuffer, buckets: number): Float32Array {
  const key = `${url}::${buckets}`;
  const hit = peakCache.get(key);
  if (hit) return hit;
  // Also reuse high-res peaks by resampling if we have 2048
  const hiKey = `${url}::2048`;
  const hi = peakCache.get(hiKey);
  if (hi && buckets < 2048) {
    const out = new Float32Array(buckets);
    const ratio = hi.length / buckets;
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const a = Math.floor(i * ratio);
      const b = Math.min(hi.length, Math.floor((i + 1) * ratio));
      for (let j = a; j < b; j++) if (hi[j] > max) max = hi[j];
      out[i] = max;
    }
    peakCache.set(key, out);
    return out;
  }
  const peaks = computePeaks(buf, buckets);
  peakCache.set(key, peaks);
  if (buckets === 2048) peakCache.set(hiKey, peaks);
  return peaks;
}


/** In-place live peaks while recording into a mock/planned clip — same passive analyser data */
function LiveClipWave({
  peaks,
  color,
  width,
  height,
}: {
  peaks: number[];
  color: string;
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.floor(width * dpr));
    c.height = Math.max(1, Math.floor(height * dpr));
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, width, height);
    const n = Math.max(1, peaks.length);
    const mid = height / 2;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    for (let i = 0; i < n; i++) {
      const x = (i / n) * width;
      const amp = Math.min(1, peaks[i] || 0) * (height * 0.42);
      const barW = Math.max(1, width / n);
      ctx.fillRect(x, mid - amp, barW, amp * 2);
    }
    // recording head
    ctx.fillStyle = "#F07167";
    ctx.fillRect(Math.max(0, width - 2), 0, 2, height);
  }, [peaks, color, width, height]);
  return (
    <canvas
      ref={ref}
      style={{ display: "block", width, height, borderRadius: 6 }}
    />
  );
}

function slicePeaksForCrop(
  peaks: Float32Array,
  offsetMs: number,
  durationMs: number,
  sourceDurationMs: number
): Float32Array {
  if (!peaks.length || sourceDurationMs <= 0) return peaks;
  const dur = Math.max(50, durationMs);
  const off = Math.max(0, Math.min(offsetMs, Math.max(0, sourceDurationMs - 50)));
  const a = Math.floor((off / sourceDurationMs) * peaks.length);
  const b = Math.ceil(((off + dur) / sourceDurationMs) * peaks.length);
  const i0 = Math.max(0, Math.min(peaks.length - 1, a));
  const i1 = Math.max(i0 + 1, Math.min(peaks.length, b));
  return peaks.subarray(i0, i1) as Float32Array;
}

function WaveformCanvas({
  peaks,
  color,
  width,
  height,
  dimmed,
  offsetMs = 0,
  durationMs,
  sourceDurationMs,
  selected,
}: {
  peaks: Float32Array | null;
  color: string;
  width: number;
  height: number;
  dimmed?: boolean;
  offsetMs?: number;
  durationMs?: number;
  sourceDurationMs?: number;
  selected?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || width < 2) return;
    const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
    c.width = Math.floor(width * dpr);
    c.height = Math.floor(height * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    let drawPeaks = peaks;
    if (
      peaks &&
      peaks.length > 4 &&
      sourceDurationMs &&
      sourceDurationMs > 0 &&
      durationMs != null &&
      durationMs > 0
    ) {
      drawPeaks = slicePeaksForCrop(
        peaks,
        offsetMs || 0,
        durationMs,
        sourceDurationMs
      );
    }

    if (!drawPeaks || drawPeaks.length === 0) {
      ctx.fillStyle = dimmed ? color + "33" : color + "55";
      ctx.fillRect(0, 0, width, height);
      return;
    }
    let peakMax = 0;
    for (let i = 0; i < drawPeaks.length; i++) {
      if (drawPeaks[i] > peakMax) peakMax = drawPeaks[i];
    }
    const norm = peakMax > 1e-4 ? 1 / Math.max(peakMax, 0.12) : 1;
    const mid = height / 2;
    ctx.fillStyle = dimmed ? color + "55" : color + "DD";
    ctx.fillRect(0, 0, width, height);
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, "rgba(255,255,255,0.14)");
    grad.addColorStop(0.5, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.18)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    const n = drawPeaks.length;
    const barW = Math.max(1.5, width / n);
    for (let i = 0; i < n; i++) {
      const raw = drawPeaks[i] * norm;
      const amp = Math.min(1, raw * 1.05);
      const h = Math.max(amp < 0.04 ? 1.5 : 3, amp * (height * 0.88));
      const x = i * barW;
      const bw = Math.max(1.4, barW - 0.4);
      ctx.fillStyle =
        amp < 0.04
          ? "rgba(255,255,255,0.2)"
          : dimmed
            ? "rgba(255,255,255,0.4)"
            : "rgba(255,255,255,0.95)";
      ctx.fillRect(x, mid - h / 2, bw, h);
    }
  }, [peaks, color, width, height, dimmed, offsetMs, durationMs, sourceDurationMs]);
  return (
    <canvas
      ref={ref}
      style={{
        display: "block",
        width,
        height,
        borderRadius: 8,
        pointerEvents: "none",
      }}
    />
  );
}

/** CapCut-style edge handle */
function ClipEdgeHandle({
  side,
  wide,
  onPointerDown,
}: {
  side: "start" | "end";
  wide: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const w = wide ? 26 : 16;
  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        [side === "start" ? "left" : "right"]: 0,
        width: w,
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "ew-resize",
        touchAction: "none",
        background:
          side === "start"
            ? "linear-gradient(90deg, rgba(255,255,255,0.92), rgba(255,255,255,0.2))"
            : "linear-gradient(270deg, rgba(255,255,255,0.92), rgba(255,255,255,0.2))",
        borderRadius: side === "start" ? "10px 0 0 10px" : "0 10px 10px 0",
      }}
    >
      <span
        style={{
          width: 14,
          height: 22,
          borderRadius: 6,
          background: "#fff",
          color: "#111",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 900,
          boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
          pointerEvents: "none",
        }}
      >
        {side === "start" ? "‹" : "›"}
      </span>
    </div>
  );
}

export function ProducerView({
  projectTitle,
  projectId,
  beatUrl,
  beatDurationMs: durationProp,
  sections,
  layers: layersProp,
  onClose,
  onOpenTweak,
  tweaksEnabled = false,
  tweaksGateMessage = "Add a beat or take to direct AP",
  onLayersChanged,
  tempoBpm = null,
  boothHref = null,
  libraryHref = "/app",
}: Props) {
  const { colors: C } = useTheme();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingScroll = useRef(false);

  function onHeaderScroll() {
    if (syncingScroll.current) return;
    const h = headerScrollRef.current;
    const tl = timelineScrollRef.current;
    if (!h || !tl) return;
    syncingScroll.current = true;
    tl.scrollTop = h.scrollTop;
    syncingScroll.current = false;
  }

  function onTimelineScroll() {
    if (syncingScroll.current) return;
    const h = headerScrollRef.current;
    const tl = timelineScrollRef.current;
    if (!h || !tl) return;
    syncingScroll.current = true;
    h.scrollTop = tl.scrollTop;
    syncingScroll.current = false;
  }


  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const gainsRef = useRef<Map<string, GainNode>>(new Map());
  const panNodesRef = useRef<Map<string, StereoPannerNode>>(new Map());
  const fxGraphRef = useRef<Map<string, LiveFxHandles>>(new Map());
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef(0);
  /** Authoritative transport — avoids stale RAF closures keeping time running after pause */
  const playingRef = useRef(false);
  /** Bumped on every stop/pause so in-flight startPlayback cannot restart audio */
  const playbackGenRef = useRef(0);
  const pxPerSecRef = useRef(56);

  useEffect(() => {
    return () => {
      try {
        playbackGenRef.current += 1;
        playingRef.current = false;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        for (const s of sourcesRef.current) {
          try {
            s.stop();
          } catch {
            /* */
          }
        }
        sourcesRef.current = [];
        for (const g of fxGraphRef.current.values()) {
          try {
            g.dispose();
          } catch {
            /* */
          }
        }
        fxGraphRef.current.clear();
      } catch {
        /* */
      }
    };
  }, []);

  const [layers, setLayers] = useState(layersProp);
  const [durationMs, setDurationMs] = useState(durationProp || 0);
  const [playheadMs, setPlayheadMs] = useState(0);
  const playheadMsRef = useRef(0);
  const playheadElRef = useRef<HTMLDivElement | null>(null);
  const playheadStateThrottleRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [transportPhase, setTransportPhase] = useState<
    "idle" | "preparing" | "ready" | "playing" | "paused" | "error"
  >("idle");
  const [muteArmedWhileRecord, setMuteArmedWhileRecord] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>("beat");
  /** User-dragged track lane height (px). Unbounded growth up to a soft max for usability. */
  const [trackHeightPx, setTrackHeightPx] = useState<Record<string, number>>({});
  const heightDragRef = useRef<{ id: string; startY: number; startH: number } | null>(null);

  const [pxPerSec, setPxPerSec] = useState(56);
  pxPerSecRef.current = pxPerSec;
  const [loopOn, setLoopOn] = useState(false);
  const loopOnRef = useRef(false);
  /** Active loop region (ms). When null, loop wraps the whole session. */
  const loopRangeRef = useRef<{ startMs: number; endMs: number } | null>(null);
  const [loopRange, setLoopRange] = useState<{ startMs: number; endMs: number } | null>(null);

  // —— Take edit (non-destructive; original recording stays on server) ——
  const [takeEditId, setTakeEditId] = useState<string | null>(null);
  const [takeSel, setTakeSel] = useState<TakeRegion | null>(null);
  const [takeDurationMs, setTakeDurationMs] = useState(0);
  const [takePeaks, setTakePeaks] = useState<number[]>([]);
  const [takeEditBusy, setTakeEditBusy] = useState(false);
  const [takeUndoDepth, setTakeUndoDepth] = useState(0);
  const [retakeTarget, setRetakeTarget] = useState<{
    taskId: string;
    startMs: number;
    endMs: number;
  } | null>(null);
  const takeWorkingRef = useRef<AudioBuffer | null>(null);
  const takeUndoStackRef = useRef<AudioBuffer[]>([]);
  const takeRedoStackRef = useRef<AudioBuffer[]>([]);
  /** Console-wide undo/redo (clip geometry + track FX). Take-edit uses take stacks when active. */
  type ConsoleHistoryEntry =
    | {
        kind: "layer-geo";
        label: string;
        id: string;
        before: { startMs: number; endMs: number };
        after: { startMs: number; endMs: number };
      }
    | {
        kind: "fx";
        label: string;
        id: string;
        before: TrackFx;
        after: TrackFx;
      }
    | {
        /** Structural edit: split / delete clip / clear recording / remove track */
        kind: "layers";
        label: string;
        before: ProducerLayer[];
        after: ProducerLayer[];
      };
  const consoleUndoRef = useRef<ConsoleHistoryEntry[]>([]);
  const consoleRedoRef = useRef<ConsoleHistoryEntry[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const takeSelDragRef = useRef<{
    mode: "create" | "start" | "end";
    originX: number;
    originStart: number;
    originEnd: number;
  } | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem("console_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [titleDraft, setTitleDraft] = useState(projectTitle || "Session");
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleSavedFlash, setTitleSavedFlash] = useState(false);
  useEffect(() => {
    setTitleDraft(projectTitle || "Session");
  }, [projectTitle]);

  async function saveSongTitle() {
    const next = titleDraft.trim().slice(0, 120) || "Untitled";
    if (!projectId) {
      setTitleDraft(next);
      return;
    }
    if (next === (projectTitle || "Session").trim()) return;
    setTitleSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as ApiJson;
        throw new Error(typeof j.error === "string" ? j.error : "Could not save title");
      }
      setTitleDraft(next);
      setTitleSavedFlash(true);
      window.setTimeout(() => setTitleSavedFlash(false), 1600);
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Could not save title");
    } finally {
      setTitleSaving(false);
    }
  }
  const [soloId, setSoloId] = useState<string | null>(null);
  /** Multi-solo set — when non-empty, only these track ids are audible */
  const [soloIds, setSoloIds] = useState<Record<string, boolean>>({});
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  /** RAF playback closes over render-time applyGains — always read latest mute/solo from refs */
  const mutedRef = useRef<Record<string, boolean>>({});
  const soloIdRef = useRef<string | null>(null);
  const soloIdsRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    soloIdRef.current = soloId;
  }, [soloId]);
  useEffect(() => {
    soloIdsRef.current = soloIds;
  }, [soloIds]);
  const [peaksById, setPeaksById] = useState<Record<string, Float32Array | null>>({});
  /** Decoded audio duration (ms) — source of truth for clip length on timeline */
  const [durationById, setDurationById] = useState<Record<string, number>>({});

  const [decodeStatus, setDecodeStatus] = useState<string>("");
  const [editMsg, setEditMsgRaw] = useState<string | null>(null);
  const editMsgTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Floating console toast — short copy, never a full-width red header bar */
  const setEditMsg = React.useCallback((msg: string | null) => {
    if (editMsgTimerRef.current) {
      clearTimeout(editMsgTimerRef.current);
      editMsgTimerRef.current = null;
    }
    if (msg == null) {
      setEditMsgRaw(null);
      return;
    }
    const short =
      msg.length > 120 ? msg.slice(0, 117).replace(/\s+\S*$/, "").trim() + "…" : msg;
    setEditMsgRaw(short);
    const isProgress = /…$|Building|Exporting|Aligning|Merging|Uploading|Saving|Applying/.test(
      msg
    );
    const isError = /fail|error|could not|denied|missing|not found|unavailable|too short|busy|permission/i.test(
      msg
    );
    if (!isProgress) {
      editMsgTimerRef.current = setTimeout(
        () => setEditMsgRaw(null),
        isError ? 6500 : 3200
      );
    }
  }, []);
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [aiInstrumentBusy, setAiInstrumentBusy] = useState(false);
  const [aiInstrumentError, setAiInstrumentError] = useState<string | null>(null);
  const [aiAroundBusy, setAiAroundBusy] = useState(false);
  const [aiAroundError, setAiAroundError] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [promptBarOpen, setPromptBarOpen] = useState(true);
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => {
      const narrow = mq.matches;
      setIsNarrow(narrow);
      if (narrow) {
        setSidebarCollapsed(true);
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const [isConsoleRecording, setIsConsoleRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [selectedSpeakerId, setSelectedSpeakerId] = useState("__headphones__");
  const [audioSetupOpen, setAudioSetupOpen] = useState(false);
  /** Live input level 0–1 — passive analyser tap, not in monitor/capture path */
  const [liveLevel, setLiveLevel] = useState(0);
  /** Rolling peak samples for in-clip live waveform while recording */
  const [livePeaks, setLivePeaks] = useState<number[]>([]);
  /** Armed task — Record captures into this planned/mock clip */
  const [armedTrackId, setArmedTrackId] = useState<string | null>(null);
  /** Inline rename of vocal track display name */
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const monitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const consoleRecRef = useRef<{
    recorder: MediaRecorder;
    chunks: BlobPart[];
    stream: MediaStream;
    dispose: () => void;
    taskId: string;
    startedAt: number;
    /** Timeline ms where this take should sit (playhead at record start) */
    recordStartMs: number;
  } | null>(null);
  /** Takes that play locally but failed server upload — keep Blob until retry succeeds */
  const pendingTakeBlobsRef = useRef<
    Map<string, { blob: Blob; name: string; durationMs: number; placementStartMs?: number }>
  >(new Map());
  const recordTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveMeterRafRef = useRef<number | null>(null);
  const liveMeterCtxRef = useRef<AudioContext | null>(null);
  const livePeaksBufRef = useRef<number[]>([]);
  const beatFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      setSelectedMicId(readPreferredMicId());
      const spk = readPreferredSpeakerId();
      if (spk) setSelectedSpeakerId(spk);
    } catch {
      /* ignore */
    }
  }, []);

  const [fxById, setFxById] = useState<Record<string, TrackFx>>({});
  /** Always-current FX map for RAF / Web Audio (avoids stale closures). */
  const fxByIdRef = useRef<Record<string, TrackFx>>({});
  useEffect(() => {
    fxByIdRef.current = fxById;
  }, [fxById]);

  // Restore beat volume / FX from project.metadata.beat_track_fx
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok || cancelled) return;
        const j = await res.json();
        const meta =
          (j.project && j.project.metadata) ||
          j.metadata ||
          {};
        const raw = meta.beat_track_fx;
        if (!raw || typeof raw !== "object") return;
        const fx = { ...DEFAULT_TRACK_FX, ...raw } as TrackFx;
        if (cancelled) return;
        fxByIdRef.current = { ...fxByIdRef.current, beat: fx };
        setFxById((prev) => ({ ...prev, beat: fx }));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const [fxRackById, setFxRackById] = useState<Record<string, string[]>>({});
  const [automationDoc, setAutomationDoc] = useState<FxAutomationDoc>({ version: 1, lanes: [] });
  const automationDocRef = useRef<FxAutomationDoc>({ version: 1, lanes: [] });
  useEffect(() => {
    automationDocRef.current = automationDoc;
  }, [automationDoc]);
  const [fxOpenId, setFxOpenId] = useState<string | null>(null);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [masterGainDb, setMasterGainDb] = useState(0);
  const [mixUndoStack, setMixUndoStack] = useState<Record<string, TrackFx>[]>([]);

  const [sessionsOpen, setSessionsOpen] = useState(false);
  /** Mobile header overflow — keeps transport row minimal */
  const [headerMoreOpen, setHeaderMoreOpen] = useState(false);
  /** Right-click / long-press context menu on track or clip */
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    trackId: string;
    clipId?: string | null;
  } | null>(null);
  const [colorById, setColorById] = useState<Record<string, string>>({});
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [trackPrompt, setTrackPrompt] = useState("");
  const [productionDirection, setProductionDirection] = useState<ProductionDirection | null>(null);
  const [directionNote, setDirectionNote] = useState<string | null>(null);
  const [trackPromptBusy, setTrackPromptBusy] = useState(false);
  const [apPhase, setApPhase] = useState(0);
  const [apLastResult, setApLastResult] = useState<"ok" | "err" | null>(null);
  const [apSteps, setApSteps] = useState<{ label: string; done: boolean; active: boolean }[]>([]);
  const [apSummary, setApSummary] = useState<string | null>(null);

  // —— Produce (shared job API — same as Booth) ——
  type ProduceUi = "idle" | "starting" | "producing" | "complete" | "failed";
  const [produceUi, setProduceUi] = useState<ProduceUi>("idle");
  const [produceStage, setProduceStage] = useState<string | null>(null);
  const [produceProgress, setProduceProgress] = useState(0);
  const [produceJobStatus, setProduceJobStatus] = useState<string | null>(null);
  const [produceJobId, setProduceJobId] = useState<string | null>(null);
  /** Sync with produceJobId — poll must not race setState and latch onto a previous job */
  const produceJobIdRef = useRef<string | null>(null);
  const [masterUrl, setMasterUrl] = useState<string | null>(null);
  /** Job id that owns the currently shown master — avoid stale “ready” after re-produce */
  const [masterJobId, setMasterJobId] = useState<string | null>(null);
  const [produceError, setProduceError] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const producePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const produceStartedAtRef = useRef(0);
  /** Last time server progress/stage changed — used to detect dead jobs */
  const produceLastChangeRef = useRef<{ at: number; progress: number; stage: string; status: string }>({
    at: 0,
    progress: -1,
    stage: "",
    status: "",
  });

  const produceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Client-side hard stop so produce UI cannot hang forever */
  const PRODUCE_CLIENT_TIMEOUT_MS = 120 * 60 * 1000;
  const produceActiveRef = useRef(false);
  const masterAudioRef = useRef<HTMLAudioElement | null>(null);
  const [masterPlaying, setMasterPlaying] = useState(false);
  const [masterTime, setMasterTime] = useState(0);
  const [masterDur, setMasterDur] = useState(0);



  const [addTitle, setAddTitle] = useState("");
  const [addType, setAddType] = useState("custom");
  const [addBusy, setAddBusy] = useState(false);
  const addFileRef = useRef<HTMLInputElement | null>(null);

  const [savingId, setSavingId] = useState<string | null>(null);
  /** Per-track busy overlay — FX / save / upload progress on the lane, not the header */
  const [trackBusy, setTrackBusy] = useState<Record<string, string>>({});
  const markTrackBusy = React.useCallback((id: string, label: string) => {
    setTrackBusy((prev) => ({ ...prev, [id]: label }));
  }, []);
  const clearTrackBusy = React.useCallback((id: string) => {
    setTrackBusy((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);
  const [stackMenuId, setStackMenuId] = useState<string | null>(null);
  /** Suno-style ⋮ overflow menu — fixed so it is not clipped by track rows */
  const [trackMenu, setTrackMenu] = useState<{
    trackId: string;
    x: number;
    y: number;
  } | null>(null);
  const dragRef = useRef<{
    id: string;
    mode: "move" | "trim-start" | "trim-end";
    originX: number;
    originStart: number;
    originEnd: number;
    originOffset: number;
    lastStart: number;
    lastEnd: number;
    lastOffset: number;
  } | null>(null);

  async function runDawAction(action: DawAction) {
    switch (action.type) {
      case "mute":
        setMuted((m) => {
          const next = { ...m, [action.trackId]: action.value };
          mutedRef.current = next;
          queueMicrotask(() => applyGains(undefined, true));
          return next;
        });
        break;
      case "solo": {
        const soloTrackId = action.trackId;
        if (soloTrackId == null) {
          soloIdsRef.current = {};
          setSoloIds({});
          soloIdRef.current = null;
          setSoloId(null);
          queueMicrotask(() => applyGains(undefined, true));
          break;
        }
        setSoloIds((prev) => {
          const next = { ...prev, [soloTrackId]: true };
          soloIdsRef.current = next;
          soloIdRef.current = soloTrackId;
          setSoloId(soloTrackId);
          queueMicrotask(() => applyGains(undefined, true));
          return next;
        });
        break;
      }
      case "pan":
        setPan(action.trackId, action.value, true);
        break;
      case "gain": {
        setFxById((prev) => {
          const cur = prev[action.trackId] || { ...DEFAULT_TRACK_FX };
          const next = {
            ...cur,
            gainDb: Math.max(-12, Math.min(12, (Number(cur.gainDb) || 0) + action.deltaDb)),
          };
          void persistFx(action.trackId, next);
          return { ...prev, [action.trackId]: next };
        });
        break;
      }
      case "fx": {
        setFxById((prev) => {
          const cur = prev[action.trackId] || { ...DEFAULT_TRACK_FX };
          const raw = Number((cur as Record<string, number>)[action.key]) || 0;
          let nextVal = raw + action.delta;
          if (
            action.key === "eqLowDb" ||
            action.key === "eqMidDb" ||
            action.key === "eqHighDb"
          ) {
            nextVal = Math.max(-12, Math.min(12, nextVal));
          } else {
            // 0–1 FX amounts (HPF/LPF use fx_set with absolute Hz, not delta keys)
            nextVal = Math.max(0, Math.min(1, nextVal));
          }
          const next = { ...cur, [action.key]: nextVal } as TrackFx;
          void persistFx(action.trackId, next);
          return { ...prev, [action.trackId]: next };
        });
        break;
      }
      case "fx_set": {
        setFxById((prev) => {
          const cur = prev[action.trackId] || { ...DEFAULT_TRACK_FX };
          const next = { ...cur, ...action.patch } as TrackFx;
          void persistFx(action.trackId, next);
          setFxRackById((r) => ({
            ...r,
            [action.trackId]: Array.from(
              new Set([...(r[action.trackId] || []), ...rackFromFx(next)])
            ),
          }));
          return { ...prev, [action.trackId]: next };
        });
        break;
      }
      case "fx_preset": {
        setFxById((prev) => {
          const cur = prev[action.trackId] || { ...DEFAULT_TRACK_FX };
          const next = applyFxPreset(cur as never, action.presetId) as TrackFx;
          void persistFx(action.trackId, next);
          return { ...prev, [action.trackId]: next };
        });
        break;
      }
      case "automation_ramp": {
        const next = applyLinearRamp(
          automationDocRef.current,
          action.trackId,
          action.param,
          action.startMs,
          action.endMs,
          action.startValue,
          action.endValue
        );
        void persistAutomation(next);
        break;
      }
      case "automation_clear": {
        const next = clearLane(automationDocRef.current, action.trackId, action.param);
        void persistAutomation(next);
        break;
      }
      case "select":
        setSelectedTrackId(action.trackId);
        break;
      case "arm":
        setArmedTrackId(action.trackId);
        setSelectedTrackId(action.trackId);
        break;
      case "play":
        if (!playing) void startPlayback(playheadMs);
        break;
      case "pause":
        if (playing) togglePlay();
        break;
      case "seek":
        seekTo(action.ms);
        break;
      case "expand":
        setExpandedId(action.trackId);
        setSelectedTrackId(action.trackId);
        break;
      case "open_fx":
        setSelectedTrackId(action.trackId);
        setExpandedId(action.trackId);
        setFxOpenId(action.trackId);
        break;
      case "choir": {
        setSelectedTrackId(action.trackId);
        setExpandedId(action.trackId);
        await makeChoir(action.trackId, action.mode, { confirm: false });
        break;
      }
      case "rename": {
        if (action.trackId === "beat") break;
        const next = action.title.trim().slice(0, 80);
        if (!next) break;
        setSelectedTrackId(action.trackId);
        setLayers((list) =>
          list.map((l) => (l.id === action.trackId ? { ...l, label: next } : l))
        );
        await persistLayer(action.trackId, { title: next });
        break;
      }
      case "color": {
        const hex = action.color;
        if (action.trackId === "all") {
          const ids = layers
            .filter((l) => l.id !== "beat")
            .map((l) => l.id);
          setColorById((prev) => {
            const next = { ...prev };
            for (const id of ids) next[id] = hex;
            return next;
          });
          setLayers((list) =>
            list.map((l) => (l.id === "beat" ? l : { ...l, color: hex }))
          );
          await Promise.all(ids.map((id) => persistColor(id, hex)));
        } else if (action.trackId !== "beat") {
          setSelectedTrackId(action.trackId);
          setLayers((list) =>
            list.map((l) => (l.id === action.trackId ? { ...l, color: hex } : l))
          );
          await persistColor(action.trackId, hex);
        }
        break;
      }
      default:
        break;
    }
  }

  async function submitTrackPrompt() {
    if (!projectId || !trackPrompt.trim() || trackPromptBusy) return;
    const promptText = trackPrompt.trim();
    setPromptBarOpen(true);
    setTrackPromptBusy(true);
    setApPhase(0);
    setApLastResult(null);
    setEditMsg(null);
    setApSummary(null);
    setApSteps([{ label: "Reading your direction…", done: false, active: true }]);

    try {
      const plan = parseConsoleCommands({
        prompt: promptText,
        tracks: tracks.map((t) => ({
          id: t.id,
          label: t.label,
          kind: t.kind,
          hasAudio: Boolean(t.url),
        })),
        sections: sections.map((s) => ({
          id: s.id,
          label: s.label,
          startMs: s.startMs,
          endMs: s.endMs,
        })),
        selectedTrackId,
        playheadMs,
      });

      // Auto-scope first matched track in UI
      if (plan.matchedTrackIds[0]) {
        setSelectedTrackId(plan.matchedTrackIds[0]);
      }

      const stepList: { label: string; done: boolean; active: boolean }[] = [
        { label: "Reading your direction…", done: true, active: false },
      ];

      // Production Direction → next Produce (Prompt = direction, Produce = render)
      const parsedDir = parseProductionDirection(promptText);
      if (parsedDir.matched.length > 0 || (parsedDir.confidence || 0) >= 0.4) {
        const merged = mergeProductionDirection(productionDirection, parsedDir.direction);
        setProductionDirection(merged);
        setDirectionNote(parsedDir.plainSummary);
        stepList.push({
          label: parsedDir.plainSummary || "Production direction updated",
          done: true,
          active: false,
        });
        setApSteps([...stepList]);
        setApSummary(parsedDir.plainSummary);
        try {
          await fetch(`/api/projects/${projectId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ production_direction: merged }),
          });
        } catch {
          /* session still holds direction */
        }
      }

      // Execute local DAW actions with staged visuals
      if (plan.actions.length) {
        for (let i = 0; i < plan.actions.length; i++) {
          const a = plan.actions[i];
          stepList.push({ label: a.label, done: false, active: true });
          setApSteps([...stepList]);
          await new Promise((r) => setTimeout(r, 280));
          await runDawAction(a);
          stepList[stepList.length - 1] = { label: a.label, done: true, active: false };
          setApSteps([...stepList]);
        }
        setApSummary(plan.summary);
      }

      // Server path for offline take/master processing
      if (plan.needsServer) {
        const trackScope =
          selectedTrackId && selectedTrackId !== "beat"
            ? selectedTrackId
            : plan.matchedTrackIds[0] && plan.matchedTrackIds[0] !== "beat"
              ? plan.matchedTrackIds[0]
              : null;

        if (trackScope) {
          const tr = tracks.find((x) => x.id === trackScope);
          if (tr && !tr.url) {
            // Local actions may have succeeded; only block server if no take
            if (!plan.actions.length) {
              setApLastResult("err");
              setEditMsg("Record or upload a take first.");
              setApSteps((s) => [
                ...s.map((x) => ({ ...x, active: false, done: true })),
                { label: "Need a take on this track", done: true, active: false },
              ]);
              return;
            }
          } else {
            stepList.push({ label: "Processing take with AP engine…", done: false, active: true });
            setApSteps([...stepList]);
            const res = await fetch(`/api/projects/${projectId}/tweak`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: promptText,
                task_id: trackScope,
                track_id: trackScope,
                scope: "track",
                playbackMs: playheadMs,
              }),
            });
            const j = await res.json().catch(() => ({})) as ApiJson;
            if (!res.ok) {
              setApLastResult("err");
              setEditMsg(
                typeof j.error === "string"
                  ? j.error
                  : typeof j.message === "string"
                    ? j.message
                    : "AP engine could not process the take"
              );
              stepList[stepList.length - 1] = {
                label: "Engine pass failed",
                done: true,
                active: false,
              };
              setApSteps([...stepList]);
            } else if (j.needsClarification || j.needsVariationPick) {
              setApLastResult("err");
              setEditMsg(
                typeof j.message === "string"
                  ? j.message
                  : typeof j.plain === "string"
                    ? j.plain
                    : "Be more specific — e.g. “warmer lead” or “mute the beat”"
              );
              stepList[stepList.length - 1] = {
                label: "Need a clearer direction",
                done: true,
                active: false,
              };
              setApSteps([...stepList]);
            } else {
              stepList[stepList.length - 1] = {
                label:
                  typeof j.plain === "string"
                    ? j.plain
                    : typeof j.summary === "string"
                      ? j.summary
                      : "Take updated",
                done: true,
                active: false,
              };
              setApSteps([...stepList]);
              setApLastResult("ok");
              onLayersChanged?.();
              onOpenTweak?.();
            }
          }
        } else if (!tweaksEnabled) {
          if (!plan.actions.length) {
            setApLastResult("err");
            setEditMsg(tweaksGateMessage);
            return;
          }
        } else {
          stepList.push({ label: "Applying song-wide direction…", done: false, active: true });
          setApSteps([...stepList]);
          const res = await fetch(`/api/projects/${projectId}/tweak`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: promptText,
              scope: "song",
              playbackMs: playheadMs,
            }),
          });
          const j = await res.json().catch(() => ({})) as ApiJson;
          if (!res.ok) {
            setApLastResult("err");
            setEditMsg(
              typeof j.error === "string"
                ? j.error
                : typeof j.message === "string"
                  ? j.message
                  : "Song direction failed"
            );
            stepList[stepList.length - 1] = {
              label: "Song pass failed",
              done: true,
              active: false,
            };
            setApSteps([...stepList]);
          } else {
            stepList[stepList.length - 1] = {
              label:
                typeof j.plain === "string"
                  ? j.plain
                  : typeof j.summary === "string"
                    ? j.summary
                    : "Song direction applied",
              done: true,
              active: false,
            };
            setApSteps([...stepList]);
            setApLastResult("ok");
            onLayersChanged?.();
            onOpenTweak?.();
          }
        }
      } else if (plan.actions.length) {
        setApLastResult("ok");
        setEditMsg(plan.summary);
      } else {
        setApLastResult("err");
        setEditMsg(
          "Try a DAW direction — e.g. “solo lead”, “pan harmony left”, “more reverb”, “go to chorus”."
        );
      }

      if (plan.actions.length || plan.needsServer) {
        setTrackPrompt("");
      }
    } catch {
      setApLastResult("err");
      setEditMsg("Network error — check connection and try again");
    } finally {
      setTrackPromptBusy(false);
      setApSteps((s) => s.map((x) => ({ ...x, active: false, done: true })));
    }
  }

  // Suno-style status line while AP works
  useEffect(() => {
    if (!trackPromptBusy) return;
    setApPhase(0);
    const id = window.setInterval(() => {
      setApPhase((p) => p + 1);
    }, 2200);
    return () => window.clearInterval(id);
  }, [trackPromptBusy]);

  async function persistColor(id: string, color: string) {
    setColorById((prev) => ({ ...prev, [id]: color }));
    setColorPickerId(null);
    setSavingId(id);
    try {
      const res = await fetch(`/api/recording-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_color: color }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as ApiJson;
        setEditMsg(typeof j.error === "string" ? j.error : "Could not save color");
      } else {
        onLayersChanged?.();
      }
    } catch {
      setEditMsg("Network error saving color");
    } finally {
      setSavingId(null);
    }
  }


  // Load project-level FX automation
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        const j = await res.json().catch(() => ({})) as ApiJson;
        if (cancelled || !res.ok) return;
        const meta = j.project?.metadata || j.metadata || {};
        const doc = parseFxAutomation(meta.fx_automation);
        setAutomationDoc(doc);
        automationDocRef.current = doc;
      } catch {
        /* keep empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);


  async function persistAutomation(doc: FxAutomationDoc) {
    setAutomationDoc(doc);
    automationDocRef.current = doc;
    if (!projectId) return;
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { fx_automation: doc } }),
      });
    } catch {
      setEditMsg("Could not save automation");
    }
  }

  function applyMixProposal(proposal: MixProposal) {
    const snapshot: Record<string, TrackFx> = {};
    for (const tr of tracks) {
      snapshot[tr.id] = { ...(fxByIdRef.current[tr.id] || DEFAULT_TRACK_FX) };
    }
    setMixUndoStack((s) => [...s.slice(-4), snapshot]);
    for (const ch of proposal.changes) {
      const cur = { ...(fxByIdRef.current[ch.trackId] || DEFAULT_TRACK_FX) };
      const next = { ...cur, ...ch.fx } as TrackFx;
      next.gainDb = Math.max(-12, Math.min(12, Number(next.gainDb) || 0));
      next.pan = Math.max(-1, Math.min(1, Number(next.pan) || 0));
      fxByIdRef.current = { ...fxByIdRef.current, [ch.trackId]: next };
      setFxById((prev) => ({ ...prev, [ch.trackId]: next }));
      const graph = fxGraphRef.current.get(ch.trackId);
      if (graph) {
        let audible = true;
        try {
          const kind = tracks.find((x) => x.id === ch.trackId)?.kind || "vocal";
          audible = isAudible(ch.trackId, kind);
        } catch {
          audible = true;
        }
        graph.apply(trackFxToLiveParams(next as unknown as Record<string, number>), audible);
      }
      void persistFx(ch.trackId, next);
    }
    setEditMsg("AP mix applied — adjust any fader or Undo mix in Mixer.");
  }

  function undoLastMix() {
    setMixUndoStack((stack) => {
      if (!stack.length) return stack;
      const prev = stack[stack.length - 1];
      for (const [id, fx] of Object.entries(prev)) {
        fxByIdRef.current = { ...fxByIdRef.current, [id]: fx };
        setFxById((p) => ({ ...p, [id]: fx }));
        const graph = fxGraphRef.current.get(id);
        if (graph) {
          let audible = true;
          try {
            const kind = tracks.find((x) => x.id === id)?.kind || "vocal";
            audible = isAudible(id, kind);
          } catch {
            audible = true;
          }
          graph.apply(trackFxToLiveParams(fx as unknown as Record<string, number>), audible);
        }
        void persistFx(id, fx);
      }
      setEditMsg("Previous mix restored.");
      return stack.slice(0, -1);
    });
  }

  function patchAutoTune(
    trackId: string,
    patch: { autoTuneEnabled?: number; autoTuneAmount?: number; autoTuneMode?: number }
  ) {
    const cur = { ...(fxByIdRef.current[trackId] || DEFAULT_TRACK_FX) };
    const next = { ...cur, ...patch } as TrackFx;
    fxByIdRef.current = { ...fxByIdRef.current, [trackId]: next };
    setFxById((p) => ({ ...p, [trackId]: next }));
    void persistFx(trackId, next);
  }

  async function persistFx(id: string, fx: TrackFx) {

    fxByIdRef.current = { ...fxByIdRef.current, [id]: fx };
    setFxById((prev) => ({ ...prev, [id]: fx }));
    markTrackBusy(id, "Applying effects…");
    setSavingId(id);
    try {
      // Beat is not a recording_task — store on project.metadata.beat_track_fx
      if (id === "beat") {
        if (!projectId) {
          clearTrackBusy(id);
          setSavingId(null);
          return;
        }
        const res = await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: { beat_track_fx: fx } }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({})) as ApiJson;
          setEditMsg(typeof j.error === "string" ? j.error : "Could not save beat volume");
        }
        return;
      }
      const res = await fetch(`/api/recording-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_fx: fx }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as ApiJson;
        setEditMsg(typeof j.error === "string" ? j.error : "Could not save FX");
      }
      // Do not call onLayersChanged here — parent refresh can race and overwrite
      // local noiseReduce/phraseCleanup before the PATCH is visible on the next fetch.
    } catch {
      setEditMsg("Network error saving FX");
    } finally {
      clearTrackBusy(id);
      setSavingId(null);
    }
  }

  async function persistLayer(
    id: string,
    patch: {
      start_ms?: number;
      end_ms?: number;
      status?: string;
      title?: string;
      selected_in_plan?: boolean;
      active?: boolean;
    }
  ) {
    markTrackBusy(id, "Updating track…");
    setSavingId(id);
    setEditMsg(null);
    try {
      const res = await fetch(`/api/recording-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as ApiJson;
        setEditMsg(typeof j.error === "string" ? j.error : "Could not save edit");
        return false;
      }
      onLayersChanged?.();
      return true;
    } catch {
      setEditMsg("Network error saving edit");
      return false;
    } finally {
      clearTrackBusy(id);
      setSavingId(null);
    }
  }

  function updateLocalLayer(
    id: string,
    startMs: number,
    endMs: number,
    offsetMs?: number
  ) {
    const sep = id.indexOf("::");
    const layerId = sep >= 0 ? id.slice(0, sep) : id;
    const clipId = sep >= 0 ? id.slice(sep + 2) : null;
    setLayers((prev) =>
      prev.map((l) => {
        if (l.id !== layerId) return l;
        if (!clipId || !l.clips || l.clips.length === 0) {
          return {
            ...l,
            startMs,
            endMs,
            mediaOffsetMs:
              offsetMs != null ? Math.max(0, offsetMs) : l.mediaOffsetMs || 0,
          };
        }
        const clips = l.clips.map((c) =>
          c.id === clipId
            ? {
                ...c,
                startMs,
                endMs,
                offsetMs:
                  offsetMs != null ? Math.max(0, offsetMs) : c.offsetMs || 0,
              }
            : c
        );
        return {
          ...l,
          clips,
          startMs: Math.min(...clips.map((c) => c.startMs)),
          endMs: Math.max(...clips.map((c) => c.endMs)),
        };
      })
    );
  }

  function resolveClipOffset(id: string): number {
    const sep = id.indexOf("::");
    const layerId = sep >= 0 ? id.slice(0, sep) : id;
    const clipId = sep >= 0 ? id.slice(sep + 2) : null;
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return 0;
    if (clipId && layer.clips?.length) {
      const c = layer.clips.find((x) => x.id === clipId);
      return Math.max(0, Number(c?.offsetMs) || 0);
    }
    return Math.max(0, Number(layer.mediaOffsetMs) || 0);
  }

  function onClipPointerDown(
    e: React.PointerEvent,
    id: string,
    mode: "move" | "trim-start" | "trim-end",
    startMs: number,
    endMs: number
  ) {
    if (id === "beat") return;
    e.stopPropagation();
    e.preventDefault();
    const originOffset = resolveClipOffset(id);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* */
    }
    dragRef.current = {
      id,
      mode,
      originX: e.clientX,
      originStart: startMs,
      originEnd: endMs,
      originOffset,
      lastStart: startMs,
      lastEnd: endMs,
      lastOffset: originOffset,
    };

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dxMs = ((ev.clientX - d.originX) / pxPerSec) * 1000;
      const minLen = 200;
      let start = d.originStart;
      let end = d.originEnd;
      let offset = d.originOffset;
      if (d.mode === "move") {
        const dur = Math.max(minLen, d.originEnd - d.originStart);
        start = Math.max(0, d.originStart + dxMs);
        end = start + dur;
        // Move keeps the same audio region
        offset = d.originOffset;
      } else if (d.mode === "trim-start") {
        // Voice Memo: drag left edge — crop into audio, keep right edge fixed
        const nextStart = Math.max(
          0,
          Math.min(d.originEnd - minLen, d.originStart + dxMs)
        );
        const delta = nextStart - d.originStart;
        offset = Math.max(0, d.originOffset + delta);
        start = nextStart;
        end = d.originEnd;
      } else {
        // Trim end — shorten/lengthen without changing audio offset
        end = Math.max(d.originStart + minLen, d.originEnd + dxMs);
        start = d.originStart;
        offset = d.originOffset;
      }
      const s = Math.round(start);
      const en = Math.round(end);
      const off = Math.round(offset);
      d.lastStart = s;
      d.lastEnd = en;
      d.lastOffset = off;
      updateLocalLayer(d.id, s, en, off);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      onClipPointerUp();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onClipPointerMove(_e: React.PointerEvent) {
    // Window-level listeners handle drag (more reliable on iOS)
  }

  function onClipPointerUp() {
    const d = dragRef.current;
    if (!d || d.id === "beat") {
      dragRef.current = null;
      return;
    }
    const { id, lastStart, lastEnd, lastOffset, originStart, originEnd, originOffset } = d;
    dragRef.current = null;
    if (
      lastStart !== originStart ||
      lastEnd !== originEnd ||
      lastOffset !== originOffset
    ) {
      pushConsoleHistory({
        kind: "layer-geo",
        label: d.mode === "move" ? "Move clip" : "Crop clip",
        id,
        before: { startMs: originStart, endMs: originEnd },
        after: { startMs: lastStart, endMs: lastEnd },
      });
    }
    const sep = id.indexOf("::");
    const layerId = sep >= 0 ? id.slice(0, sep) : id;
    const clipId = sep >= 0 ? id.slice(sep + 2) : null;
    const layer = layers.find((l) => l.id === layerId);
    if (clipId && layer?.clips && layer.clips.length > 0) {
      const clips = layer.clips.map((c) =>
        c.id === clipId
          ? { ...c, startMs: lastStart, endMs: lastEnd, offsetMs: lastOffset }
          : c
      );
      void fetch(`/api/recording-tasks/${layerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_ms: Math.min(...clips.map((c) => c.startMs)),
          end_ms: Math.max(...clips.map((c) => c.endMs)),
          console_clips: clips.map((c) => ({
            id: c.id,
            start_ms: c.startMs,
            end_ms: c.endMs,
            recording_id: c.recordingId || null,
            offset_ms: c.offsetMs || 0,
          })),
        }),
      });
    } else {
      void fetch(`/api/recording-tasks/${layerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_ms: lastStart,
          end_ms: lastEnd,
          metadata: { media_offset_ms: lastOffset },
        }),
      }).catch(() => {
        void persistLayer(layerId, { start_ms: lastStart, end_ms: lastEnd });
      });
    }
  }

  async function makeChoir(
    id: string,
    mode: "double" | "choir_light" | "choir_full" | "chorus_lift" = "choir_full",
    opts?: { confirm?: boolean }
  ): Promise<boolean> {
    if (!projectId || id === "beat") return false;
    // Plugin-style: one recorded take is enough. API resolves the take by task id
    // (and same-section lead fallback). Do not require pre-planned choir tasks.
    const labels: Record<string, string> = {
      double: "Add tight doubles from this vocal?",
      choir_light: "Add a light choir (doubles + high harmony)?",
      choir_full: "Turn this vocal into a full choir stack?",
      chorus_lift: "Lift this section (chorus-style doubles + high)?",
    };
    if (opts?.confirm !== false) {
      if (!window.confirm(labels[mode] || labels.choir_full)) return false;
    }
    setSavingId(id);
    setEditMsg("Building choir…");
    try {
      const layer = layers.find((l) => l.id === id);
      // Prefer client-decoded WAV (browser handles webm/opus; Vercel often cannot).
      // Fall back to server path if local decode fails (revoked blob URL, CORS, etc.).
      let res: Response | null = null;
      if (layer?.audioUrl) {
        try {
          let audioBuf: AudioBuffer | null =
            (layer.audioUrl && bufferCache.get(layer.audioUrl)) || null;
          if (!audioBuf) {
            const actx = new AudioContext();
            try {
              audioBuf = await decodeAudioUrl(actx, layer.audioUrl);
              if (audioBuf) bufferCache.set(layer.audioUrl, audioBuf);
            } finally {
              void actx.close().catch(() => undefined);
            }
          }
          if (audioBuf && audioBuf.length > 256) {
            const wavBlob = encodeWavBlob(audioBuf);
            const fd = new FormData();
            fd.append("mode", mode);
            if (layer.recordingId) fd.append("recording_id", layer.recordingId);
            fd.append("file", wavBlob, "lead.wav");
            res = await fetch(`/api/recording-tasks/${id}/choir`, {
              method: "POST",
              body: fd,
            });
          }
        } catch (clientErr) {
          console.warn("[choir] client WAV path failed, falling back to server", clientErr);
        }
      }
      if (!res) {
        res = await fetch(`/api/recording-tasks/${id}/choir`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            ...(layer?.recordingId ? { recording_id: layer.recordingId } : {}),
          }),
        });
      }
      const j = await res.json().catch(() => ({})) as ApiJson;
      if (!res.ok) {
        const hint =
          typeof j.error === "string"
            ? j.error
            : "Could not build choir";
        const det = j.details && typeof j.details === "object" ? j.details : null;
        const found =
          det && typeof (det as { recordings_found?: number }).recordings_found === "number"
            ? ` (${(det as { recordings_found: number }).recordings_found} takes in project)`
            : "";
        const reason =
          det && typeof (det as { reason?: string }).reason === "string"
            ? `: ${(det as { reason: string }).reason}`
            : typeof j.detail === "string"
              ? `: ${j.detail}`
              : "";
        const saveErrs = Array.isArray((det as { saveErrors?: string[] } | null)?.saveErrors)
          ? ` — ${(det as { saveErrors: string[] }).saveErrors.slice(0, 2).join("; ")}`
          : "";
        setEditMsg(
          hint === "Task not found"
            ? "Track not found — refresh Console and use a recorded vocal layer."
            : hint.startsWith("No vocal take")
              ? "No vocal take on this track — record or upload first, then Stack."
              : `${hint}${found}${reason}${saveErrs}`
        );
        return false;
      }
      const msg =
        typeof j.message === "string"
          ? j.message
          : mode === "choir_full"
            ? "Full choir stacked on this vocal — same section timeline."
            : "Choir layers added on this vocal.";
      setEditMsg(msg);
      setTimeout(() => setEditMsg(null), 5000);
      // Soft refresh so new harmony/double tracks appear with audio URLs
      onLayersChanged?.();
      // Second pass after a short delay — session-preview may lag one tick behind inserts
      setTimeout(() => onLayersChanged?.(), 800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error building choir";
      setEditMsg(msg.includes("fetch") || msg.includes("Network") ? "Network error building choir" : msg);
      return false;
    } finally {
      setSavingId(null);
    }
    return true;
  }

  async function duplicateLayer(id: string) {
    if (!projectId || id === "beat") return;
    setSavingId(id);
    setEditMsg(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/recording-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicate_from: id }),
      });
      const j = await res.json().catch(() => ({})) as ApiJson;
      if (!res.ok) {
        setEditMsg(typeof j.error === "string" ? j.error : "Could not duplicate track");
        return;
      }
      const task = j.task as {
        id: string;
        type?: string;
        title?: string;
        start_ms?: number;
        end_ms?: number;
        status?: string;
      };
      if (!task?.id) {
        setEditMsg("Duplicate created but no id returned");
        return;
      }
      const src = layers.find((l) => l.id === id);
      setLayers((prev) => [
        ...prev,
        {
          id: task.id,
          label: (task.type || src?.role || "custom").replace(/_/g, " "),
          role: task.type || src?.role || "custom",
          sectionLabel: task.title || `${src?.sectionLabel || src?.label || "Track"} (copy)`,
          startMs: Number(task.start_ms) ?? src?.startMs ?? 0,
          endMs: Number(task.end_ms) ?? src?.endMs ?? 8000,
          audioUrl: src?.audioUrl || null,
          color: src?.color,
          trackFx: src?.trackFx ? { ...src.trackFx } : null,
        },
      ]);
      if (src?.color) {
        setColorById((prev) => ({ ...prev, [task.id]: src.color! }));
        void fetch(`/api/recording-tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ track_color: src.color }),
        }).catch(() => null);
      }
      if (src?.trackFx) {
        void persistFx(task.id, { ...DEFAULT_TRACK_FX, ...src.trackFx });
      }
      setSelectedTrackId(task.id);
      onLayersChanged?.();
    } catch {
      setEditMsg("Network error duplicating track");
    } finally {
      setSavingId(null);
    }
  }

  function beginRenameTrack(tr: { id: string; label: string; kind: string }) {
    if (tr.kind !== "vocal" || tr.id === "beat") return;
    setRenamingTrackId(tr.id);
    setRenameDraft(tr.label || "");
    setSelectedTrackId(tr.id);
  }

  async function commitRenameTrack() {
    const id = renamingTrackId;
    if (!id) return;
    const next = renameDraft.trim().slice(0, 80);
    setRenamingTrackId(null);
    if (!next) return;
    const prev = layers.find((l) => l.id === id);
    if (prev && prev.label === next) return;
    setRenameBusy(true);
    setEditMsg(null);
    // Optimistic UI
    setLayers((list) => list.map((l) => (l.id === id ? { ...l, label: next } : l)));
    try {
      const ok = await persistLayer(id, { title: next });
      if (!ok) {
        // revert via parent soft reload
        onLayersChanged?.();
      } else {
        setEditMsg(`Renamed to “${next}”`);
      }
    } finally {
      setRenameBusy(false);
    }
  }

  function openTrackContextMenu(
    e: React.MouseEvent | React.PointerEvent,
    trackId: string,
    clipId?: string | null
  ) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedTrackId(trackId);
    if (trackId !== "beat") setArmedTrackId(trackId);
    if (clipId) setSelectedClipId(clipId);
    const pad = 8;
    const menuW = 220;
    const menuH = 320;
    const x = Math.min(e.clientX, (typeof window !== "undefined" ? window.innerWidth : 400) - menuW - pad);
    const y = Math.min(e.clientY, (typeof window !== "undefined" ? window.innerHeight : 600) - menuH - pad);
    setCtxMenu({ x: Math.max(pad, x), y: Math.max(pad, y), trackId, clipId: clipId || null });
  }

  function closeCtxMenu() {
    setCtxMenu(null);
  }


  async function ensureRecordTargetTask(): Promise<string | null> {
    if (!projectId) return null;
    // Prefer armed mock/planned clip, then selected vocal — never create a parallel task for those
    const prefer = [armedTrackId, selectedTrackId].filter(
      (id): id is string => Boolean(id) && id !== "beat"
    );
    for (const id of prefer) {
      const exists = layers.some((l) => l.id === id) || tracks.some((tr) => tr.id === id);
      if (exists) {
        setSelectedTrackId(id);
        setArmedTrackId(id);
        return id;
      }
    }
    // Create a new lead at playhead
    setAddType("lead");
    const startMs = Math.round(playheadMs);
    const res = await fetch(`/api/projects/${projectId}/recording-tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "lead",
        title: "Lead (Console)",
        start_ms: startMs,
        end_ms: startMs + 30000,
        plan_source: "console",
      }),
    });
    const j = await res.json().catch(() => ({})) as ApiJson;
    if (!res.ok || !j.task?.id) {
      setEditMsg(typeof j.error === "string" ? j.error : "Could not create record target");
      return null;
    }
    const task = j.task;
    setLayers((prev) => [
      ...prev,
      {
        id: task.id,
        label: "lead",
        role: "lead",
        sectionLabel: task.title || "Lead",
        startMs: Number(task.start_ms) || startMs,
        endMs: Number(task.end_ms) || startMs + 30000,
      },
    ]);
    setSelectedTrackId(task.id);
    return task.id as string;
  }

  async function retryPendingUpload(taskId: string) {
    const pending = pendingTakeBlobsRef.current.get(taskId);
    if (!pending) {
      // Try recover from blob: audioUrl on the layer
      const layer = layers.find((l) => l.id === taskId);
      const url = layer?.audioUrl;
      if (url && url.startsWith("blob:")) {
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          pendingTakeBlobsRef.current.set(taskId, {
            blob,
            name: "take-retry.wav",
            durationMs: Math.max(500, (layer?.endMs || 0) - (layer?.startMs || 0)),
          });
        } catch {
          setEditMsg("Could not recover take from memory — re-record this part");
          return;
        }
      } else {
        setEditMsg("No pending take to upload for this track");
        return;
      }
    }
    const pack = pendingTakeBlobsRef.current.get(taskId);
    if (!pack) return;
    markTrackBusy(taskId, "Retrying upload…");
    setEditMsg(null);
    try {
      const placeMs = pack.placementStartMs ?? layers.find((l) => l.id === taskId)?.startMs ?? 0;
      let uj: RecordingUploadJson = {};
      let upOk = false;
      if (pack.blob.size <= 3_200_000) {
        const fd = new FormData();
        fd.append("file", pack.blob, pack.name || "take.wav");
        fd.append("duration_ms", String(pack.durationMs));
        fd.append("source", "record");
        fd.append("placement_start_ms", String(placeMs));
        const up = await fetch(`/api/recording-tasks/${taskId}/recordings`, {
          method: "POST",
          body: fd,
        });
        uj = (await up.json().catch(() => ({}))) as RecordingUploadJson;
        upOk = up.ok;
      } else {
        const signRes = await fetch(`/api/recording-tasks/${taskId}/recordings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            duration_ms: pack.durationMs,
            content_type: pack.blob.type || "audio/wav",
            placement_start_ms: placeMs,
            source: "record",
          }),
        });
        const signJ = (await signRes.json().catch(() => ({}))) as RecordingUploadJson;
        if (!signRes.ok) {
          uj = signJ;
        } else {
          const signedUrl = signJ.upload?.signedUrl || signJ.signedUrl;
          if (!signedUrl) {
            uj = { error: "No signed upload URL" };
          } else {
            const put = await fetch(signedUrl, {
              method: "PUT",
              headers: (signJ.upload?.headers as Record<string, string> | undefined) || {
                "Content-Type": pack.blob.type || "audio/wav",
              },
              body: pack.blob,
            });
            upOk = put.ok;
            uj = put.ok ? signJ : { error: `Storage PUT ${put.status}` };
          }
        }
      }
      if (!upOk) {
        setEditMsg(
          (typeof uj.error === "string" ? uj.error : "Upload failed again") +
            " — Download take to keep a local copy"
        );
        return;
      }
      pendingTakeBlobsRef.current.delete(taskId);
      await fetch(`/api/recording-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          end_ms: Math.round(
            (layers.find((l) => l.id === taskId)?.startMs || 0) + pack.durationMs
          ),
        }),
      }).catch(() => null);
      const audioUrl =
        audioUrlFromUploadJson(uj);
      setLayers((prev) =>
        prev.map((l) =>
          l.id === taskId
            ? {
                ...l,
                audioUrl: audioUrl || l.audioUrl,
                uploadFailed: false,
                recordingId: (uj.recording?.id as string) || l.recordingId,
              }
            : l
        )
      );
      clearTrackBusy(taskId);
      setEditMsg(null);
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Retry upload failed");
    }
  }

  function downloadPendingTake(taskId: string) {
    const pending = pendingTakeBlobsRef.current.get(taskId);
    const layer = layers.find((l) => l.id === taskId);
    const run = async () => {
      let blob = pending?.blob;
      if (!blob && layer?.audioUrl?.startsWith("blob:")) {
        try {
          blob = await (await fetch(layer.audioUrl)).blob();
        } catch {
          setEditMsg("Could not download — blob already cleared");
          return;
        }
      }
      if (!blob) {
        setEditMsg("No local take data to download");
        return;
      }
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `${(layer?.label || "take").replace(/[^\w\-]+/g, "_")}-${taskId.slice(0, 8)}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setEditMsg("Downloaded local copy — keep this file safe, then Retry upload");
    };
    void run();
  }

  async function stopConsoleRecord() {

    const rec = consoleRecRef.current;
    if (!rec) {
      setIsConsoleRecording(false);
      return;
    }
    if (recordTickRef.current) {
      clearInterval(recordTickRef.current);
      recordTickRef.current = null;
    }
    try {
      if (monitorAudioRef.current) {
        monitorAudioRef.current.pause();
        monitorAudioRef.current = null;
      }
      // Keep multitrack arrangement playing after punch-out (DAW-style).
      // User can pause with transport if they want silence.
      if (isConsoleRecording) {
        // Re-apply gains so soft-muted armed track becomes audible again
        queueMicrotask(() => applyGains(undefined, true));
      }
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      rec.recorder.onstop = () => resolve();
      try {
        if (rec.recorder.state !== "inactive") rec.recorder.stop();
        else resolve();
      } catch {
        resolve();
      }
    });
    rec.stream.getTracks().forEach((tr) => tr.stop());
    try {
      rec.dispose();
    } catch {
      /* ignore */
    }
    const blob = new Blob(rec.chunks, { type: rec.recorder.mimeType || "audio/webm" });
    const wallClockMs = Math.max(500, Date.now() - rec.startedAt);
    const taskId = rec.taskId;
    // Transport-relative start; subtract capture pipeline latency so takes sit on the groove
    const rawStart = Math.max(0, Math.round(rec.recordStartMs ?? playheadMs));
    const placementStartMs = Math.max(0, rawStart - getCaptureLatencyCompMs());
    consoleRecRef.current = null;
    setIsConsoleRecording(false);
    setRecordSeconds(0);
    stopLiveMeter();
    setLivePeaks([]);
    livePeaksBufRef.current = [];

    if (blob.size < 100) {
      setEditMsg("Recording too short — try again");
      return;
    }

    // Retake path: merge into working take buffer (do not upload as full replacement yet)
    if (
      retakeTarget &&
      retakeTarget.taskId === taskId &&
      takeEditId === taskId &&
      takeWorkingRef.current
    ) {
      setEditMsg("Merging retake…");
      const ok = await finishRetakeWithBlob(taskId, blob);
      if (ok) return;
      // fall through to normal save if merge failed
    }

    markTrackBusy(taskId, "Saving take…");
    setEditMsg(null);
    try {
      // Same as Booth: MediaRecorder blob → WAV so waveform + produce use decoded PCM.
      // Instant local peaks from the decoded buffer (same path as uploaded vocals).
      let uploadBlob: Blob = blob;
      let uploadName = `console-take-${Date.now()}.webm`;
      let durationMs = wallClockMs;
      let localUrl: string | null = null;
      const takeClipId = `take-${Date.now()}`;
      try {
        const wav = await audioBlobToWavDetailed(blob);
        uploadBlob = wav.blob;
        uploadName = "take.wav";
        durationMs = Math.max(
          500,
          Math.round((wav.outputDurationSec || wav.sourceDurationSec || wallClockMs / 1000) * 1000)
        );
        localUrl = URL.createObjectURL(uploadBlob);
        // Decode WAV for high-res peaks immediately (matches upload accuracy)
        const ctx = getCtx();
        if (ctx && localUrl) {
          try {
            const ab = await uploadBlob.arrayBuffer();
            const audioBuf = await ctx.decodeAudioData(ab.slice(0));
            bufferCache.set(localUrl, audioBuf);
            peaksForUrl(localUrl, audioBuf, 2048);
            const buckets = Math.min(2048, Math.max(64, Math.floor(timelineW || 800)));
            const hi = peaksForUrl(localUrl, audioBuf, buckets);
            setPeaksById((prev) => ({
              ...prev,
              [taskId]: hi,
              [takeClipId]: hi,
            }));
            setDurationById((prev) => ({
              ...prev,
              [taskId]: Math.round(audioBuf.duration * 1000),
              [takeClipId]: Math.round(audioBuf.duration * 1000),
            }));
          } catch {
            /* peaks still refresh after server URL */
          }
        }
      } catch (convErr) {
        console.warn("[console] WAV conversion failed — uploading original", convErr);
      }

      // Place take at playhead where recording started (DAW-style free record)
      const placeMs = placementStartMs;
      setLayers((prev) =>
        prev.map((l) =>
          l.id === taskId
            ? mergeTakeOntoLayer(l, {
                id: takeClipId,
                startMs: placeMs,
                endMs: placeMs + durationMs,
                audioUrl: localUrl || l.audioUrl,
              })
            : l
        )
      );
      setSelectedClipId(takeClipId);

      /**
       * Upload strategy:
       * - Small files: multipart through API (simple)
       * - Larger files: signed URL → PUT straight to R2 (avoids Vercel ~4.5MB body limit — common "Upload failed" cause)
       */
      const DIRECT_THRESHOLD = 3_200_000; // bytes
      let uj: RecordingUploadJson = {};
      let upOk = false;

      try {
        if (uploadBlob.size <= DIRECT_THRESHOLD) {
          const fd = new FormData();
          fd.append("file", uploadBlob, uploadName);
          fd.append("duration_ms", String(durationMs));
          fd.append("source", "record");
          fd.append("placement_start_ms", String(placeMs));
          fd.append("recording_offset_ms", String(0));
          const up = await fetch(`/api/recording-tasks/${taskId}/recordings`, {
            method: "POST",
            body: fd,
          });
          uj = (await up.json().catch(() => ({}))) as RecordingUploadJson;
          upOk = up.ok;
        } else {
          // 1) Create row + signed PUT URL (no audio body through Vercel)
          const signRes = await fetch(`/api/recording-tasks/${taskId}/recordings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              duration_ms: durationMs,
              content_type: uploadBlob.type || "audio/wav",
              placement_start_ms: placeMs,
              recording_offset_ms: 0,
              source: "record",
            }),
          });
          const signJ = (await signRes.json().catch(() => ({}))) as RecordingUploadJson;
          if (!signRes.ok) {
            uj = signJ;
            upOk = false;
          } else {
            const signedUrl =
              signJ.upload?.signedUrl || signJ.signedUrl || signJ.upload_url || null;
            const putHeaders =
              (signJ.upload?.headers as Record<string, string> | undefined) || {
                "Content-Type": uploadBlob.type || "audio/wav",
              };
            if (!signedUrl) {
              uj = { error: "No signed upload URL returned" };
              upOk = false;
            } else {
              const put = await fetch(signedUrl, {
                method: "PUT",
                headers: putHeaders,
                body: uploadBlob,
              });
              if (!put.ok) {
                const putText = await put.text().catch(() => "");
                uj = {
                  error: `Direct storage upload failed (${put.status})${putText ? `: ${putText.slice(0, 120)}` : ""}`,
                };
                upOk = false;
              } else {
                uj = signJ;
                upOk = true;
              }
            }
          }
        }
      } catch (netErr) {
        uj = {
          error: netErr instanceof Error ? netErr.message : "Network error during upload",
        };
        upOk = false;
      }

      if (!upOk) {
        pendingTakeBlobsRef.current.set(taskId, {
          blob: uploadBlob,
          name: uploadName,
          durationMs,
          placementStartMs: placeMs,
        });
        setLayers((prev) =>
          prev.map((l) =>
            l.id === taskId
              ? mergeTakeOntoLayer(l, {
                  id: takeClipId,
                  startMs: placeMs,
                  endMs: placeMs + durationMs,
                  audioUrl: localUrl || l.audioUrl,
                  uploadFailed: true,
                })
              : l
          )
        );
        const detail =
          typeof uj.error === "string"
            ? uj.error
            : typeof uj.message === "string"
              ? uj.message
              : "Upload failed";
        setEditMsg(`${detail} — take still plays. Retry or Download below.`);
        clearTrackBusy(taskId);
        return;
      }
      pendingTakeBlobsRef.current.delete(taskId);
      const audioUrl =
        audioUrlFromUploadJson(uj);
      if (audioUrl) {
        // Prefer server URL; carry local peaks over by seeding cache under the new URL
        if (localUrl) {
          const localBuf = bufferCache.get(localUrl);
          if (localBuf) {
            bufferCache.set(audioUrl, localBuf);
            const hi = peakCache.get(`${localUrl}::2048`);
            if (hi) peakCache.set(`${audioUrl}::2048`, hi);
          }
        }
        const serverClipId =
          (typeof uj.recording?.id === "string" && uj.recording.id) || takeClipId;
        setLayers((prev) =>
          prev.map((l) => {
            if (l.id !== taskId) return l;
            const clips = (l.clips && l.clips.length > 0
              ? l.clips
              : l.audioUrl || l.recordingId
                ? [
                    {
                      id: l.recordingId || l.id,
                      startMs: l.startMs,
                      endMs: l.endMs,
                      audioUrl: l.audioUrl,
                      recordingId: l.recordingId,
                      offsetMs: l.mediaOffsetMs || 0,
                    },
                  ]
                : []
            ).map((c) =>
              c.id === takeClipId
                ? {
                    ...c,
                    id: serverClipId,
                    audioUrl: audioUrl || c.audioUrl,
                    recordingId:
                      (typeof uj.recording?.id === "string" && uj.recording.id) ||
                      c.recordingId ||
                      null,
                    startMs: placementStartMs,
                    endMs: placementStartMs + durationMs,
                  }
                : c
            );
            const hasTake = clips.some((c) => c.id === serverClipId || c.id === takeClipId);
            if (!hasTake) {
              // Optimistic first take is a single region (no clips[]) — just stamp server URL
              if (!l.clips?.length) {
                return {
                  ...l,
                  audioUrl: audioUrl || l.audioUrl,
                  recordingId:
                    (typeof uj.recording?.id === "string" && uj.recording.id) ||
                    l.recordingId,
                  startMs: placementStartMs,
                  endMs: placementStartMs + durationMs,
                  uploadFailed: false,
                };
              }
              return mergeTakeOntoLayer(l, {
                id: serverClipId,
                startMs: placementStartMs,
                endMs: placementStartMs + durationMs,
                audioUrl: audioUrl,
                recordingId:
                  (typeof uj.recording?.id === "string" && uj.recording.id) || null,
                uploadFailed: false,
              });
            }
            const sorted = [...clips].sort((a, b) => a.startMs - b.startMs);
            return {
              ...l,
              clips: sorted.length > 1 ? sorted : undefined,
              startMs: sorted[0]?.startMs ?? placementStartMs,
              endMs: sorted[sorted.length - 1]?.endMs ?? placementStartMs + durationMs,
              audioUrl: sorted[0]?.audioUrl ?? audioUrl ?? l.audioUrl,
              recordingId: sorted[0]?.recordingId ?? l.recordingId,
              uploadFailed: false,
            };
          })
        );
        setSelectedClipId(serverClipId);
        // Re-map peaks to task id under the server URL resolution
        setPeaksById((prev) => {
          const existing = prev[taskId];
          if (!existing) return prev;
          return { ...prev, [taskId]: existing };
        });
      }
      // Keep local object URL until React swaps to server URL (revoke would break mid-frame)
      // Persist multi-clip layout + take span for this track
      setLayers((prev) => {
        const layer = prev.find((l) => l.id === taskId);
        if (layer) persistLayerStructure(layer);
        return prev;
      });
      clearTrackBusy(taskId);
      setArmedTrackId(taskId);
      setSelectedTrackId(taskId);
      onLayersChanged?.();
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Save failed");
      clearTrackBusy(taskId);
    }
  }

  async function startConsoleRecord() {
    if (!projectId) {
      setEditMsg("Missing project");
      return;
    }
    if (isConsoleRecording) return;
    setEditMsg(null);
    const taskId = await ensureRecordTargetTask();
    if (!taskId) return;

    try {
      const opened = await openRecordingStream({
        preferredInputId: selectedMicId || "",
        outputPreference: selectedSpeakerId || "__headphones__",
      });
      const { recorder, mimeType } = createVocalRecorder(opened.recordStream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      // DAW-style: record from the current playhead, not forced to section/clip start
      const fromMs = Math.max(0, Math.round(playheadMs));
      consoleRecRef.current = {
        recorder,
        chunks,
        stream: opened.stream,
        dispose: opened.dispose,
        taskId,
        startedAt: Date.now(),
        recordStartMs: fromMs,
      };
      recorder.start(250);
      setIsConsoleRecording(true);
      setRecordSeconds(0);
      // Passive level meter on cloned mic tracks (not in capture or monitor path)
      startLiveMeter(opened.stream);
      recordTickRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);

      // Multitrack overdub monitor: play ALL tracks from playhead (Web Audio).
      // Mic capture stays on a separate MediaStream — never fed from the master mix.
      setPlayheadMs(fromMs);
      setArmedTrackId(taskId);
      setSelectedTrackId(taskId);
      try {
        // Mute the track being recorded so the artist hears others, not prior takes on same lane
        // (optional soft-mute only if they already have audio — keep unmuted if empty lane)
        void startPlayback(fromMs);
      } catch {
        /* playback monitor best-effort */
      }
      const micNote = opened.info?.inputLabel || micSummaryLabel(selectedMicId);
      const routeWarn =
        opened.fellBack || opened.info?.routingStatus === "FALLBACK"
          ? " · Browser opened a different mic than selected — re-pick the interface"
          : opened.info?.routingNote
            ? ` · ${opened.info.routingNote}`
            : opened.info?.routingStatus === "OS_OVERRIDE"
              ? " · OS may be routing audio through another device"
              : "";
      setEditMsg(
        `Overdub from ${Math.round(fromMs / 100) / 10}s — hearing arrangement · ${mimeType.split(";")[0]} · ${micNote}${routeWarn}`
      );
    } catch (e) {
      setEditMsg(formatMicOpenError(e));
      setIsConsoleRecording(false);
      stopLiveMeter();
    }
  }


  function getEditAudioCtx(): AudioContext | null {
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }

  function pushTakeUndo(buf: AudioBuffer) {
    takeUndoStackRef.current = [...takeUndoStackRef.current.slice(-11), buf];
    takeRedoStackRef.current = [];
    setTakeUndoDepth(takeUndoStackRef.current.length);
  }

  function bumpHistory() {
    setHistoryTick((n) => n + 1);
  }

  function pushConsoleHistory(entry: ConsoleHistoryEntry) {
    consoleUndoRef.current = [...consoleUndoRef.current.slice(-39), entry];
    consoleRedoRef.current = [];
    bumpHistory();
  }

  function applyLayerGeo(id: string, startMs: number, endMs: number, persist: boolean) {
    updateLocalLayer(id, startMs, endMs);
    if (persist) void persistLayer(id, { start_ms: startMs, end_ms: endMs });
  }

  function applyFxSnapshot(id: string, fx: TrackFx, persist: boolean) {
    fxByIdRef.current = { ...fxByIdRef.current, [id]: { ...fx } };
    setFxById((prev) => ({ ...prev, [id]: { ...fx } }));
    const graph = fxGraphRef.current.get(id);
    if (graph) {
      try {
        const kind = tracks.find((x) => x.id === id)?.kind || "vocal";
        graph.apply(
          trackFxToLiveParams(fx as unknown as Record<string, number>),
          isAudible(id, kind)
        );
      } catch {
        /* */
      }
    }
    // Gate / denoise are buffer-preprocessed — re-cue playback so preview matches knobs
    if (
      persist &&
      playingRef.current &&
      ((Number(fx.gate) || 0) > 0.02 ||
        (Number(fx.noiseReduce) || 0) > 0.02 ||
        (Number(fx.phraseCleanup) || 0) > 0.02 ||
        (Number((fxByIdRef.current[id] || {}).gate) || 0) > 0.02 ||
        (Number((fxByIdRef.current[id] || {}).noiseReduce) || 0) > 0.02 ||
        (Number((fxByIdRef.current[id] || {}).phraseCleanup) || 0) > 0.02)
    ) {
      const t = playheadMsRef.current;
      queueMicrotask(() => {
        if (playingRef.current) void startPlayback(t);
      });
    }
    if (persist) void persistFx(id, fx);
  }

  function cloneLayersSnap(list: ProducerLayer[]): ProducerLayer[] {
    return list.map((l) => ({
      ...l,
      clips: l.clips ? l.clips.map((c) => ({ ...c })) : undefined,
    }));
  }

  function persistLayerStructure(layer: ProducerLayer) {
    const clips = layer.clips && layer.clips.length > 0 ? layer.clips : null;
    const body: Record<string, unknown> = {
      start_ms: layer.startMs,
      end_ms: layer.endMs,
      status:
        layer.audioUrl || layer.recordingId || (clips && clips.length)
          ? "completed"
          : "pending",
    };
    if (clips) {
      body.console_clips = clips.map((c) => ({
        id: c.id,
        start_ms: c.startMs,
        end_ms: c.endMs,
        recording_id: c.recordingId || null,
      }));
    } else {
      body.console_clips = [];
    }
    void fetch(`/api/recording-tasks/${layer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
  }

  function applyLayersSnapshot(snap: ProducerLayer[], persist: boolean) {
    const next = cloneLayersSnap(snap);
    setLayers(next);
    if (persist) {
      for (const l of next) {
        persistLayerStructure(l);
      }
      onLayersChanged?.();
    }
  }

  function consoleUndo() {
    // Prefer take-edit stack while a take is open
    if (takeEditId && takeUndoStackRef.current.length) {
      undoTakeEdit();
      return;
    }
    const entry = consoleUndoRef.current.pop();
    if (!entry) return;
    consoleRedoRef.current.push(entry);
    if (entry.kind === "layer-geo") {
      applyLayerGeo(entry.id, entry.before.startMs, entry.before.endMs, true);
    } else if (entry.kind === "fx") {
      applyFxSnapshot(entry.id, entry.before, true);
    } else if (entry.kind === "layers") {
      applyLayersSnapshot(entry.before, true);
      setSelectedClipId(null);
      setEditMsg(`Undid: ${entry.label}`);
    }
    bumpHistory();
  }

  function consoleRedo() {
    if (takeEditId && takeRedoStackRef.current.length) {
      redoTakeEdit();
      return;
    }
    const entry = consoleRedoRef.current.pop();
    if (!entry) return;
    consoleUndoRef.current.push(entry);
    if (entry.kind === "layer-geo") {
      applyLayerGeo(entry.id, entry.after.startMs, entry.after.endMs, true);
    } else if (entry.kind === "fx") {
      applyFxSnapshot(entry.id, entry.after, true);
    } else if (entry.kind === "layers") {
      applyLayersSnapshot(entry.after, true);
      setSelectedClipId(null);
      setEditMsg(`Redid: ${entry.label}`);
    }
    bumpHistory();
  }

  async function deleteLayer(id: string) {
    if (id === "beat") return;
    if (!window.confirm("Remove this track from the plan? Your take stays in the library — you can undo this.")) return;
    const before = cloneLayersSnap(layers);
    // Optimistic remove so AI plan slots cannot flash back while PATCH is in flight
    const after = before.filter((l) => l.id !== id);
    setLayers(after);
    if (selectedTrackId === id) setSelectedTrackId(null);
    if (armedTrackId === id) setArmedTrackId(null);
    setSelectedClipId(null);
    pushConsoleHistory({
      kind: "layers",
      label: "Remove track",
      before,
      after: cloneLayersSnap(after),
    });
    try {
      const res = await fetch(`/api/recording-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "skipped",
          selected_in_plan: false,
          active: false,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as ApiJson;
        // Roll back if server refused
        setLayers(before);
        setEditMsg(typeof j.error === "string" ? j.error : "Could not remove track");
        return;
      }
      setEditMsg("Track removed from plan");
      onLayersChanged?.();
    } catch {
      setLayers(before);
      setEditMsg("Network error — track not removed");
    }
  }

  /**
   * Delete selected split clip, or clear the take without removing the track.
   * Empty lane stays on plan for a retake. Undo restores the recording.
   */
  async function deleteSelectedClipOrRecording() {
    const trackId = selectedTrackId;
    if (!trackId || trackId === "beat") {
      setEditMsg("Select a vocal clip or track to delete");
      return;
    }
    const layer = layers.find((l) => l.id === trackId);
    if (!layer) return;

    const before = cloneLayersSnap(layers);
    const multi = layer.clips && layer.clips.length > 1 ? layer.clips : null;
    const clipId = selectedClipId;

    if (multi && clipId && multi.some((c) => c.id === clipId)) {
      const nextClips = multi.filter((c) => c.id !== clipId);
      if (nextClips.length > 0) {
        const nextLayer: ProducerLayer = {
          ...layer,
          clips: nextClips,
          startMs: Math.min(...nextClips.map((c) => c.startMs)),
          endMs: Math.max(...nextClips.map((c) => c.endMs)),
          audioUrl: nextClips[0]?.audioUrl ?? layer.audioUrl,
          recordingId: nextClips[0]?.recordingId ?? layer.recordingId,
        };
        const after = layers.map((l) => (l.id === trackId ? nextLayer : l));
        setLayers(cloneLayersSnap(after));
        setSelectedClipId(nextClips[0]?.id ?? null);
        persistLayerStructure(nextLayer);
        pushConsoleHistory({
          kind: "layers",
          label: "Delete clip",
          before,
          after: cloneLayersSnap(after),
        });
        setEditMsg("Clip deleted — Undo to restore");
        return;
      }
    }

    const hasAudio =
      Boolean(layer.audioUrl) ||
      Boolean(layer.recordingId) ||
      Boolean(layer.clips && layer.clips.length);

    if (hasAudio) {
      const cleared: ProducerLayer = {
        ...layer,
        audioUrl: null,
        recordingId: null,
        clips: undefined,
        endMs: Math.max(layer.startMs + 500, layer.startMs + 1000),
      };
      const after = layers.map((l) => (l.id === trackId ? cleared : l));
      setLayers(cloneLayersSnap(after));
      setSelectedClipId(null);
      void fetch(`/api/recording-tasks/${trackId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_ms: cleared.startMs,
          end_ms: cleared.endMs,
          status: "pending",
          console_clips: [],
        }),
      })
        .then(() => onLayersChanged?.())
        .catch(() => null);
      pushConsoleHistory({
        kind: "layers",
        label: "Clear recording",
        before,
        after: cloneLayersSnap(after),
      });
      setEditMsg("Recording cleared — track kept for retake. Undo to restore.");
      return;
    }

    await deleteLayer(trackId);
  }



  function redoTakeEdit() {
    const next = takeRedoStackRef.current.pop();
    if (!next || !takeEditId) return;
    const cur = takeWorkingRef.current;
    if (cur) {
      takeUndoStackRef.current = [...takeUndoStackRef.current.slice(-11), cur];
      setTakeUndoDepth(takeUndoStackRef.current.length);
    }
    takeWorkingRef.current = next;
    refreshTakePeaks(next);
    setTakeSel(null);
    const dur = bufferDurationMs(next);
    setLayers((prevL) =>
      prevL.map((l) =>
        l.id === takeEditId ? { ...l, endMs: l.startMs + Math.max(400, dur) } : l
      )
    );
    bumpHistory();
  }

  function refreshTakePeaks(buf: AudioBuffer) {
    const durMs = bufferDurationMs(buf);
    setTakeDurationMs(durMs);
    // Same peak path as the rest of Console — not a different "edit" waveform look
    const buckets = Math.min(2048, Math.max(64, Math.floor((timelineW || 480) / 2) || 256));
    const peaks = computePeaks(buf, buckets);
    setTakePeaks(Array.from(peaks)); // kept for duration-only consumers; UI uses peaksById
    if (takeEditId) {
      setPeaksById((prev) => ({ ...prev, [takeEditId]: peaks }));
    }
  }

  async function beginTakeEdit(taskId: string, audioUrl: string | null | undefined) {
    if (!audioUrl || takeEditBusy) return;
    const ctx = getEditAudioCtx();
    if (!ctx) {
      setEditMsg("Audio not available in this browser");
      return;
    }
    setTakeEditBusy(true);
    setEditMsg(null);
    try {
      if (ctx.state === "suspended") await ctx.resume();
      const buf = await decodeAudioUrl(ctx, audioUrl);
      takeWorkingRef.current = buf;
      takeUndoStackRef.current = [];
    takeRedoStackRef.current = [];
       setTakeUndoDepth(0);
      setTakeSel(null);
      setRetakeTarget(null);
      refreshTakePeaks(buf);
      setTakeEditId(taskId);
      setExpandedId(taskId);
      setSelectedTrackId(taskId);
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Could not open take for editing");
    } finally {
      setTakeEditBusy(false);
    }
  }

  function cancelTakeEdit() {
    takeWorkingRef.current = null;
    takeUndoStackRef.current = [];
    takeRedoStackRef.current = [];
       setTakeUndoDepth(0);
    setTakeEditId(null);
    setTakeSel(null);
    setTakePeaks([]);
    setTakeDurationMs(0);
    setRetakeTarget(null);
    setEditMsg(null);
  }

  function applyTakeDelete() {
    const ctx = getEditAudioCtx();
    const buf = takeWorkingRef.current;
    if (!ctx || !buf || !isValidRegion(takeSel, bufferDurationMs(buf))) return;
    const region = normalizeRegion(takeSel!, bufferDurationMs(buf));
    pushTakeUndo(buf);
    const next = deleteRegionFromBuffer(ctx, buf, region);
    takeWorkingRef.current = next;
    refreshTakePeaks(next);
    setTakeSel(null);
    // Shrink timeline clip to match edited take length (position unchanged)
    if (takeEditId) {
      const dur = bufferDurationMs(next);
      setLayers((prev) =>
        prev.map((l) =>
          l.id === takeEditId ? { ...l, endMs: l.startMs + Math.max(400, dur) } : l
        )
      );
    }
  }

  function applyTakeKeep() {
    const ctx = getEditAudioCtx();
    const buf = takeWorkingRef.current;
    if (!ctx || !buf || !isValidRegion(takeSel, bufferDurationMs(buf))) return;
    const region = normalizeRegion(takeSel!, bufferDurationMs(buf));
    pushTakeUndo(buf);
    const next = keepRegionFromBuffer(ctx, buf, region);
    takeWorkingRef.current = next;
    refreshTakePeaks(next);
    setTakeSel(null);
    if (takeEditId) {
      const dur = bufferDurationMs(next);
      setLayers((prev) =>
        prev.map((l) =>
          l.id === takeEditId ? { ...l, endMs: l.startMs + Math.max(400, dur) } : l
        )
      );
    }
  }

  function undoTakeEdit() {
    const prev = takeUndoStackRef.current.pop();
    if (!prev) return;
    const cur = takeWorkingRef.current;
    if (cur) {
      takeRedoStackRef.current = [...takeRedoStackRef.current.slice(-11), cur];
    }
    takeWorkingRef.current = prev;
    setTakeUndoDepth(takeUndoStackRef.current.length);
    refreshTakePeaks(prev);
    setTakeSel(null);
    if (takeEditId) {
      const dur = bufferDurationMs(prev);
      setLayers((prevL) =>
        prevL.map((l) =>
          l.id === takeEditId ? { ...l, endMs: l.startMs + Math.max(400, dur) } : l
        )
      );
    }
    bumpHistory();
  }

  function playTakeSelection() {
    const ctx = getEditAudioCtx();
    const buf = takeWorkingRef.current;
    if (!ctx || !buf) return;
    stopSources();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    sourcesRef.current.push(src);
    if (takeSel && isValidRegion(takeSel, bufferDurationMs(buf))) {
      const r = normalizeRegion(takeSel, bufferDurationMs(buf));
      const start = r.startMs / 1000;
      const dur = (r.endMs - r.startMs) / 1000;
      src.start(ctx.currentTime, start, dur);
    } else {
      src.start(ctx.currentTime);
    }
  }

  function startRetakeRegion() {
    const buf = takeWorkingRef.current;
    if (!takeEditId || !buf || !takeSel || !isValidRegion(takeSel, bufferDurationMs(buf))) return;
    const r = normalizeRegion(takeSel, bufferDurationMs(buf));
    setRetakeTarget({ taskId: takeEditId, startMs: r.startMs, endMs: r.endMs });
    setArmedTrackId(takeEditId);
    setSelectedTrackId(takeEditId);
    setEditMsg(
      `Retake ${Math.round(r.startMs)}–${Math.round(r.endMs)} ms — tap Record when ready`
    );
  }

  async function commitTakeEdit() {
    if (!takeEditId || !takeWorkingRef.current || takeEditBusy) return;
    const buf = takeWorkingRef.current;
    setTakeEditBusy(true);
    setEditMsg("Saving edited take…");
    try {
      const blob = encodeWavBlob(buf);
      const fd = new FormData();
      fd.append("file", blob, "edited-take.wav");
      fd.append("source", "take_edit");
      const up = await fetch(`/api/recording-tasks/${takeEditId}/recordings`, {
        method: "POST",
        body: fd,
      });
      const uj = (await up.json().catch(() => ({}))) as RecordingUploadJson;
      if (!up.ok) {
        throw new Error(
          typeof uj.error === "string" ? uj.error : "Could not save edited take"
        );
      }
      const newId = uj?.recording?.id as string | undefined;
      if (newId) {
        await fetch(`/api/recording-tasks/${takeEditId}/recordings/${newId}/select`, {
          method: "POST",
        }).catch(() => undefined);
      }
      await fetch(`/api/recording-tasks/${takeEditId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      }).catch(() => null);

      const audioUrl =
        audioUrlFromUploadJson(uj);
      if (audioUrl) {
        setLayers((prev) =>
          prev.map((l) =>
            l.id === takeEditId
              ? {
                  ...l,
                  audioUrl,
                  endMs: l.startMs + bufferDurationMs(buf),
                }
              : l
          )
        );
        // clear decode cache for old url
        bufferCache.clear();
      }
      cancelTakeEdit();
      setEditMsg("Edited take saved — original recording kept");
      onLayersChanged?.();
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Could not save edited take");
    } finally {
      setTakeEditBusy(false);
    }
  }

  /** Upload a WAV buffer as a take on a task; returns audio_url. */
  async function uploadBufferAsTake(
    taskId: string,
    buf: AudioBuffer,
    source: string,
    opts?: { select?: boolean; placementStartMs?: number; placementEndMs?: number }
  ): Promise<{ audioUrl: string | null; recordingId: string | null }> {
    const blob = encodeWavBlob(buf);
    const fd = new FormData();
    fd.append("file", blob, `${source}.wav`);
    fd.append("source", source);
    fd.append("duration_ms", String(bufferDurationMs(buf)));
    if (opts?.placementStartMs != null) {
      fd.append("placement_start_ms", String(Math.round(opts.placementStartMs)));
    }
    if (opts?.placementEndMs != null) {
      fd.append("timeline_end_ms", String(Math.round(opts.placementEndMs)));
    }
    // Split clips must both stay active — never run exclusive /select
    if (opts?.select === false) {
      fd.append("keep_unselected", "1");
    }
    const up = await fetch(`/api/recording-tasks/${taskId}/recordings`, {
      method: "POST",
      body: fd,
    });
    const uj = (await up.json().catch(() => ({}))) as RecordingUploadJson;
    if (!up.ok) {
      throw new Error(typeof uj.error === "string" ? uj.error : "Upload failed");
    }
    const newId = (uj?.recording?.id as string | undefined) || null;
    if (newId && opts?.select !== false) {
      await fetch(`/api/recording-tasks/${taskId}/recordings/${newId}/select`, {
        method: "POST",
      }).catch(() => undefined);
    }
    // Mark both split recordings selected without exclusive deselect
    if (newId && opts?.select === false) {
      try {
        await fetch(`/api/recording-tasks/${taskId}/recordings/${newId}/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exclusive: false }),
        }).catch(() => undefined);
      } catch {
        /* */
      }
    }
    const audioUrl =
      audioUrlFromUploadJson(uj);
    return { audioUrl: audioUrl ? String(audioUrl) : null, recordingId: newId };
  }

  /**
   * DAW split: cut the clip under the playhead into two regions on the SAME track.
   * Does not create a new track or rename anything.
   */
  async function splitSelectedAtPlayhead() {
    const id = selectedTrackId;
    if (!id || id === "beat" || !projectId) return;
    const layer = layers.find((l) => l.id === id);
    if (!layer) {
      setEditMsg("Select a vocal track to split");
      return;
    }
    const existing = clipsForLayer(layer);
    const target =
      existing.find(
        (c) => playheadMs > c.startMs + 200 && playheadMs < c.endMs - 200
      ) ||
      existing.find((c) => playheadMs >= c.startMs && playheadMs <= c.endMs);
    if (!target?.audioUrl) {
      setEditMsg("Place the playhead inside a clip on this track to split");
      return;
    }
    const localMs = playheadMs - target.startMs;
    const clipDur = Math.max(0, target.endMs - target.startMs);
    if (localMs < 250 || localMs > clipDur - 250) {
      setEditMsg("Move the playhead inside the clip (not too close to the edges)");
      return;
    }
    const ctx = getEditAudioCtx() || getCtx();
    if (!ctx) {
      setEditMsg("Audio not available in this browser");
      return;
    }
    setTakeEditBusy(true);
    setEditMsg("Splitting…");
    try {
      if (ctx.state === "suspended") await ctx.resume();
      // Prefer already-decoded buffer (instant) over re-fetching the take
      let full = target.audioUrl ? bufferCache.get(target.audioUrl) : undefined;
      if (!full) {
        full = await decodeAudioUrl(ctx, target.audioUrl!);
        bufferCache.set(target.audioUrl!, full);
      }
      const { left, right } = splitBufferAtMs(ctx, full, localMs);
      const leftDur = bufferDurationMs(left);
      const rightDur = bufferDurationMs(right);
      // Placement must follow actual buffer cut (may differ slightly from playhead due to min-region clamp)
      const cutAtSongMs = target.startMs + leftDur;

      // Instant local clips via blob URLs — both halves visible immediately
      const leftBlob = encodeWavBlob(left);
      const rightBlob = encodeWavBlob(right);
      const leftLocalUrl = URL.createObjectURL(leftBlob);
      const rightLocalUrl = URL.createObjectURL(rightBlob);
      bufferCache.set(leftLocalUrl, left);
      bufferCache.set(rightLocalUrl, right);

      const leftClip: ProducerClip = {
        id: `local-L-${Date.now()}`,
        startMs: target.startMs,
        endMs: cutAtSongMs,
        audioUrl: leftLocalUrl,
        recordingId: null,
      };
      const rightClip: ProducerClip = {
        id: `local-R-${Date.now() + 1}`,
        startMs: cutAtSongMs,
        endMs: cutAtSongMs + rightDur,
        audioUrl: rightLocalUrl,
        recordingId: null,
      };

      const nextClipsLocal = [
        ...existing.filter((c) => c.id !== target.id),
        leftClip,
        rightClip,
      ].sort((a, b) => a.startMs - b.startMs);

      const beforeSplit = cloneLayersSnap(layers);
      const afterSplitLocal = layers.map((l) => {
          if (l.id !== id) return l;
          return {
            ...l,
            clips: nextClipsLocal,
            startMs: nextClipsLocal[0]?.startMs ?? l.startMs,
            endMs: nextClipsLocal[nextClipsLocal.length - 1]?.endMs ?? l.endMs,
            // Keep layer.audioUrl as left for single-url fallbacks; both clips have their own URLs
            audioUrl: leftLocalUrl,
            recordingId: l.recordingId,
          };
        });
      setLayers(afterSplitLocal);
      pushConsoleHistory({
        kind: "layers",
        label: "Split clip",
        before: beforeSplit,
        after: cloneLayersSnap(afterSplitLocal),
      });
      setSelectedClipId(rightClip.id);
      setDurationById((d) => {
        const next = { ...d, [leftClip.id]: leftDur, [rightClip.id]: rightDur };
        // Drop parent full-length duration so multi-clip geometry stays accurate
        delete next[id];
        return next;
      });
      // Immediate waveforms for both halves (don't wait on decode effect)
      try {
        const leftPeaks = peaksFromBuffer(left, Math.min(2048, Math.max(64, Math.floor((leftDur / 1000) * 40))));
        const rightPeaks = peaksFromBuffer(right, Math.min(2048, Math.max(64, Math.floor((rightDur / 1000) * 40))));
        setPeaksById((prev) => ({
          ...prev,
          [leftClip.id]: new Float32Array(leftPeaks),
          [rightClip.id]: new Float32Array(rightPeaks),
        }));
      } catch {
        /* decode effect will fill peaks */
      }
      setEditMsg("Split — both clips on this track. Saving…");
      setTakeEditBusy(false);

      // Background: upload both halves in parallel (do NOT exclusive-select — keeps both)
      void (async () => {
        try {
          const [leftUp, rightUp] = await Promise.all([
            uploadBufferAsTake(id, left, "split_left", {
              select: false,
              placementStartMs: leftClip.startMs,
              placementEndMs: leftClip.endMs,
            }),
            uploadBufferAsTake(id, right, "split_right", {
              select: false,
              placementStartMs: rightClip.startMs,
              placementEndMs: rightClip.endMs,
            }),
          ]);

          const leftSaved: ProducerClip = {
            ...leftClip,
            id: leftUp.recordingId || leftClip.id,
            // Prefer same-origin proxy so leaving Console does not lose the waveform
            audioUrl: leftUp.recordingId
              ? `/api/recordings/${leftUp.recordingId}/audio`
              : leftUp.audioUrl || leftLocalUrl,
            recordingId: leftUp.recordingId,
          };
          const rightSaved: ProducerClip = {
            ...rightClip,
            id: rightUp.recordingId || rightClip.id,
            audioUrl: rightUp.recordingId
              ? `/api/recordings/${rightUp.recordingId}/audio`
              : rightUp.audioUrl || rightLocalUrl,
            recordingId: rightUp.recordingId,
          };
          if (leftSaved.audioUrl) bufferCache.set(leftSaved.audioUrl, left);
          if (rightSaved.audioUrl) bufferCache.set(rightSaved.audioUrl, right);
          if (leftUp.audioUrl) bufferCache.set(leftUp.audioUrl, left);
          if (rightUp.audioUrl) bufferCache.set(rightUp.audioUrl, right);

          // Remap peaks + durations from local blob ids → saved recording ids
          setPeaksById((prev) => {
            const next = { ...prev };
            if (leftSaved.id !== leftClip.id && next[leftClip.id]) {
              next[leftSaved.id] = next[leftClip.id];
            }
            if (rightSaved.id !== rightClip.id && next[rightClip.id]) {
              next[rightSaved.id] = next[rightClip.id];
            }
            return next;
          });
          setDurationById((prev) => {
            const next = { ...prev };
            next[leftSaved.id] = leftDur;
            next[rightSaved.id] = rightDur;
            return next;
          });

          const nextClips = [
            ...existing.filter((c) => c.id !== target.id),
            leftSaved,
            rightSaved,
          ].sort((a, b) => a.startMs - b.startMs);

          await fetch(`/api/recording-tasks/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              start_ms: nextClips[0].startMs,
              end_ms: nextClips[nextClips.length - 1].endMs,
              status: "completed",
              console_clips: nextClips.map((c) => ({
                id: c.id,
                start_ms: c.startMs,
                end_ms: c.endMs,
                recording_id: c.recordingId || null,
              })),
            }),
          }).catch(() => null);

          setLayers((prev) =>
            prev.map((l) => {
              if (l.id !== id) return l;
              return {
                ...l,
                clips: nextClips,
                startMs: nextClips[0]?.startMs ?? l.startMs,
                endMs: nextClips[nextClips.length - 1]?.endMs ?? l.endMs,
                audioUrl: leftSaved.audioUrl || l.audioUrl,
                recordingId: leftSaved.recordingId || l.recordingId,
              };
            })
          );
          setSelectedClipId(rightSaved.id);
          setEditMsg("Split saved — both clips kept on this track");
        } catch (e) {
          setEditMsg(
            e instanceof Error
              ? `Split shown locally; save failed: ${e.message}`
              : "Split shown locally; save failed"
          );
        }
      })();
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Split failed");
      setTakeEditBusy(false);
    }
  }

    /** Snap clip start  /** Snap clip start to the nearest beat (or 1/2 beat). */
  async function quantizeSelectedToBeat(subdivision = 1) {
    const id = selectedTrackId;
    if (!id || id === "beat") return;
    const layer = layers.find((l) => l.id === id);
    if (!layer) return;
    const bpm = tempoBpm != null && Number.isFinite(tempoBpm) ? Number(tempoBpm) : null;
    if (bpm == null || bpm <= 0) {
      setEditMsg("BPM is required to snap to the grid — analyze the beat or set project tempo first");
      return;
    }
    const dur = Math.max(400, layer.endMs - layer.startMs);
    const newStart = snapToBeatMs(layer.startMs, bpm, subdivision);
    const newEnd = newStart + dur;
    updateLocalLayer(id, newStart, newEnd);
    const ok = await persistLayer(id, { start_ms: newStart, end_ms: newEnd });
    setEditMsg(
      ok
        ? `Snapped to ${subdivision === 2 ? "1/2 " : ""}beat grid (${Math.round(newStart)} ms)`
        : "Could not save snap position"
    );
  }

  /**
   * Detect vocal onset and shift the clip so the first word/hit lands on the nearest beat.
   * Fixes late/early takes without changing the audio content.
   */
  async function correctSelectedToBeat() {
    const id = selectedTrackId;
    if (!id || id === "beat") return;
    const layer = layers.find((l) => l.id === id);
    if (!layer?.audioUrl) {
      setEditMsg("Select a vocal with audio to correct timing");
      return;
    }
    const bpm = tempoBpm != null && Number.isFinite(tempoBpm) ? Number(tempoBpm) : null;
    if (bpm == null || bpm <= 0) {
      setEditMsg("BPM is required to correct timing");
      return;
    }
    const ctx = getEditAudioCtx() || getCtx();
    if (!ctx) {
      setEditMsg("Audio not available in this browser");
      return;
    }
    setTakeEditBusy(true);
    setEditMsg("Aligning vocal to the beat…");
    try {
      if (ctx.state === "suspended") await ctx.resume();
      const buf = await decodeAudioUrl(ctx, layer.audioUrl);
      const onset = detectOnsetMs(buf);
      const songOnset = layer.startMs + onset;
      const snappedOnset = snapToBeatMs(songOnset, bpm, 1);
      let newStart = snappedOnset - onset;
      if (newStart < 0) newStart = 0;
      const dur = Math.max(400, layer.endMs - layer.startMs);
      const newEnd = newStart + dur;
      const shift = Math.round(newStart - layer.startMs);
      updateLocalLayer(id, newStart, newEnd);
      const ok = await persistLayer(id, { start_ms: newStart, end_ms: newEnd });
      setEditMsg(
        ok
          ? shift === 0
            ? "Already on the grid"
            : `Timing corrected — shifted ${shift > 0 ? "+" : ""}${shift} ms so the vocal hits the beat`
          : "Could not save timing correction"
      );
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Timing correction failed");
    } finally {
      setTakeEditBusy(false);
    }
  }


  async function finishRetakeWithBlob(taskId: string, blob: Blob) {
    const ctx = getEditAudioCtx();
    const working = takeWorkingRef.current;
    const region = retakeTarget;
    if (!ctx || !working || !region || region.taskId !== taskId) return false;
    try {
      const ab = await blob.arrayBuffer();
      const rep = await ctx.decodeAudioData(ab.slice(0));
      pushTakeUndo(working);
      const next = spliceReplacementIntoBuffer(ctx, working, region, rep);
      takeWorkingRef.current = next;
      refreshTakePeaks(next);
      setRetakeTarget(null);
      setTakeSel(null);
      setEditMsg("Retake applied — tap Done to save");
      return true;
    } catch {
      setEditMsg("Retake recorded but could not merge — try again");
      return false;
    }
  }

  async function toggleConsoleRecord() {
    if (isConsoleRecording) await stopConsoleRecord();
    else await startConsoleRecord();
  }

  async function uploadBeatAndPlan(file: File) {
    if (!projectId) {
      setEditMsg("Missing project");
      return;
    }
    setPlanBusy(true);
    setEditMsg("Uploading beat…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch(`/api/projects/${projectId}/beat`, { method: "POST", body: fd });
      const uj = (await up.json().catch(() => ({}))) as RecordingUploadJson;
      if (!up.ok) {
        setEditMsg(typeof uj.error === "string" ? uj.error : "Beat upload failed");
        return;
      }
      setEditMsg("Building producer plan (same as Booth)…");
      const ar = await fetch(`/api/projects/${projectId}/analyze`, { method: "POST" });
      const aj = await ar.json().catch(() => ({})) as ApiJson;
      if (!ar.ok) {
        setEditMsg(typeof aj.error === "string" ? aj.error : "Plan generation failed");
        return;
      }
      setEditMsg("Plan ready — record into tracks or open Booth");
      onLayersChanged?.();
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Beat / plan failed");
    } finally {
      setPlanBusy(false);
    }
  }

  /** Plan only — same /analyze → planProduction() as Booth; when beat exists but no tasks */
  async function generatePlanOnly() {
    if (!projectId) {
      setEditMsg("Missing project");
      return;
    }
    if (!beatUrl) {
      setEditMsg("Upload a beat first");
      return;
    }
    setPlanBusy(true);
    setEditMsg("Building producer plan (same as Booth)…");
    try {
      const ar = await fetch(`/api/projects/${projectId}/analyze`, { method: "POST" });
      const aj = await ar.json().catch(() => ({})) as ApiJson;
      if (!ar.ok) {
        setEditMsg(typeof aj.error === "string" ? aj.error : "Plan generation failed");
        return;
      }
      setEditMsg(aj.reused ? "Plan already ready" : "Plan ready — record into tracks");
      onLayersChanged?.();
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Plan generation failed");
    } finally {
      setPlanBusy(false);
    }
  }

  /** Passive meter: parallel graph on a clone of the mic stream — never touches monitor or MediaRecorder */
  function startLiveMeter(sourceStream: MediaStream) {
    stopLiveMeter();
    livePeaksBufRef.current = [];
    setLivePeaks([]);
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      // Clone tracks so analyser graph cannot affect capture/monitor
      const clone = new MediaStream(sourceStream.getAudioTracks().map((tr) => tr.clone()));
      const ctx = new AC();
      liveMeterCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(clone);
      const analyser = ctx.createAnalyser();
      // Higher fftSize + denser sampling → live clip waveform closer to post-decode peaks
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.35;
      // analyser is a sink only — nothing connects after it to speakers
      src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          const a = Math.abs(v);
          if (a > peak) peak = a;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLiveLevel(Math.min(1, rms * 3.2));
        // Every animation frame (~60 Hz) — denser history for accurate live shape
        frame += 1;
        livePeaksBufRef.current.push(Math.min(1, peak));
        if (livePeaksBufRef.current.length > 4800) {
          livePeaksBufRef.current = livePeaksBufRef.current.slice(-4800);
        }
        if (frame % 2 === 0) {
          setLivePeaks(livePeaksBufRef.current.slice());
        }
        liveMeterRafRef.current = requestAnimationFrame(tick);
      };
      liveMeterRafRef.current = requestAnimationFrame(tick);
    } catch {
      /* visualization optional */
    }
  }

  function stopLiveMeter() {
    if (liveMeterRafRef.current != null) {
      cancelAnimationFrame(liveMeterRafRef.current);
      liveMeterRafRef.current = null;
    }
    if (liveMeterCtxRef.current) {
      try {
        void liveMeterCtxRef.current.close();
      } catch {
        /* ignore */
      }
      liveMeterCtxRef.current = null;
    }
    setLiveLevel(0);
    // keep livePeaks until save refreshes waveform; clear after stop handler
  }

  async function createTrack(file?: File | null) {
    if (!projectId) {
      setEditMsg("Missing project — cannot add track");
      return;
    }
    setAddBusy(true);
    setEditMsg(null);
    try {
      const startMs = Math.round(playheadMs);
      const res = await fetch(`/api/projects/${projectId}/recording-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: addType,
          title: addTitle.trim() || undefined,
          start_ms: startMs,
          end_ms: startMs + 8000,
        }),
      });
      const j = await res.json().catch(() => ({})) as ApiJson;
      if (!res.ok) {
        setEditMsg(typeof j.error === "string" ? j.error : "Could not create track");
        return;
      }
      const task = j.task as {
        id: string;
        type?: string;
        title?: string;
        start_ms?: number;
        end_ms?: number;
      };
      if (!task?.id) {
        setEditMsg("Track created but no id returned");
        return;
      }

      let audioUrl: string | null = null;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const up = await fetch(`/api/recording-tasks/${task.id}/recordings`, {
          method: "POST",
          body: fd,
        });
        const uj = (await up.json().catch(() => ({}))) as RecordingUploadJson;
        if (!up.ok) {
          setEditMsg(
            typeof uj.error === "string"
              ? uj.error
              : "Track created; upload failed — record a take in the booth"
          );
        } else {
          audioUrl =
            audioUrlFromUploadJson(uj);
          // mark completed if upload ok
          await fetch(`/api/recording-tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "completed" }),
          }).catch(() => null);

          // Instant local peaks from the uploaded file (don't wait on R2 CORS decode)
          try {
            const ctx = getCtx();
            if (ctx && file) {
              const ab = await file.arrayBuffer();
              const audioBuf = await ctx.decodeAudioData(ab.slice(0));
              const localKey = audioUrl || `local-upload-${task.id}`;
              bufferCache.set(localKey, audioBuf);
              if (audioUrl) bufferCache.set(audioUrl, audioBuf);
              peaksForUrl(localKey, audioBuf, 2048);
              const hi = peaksForUrl(localKey, audioBuf, 512);
              setPeaksById((prev) => ({ ...prev, [task.id]: hi }));
              setDurationById((prev) => ({
                ...prev,
                [task.id]: Math.round(audioBuf.duration * 1000),
              }));
            }
          } catch (peakErr) {
            console.warn("[console] local upload peak decode failed", peakErr);
          }
        }
      }

      const named =
        (typeof task.title === "string" && task.title.trim()) ||
        (addTitle && addTitle.trim()) ||
        (task.type || addType).replace(/_/g, " ");
      setLayers((prev) => [
        ...prev,
        {
          id: task.id,
          label: named,
          role: task.type || addType,
          sectionLabel: named,
          startMs: Number(task.start_ms) || startMs,
          endMs: Number(task.end_ms) || startMs + 8000,
          audioUrl,
        },
      ]);
      setShowAddTrack(false);
      setAddTitle("");
      setAddType("custom");
      onLayersChanged?.();
    } catch {
      setEditMsg("Network error creating track");
    } finally {
      setAddBusy(false);
    }
  }



  // Merge URLs from session-preview if projectId given
  useEffect(() => {
    // Soft parent refresh: keep audioUrls already resolved from session-preview
    setLayers((prev) => {
      const prevById = new Map(prev.map((l) => [l.id, l]));
      return layersProp.map((l) => {
        const local = prevById.get(l.id);
        const audioUrl = l.audioUrl || local?.audioUrl || null;
        const clips =
          l.clips && l.clips.length > 0 ? l.clips : local?.clips;
        // Keep free-record playhead placement when server still has plan window
        let startMs = l.startMs;
        let endMs = l.endMs;
        if (
          local &&
          audioUrl &&
          !l.audioUrl &&
          (local.startMs !== l.startMs || local.endMs !== l.endMs)
        ) {
          startMs = local.startMs;
          endMs = local.endMs;
        } else if (
          local &&
          local.clips &&
          local.clips.length > 0 &&
          !(l.clips && l.clips.length > 0)
        ) {
          startMs = local.startMs;
          endMs = local.endMs;
        }
        return {
          ...l,
          audioUrl,
          clips,
          startMs,
          endMs,
          recordingId: l.recordingId || local?.recordingId || null,
        };
      });
    });
    setFxById((prev) => {
      const next = { ...prev };
      for (const l of layersProp) {
        if (l.trackFx) {
          const server = { ...DEFAULT_TRACK_FX, ...l.trackFx } as TrackFx;
          const local = next[l.id];
          // Prefer server as base, but keep local values that server dropped (0) while local is active
          if (local) {
            const merged = { ...server } as TrackFx;
            for (const k of Object.keys(DEFAULT_TRACK_FX) as (keyof TrackFx)[]) {
              const lv = Number(local[k]) || 0;
              const sv = Number(server[k]) || 0;
              if (Math.abs(lv) > 0.02 && Math.abs(sv) < 0.005) {
                (merged as any)[k] = local[k];
              }
            }
            next[l.id] = merged;
            fxByIdRef.current = { ...fxByIdRef.current, [l.id]: merged };
          } else {
            next[l.id] = server;
            fxByIdRef.current = { ...fxByIdRef.current, [l.id]: server };
          }
        } else if (!next[l.id]) {
          next[l.id] = { ...DEFAULT_TRACK_FX };
        }
      }
      return next;
    });
    setFxRackById((prev) => {
      const next = { ...prev };
      for (const l of layersProp) {
        if (next[l.id]?.length) continue;
        const fx = l.trackFx
          ? ({ ...DEFAULT_TRACK_FX, ...l.trackFx } as TrackFx)
          : next[l.id]
            ? undefined
            : DEFAULT_TRACK_FX;
        if (l.trackFx) {
          next[l.id] = rackFromFx({ ...DEFAULT_TRACK_FX, ...l.trackFx } as TrackFx);
        }
      }
      return next;
    });
    setColorById((prev) => {
      const next = { ...prev };
      for (const l of layersProp) {
        if (l.color) next[l.id] = l.color;
      }
      return next;
    });
  }, [layersProp]);

  // session-preview returns { layers: [{ task_id, audio_url, ... }] } — same as Booth preview
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/session-preview`);
        if (!res.ok) return;
        const j = await res.json();
        const recs: { task_id?: string; audio_url?: string; id?: string }[] =
          j.layers || j.recordings || j.takes || [];
        if (!Array.isArray(recs) || cancelled) return;
        const byTask = new Map<string, string>();
        for (const r of recs) {
          const tid = r.task_id || r.id;
          if (tid && r.audio_url) byTask.set(tid, r.audio_url);
        }
        if (byTask.size === 0) return;
        setLayers((prev) =>
          prev.map((l) => {
            if (l.audioUrl) return l;
            const url = byTask.get(l.id);
            return url ? { ...l, audioUrl: url } : l;
          })
        );
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-merge when parent soft-reloads tasks (layersProp loses audioUrl until preview attaches)
  }, [projectId, layersProp]);

  const totalMs = useMemo(() => {
    let max = durationMs || 0;
    for (const s of sections) {
      max = Math.max(max, Number(s.endMs) || 0, (Number(s.startMs) || 0) + 1000);
    }
    for (const l of layers) {
      const start = Number(l.startMs) || 0;
      const decoded = durationById[l.id];
      const end =
        typeof decoded === "number" && decoded > 0
          ? start + decoded
          : Number(l.endMs) || 0;
      max = Math.max(max, end, start + 500);
    }
    // Prefer real beat length when known; never cap the scroll region to the first section only
    return Math.max(max, 60_000);
  }, [durationMs, sections, layers, durationById]);

  // Explicit pixel width so iOS doesn't collapse absolute-positioned clip rows to viewport-only scroll
  const timelineW = Math.max(480, Math.ceil((totalMs / 1000) * pxPerSec) + 80);
  const peakBuckets = Math.min(2048, Math.max(64, Math.floor(timelineW)));

  const tracks = useMemo(() => {
    const list: {
      id: string;
      label: string;
      kind: "beat" | "vocal";
      color: string;
      startMs: number;
      endMs: number;
      sub?: string;
      url?: string | null;
      recordingId?: string | null;
      clips?: ProducerClip[];
      mediaOffsetMs?: number;
    }[] = [];
    list.push({
      id: "beat",
      label: "Beat",
      kind: "beat",
      color: ROLE_COLORS.beat,
      startMs: 0,
      endMs: totalMs,
      url: beatUrl,
      recordingId: null,
    });
    for (const l of layers) {
      const multi = (l.clips && l.clips.length > 1) || false;
      const clips = clipsForLayer(l).map((c) => {
        // Per-clip duration only — never fall back to the parent layer's full-take
        // length (that stretched both halves after a split and broke waveforms).
        const decoded = durationById[c.id];
        const span = Math.max(0, c.endMs - c.startMs);
        let end: number;
        if (typeof decoded === "number" && decoded > 0) {
          // Prefer explicit placement span when present; only extend if decoded is close
          if (multi && span > 200) {
            end = c.endMs;
          } else {
            end = c.startMs + decoded;
          }
        } else {
          end = Math.max(c.endMs, c.startMs + 500);
        }
        return { ...c, endMs: end };
      });
      const spanStart = Math.min(...clips.map((c) => c.startMs));
      const spanEnd = Math.max(...clips.map((c) => c.endMs));
      list.push({
        id: l.id,
        label: l.label,
        kind: "vocal",
        color: colorById[l.id] || l.color || roleColor(l.role),
        startMs: spanStart,
        endMs: spanEnd,
        sub: l.sectionLabel || l.label,
        url: clips[0]?.audioUrl || l.audioUrl,
        recordingId: clips[0]?.recordingId || l.recordingId || null,
        clips,
        mediaOffsetMs: l.mediaOffsetMs || clips[0]?.offsetMs || 0,
      });
    }
    return list;
  }, [layers, totalMs, beatUrl, colorById, durationById]);

  const getCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const AC =
        typeof window !== "undefined"
          ? window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          : null;
      if (!AC) return null;
      audioCtxRef.current = new AC();
    }
    return audioCtxRef.current;
  }, []);

  // Decode all tracks once; cache peaks at 2048 resolution
  useEffect(() => {
    let cancelled = false;
    const ctx = getCtx();
    if (!ctx) return;
    (async () => {
      setDecodeStatus("Loading waveforms…");
      type PeakJob = {
        partId: string;
        trackId: string;
        primary: string;
        fallback: string | null;
        isBeat: boolean;
        singleClipTrack: boolean;
      };
      const jobs: PeakJob[] = [];
      for (const tr of tracks) {
        const parts =
          tr.kind === "vocal" && tr.clips && tr.clips.length > 0
            ? tr.clips.map((c) => ({
                id: c.id,
                url: c.audioUrl || null,
                recordingId: c.recordingId || null,
              }))
            : [
                {
                  id: tr.id,
                  url: tr.url || null,
                  recordingId: tr.recordingId || null,
                },
              ];
        for (const part of parts) {
          const recordingProxy =
            tr.kind === "vocal" && part.recordingId
              ? `/api/recordings/${part.recordingId}/audio`
              : null;
          const vocalProxy =
            tr.kind === "vocal" && tr.id
              ? `/api/recording-tasks/${tr.id}/audio`
              : null;
          const beatProxy =
            tr.kind === "beat" && projectId
              ? `/api/projects/${projectId}/beat/download`
              : null;
          // Prefer same-origin proxies so waveforms load on mobile Safari
          const primary =
            recordingProxy ||
            vocalProxy ||
            beatProxy ||
            part.url ||
            null;
          if (!primary) continue;
          jobs.push({
            partId: part.id,
            trackId: tr.id,
            primary,
            fallback: part.url && part.url !== primary ? part.url : null,
            isBeat: tr.kind === "beat",
            singleClipTrack: !(tr.clips && tr.clips.length > 1),
          });
        }
      }
      const results = await Promise.all(
        jobs.map(async (job) => {
          const buf = await fetchDecode(ctx, job.primary, job.fallback);
          if (!buf) return null;
          return { job, buf };
        })
      );
      if (cancelled) return;
      const next: Record<string, Float32Array | null> = {};
      const durs: Record<string, number> = {};
      for (const row of results) {
        if (!row) continue;
        const { job, buf } = row;
        const durMs = Math.round(buf.duration * 1000);
        if (job.isBeat) {
          setDurationMs((d) => Math.max(d, durMs));
        }
        durs[job.partId] = durMs;
        peaksForUrl(job.primary, buf, 2048);
        next[job.partId] = peaksForUrl(job.primary, buf, peakBuckets);
        if (job.singleClipTrack) {
          next[job.trackId] = next[job.partId];
        }
      }
      setPeaksById((prev) => ({ ...prev, ...next }));
      setDurationById((prev) => ({ ...prev, ...durs }));
      setDecodeStatus("");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tracks
      .map((t) => {
        if (t.clips && t.clips.length > 0) {
          return t.clips.map((c) => `${c.id}:${c.audioUrl || ""}`).join(",");
        }
        return `${t.id}:${t.url || ""}`;
      })
      .join("|"),
    getCtx,
  ]);

  // Re-bucket peaks when zoom changes (from cache, no re-decode)
  useEffect(() => {
    setPeaksById((prev) => {
      const next: Record<string, Float32Array | null> = { ...prev };
      for (const tr of tracks) {
        const parts =
          tr.clips && tr.clips.length > 0
            ? tr.clips.map((c) => ({ id: c.id, url: c.audioUrl || null }))
            : [{ id: tr.id, url: tr.url || null }];
        for (const part of parts) {
          if (!part.url) continue;
          const buf = bufferCache.get(part.url);
          if (!buf) continue;
          next[part.id] = peaksForUrl(part.url, buf, peakBuckets);
        }
      }
      return next;
    });
  }, [peakBuckets, tracks]);

  function isAudible(id: string, kind: "beat" | "vocal") {
    const mutes = mutedRef.current;
    if (mutes[id]) return false;
    // Multi-solo: any selected solo tracks isolate the mix (beat not forced on)
    const solos = soloIdsRef.current;
    const soloList = Object.keys(solos).filter((k) => solos[k]);
    if (soloList.length > 0) return soloList.includes(id);
    // Legacy single soloId
    const solo = soloIdRef.current;
    if (solo) return id === solo;
    void kind;
    return true;
  }

  function applyGains(atMs?: number, force = false) {
    const tMs =
      typeof atMs === "number" && Number.isFinite(atMs)
        ? atMs
        : playheadMsRef.current;
    const autoDoc = automationDocRef.current;
    const hasAnyAutomation = (autoDoc?.lanes?.length || 0) > 0;
    for (const tr of tracks) {
      const on = isAudible(tr.id, tr.kind);
      const base = fxByIdRef.current[tr.id] || fxById[tr.id] || DEFAULT_TRACK_FX;
      // Only sample automation when lanes exist — avoids wiping static FX every frame
      const overlay =
        hasAnyAutomation || force
          ? sampleTrackAutomation(autoDoc, tr.id, tMs)
          : ({} as ReturnType<typeof sampleTrackAutomation>);
      const hasOverlay = Object.keys(overlay).length > 0;
      // Skip re-applying static FX every RAF tick (was starving setTargetAtTime ramps)
      if (!force && !hasOverlay && fxGraphRef.current.has(tr.id)) {
        // Still update mute/solo via output gain only
        const graph = fxGraphRef.current.get(tr.id)!;
        const gLin = on
          ? Math.pow(10, Math.max(-12, Math.min(12, Number(base.gainDb) || 0)) / 20)
          : 0;
        try {
          const now = audioCtxRef.current?.currentTime ?? 0;
          graph.gain.gain.cancelScheduledValues(now);
          // setValueAtTime for mute so RAF cannot leave a slow setTarget ramp audible
          if (!on) {
            graph.gain.gain.setValueAtTime(0, now);
          } else {
            graph.gain.gain.setTargetAtTime(Math.min(gLin, 2.5), now, 0.02);
          }
        } catch {
          /* */
        }
        continue;
      }
      const fx = { ...base, ...overlay } as TrackFx;
      const graph = fxGraphRef.current.get(tr.id);
      if (graph) {
        graph.apply(trackFxToLiveParams(fx as unknown as Record<string, number>), on);
        continue;
      }
      const g = gainsRef.current.get(tr.id);
      if (!g) continue;
      const lin = Math.pow(10, (fx.gainDb || 0) / 20);
      g.gain.setTargetAtTime(on ? lin : 0, audioCtxRef.current?.currentTime || 0, 0.02);
      const panNode = panNodesRef.current.get(tr.id);
      if (panNode) {
        const p = Math.max(-1, Math.min(1, Number(fx.pan) || 0));
        panNode.pan.setTargetAtTime(p, audioCtxRef.current?.currentTime || 0, 0.02);
      }
    }
    // HTMLAudio beat fallback (CORS) — not on the WebAudio gain graph
    try {
      const htmlBeat = monitorAudioRef.current;
      if (htmlBeat) {
        const beatOn = isAudible("beat", "beat");
        const bfx = fxByIdRef.current["beat"] || DEFAULT_TRACK_FX;
        const lin = Math.pow(10, (Number(bfx.gainDb) || 0) / 20);
        htmlBeat.volume = beatOn ? Math.max(0, Math.min(1, lin)) : 0;
        htmlBeat.muted = !beatOn;
      }
    } catch {
      /* */
    }
  }

  useEffect(() => {
    applyGains(undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, soloId, tracks, fxById]);

  /**
   * Stop buffer sources + RAF. By default KEEP live FX graphs so pause/resume
   * does not rebuild the mixer (AudioBufferSourceNodes are one-shot; graphs are not).
   * Pass disposeGraphs=true on project leave / hard reset.
   */
  function stopSources(opts?: { disposeGraphs?: boolean }) {
    playingRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    for (const s of sourcesRef.current) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      try {
        s.disconnect();
      } catch {
        /* */
      }
    }
    sourcesRef.current = [];
    if (opts?.disposeGraphs) {
      for (const g of fxGraphRef.current.values()) {
        try {
          g.dispose();
        } catch {
          /* */
        }
      }
      fxGraphRef.current.clear();
      gainsRef.current.clear();
      panNodesRef.current.clear();
    }
    try {
      if (monitorAudioRef.current && !isConsoleRecording) {
        monitorAudioRef.current.pause();
        monitorAudioRef.current = null;
      }
    } catch {
      /* */
    }
  }

  function disposeAllAudioGraphs() {
    stopSources({ disposeGraphs: true });
  }

  useEffect(() => {
    loopOnRef.current = loopOn;
  }, [loopOn]);

  // Resolve loop region from selected track / clip (or full song when none)
  useEffect(() => {
    if (!loopOn) {
      loopRangeRef.current = null;
      setLoopRange(null);
      return;
    }
    const tid = selectedTrackId || armedTrackId;
    let start = 0;
    let end = Math.max(totalMs || 0, 1);
    let scoped = false;
    if (tid) {
      const tr = tracks.find((x) => x.id === tid);
      if (tr) {
        if (tr.kind === "vocal" && selectedClipId && tr.clips?.length) {
          const clip = tr.clips.find((c) => c.id === selectedClipId);
          if (clip) {
            start = Math.max(0, clip.startMs);
            end = Math.max(start + 200, clip.endMs);
            scoped = true;
          }
        }
        if (!scoped) {
          start = Math.max(0, tr.startMs);
          end = Math.max(start + 200, tr.endMs || totalMs);
          // Beat defaults to full song unless user selected a narrow span
          if (tr.kind === "beat") {
            start = 0;
            end = Math.max(totalMs || 0, 1);
          } else {
            scoped = true;
          }
        }
      }
    }
    const region = { startMs: start, endMs: end };
    loopRangeRef.current = region;
    setLoopRange(scoped || loopOn ? region : null);
  }, [loopOn, selectedTrackId, armedTrackId, selectedClipId, tracks, totalMs]);

  // Keep needle aligned when zoom changes (transform is in px)
  useEffect(() => {
    pxPerSecRef.current = pxPerSec;
    const el = playheadElRef.current;
    if (el) {
      const ms = playheadMsRef.current;
      el.style.transform = `translate3d(${(ms / 1000) * pxPerSec}px, 0, 0)`;
    }
  }, [pxPerSec]);

  useEffect(() => {
    if (playingRef.current) return; // rAF owns the needle while playing
    playheadMsRef.current = playheadMs;
    const el = playheadElRef.current;
    if (el) {
      el.style.transform = `translate3d(${(playheadMs / 1000) * pxPerSecRef.current}px, 0, 0)`;
    }
  }, [playheadMs]);


  function tickPlayhead() {
    // Must use ref — React state in this closure stays true after pause
    if (!playingRef.current) {
      rafRef.current = 0;
      return;
    }
    const ctx = audioCtxRef.current;
    if (!ctx) {
      rafRef.current = 0;
      return;
    }
    // Prefer AudioContext clock (Web Audio graph). If only HTMLAudio beat fallback
    // is running, derive timeline from that element so the playhead matches audio.
    let elapsed: number;
    const htmlBeat = monitorAudioRef.current;
    if (htmlBeat && sourcesRef.current.length === 0 && !htmlBeat.paused) {
      elapsed = (htmlBeat.currentTime || 0) * 1000;
    } else {
      // Clamp so lookahead (t0 > currentTime) does not pull the needle backwards
      elapsed = Math.max(
        offsetRef.current,
        (ctx.currentTime - startedAtRef.current) * 1000 + offsetRef.current
      );
    }
    const songEnd = Math.max(totalMs || 0, 1);
    elapsed = Math.min(songEnd, Math.max(0, elapsed));
    // Visual only — offsetRef stays as the playback start anchor
    applyPlayheadVisual(elapsed, false);
    // Drive live FX automation from audio clock (not React render)
    try {
      applyGains(elapsed);
    } catch {
      /* */
    }
    const last = playheadStateThrottleRef.current;
    if (Math.abs(elapsed - last) >= 100) {
      playheadStateThrottleRef.current = elapsed;
      setPlayheadMs(elapsed);
    }

    // DAW-style follow: keep playhead visible while playing (esp. mobile)
    try {
      const el = timelineScrollRef.current;
      if (el && el.clientWidth > 0) {
        const x = (elapsed / 1000) * pxPerSecRef.current;
        const viewL = el.scrollLeft;
        const viewW = el.clientWidth;
        const viewR = viewL + viewW;
        // Keep playhead in the left third on mobile so it never drifts off-screen
        const lead = Math.min(120, Math.max(56, viewW * (viewW < 520 ? 0.32 : 0.28)));
        const rightPad = Math.min(80, Math.max(36, viewW * 0.18));
        if (x > viewR - rightPad || x < viewL + 16) {
          const target = Math.max(0, x - lead);
          el.scrollLeft = target;
        }
      }
    } catch {
      /* ignore */
    }

    {
      const region = loopOnRef.current ? loopRangeRef.current : null;
      const loopEnd = region ? region.endMs : totalMs;
      const loopStart = region ? region.startMs : 0;
      // Entered past loop end (or song end)
      if (elapsed >= loopEnd - 1) {
        if (loopOnRef.current && loopEnd > loopStart + 50) {
          void startPlayback(loopStart);
          return;
        }
        if (elapsed >= totalMs - 1) {
          playingRef.current = false;
          setPlaying(false);
          stopSources();
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(tickPlayhead);
  }

  async function startPlayback(fromMs: number) {
    const ctx = getCtx();
    if (!ctx) return;
    const gen = ++playbackGenRef.current;

    // Resume under the same user gesture as Play (required on iOS)
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* */
      }
    }
    if (gen !== playbackGenRef.current) return;

    // Stop prior sources only — keep live FX graphs for resume
    stopSources();
    setTransportPhase("preparing");
    offsetRef.current = Math.max(0, fromMs);
    // Pin playhead visually without advancing until essential audio is ready
    applyPlayheadVisual(fromMs, true);
    playingRef.current = false;
    setPlaying(false);

    const startSec = fromMs / 1000;
    const beatProxy =
      projectId && beatUrl ? `/api/projects/${projectId}/beat/download` : null;

    type ClipSpec = {
      trackId: string;
      kind: "beat" | "vocal";
      startMs: number;
      endMs: number;
      offsetMs: number;
      loadUrl: string;
      fallback: string | null;
      fx: TrackFx;
      on: boolean;
    };

    const specs: ClipSpec[] = [];
    for (const tr of tracks) {
      const on = isAudible(tr.id, tr.kind);
      const fx = (fxByIdRef.current[tr.id] ||
        fxById[tr.id] ||
        DEFAULT_TRACK_FX) as TrackFx;

      if (tr.kind === "vocal") {
        const parts =
          tr.clips && tr.clips.length > 0
            ? tr.clips
            : tr.url
              ? [
                  {
                    id: tr.id,
                    startMs: tr.startMs,
                    endMs: tr.endMs,
                    audioUrl: tr.url,
                    recordingId: tr.recordingId,
                    offsetMs: tr.mediaOffsetMs || 0,
                  },
                ]
              : [];
        for (const clip of parts) {
          const recordingProxy = clip.recordingId
            ? `/api/recordings/${clip.recordingId}/audio`
            : null;
          const vocalProxy = `/api/recording-tasks/${tr.id}/audio`;
          const loadUrl =
            recordingProxy ||
            vocalProxy ||
            clip.audioUrl ||
            null;
          if (!loadUrl) continue;
          specs.push({
            trackId: tr.id,
            kind: "vocal",
            startMs: Number(clip.startMs) || 0,
            endMs: Number(clip.endMs) || tr.endMs,
            offsetMs: Number(clip.offsetMs) || 0,
            loadUrl,
            fallback:
              clip.audioUrl && clip.audioUrl !== loadUrl ? clip.audioUrl : null,
            fx,
            on,
          });
        }
        continue;
      }

      if (!tr.url) continue;
      const loadUrl = beatProxy || tr.url;
      specs.push({
        trackId: tr.id,
        kind: "beat",
        startMs: 0,
        endMs: 0,
        offsetMs: 0,
        loadUrl,
        fallback: tr.url !== loadUrl ? tr.url : null,
        fx,
        on,
      });
    }

    // Prefer beat first so groove starts ASAP
    specs.sort((a, b) => (a.kind === "beat" ? -1 : 0) - (b.kind === "beat" ? -1 : 0));

    // Soft-mute armed track during overdub so the artist hears the arrangement, not prior take
    if (isConsoleRecording && muteArmedWhileRecord) {
      const armed = armedTrackId || consoleRecRef.current?.taskId;
      if (armed) {
        for (const s of specs) {
          if (s.trackId === armed) s.on = false;
        }
      }
    }

    // Essential = beat + clips that cover the current playhead (not entire project)
    const essential = specs.filter((s) => {
      if (s.kind === "beat") return true;
      return s.startMs <= fromMs + 50 && s.endMs >= fromMs - 50;
    });
    for (const s of essential) {
      if (gen !== playbackGenRef.current) return;
      let buf =
        bufferCache.get(s.loadUrl) ||
        (s.fallback ? bufferCache.get(s.fallback) : null) ||
        null;
      if (!buf) buf = await fetchDecode(ctx, s.loadUrl, s.fallback);
      if (!buf) {
        // Beat missing is hard failure for readiness; continue for vocals
        if (s.kind === "beat") {
          setTransportPhase("error");
          setEditMsg("Could not load beat for playback");
        }
      }
    }
    if (gen !== playbackGenRef.current) return;

    // Authoritative clock starts only after essential prepare
    playingRef.current = true;
    setPlaying(true);
    setTransportPhase("playing");
    const t0 = ctx.currentTime;
    startedAtRef.current = t0;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tickPlayhead);

    const graphs = new Map<string, ReturnType<typeof createLiveTrackFxGraph>>();
    // Rehydrate from existing live graphs (pause/resume)
    for (const [id, g] of fxGraphRef.current) {
      graphs.set(id, g);
    }
    let beatStartedInGraph = false;

    const scheduleBuf = (
      spec: ClipSpec,
      buf: AudioBuffer,
      graph: ReturnType<typeof createLiveTrackFxGraph>
    ) => {
      if (gen !== playbackGenRef.current || !playingRef.current) return;
      const src = ctx.createBufferSource();
      let playBuf = buf;
      try {
        if (
          (Number(spec.fx.gate) || 0) > 0.02 ||
          (Number(spec.fx.noiseReduce) || 0) > 0.02
        ) {
          playBuf = processPreviewBuffer(ctx, buf, {
            gate: Number(spec.fx.gate) || 0,
            noiseReduce: Number(spec.fx.noiseReduce) || 0,
            deEss: Number(spec.fx.deEss) || 0,
            phraseCleanup: Number(spec.fx.phraseCleanup) || 0,
          });
        }
      } catch {
        playBuf = buf;
      }
      src.buffer = playBuf;
      src.connect(graph.input);

      // Song time (seconds) at this exact AudioContext moment
      const songNow = startSec + Math.max(0, ctx.currentTime - t0);

      if (spec.kind === "vocal") {
        const layerStart = spec.startMs / 1000;
        const layerEnd = Math.max(layerStart + 0.05, spec.endMs / 1000);
        const mediaOff = Math.max(0, spec.offsetMs / 1000);
        const clipDur = Math.max(0.05, layerEnd - layerStart);
        if (songNow >= layerEnd) return;
        if (songNow >= layerStart) {
          const into = mediaOff + (songNow - layerStart);
          const remain = Math.max(0.05, layerEnd - songNow);
          if (into >= playBuf.duration) return;
          src.start(
            ctx.currentTime,
            into,
            Math.min(remain, playBuf.duration - into)
          );
        } else {
          const when = t0 + (layerStart - startSec);
          src.start(
            Math.max(ctx.currentTime, when),
            mediaOff,
            Math.min(clipDur, playBuf.duration - mediaOff)
          );
        }
      } else {
        if (songNow >= playBuf.duration) return;
        src.start(ctx.currentTime, songNow);
        beatStartedInGraph = true;
      }
      sourcesRef.current.push(src);
    };

    // Progressive: each buffer starts the moment it is ready (beat prioritized)
    await Promise.all(
      specs.map(async (spec) => {
        let buf =
          bufferCache.get(spec.loadUrl) ||
          (spec.fallback ? bufferCache.get(spec.fallback) : null) ||
          null;
        if (!buf) {
          buf = await fetchDecode(ctx, spec.loadUrl, spec.fallback);
        }
        if (!buf || gen !== playbackGenRef.current || !playingRef.current) return;

        let graph = graphs.get(spec.trackId) || fxGraphRef.current.get(spec.trackId);
        if (!graph) {
          graph = createLiveTrackFxGraph(ctx);
          graph.apply(
            trackFxToLiveParams(spec.fx as unknown as Record<string, number>),
            spec.on
          );
          graphs.set(spec.trackId, graph);
          fxGraphRef.current.set(spec.trackId, graph);
          gainsRef.current.set(spec.trackId, graph.gain);
          panNodesRef.current.set(spec.trackId, graph.pan);
          try {
            graph.output.connect(ctx.destination);
          } catch {
            /* already connected */
          }
        } else {
          graph.apply(
            trackFxToLiveParams(spec.fx as unknown as Record<string, number>),
            spec.on
          );
          gainsRef.current.set(spec.trackId, graph.gain);
          panNodesRef.current.set(spec.trackId, graph.pan);
        }
        scheduleBuf(spec, buf, graph);
      })
    );

    if (gen !== playbackGenRef.current || !playingRef.current) {
      stopSources();
      setPlaying(false);
      setTransportPhase("paused");
      return;
    }

    // HTMLAudio fallback if beat never made it into the WebAudio graph
    const beatTrack = tracks.find((x) => x.kind === "beat" && x.url);
    if (beatTrack?.url && !beatStartedInGraph && isAudible("beat", "beat")) {
      try {
        try {
          monitorAudioRef.current?.pause();
        } catch {
          /* */
        }
        const a = new Audio(beatTrack.url);
        // Align element time to current song position
        const songNow = startSec + Math.max(0, ctx.currentTime - t0);
        a.currentTime = Math.max(0, songNow);
        {
          const bfx =
            fxByIdRef.current["beat"] || fxById["beat"] || DEFAULT_TRACK_FX;
          const lin = Math.pow(10, (Number(bfx.gainDb) || 0) / 20);
          a.volume = Math.max(0, Math.min(1, lin));
        }
        monitorAudioRef.current = a;
        void a.play().catch((e) =>
          console.warn("[producer-view] beat HTMLAudio play", e)
        );
      } catch (e) {
        console.warn("[producer-view] beat HTMLAudio fallback", e);
      }
    }
  }

  function fitTimelineToView() {
    const el = timelineScrollRef.current;
    if (!el || totalMs <= 0) return;
    const usable = Math.max(160, el.clientWidth - 16);
    const sec = Math.max(0.5, totalMs / 1000);
    const next = Math.max(8, Math.min(160, usable / sec));
    setPxPerSec(next);
    el.scrollLeft = 0;
  }

  /** Zoom timeline with scroll/pinch on the timeline body (not header buttons). */
  function applyTimelineZoom(factor: number, clientX: number) {
    const el = timelineScrollRef.current;
    if (!el) return;
    setPxPerSec((z) => {
      const next = Math.max(8, Math.min(160, Math.round(z * factor * 10) / 10));
      if (next === z) return z;
      const rect = el.getBoundingClientRect();
      const cursorX = clientX - rect.left;
      const timeSec = (el.scrollLeft + cursorX) / Math.max(1e-6, z);
      requestAnimationFrame(() => {
        const sc = timelineScrollRef.current;
        if (!sc) return;
        sc.scrollLeft = Math.max(0, timeSec * next - cursorX);
        // keep header scroll in sync
        const h = headerScrollRef.current;
        if (h) h.scrollLeft = sc.scrollLeft;
      });
      return next;
    });
  }

  // Ctrl/Cmd+wheel or trackpad pinch over timeline → zoom (passive:false so preventDefault works)
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const pinch = e.ctrlKey || e.metaKey;
      // Ruler strip: always zoom on vertical wheel (no modifier required)
      const target = e.target as HTMLElement | null;
      const onRuler = Boolean(target?.closest?.("[data-console-ruler]"));
      if (!pinch && !onRuler) return;
      // Ignore pure horizontal pan gestures
      if (!pinch && onRuler && Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      const dy = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      const factor = dy > 0 ? 0.9 : 1.11;
      applyTimelineZoom(factor, e.clientX);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // applyTimelineZoom closes over setPxPerSec/refs — stable enough for mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePlay() {
    if (playingRef.current || playing || transportPhase === "preparing") {
      const ctx = audioCtxRef.current;
      if (ctx && playingRef.current) {
        const frozen =
          (ctx.currentTime - startedAtRef.current) * 1000 + offsetRef.current;
        const clamped = Math.min(Math.max(totalMs || 0, 1), Math.max(0, frozen));
        offsetRef.current = clamped;
        applyPlayheadVisual(clamped, true);
      }
      playbackGenRef.current += 1;
      playingRef.current = false;
      stopSources(); // keep FX graphs
      setPlaying(false);
      setTransportPhase("paused");
    } else {
      void startPlayback(playheadMs);
    }
  }


  function clearProducePoll() {
    if (producePollRef.current) {
      clearTimeout(producePollRef.current);
      producePollRef.current = null;
    }
    if (produceTimeoutRef.current) {
      clearTimeout(produceTimeoutRef.current);
      produceTimeoutRef.current = null;
    }
    produceActiveRef.current = false;
  }

  const pollProduceOnce = useCallback(async (): Promise<"complete" | "failed" | "pending" | "error"> => {
    if (!projectId) return "error";
    try {
      // Advance the job on the server (status route is read-only; worker may be offline).
      // GET /api/jobs/:id runs tickProduceJob for queued/processing PRODUCE_SONG.
      const pollJobId = produceJobIdRef.current || produceJobId;
      if (pollJobId) {
        try {
          const jr = await fetch(`/api/jobs/${pollJobId}`);
          const jj = await jr.json().catch(() => ({})) as ApiJson;
          if (jr.ok) {
            const stGate = String(jj.status || "").toLowerCase();
            if (jj.status) setProduceJobStatus(String(jj.status));
            // Only show engine stages after the worker has claimed the job.
            // Queued jobs must not display arranging@80% from stale/default progress.
            if (stGate === "queued" || stGate === "pending" || !stGate) {
              setProduceStage("queued");
              setProduceProgress(5);
            } else if (stGate === "processing" || stGate === "running") {
              if (jj.stage) setProduceStage(String(jj.stage));
              if (typeof jj.progress === "number" && Number.isFinite(jj.progress)) {
                setProduceProgress(Math.max(5, Math.min(99, Math.round(jj.progress))));
              }
            } else if (stGate === "complete" || stGate === "completed") {
              if (jj.stage) setProduceStage(String(jj.stage));
              if (typeof jj.progress === "number" && Number.isFinite(jj.progress)) {
                setProduceProgress(Math.max(0, Math.min(100, Math.round(jj.progress))));
              }
            }
            // Honest progress: detect stuck queue / dead processing (worker never advances)
            {
              const stNow = String(jj.status || "").toLowerCase();
              const stageNow = String(jj.stage || "").toLowerCase();
              const progNow =
                typeof jj.progress === "number" && Number.isFinite(jj.progress)
                  ? Math.round(jj.progress)
                  : produceLastChangeRef.current.progress;
              const prev = produceLastChangeRef.current;
              const changed =
                progNow !== prev.progress || stageNow !== prev.stage || stNow !== prev.status;
              if (changed) {
                produceLastChangeRef.current = {
                  at: Date.now(),
                  progress: progNow,
                  stage: stageNow,
                  status: stNow,
                };
              } else if (prev.at > 0) {
                const idleMs = Date.now() - prev.at;
                // Queued too long → worker never claimed
                if (stNow === "queued" && idleMs > 90_000) {
                  // Do not clear ref mid-poll chain incorrectly; fail this run explicitly
                  produceJobIdRef.current = null;
                  setProduceJobId(null);
                  setProduceUi("failed");
                  setProduceStage("failed");
                  setProduceError(
                    "Production never started — the studio engine did not pick up this job. Tap Produce again. If it keeps happening, check the Railway worker."
                  );
                  setProduceProgress(0);
                  return "failed";
                }
                // Processing but no stage/progress change → worker died mid-job
                if (
                  (stNow === "processing" || stNow === "running") &&
                  idleMs > 4 * 60_000
                ) {
                  produceJobIdRef.current = null;
                  setProduceJobId(null);
                  setProduceUi("failed");
                  setProduceStage("failed");
                  setProduceError(
                    "Production stalled on the studio engine (no progress for several minutes). Your recordings are safe — cancel if needed, then tap Produce again."
                  );
                  return "failed";
                }
              }
            }
            if (jj.status === "failed" || jj.status === "FAILED") {
              setProduceJobId(null);
              setProduceError(humanProduceError(jj.error, jj.stage));
              setProduceUi("failed");
              setProduceProgress(100);
              return "failed";
            }
            if (
              (jj.status === "complete" || jj.status === "completed") &&
              (jj.output_data?.master_url ||
                jj.output_data?.master_path ||
                jj.output_data?.master_storage_path ||
                jj.output_data?.masterPath)
            ) {
              // Fall through to status for signed master URL
            }
          }
        } catch {
          /* still poll status */
        }
      }

      const sr = await fetch(`/api/projects/${projectId}/status`);
      const st = await sr.json().catch(() => ({})) as ApiJson;
      if (!sr.ok) return "error";

      const jobs = (st.jobs || []) as {
        id?: string;
        type?: string;
        status?: string;
        stage?: string;
        progress?: number;
        error?: string;
        output_data?: Record<string, unknown>;
      }[];
      // Strict tracking via REF (not React state) so Produce again cannot race and
      // complete against a previous job before setProduceJobId commits.
      const activeJobId = produceJobIdRef.current || produceJobId;
      const tracked =
        activeJobId ? jobs.find((j) => j.id === activeJobId) : undefined;
      const trackedStatus = String(tracked?.status || "").toLowerCase();

      if (activeJobId && tracked && trackedStatus === "failed") {
        setProduceError(humanProduceError(tracked.error, tracked.stage));
        setProduceUi("failed");
        setProduceProgress(100);
        return "failed";
      }

      let produceJob = tracked;
      if (!produceJob && !activeJobId) {
        // Resume path only (no active job id yet): prefer in-flight, never a completed old master
        produceJob = jobs.find(
          (j) =>
            j.type === "PRODUCE_SONG" &&
            ["queued", "processing", "running"].includes(String(j.status || "").toLowerCase())
        );
        if (produceJob?.id) {
          produceJobIdRef.current = String(produceJob.id);
          setProduceJobId(String(produceJob.id));
        }
      }

      const stGate2 = String(produceJob?.status || "").toLowerCase();
      if (produceJob?.status) setProduceJobStatus(String(produceJob.status));
      if (stGate2 === "queued" || stGate2 === "pending" || !stGate2) {
        setProduceStage("queued");
        setProduceProgress(5);
      } else if (stGate2 === "processing" || stGate2 === "running") {
        if (produceJob?.stage) setProduceStage(String(produceJob.stage));
        if (typeof produceJob?.progress === "number" && Number.isFinite(produceJob.progress)) {
          setProduceProgress(Math.max(5, Math.min(99, Math.round(produceJob.progress))));
        }
      } else {
        if (produceJob?.stage) setProduceStage(String(produceJob.stage));
        if (typeof produceJob?.progress === "number" && Number.isFinite(produceJob.progress)) {
          setProduceProgress(Math.max(0, Math.min(100, Math.round(produceJob.progress))));
        }
      }

      const jobStatus = (produceJob?.status || "").toLowerCase();

      if (jobStatus === "failed") {
        setProduceError(humanProduceError(produceJob?.error, produceJob?.stage));
        setProduceUi("failed");
        return "failed";
      }

      const masterReady =
        Boolean(st.master_url) ||
        (st.master?.audio_path &&
          typeof st.master.audio_path === "string" &&
          !String(st.master.audio_path).startsWith("http") &&
          !String(st.master.audio_path).startsWith("mock://"));

      // Complete only when THIS job is completed AND it looks like a real new finish
      // (not a stale completed row or project still pointing at the previous master).
      if (jobStatus === "complete" || jobStatus === "completed") {
        // Must be the job we started — never adopt another completed PRODUCE_SONG
        if (activeJobId && produceJob?.id && String(produceJob.id) !== String(activeJobId)) {
          return "pending";
        }
        if (!activeJobId) {
          // No intentional produce session — do not auto-complete from history
          return "pending";
        }
        const out = (produceJob?.output_data || {}) as Record<string, unknown>;
        // Worker writes master_storage_path (R2 key); legacy keys kept for older jobs
        const jobHasMaster = Boolean(
          out.master_storage_path ||
            out.master_path ||
            out.master_url ||
            out.masterPath ||
            out.mix_storage_path
        );
        const completedAtMs = (() => {
          const raw = (produceJob as { completed_at?: string } | undefined)?.completed_at
            || (out.completed_at as string | undefined);
          const n = raw ? Date.parse(String(raw)) : NaN;
          return Number.isFinite(n) ? n : 0;
        })();
        const started = produceStartedAtRef.current || 0;
        // Must have finished AFTER this Produce click (strict — no 5%→100% on old master)
        if (started) {
          if (!completedAtMs) {
            // Complete without completed_at is suspicious; keep waiting one more cycle
            return "pending";
          }
          if (completedAtMs < started - 2_000) {
            return "pending";
          }
        }
        if (!jobHasMaster) {
          return "pending";
        }
        // Prefer THIS job's signed master — avoid project-level previous master
        let url =
          (typeof out.master_url === "string" && out.master_url.startsWith("http")
            ? out.master_url
            : null) || null;
        if (!url) {
          try {
            // Resolve via status API with job context if possible
            url = await resolveMasterPlayUrl();
          } catch {
            url = null;
          }
        }
        // Only use project master_url if it changed after we started produce
        if (!url && st.master_url) {
          const masterCreated = st.master?.created_at
            ? Date.parse(String(st.master.created_at))
            : 0;
          if (!started || !masterCreated || masterCreated >= started - 2_000) {
            url = String(st.master_url);
          }
        }
        if (!url) {
          // Job finished with storage path but URL not ready — stay producing, not "complete" with old audio
          setProduceStage(String(produceJob?.stage || "export"));
          setProduceProgress(96);
          setProduceUi("producing");
          return "pending";
        }
        if (url) setMasterUrl(url);
        if (produceJob?.id) setMasterJobId(String(produceJob.id));
        setProduceStage("complete");
        setProduceProgress(100);
        setProduceUi("complete");
        setProduceError(null);
        return "complete";
      }

      if (jobStatus === "queued" || jobStatus === "processing" || jobStatus === "running") {
        setProduceUi("producing");
        return "pending";
      }

      // produceJobId set but not in list yet (just enqueued) — keep waiting
      return "pending";
    } catch {
      return "error";
    }
  }, [projectId, produceJobId]);

  const scheduleProducePoll = useCallback(() => {
    clearProducePoll();
    produceActiveRef.current = true;
    const PRODUCE_CLIENT_TIMEOUT_MS = 120 * 60 * 1000; // 120 min hard client timeout
  const PRODUCE_CLIENT_WARN_MS = 12 * 60 * 1000; // show stronger cancel hint
  const PRODUCE_POLL_MS = 4000;
    // Full AP engine often exceeds 10m (restore + arrange + mix + master). Align with worker ceiling.
    const PRODUCE_MAX_MS = 30 * 60 * 1000;
    const tick = async () => {
      if (!produceActiveRef.current) return;
      if (Date.now() - produceStartedAtRef.current > PRODUCE_MAX_MS) {
        // Soft timeout: re-check once. If worker still processing, keep waiting — do not mark failed.
        const result = await pollProduceOnce();
        if (result === "complete" || result === "failed") {
          produceActiveRef.current = false;
          return;
        }
        if (result === "pending") {
          // Extend another 15m while job is still alive on the server
          produceStartedAtRef.current = Date.now() - PRODUCE_MAX_MS + 15 * 60 * 1000;
          setProduceError(
            "Still producing on the server — this can take a while on longer songs. Leave this open; progress will update."
          );
          setProduceUi("producing");
          producePollRef.current = setTimeout(() => void tick(), PRODUCE_POLL_MS);
          return;
        }
        setProduceUi("failed");
        setProduceError(
          "This is taking longer than expected. Tap Produce again to start a fresh job — your recordings are safe."
        );
        produceActiveRef.current = false;
        return;
      }
      const result = await pollProduceOnce();
      if (result === "complete" || result === "failed") {
        produceActiveRef.current = false;
        return;
      }
      producePollRef.current = setTimeout(() => void tick(), PRODUCE_POLL_MS);
    };
    producePollRef.current = setTimeout(() => void tick(), PRODUCE_POLL_MS);
  }, [pollProduceOnce]);

  // Resume produce / master on open
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const sr = await fetch(`/api/projects/${projectId}/status`);
        if (!sr.ok || cancelled) return;
        const st = await sr.json().catch(() => ({})) as ApiJson;
        const jobs = (st.jobs || []) as {
          id?: string;
          type?: string;
          status?: string;
          stage?: string;
          error?: string;
        }[];
        // Prefer newest in-flight PRODUCE_SONG; never pretend a dead job is actively producing
        const produceJobs = jobs.filter((j) => j.type === "PRODUCE_SONG");
        const inflight = produceJobs.find((j) => {
          const s = (j.status || "").toLowerCase();
          return s === "queued" || s === "processing" || s === "running";
        });
        const produceJob = inflight || produceJobs[0];
        const js = (produceJob?.status || "").toLowerCase();
        if (produceJob?.id) setProduceJobId(String(produceJob.id));
        if (js === "queued" || js === "processing" || js === "running") {
          const startedRaw = (produceJob as { started_at?: string })?.started_at
            || (produceJob as { created_at?: string })?.created_at;
          const startedMs = startedRaw ? Date.parse(String(startedRaw)) : 0;
          const ageMs = startedMs ? Date.now() - startedMs : 0;
          // Older than 8 minutes with no active poll session → treat as stalled, not "working"
          if (ageMs > 8 * 60_000 && js !== "queued") {
            setProduceUi("failed");
            setProduceStage("failed");
            setProduceError(
              "A previous produce run stalled. Your recordings are safe — tap Produce to start a fresh job."
            );
          } else {
            setProduceUi("producing");
            setProduceStage(js === "queued" ? "queued" : (produceJob?.stage || "queued"));
            produceStartedAtRef.current = Date.now();
            produceLastChangeRef.current = {
              at: Date.now(),
              progress: 0,
              stage: String(produceJob?.stage || js),
              status: js,
            };
            scheduleProducePoll();
          }
        } else if (js === "failed") {
          setProduceUi("failed");
          setProduceError(
            humanProduceError(
              (produceJob as { error?: string } | undefined)?.error,
              produceJob?.stage
            )
          );
          setProduceStage("failed");
        } else if (st.master_url) {
          setMasterUrl(String(st.master_url));
          if (produceJob?.id) setMasterJobId(String(produceJob.id));
          // Keep master available but do not force the result panel open on every visit
          setProduceStage("complete");
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      clearProducePoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function resolveMasterPlayUrl(): Promise<string | null> {
    if (!projectId) return null;
    for (let i = 0; i < 6; i++) {
      try {
        const sr = await fetch(`/api/projects/${projectId}/status`);
        const st = await sr.json().catch(() => ({})) as ApiJson;
        if (!sr.ok) break;
        if (st.master_url && typeof st.master_url === "string") {
          return st.master_url;
        }
        const alt = st.master?.url || st.audio_url;
        if (alt && typeof alt === "string") return alt;
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 900));
    }
    return null;
  }

  async function cancelProduce(reason: "user" | "timeout" = "user") {
    const jobId = produceJobIdRef.current || produceJobId;
    clearProducePoll();
    produceJobIdRef.current = null;
    setProduceJobId(null);
    setProduceUi("failed");
    setProduceError(
      reason === "timeout"
        ? "Production timed out after 120 minutes. Tap Produce again to start a new job — your recordings are safe."
        : "Production cancelled. Your recordings are safe — tap Produce when you want to try again."
    );
    setProduceStage("failed");
    if (projectId) {
      try {
        await fetch(`/api/projects/${projectId}/produce/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
      } catch {
        /* UI already exited producing */
      }
    }
  }

  async function startConsoleProduce() {

    if (!projectId) return;
    // Allow restart while stuck on producing: cancel in-flight UI + server job first
    if (produceUi === "producing" || produceUi === "starting") {
      try {
        await cancelProduce("user");
      } catch {
        /* continue to new job */
      }
    }

    setProduceUi("starting");
    setProduceError(null);
    setMasterUrl(null);
    setMasterJobId(null);
    setMasterPlaying(false);

    let planTasks: PlanTaskRow[] = [];
    try {
      const tr = await fetch(`/api/projects/${projectId}/recording-tasks?all=1`);
      const tj = await tr.json().catch(() => ({})) as ApiJson;
      if (tr.ok && Array.isArray(tj.tasks)) {
        planTasks = (tj.tasks as Record<string, unknown>[]).map((tk) => ({
          id: String(tk.id),
          type: String(tk.type || "lead"),
          title: (tk.title as string) || null,
          status: String(tk.status || "pending"),
          start_ms: (tk.start_ms as number) ?? null,
          end_ms: (tk.end_ms as number) ?? null,
          required: (tk.required as boolean) ?? null,
          active: (tk.active as boolean) ?? null,
          selected_in_plan: (tk.selected_in_plan as boolean) ?? null,
        }));
        const ready = produceReadinessFromTasks(planTasks);
        if (!ready.canProduce) {
          setProduceUi("failed");
          setProduceError(ready.reason);
          return;
        }
      } else if (!layers.some((l) => Boolean(l.audioUrl))) {
        setProduceUi("failed");
        setProduceError("Record at least one selected part before producing.");
        return;
      }
    } catch {
      if (!layers.some((l) => Boolean(l.audioUrl))) {
        setProduceUi("failed");
        setProduceError("Record at least one selected part before producing.");
        return;
      }
    }

    // Fresh produce: stop polling the previous job and clear its id
    clearProducePoll();
    produceActiveRef.current = false;
    produceJobIdRef.current = null;
    setProduceJobId(null);
    setProduceJobStatus("queued");
    setProduceProgress(0);
    setProduceError(null);
    setProduceStage("queued");
    setProduceUi("producing");
    produceLastChangeRef.current = { at: Date.now(), progress: 0, stage: "queued", status: "queued" };

    // Shared prep (same as Booth) — originals kept; new WAV take selected when needed
    try {
      if (planTasks.length) {
        await prepareTakesForProduce({
          tasks: planTasks,
          onStage: (s) => setProduceStage(s),
        });
      }
    } catch {
      /* server normalizeToInternalPcm is still authoritative */
    }

    try {
      const res = await fetch(`/api/projects/${projectId}/produce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const j = await res.json().catch(() => ({})) as ApiJson;
      if (!res.ok) {
        const msg =
          typeof j.error === "string"
            ? j.error
            : typeof j.message === "string"
              ? j.message
              : "AP couldn’t start production.";
        throw new Error(String(msg).replace(/\bRoEx\b/gi, "AP"));
      }
      const jid = j.jobId || j.job_id;
      if (!jid) {
        throw new Error(
          "Production job was not created. Check your connection and try Produce again."
        );
      }
      // Always wait for THIS job — never short-circuit on a prior master_url.
      // Set ref BEFORE scheduleProducePoll so the first poll cannot match an old completed job.
      produceStartedAtRef.current = Date.now();
      produceJobIdRef.current = String(jid);
      setProduceJobId(String(jid));
      // Job exists but worker has not claimed yet — never show arrange progress here
      setProduceJobStatus("queued");
      setProduceStage("queued");
      setProduceProgress(5);
      if (j.deduped) {
        console.warn("[produce] unexpected dedupe on force Produce again", jid, j);
      }
      // Do not GET /api/jobs here — that can tick inline and race the worker. Polling handles status.
      if (produceTimeoutRef.current) clearTimeout(produceTimeoutRef.current);
      produceTimeoutRef.current = setTimeout(() => {
        if (produceActiveRef.current) void cancelProduce("timeout");
      }, PRODUCE_CLIENT_TIMEOUT_MS);
      scheduleProducePoll();
    } catch (e) {
      setProduceUi("failed");
      setProduceError(
        e instanceof Error
          ? e.message.replace(/\bRoEx\b/gi, "AP")
          : "AP couldn’t start production."
      );
    }
  }

  function dismissProducePanel() {
    try {
      masterAudioRef.current?.pause();
    } catch {
      /* */
    }
    setMasterPlaying(false);
    setProduceUi("idle");
    setProduceError(null);
  }


  /** Artist finish: bounce timeline + FX + automation to WAV (does not run Produce). */
  async function exportSessionBounce() {
    if (exportBusy) return;
    setExportBusy(true);
    setEditMsg("Exporting your mix…");
    try {
      const mutes = mutedRef.current;
      const solo = soloIdRef.current;
      const bounceLayers: {
        id: string;
        kind: "beat" | "vocal";
        startMs: number;
        audioUrl: string;
        label?: string;
        fallbackUrl?: string | null;
        automationTrackId?: string;
        fx?: Record<string, number>;
        muted?: boolean;
        phraseCleanup?: number;
      }[] = [];

      // Beat
      if (beatUrl) {
        const beatMuted =
          !!mutes["beat"] || (!!solo && solo !== "beat");
        const fx = fxById["beat"] || DEFAULT_TRACK_FX;
        bounceLayers.push({
          id: "beat",
          kind: "beat",
          startMs: 0,
          audioUrl: beatUrl,
          label: "Beat",
          automationTrackId: "beat",
          fallbackUrl: projectId
            ? `/api/projects/${projectId}/beat/download`
            : null,
          fx: { ...(fx as unknown as Record<string, number>) },
          muted: beatMuted,
          phraseCleanup: 0,
        });
      }

      // Vocals — expand multi-clip tracks so splits are not dropped
      for (const l of layers) {
        const fx = fxById[l.id] || DEFAULT_TRACK_FX;
        const trackMuted =
          !!mutes[l.id] || (!!solo && solo !== l.id);
        const taskProxy = `/api/recording-tasks/${l.id}/audio`;
        const clips =
          l.clips && l.clips.length > 0
            ? l.clips
            : [
                {
                  id: l.id,
                  startMs: l.startMs || 0,
                  endMs: l.endMs,
                  audioUrl: l.audioUrl,
                  recordingId: l.recordingId,
                },
              ];
        for (const c of clips) {
          const recProxy =
            c.recordingId != null
              ? `/api/recordings/${c.recordingId}/audio`
              : null;
          const primary =
            c.audioUrl || recProxy || l.audioUrl || taskProxy || "";
          if (!primary && !recProxy && !taskProxy) {
            // Surface missing audio rather than silent omit
            bounceLayers.push({
              id: `${l.id}::${c.id}`,
              kind: "vocal",
              startMs: c.startMs || 0,
              audioUrl: "",
              label: `${l.label || l.id}${clips.length > 1 ? ` (${c.id.slice(0, 6)})` : ""}`,
              automationTrackId: l.id,
              fallbackUrl: null,
              fx: { ...(fx as unknown as Record<string, number>) },
              muted: trackMuted,
              phraseCleanup: fx.phraseCleanup || 0,
            });
            continue;
          }
          bounceLayers.push({
            id: clips.length > 1 ? `${l.id}::${c.id}` : l.id,
            kind: "vocal",
            startMs: c.startMs || 0,
            audioUrl: primary,
            label: `${l.label || l.id}${clips.length > 1 ? ` clip` : ""}`,
            // Parent task id so split clips still receive track automation / FX rides
            automationTrackId: l.id,
            fallbackUrl: recProxy || taskProxy,
            fx: { ...(fx as unknown as Record<string, number>) },
            muted: trackMuted,
            phraseCleanup: fx.phraseCleanup || 0,
          });
        }
      }

      if (!bounceLayers.length) {
        setEditMsg("Nothing to export — add a beat or vocal first.");
        setExportBusy(false);
        return;
      }

      // Content length: farthest clip end (not just totalMs scroll width)
      let contentEnd = Math.max(totalMs || 0, durationMs || 0, 5000);
      for (const l of layers) {
        contentEnd = Math.max(contentEnd, Number(l.endMs) || 0);
        if (l.clips) {
          for (const c of l.clips) {
            contentEnd = Math.max(contentEnd, Number(c.endMs) || 0);
          }
        }
      }

      const result = await bounceSessionToWavDetailed({
        layers: bounceLayers,
        durationMs: contentEnd,
        automation: automationDocRef.current,
        strict: true,
        onProgress: (p) => {
          if (p < 1) setEditMsg(`Exporting your mix… ${Math.round(p * 100)}%`);
        },
      });
      const name = `${(titleDraft || projectTitle || "session").replace(/[^\w\-]+/g, "_")}-export.wav`;
      downloadBlob(result.blob, name);
      const note =
        result.notes.length > 0 ? ` (${result.notes[0]})` : "";
      setEditMsg(
        `Mix exported — ${result.included.length} track(s) rendered.${note}`
      );
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  }

  async function downloadMaster(format: "wav" | "mp3" = "wav") {
    if (!projectId) return;
    setDownloadBusy(true);
    setProduceError(null);
    const result = await forceDownloadFromApi(
      projectId,
      format,
      `${titleDraft || projectTitle || "song"}.${format}`
    );
    setDownloadBusy(false);
    if (!result.ok) {
      if (result.code === "PAYWALL") {
        setPaywallOpen(true);
        setProduceError(null);
        return;
      }
      if (format === "mp3") {
        setProduceError(
          result.error || "MP3 is not ready yet — try Download WAV."
        );
      } else {
        setProduceError(result.error || "Download not available yet.");
      }
    }
  }

  function toggleMasterPlay() {
    const a = masterAudioRef.current;
    if (!a || !masterUrl) return;
    if (a.paused) {
      void a.play();
      setMasterPlaying(true);
    } else {
      a.pause();
      setMasterPlaying(false);
    }
  }

  /** Max seekable time — prefer real content length, never a short sticky default. */
  function seekCeilingMs(): number {
    return Math.max(totalMs || 0, durationMs || 0, 3 * 60_000);
  }

  /**
   * Move the playhead needle in the DOM.
   * CRITICAL: do NOT write offsetRef here during playback ticks.
   * offsetRef is the *start* anchor for: elapsed = (now - startedAt)*1000 + offsetRef
   * Writing current time into offsetRef every frame compounds and races the needle.
   */
  function applyPlayheadVisual(ms: number, syncReact: boolean) {
    const ceiling = Math.max(totalMs || 0, durationMs || 0, 1);
    const clamped = Math.max(0, Math.min(ceiling, ms));
    playheadMsRef.current = clamped;
    const el = playheadElRef.current;
    if (el) {
      el.style.transform = `translate3d(${(clamped / 1000) * pxPerSecRef.current}px, 0, 0)`;
    }
    if (syncReact) {
      setPlayheadMs(clamped);
      playheadStateThrottleRef.current = clamped;
    }
  }

  /**
   * Map a pointer's clientX to song time using the scroll container
   * (correct when scrolled — sticky ruler getBoundingClientRect alone is wrong).
   */
  function clientXToTimelineMs(clientX: number): number {
    const scroll = timelineScrollRef.current;
    if (scroll) {
      const rect = scroll.getBoundingClientRect();
      const x = clientX - rect.left + scroll.scrollLeft;
      return (x / pxPerSecRef.current) * 1000;
    }
    return 0;
  }

  function seekTo(ms: number) {
    const ceiling = Math.max(totalMs || 0, durationMs || 0, seekCeilingMs());
    const clamped = Math.max(0, Math.min(ceiling, ms));
    offsetRef.current = clamped;
    applyPlayheadVisual(clamped, true);
    if (playingRef.current || playing) {
      void startPlayback(clamped);
    }
  }

  function seekFromClientX(clientX: number) {
    seekTo(clientXToTimelineMs(clientX));
  }

  function nudgePan(trackId: string, delta: number) {
    if (!trackId) return;
    setFxById((prev) => {
      const cur = prev[trackId] || { ...DEFAULT_TRACK_FX };
      const nextPan = Math.max(-1, Math.min(1, (Number(cur.pan) || 0) + delta));
      const next = { ...cur, pan: Math.round(nextPan * 20) / 20 };
      if (next.pan !== cur.pan) {
        pushConsoleHistory({
          kind: "fx",
          label: "Pan",
          id: trackId,
          before: { ...cur },
          after: { ...next },
        });
      }
      void persistFx(trackId, next);
      return { ...prev, [trackId]: next };
    });
  }

  function setPan(trackId: string, value: number, commit = false) {
    if (!trackId) return;
    const pan = Math.max(-1, Math.min(1, Math.round(value * 100) / 100));
    setFxById((prev) => {
      const cur = prev[trackId] || { ...DEFAULT_TRACK_FX };
      const next = { ...cur, pan };
      if (commit && next.pan !== cur.pan) {
        pushConsoleHistory({
          kind: "fx",
          label: "Pan",
          id: trackId,
          before: { ...cur },
          after: { ...next },
        });
        void persistFx(trackId, next);
      }
      return { ...prev, [trackId]: next };
    });
  }

  /** Push gain into live Web Audio / HTMLAudio immediately (works mid-playback). */
  function applyGainNow(trackId: string, gainDb: number, audible: boolean) {
    const lin = Math.pow(10, gainDb / 20);
    const ctx = audioCtxRef.current;
    const t0 = ctx?.currentTime ?? 0;
    const graph = fxGraphRef.current.get(trackId);
    if (graph) {
      try {
        const fx = {
          ...(fxByIdRef.current[trackId] || DEFAULT_TRACK_FX),
          gainDb,
        };
        graph.apply(trackFxToLiveParams(fx as unknown as Record<string, number>), audible);
      } catch {
        /* */
      }
      return;
    }
    const g = gainsRef.current.get(trackId);
    if (g && ctx) {
      try {
        g.gain.setTargetAtTime(audible ? lin : 0, t0, 0.02);
      } catch {
        /* */
      }
    }
    if (trackId === "beat" && monitorAudioRef.current) {
      try {
        monitorAudioRef.current.volume = audible ? Math.max(0, Math.min(1, lin)) : 0;
      } catch {
        /* */
      }
    }
  }

  function setGain(trackId: string, value: number, commit = false) {
    if (!trackId) return;
    const gainDb = Math.max(-12, Math.min(12, Math.round(value * 10) / 10));
    const cur = fxByIdRef.current[trackId] || { ...DEFAULT_TRACK_FX };
    const next = { ...cur, gainDb };
    fxByIdRef.current = { ...fxByIdRef.current, [trackId]: next };
    let audible = true;
    try {
      const kind = tracks.find((x) => x.id === trackId)?.kind || "vocal";
      audible = isAudible(trackId, kind);
    } catch {
      audible = true;
    }
    applyGainNow(trackId, gainDb, audible);
    setFxById((prev) => ({ ...prev, [trackId]: next }));
    if (commit) {
      if (next.gainDb !== cur.gainDb) {
        pushConsoleHistory({
          kind: "fx",
          label: "Gain",
          id: trackId,
          before: { ...cur },
          after: { ...next },
        });
      }
      void persistFx(trackId, next);
    }
  }

  // Console keyboard shortcuts (ignore when typing in inputs)
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      // Undo / Redo (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y)
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          consoleUndo();
          return;
        }
        if ((k === "z" && e.shiftKey) || k === "y") {
          e.preventDefault();
          consoleRedo();
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      const sel = selectedTrackId;

      if (key === " " || key === "Spacebar") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (key === "ArrowLeft") {
        e.preventDefault();
        seekTo(playheadMs - (e.shiftKey ? 5000 : 1000));
        return;
      }
      if (key === "ArrowRight") {
        e.preventDefault();
        seekTo(playheadMs + (e.shiftKey ? 5000 : 1000));
        return;
      }
      if (key === "Home") {
        e.preventDefault();
        seekTo(0);
        return;
      }
      if (key === "End") {
        e.preventDefault();
        seekTo(totalMs);
        return;
      }
      if (key === "Escape") {
        if (fxOpenId) setFxOpenId(null);
        else if (colorPickerId) setColorPickerId(null);
        else if (promptBarOpen) setPromptBarOpen(false);
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        e.preventDefault();
        void deleteSelectedClipOrRecording();
        return;
      }
      if (!sel) return;
      if (key === "m" || key === "M") {
        e.preventDefault();
        setMuted((m) => ({ ...m, [sel]: !m[sel] }));
        return;
      }
      if (key === "s" || key === "S") {
        e.preventDefault();
        setSoloIds((prev) => {
          const next = { ...prev };
          if (next[sel]) delete next[sel];
          else next[sel] = true;
          soloIdsRef.current = next;
          const keys = Object.keys(next).filter((k) => next[k]);
          soloIdRef.current = keys[0] || null;
          setSoloId(soloIdRef.current);
          queueMicrotask(() => applyGains(undefined, true));
          return next;
        });
        return;
      }
      if (key === "l" || key === "L") {
        e.preventDefault();
        nudgePan(sel, -0.15);
        return;
      }
      if (key === "r" || key === "R") {
        if (e.shiftKey) {
          e.preventDefault();
          nudgePan(sel, 0.15);
          return;
        }
        const tr = tracks.find((t) => t.id === sel);
        if (tr?.kind === "vocal") {
          e.preventDefault();
          setArmedTrackId(sel);
          setSelectedTrackId(sel);
        }
        return;
      }
      if (key === "[") {
        e.preventDefault();
        nudgePan(sel, -0.15);
        return;
      }
      if (key === "]") {
        e.preventDefault();
        nudgePan(sel, 0.15);
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrackId, playheadMs, totalMs, playing, fxOpenId, colorPickerId, promptBarOpen, tracks]);

  useEffect(() => {
    return () => {
      stopSources();
      try {
        audioCtxRef.current?.close();
      } catch {
        /* */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // historyTick forces button enabled state to update when stacks change (refs alone don't)
  void historyTick;
  const undoEnabled = takeEditId
    ? takeUndoStackRef.current.length > 0
    : consoleUndoRef.current.length > 0;
  const redoEnabled = takeEditId
    ? takeRedoStackRef.current.length > 0
    : consoleRedoRef.current.length > 0;

  const msToX = (ms: number) => (ms / 1000) * pxPerSec;

  const bg = C.bg || "#0a0a0c";
  const surface = C.surface || "rgba(255,255,255,0.06)";
  const border = C.border || "rgba(255,255,255,0.12)";
  const text = C.text || "#F4F1EC";
  const mutedText = C.textMuted || "#9B96A3";
  const faint = C.textFaint || "#5C5866";
  const brass = C.brass || "#E7A961";

  // Expanded rail must fit labels + M/S/FX without shrinking text (overflow, not scale)
  const sidebarW = sidebarCollapsed ? (isNarrow ? 44 : 56) : isNarrow ? 168 : 200;
  const toggleSidebar = () => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        sessionStorage.setItem("console_sidebar_collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };


  async function pollMusicJob(jobId: string, timeoutMs = 360_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(`/api/music/generate/${jobId}`, { method: "POST" });
      const j = await res.json().catch(() => ({})) as ApiJson;
      if (!res.ok) {
        throw new Error(typeof j.error === "string" ? j.error : "Generation failed");
      }
      const status = String(j.status || j.job?.status || "").toUpperCase();
      if (status === "COMPLETED" || status === "SUCCEEDED" || status === "COMPLETE") return;
      if (status === "FAILED" || status === "CANCELED" || status === "CANCELLED") {
        throw new Error(typeof j.error === "string" ? j.error : "Generation failed");
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    throw new Error("Generation timed out — try again");
  }

  async function generateAiInstrument(instrument: string) {
    if (!projectId || aiInstrumentBusy) return;
    setAiInstrumentBusy(true);
    setAiInstrumentError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/add-instrument`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instrument }),
      });
      const j = await res.json().catch(() => ({})) as ApiJson;
      if (!res.ok) {
        throw new Error(typeof j.error === "string" ? j.error : "Could not start instrument generation");
      }
      const jobId = j.jobId || j.job_id;
      if (!jobId) throw new Error("No job id returned");
      await pollMusicJob(String(jobId));
      setShowAddTrack(false);
      // Reload so the new track appears from session data
      window.location.reload();
    } catch (e) {
      setAiInstrumentError(e instanceof Error ? e.message : "Instrument generation failed");
    } finally {
      setAiInstrumentBusy(false);
    }
  }

  async function buildAroundSelectedVocal() {
    if (!projectId || aiAroundBusy) return;
    const vocalLayer =
      layers.find(
        (l) =>
          l.id !== "beat" &&
          Boolean(l.recordingId) &&
          (l.role === "lead" ||
            l.role === "vocal" ||
            String(l.role || "").includes("harmony") ||
            String(l.role || "").includes("double"))
      ) || layers.find((l) => l.id !== "beat" && Boolean(l.recordingId));
    const recordingId = vocalLayer?.recordingId || undefined;
    setAiAroundBusy(true);
    setAiAroundError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/build-around-vocal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recordingId ? { recordingId } : {}),
      });
      const j = await res.json().catch(() => ({})) as ApiJson;
      if (!res.ok) {
        throw new Error(typeof j.error === "string" ? j.error : "Could not build around vocal");
      }
      const jobId = j.jobId || j.job_id;
      if (!jobId) throw new Error("No job id returned");
      await pollMusicJob(String(jobId));
      window.location.reload();
    } catch (e) {
      setAiAroundError(e instanceof Error ? e.message : "Build around vocal failed");
    } finally {
      setAiAroundBusy(false);
    }
  }


  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        width: "100vw",
        background: bg,
        color: text,
        fontFamily: "system-ui, -apple-system, sans-serif",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          background: surface,
          borderBottom: `1px solid ${border}`,
          paddingTop: "max(8px, env(safe-area-inset-top))",
        }}
      >
      {/* Row 1 — tools. Mobile: minimal transport (no horizontal button dump). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: isNarrow ? 8 : 8,
          padding: isNarrow ? "0 12px" : "0 12px",
          height: isNarrow ? 56 : 56,
          minHeight: isNarrow ? 56 : 56,
          maxHeight: isNarrow ? 56 : 56,
          flexWrap: "nowrap",
          overflowX: "auto",
          overflowY: "hidden",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          boxSizing: "border-box",
        }}
      >
        <a
          href={libraryHref || "/app"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: isNarrow ? 0 : 8,
            textDecoration: "none",
            color: text,
            flexShrink: 0,
            maxWidth: isNarrow ? 36 : 120,
            overflow: "hidden",
            lineHeight: 1,
          }}
          title="Back to Library"
          aria-label="Library"
        >
          <img
            src={STUDIO_LOGO_URL}
            alt=""
            width={28}
            height={28}
            style={{ borderRadius: 8, objectFit: "cover", display: "block", flexShrink: 0 }}
          />
          {!isNarrow && (
            <span
              style={{
                fontWeight: 800,
                fontSize: 12,
                letterSpacing: "0.04em",
                color: brass,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1,
              }}
            >
              CONSOLE
            </span>
          )}
        </a>

        {/* Desktop: title inline */}
        {!isNarrow && (
          <div
            style={{
              flex: 1,
              minWidth: 0,
              maxWidth: 300,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void saveSongTitle()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              aria-label="Song title"
              title={titleDraft}
              placeholder="Song name"
              style={{
                flex: 1,
                minWidth: 0,
                width: "100%",
                height: 36,
                background: "rgba(255,255,255,0.06)",
                border: `1px solid ${titleSavedFlash ? brass : border}`,
                borderRadius: 8,
                color: text,
                fontWeight: 600,
                fontSize: 14,
                padding: "0 10px",
                fontFamily: "inherit",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                lineHeight: 1,
                boxSizing: "border-box",
              }}
            />
            <button
              type="button"
              onClick={() => void saveSongTitle()}
              disabled={titleSaving}
              title="Save song name"
              style={{
                flexShrink: 0,
                height: 32,
                padding: "0 10px",
                borderRadius: 8,
                border: `1px solid ${border}`,
                background: surface,
                color: titleSavedFlash ? brass : mutedText,
                fontSize: 11,
                fontWeight: 700,
                cursor: titleSaving ? "wait" : "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
              }}
            >
              {titleSaving ? "…" : titleSavedFlash ? "Saved" : "Save"}
            </button>
          </div>
        )}

        {/* Mobile: push transport to the right of logo */}
        {isNarrow && <div style={{ flex: 1, minWidth: 4 }} />}

        {/* Undo/redo — desktop only (mobile: header ⋯ menu) */}
        {!isNarrow && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            title="Undo (Ctrl/Cmd+Z)"
            disabled={!undoEnabled}
            onClick={() => consoleUndo()}
            style={{
              ...iconBtn(border, surface, text),
              width: isNarrow ? 34 : 36,
              height: isNarrow ? 34 : 36,
              minWidth: isNarrow ? 34 : 36,
              minHeight: isNarrow ? 34 : 36,
              flexShrink: 0,
              opacity: undoEnabled ? 1 : 0.35,
              cursor: undoEnabled ? "pointer" : "default",
              fontSize: 14,
              fontWeight: 700,
            }}
            aria-label="Undo"
          >
            ↺
          </button>
          <button
            type="button"
            title="Redo (Ctrl/Cmd+Shift+Z)"
            disabled={!redoEnabled}
            onClick={() => consoleRedo()}
            style={{
              ...iconBtn(border, surface, text),
              width: isNarrow ? 34 : 36,
              height: isNarrow ? 34 : 36,
              minWidth: isNarrow ? 34 : 36,
              minHeight: isNarrow ? 34 : 36,
              flexShrink: 0,
              opacity: redoEnabled ? 1 : 0.35,
              cursor: redoEnabled ? "pointer" : "default",
              fontSize: 14,
              fontWeight: 700,
            }}
            aria-label="Redo"
          >
            ↻
          </button>
        </div>
        )}


        {projectId && !isNarrow ? (
          <button
            type="button"
            onClick={() => setSessionsOpen(true)}
            title="AP Sessions — remote collaboration"
            style={{
              flexShrink: 0,
              height: 36,
              minHeight: 36,
              maxHeight: 36,
              padding: "0 12px",
              borderRadius: 999,
              border: `1px solid ${border}`,
              background: "rgba(0,0,0,0.35)",
              color: brass,
              fontWeight: 700,
              fontSize: isNarrow ? 11 : 12,
              cursor: "pointer",
              boxSizing: "border-box",
              whiteSpace: "nowrap",
              fontFamily: "inherit",
            }}
          >
            Sessions
          </button>
        ) : null}

        {projectId ? (
          <button
            type="button"
            onClick={() => setMixerOpen(true)}
            title="Mixer — levels, pan, Mix with AP, Auto-Tune"
            aria-label="Mixer"
            style={{
              ...iconBtn(border, surface, text),
              width: isNarrow ? 34 : 36,
              height: isNarrow ? 34 : 36,
              minWidth: isNarrow ? 34 : 36,
              minHeight: isNarrow ? 34 : 36,
              flexShrink: 0,
              borderRadius: 999,
              border: mixerOpen ? `1px solid ${brass}` : `1px solid ${border}`,
              background: mixerOpen ? "rgba(231,169,97,0.15)" : "rgba(255,255,255,0.06)",
              color: mixerOpen ? brass : text,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 4v16" />
              <path d="M12 8v12" />
              <path d="M18 4v16" />
              <circle cx="6" cy="10" r="2" fill="currentColor" stroke="none" />
              <circle cx="12" cy="14" r="2" fill="currentColor" stroke="none" />
              <circle cx="18" cy="8" r="2" fill="currentColor" stroke="none" />
            </svg>
          </button>
        ) : null}

        {projectId ? (
          <button
            type="button"
            onClick={() => void exportSessionBounce()}
            disabled={exportBusy || produceUi === "producing" || produceUi === "starting"}
            title="Finish and download your mix (timeline, effects, automation). WAV — does not run Produce."
            style={{
              flexShrink: 0,
              height: 36,
              minHeight: 36,
              maxHeight: 36,
              padding: isNarrow ? "0 10px" : "0 12px",
              borderRadius: 999,
              border: `1px solid ${border}`,
              boxSizing: "border-box",
              background: "rgba(255,255,255,0.06)",
              color: text,
              fontWeight: 700,
              fontSize: isNarrow ? 11 : 12,
              cursor: exportBusy ? "default" : "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            {exportBusy ? "Exporting…" : "Export"}
          </button>
        ) : null}

        {projectId ? (
          <button
            type="button"
            onClick={() => void startConsoleProduce()}
            disabled={produceUi === "producing" || produceUi === "starting"}
            title="Let AP produce your song — analysis, mix, and master"
            style={{
              flexShrink: 0,
              height: 36,
              minHeight: 36,
              maxHeight: 36,
              padding: isNarrow ? "0 12px" : "0 14px",
              borderRadius: 999,
              border: "none",
              boxSizing: "border-box",
              background:
                produceUi === "producing"
                  ? "rgba(255,255,255,0.1)"
                  : produceUi === "complete"
                    ? "rgba(52,211,153,0.2)"
                    : `linear-gradient(180deg, #F0BC80, ${brass})`,
              color:
                produceUi === "producing"
                  ? mutedText
                  : produceUi === "complete"
                    ? "#6EE7B7"
                    : "#1A1208",
              fontWeight: 800,
              fontSize: isNarrow ? 12 : 13,
              cursor: produceUi === "producing" || produceUi === "starting" ? "default" : "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
            }}
          >
            {produceUi === "starting"
              ? "Starting…"
              : produceUi === "producing"
                ? "Producing…"
                : produceUi === "complete"
                  ? "Produce again"
                  : produceUi === "failed"
                    ? "Try again"
                    : "Produce"}
          </button>
        ) : null}

        {!isNarrow && (
        <button
          type="button"
          title="Audio interface / microphone"
          onClick={() => setAudioSetupOpen((o) => !o)}
          disabled={isConsoleRecording}
          style={{
            ...iconBtn(border, surface, text),
            width: 36,
            height: 36,
            minWidth: 36,
            minHeight: 36,
            maxHeight: 36,
            flexShrink: 0,
            borderRadius: 999,
            boxSizing: "border-box",
            border: audioSetupOpen ? `1px solid ${brass}` : `1px solid ${border}`,
            color: audioSetupOpen ? brass : mutedText,
            fontSize: 14,
            fontWeight: 700,
          }}
          aria-label="Audio interface"
          aria-expanded={audioSetupOpen}
        >
          🎙
        </button>
        )}
        <button
          type="button"
          title={isConsoleRecording ? "Stop recording" : "Record vocal into selected track (raw capture, same as Booth)"}
          onClick={() => void toggleConsoleRecord()}
          style={{
            ...iconBtn(border, surface, text),
            width: 36,
            height: 36,
            minWidth: 36,
            minHeight: 36,
            maxHeight: 36,
            flexShrink: 0,
            borderRadius: 999,
            boxSizing: "border-box",
            color: "#F07167",
            boxShadow: isConsoleRecording ? "0 0 0 3px rgba(240,113,103,0.35)" : undefined,
            background: isConsoleRecording ? "rgba(240,113,103,0.2)" : undefined,
          }}
          aria-label={isConsoleRecording ? "Stop recording" : "Record vocal"}
        >
          <span
            style={{
              width: isConsoleRecording ? 10 : 12,
              height: isConsoleRecording ? 10 : 12,
              borderRadius: isConsoleRecording ? 2 : 999,
              background: "#F07167",
              display: "inline-block",
            }}
          />
        </button>
        {isConsoleRecording && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#F07167", fontVariantNumeric: "tabular-nums" }}>
              {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, "0")}
            </span>
            {/* Live input level — passive analyser (not in monitor/capture path) */}
            <div
              title="Input level"
              style={{
                width: isNarrow ? 56 : 72,
                height: 8,
                borderRadius: 4,
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: `${Math.round(liveLevel * 100)}%`,
                  height: "100%",
                  borderRadius: 4,
                  background:
                    liveLevel > 0.85
                      ? "#F07167"
                      : liveLevel > 0.35
                        ? brass
                        : "rgba(231,169,97,0.55)",
                  transition: "width 50ms linear",
                }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={togglePlay}
          style={{
            width: isNarrow ? 44 : 36,
            height: isNarrow ? 44 : 36,
            minWidth: isNarrow ? 44 : 36,
            minHeight: isNarrow ? 44 : 36,
            maxHeight: isNarrow ? 44 : 36,
            borderRadius: 999,
            border: "none",
            background: `linear-gradient(180deg, #F0BC80, ${brass})`,
            color: "#1A1208",
            fontWeight: 800,
            fontSize: isNarrow ? 16 : 14,
            cursor: "pointer",
            flexShrink: 0,
            boxSizing: "border-box",
            padding: 0,
            boxShadow: isNarrow ? `0 0 0 3px rgba(231,169,97,0.25)` : undefined,
          }}
          aria-label={
            transportPhase === "preparing"
              ? "Preparing"
              : playing
                ? "Pause"
                : "Play"
          }
          disabled={transportPhase === "preparing"}
          title={
            transportPhase === "preparing"
              ? "Loading essential audio…"
              : playing
                ? "Pause"
                : "Play"
          }
        >
          {transportPhase === "preparing" ? "…" : playing ? "❚❚" : "▶"}
        </button>
        {transportPhase === "preparing" ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: brass,
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            Preparing…
          </span>
        ) : null}

        <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 13, color: mutedText, minWidth: 88, fontWeight: 600 }}>
          {formatPlayhead(playheadMs)}
          {typeof window !== "undefined" &&
          (() => {
            try {
              return window.localStorage?.getItem("studio_console_debug") === "1";
            } catch {
              return false;
            }
          })() ? (
            <span
              style={{
                display: "block",
                fontSize: 10,
                fontFamily: "ui-monospace, monospace",
                color: "#E8A87C",
                marginTop: 2,
                lineHeight: 1.35,
              }}
              title="Dev only: localStorage.studio_console_debug=1"
            >
              {`PH ${Math.round(playheadMs)}ms${playing ? " ▶" : " ⏸"}`}
            </span>
          ) : null}
        </div>

        {!isNarrow && (
        <div
          style={{ fontSize: 12, color: tempoBpm != null ? text : faint, fontWeight: 600, minWidth: 64, padding: "4px 8px", borderRadius: 6, border: `1px solid ${border}`, background: "rgba(255,255,255,0.04)", flexShrink: 0 }}
          title={tempoBpm != null ? "Project tempo" : "BPM not detected for this project yet"}
        >
          {tempoBpm != null && Number.isFinite(tempoBpm) ? `${Math.round(tempoBpm)} BPM` : "— BPM"}
        </div>
        )}

        <button
          type="button"
          onClick={() => {
            setLoopOn((v) => {
              const next = !v;
              if (next) {
                // Prefer selected/armed track as the loop target
                const tid = selectedTrackId || armedTrackId;
                const tr = tid ? tracks.find((x) => x.id === tid) : null;
                if (tr && tr.kind === "vocal") {
                  let s = tr.startMs;
                  let e = tr.endMs;
                  if (selectedClipId && tr.clips?.length) {
                    const clip = tr.clips.find((c) => c.id === selectedClipId);
                    if (clip) {
                      s = clip.startMs;
                      e = clip.endMs;
                    }
                  }
                  const region = {
                    startMs: Math.max(0, s),
                    endMs: Math.max(s + 200, e),
                  };
                  loopRangeRef.current = region;
                  setLoopRange(region);
                  // Jump into the loop if playhead is outside
                  const ph = playheadMsRef.current;
                  if (ph < region.startMs - 20 || ph > region.endMs + 20) {
                    setPlayheadMs(region.startMs);
                    playheadMsRef.current = region.startMs;
                    if (playingRef.current) {
                      void startPlayback(region.startMs);
                    }
                  }
                } else {
                  // No vocal selected — loop full session
                  const region = { startMs: 0, endMs: Math.max(totalMs || 0, 1) };
                  loopRangeRef.current = region;
                  setLoopRange(region);
                }
              } else {
                loopRangeRef.current = null;
                setLoopRange(null);
              }
              return next;
            });
          }}
          style={{
            ...iconBtn(border, surface, text),
            color: loopOn ? brass : text,
            borderColor: loopOn ? brass : border,
            background: loopOn ? "rgba(231,169,97,0.15)" : surface,
          }}
          aria-label={
            loopOn
              ? loopRange && selectedTrackId
                ? "Track loop on"
                : "Session loop on"
              : "Loop off"
          }
          title={
            loopOn
              ? loopRange
                ? `Looping ${formatMs(loopRange.startMs)}–${formatMs(loopRange.endMs)} — click to disable`
                : "Loop on — click to disable"
              : selectedTrackId && selectedTrackId !== "beat"
                ? "Loop selected track"
                : "Loop full session (select a track to loop that part)"
          }
          aria-pressed={loopOn}
        >
          <LoopIcon />
        </button>

        {/* Mobile: one overflow control instead of a scrolling toolbar */}
        {isNarrow && (
          <button
            type="button"
            onClick={() => setHeaderMoreOpen((o) => !o)}
            style={{
              ...iconBtn(border, surface, text),
              width: 36,
              height: 36,
              borderRadius: 999,
              border: headerMoreOpen ? `1px solid ${brass}` : `1px solid ${border}`,
              color: headerMoreOpen ? brass : text,
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: 0.04,
            }}
            aria-label="More tools"
            aria-expanded={headerMoreOpen}
            title="More"
          >
            ⋯
          </button>
        )}

        {!isNarrow && (
          <a
            href={libraryHref || "/app"}
            style={{
              ...iconBtn(border, surface, text),
              textDecoration: "none",
              fontSize: 12,
              fontWeight: 700,
              padding: "0 12px",
              width: "auto",
              minWidth: 72,
              height: 40,
              maxWidth: 100,
              color: text,
              flexShrink: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
            title="Library"
          >
            Library
          </a>
        )}
        {(boothHref || onClose) && !isNarrow && (
          <button
            type="button"
            onClick={() => {
              if (boothHref) window.location.href = boothHref;
              else onClose?.();
            }}
            style={{
              ...iconBtn(border, surface, text),
              width: "auto",
              minWidth: 64,
              height: 40,
              padding: "0 12px",
              fontSize: 12,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
          >
            Booth
          </button>
        )}
      </div>


      {/* Mobile overflow sheet — Sessions, undo, mic, zoom, etc. */}
      {isNarrow && headerMoreOpen && (
        <div
          style={{
            borderBottom: `1px solid ${border}`,
            background: "rgba(12,10,14,0.98)",
            padding: "10px 12px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              disabled={!undoEnabled}
              onClick={() => consoleUndo()}
              style={{ ...iconBtn(border, surface, text), opacity: undoEnabled ? 1 : 0.35 }}
            >
              ↺
            </button>
            <button
              type="button"
              disabled={!redoEnabled}
              onClick={() => consoleRedo()}
              style={{ ...iconBtn(border, surface, text), opacity: redoEnabled ? 1 : 0.35 }}
            >
              ↻
            </button>
            <button
              type="button"
              onClick={() => setAudioSetupOpen((o) => !o)}
              disabled={isConsoleRecording}
              style={{
                ...iconBtn(border, surface, text),
                border: audioSetupOpen ? `1px solid ${brass}` : `1px solid ${border}`,
                color: audioSetupOpen ? brass : text,
              }}
              aria-label="Mic"
            >
              🎙
            </button>
            {projectId ? (
              <button
                type="button"
                onClick={() => {
                  setHeaderMoreOpen(false);
                  setSessionsOpen(true);
                }}
                style={{
                  height: 36,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: `1px solid ${border}`,
                  background: "rgba(0,0,0,0.35)",
                  color: brass,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Sessions
              </button>
            ) : null}
            {(boothHref || onClose) && (
              <button
                type="button"
                onClick={() => {
                  setHeaderMoreOpen(false);
                  if (boothHref) window.location.href = boothHref;
                  else onClose?.();
                }}
                style={{
                  height: 36,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: `1px solid ${border}`,
                  background: surface,
                  color: text,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Booth
              </button>
            )}
            <a
              href={libraryHref || "/app"}
              style={{
                height: 36,
                padding: "0 14px",
                borderRadius: 999,
                border: `1px solid ${border}`,
                background: surface,
                color: text,
                fontWeight: 700,
                fontSize: 12,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Library
            </a>
          </div>
        </div>
      )}

      {/* Row 2 (mobile) — song name + edit dot */}
      {isNarrow && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 12px 10px",
            minHeight: 36,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: titleSavedFlash ? brass : mutedText,
              flexShrink: 0,
              opacity: titleSavedFlash ? 1 : 0.55,
            }}
            title="Edit song name"
          />
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void saveSongTitle()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label="Song title"
            title="Tap to edit song name"
            placeholder="Song name"
            style={{
              flex: 1,
              minWidth: 0,
              height: 32,
              background: "transparent",
              border: "none",
              borderBottom: `1px solid ${titleSavedFlash ? brass : "transparent"}`,
              borderRadius: 0,
              color: text,
              fontWeight: 650,
              fontSize: 15,
              padding: "0 2px",
              fontFamily: "inherit",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.2,
              outline: "none",
            }}
          />
          {titleSaving ? (
            <span style={{ fontSize: 11, color: mutedText, flexShrink: 0 }}>…</span>
          ) : titleSavedFlash ? (
            <span style={{ fontSize: 11, color: brass, fontWeight: 700, flexShrink: 0 }}>Saved</span>
          ) : (
            <span style={{ fontSize: 11, color: faint, flexShrink: 0 }}>edit</span>
          )}
        </div>
      )}
      </div>
      <style>{`
        @keyframes apTrackShimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
        @keyframes apTrackSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      {/* Floating toast — keeps the header clean; errors are short & dismissible */}
      {(editMsg || layers.some((l) => l.uploadFailed)) && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            bottom: "max(20px, env(safe-area-inset-bottom))",
            transform: "translateX(-50%)",
            zIndex: 12000,
            width: "min(420px, calc(100vw - 24px))",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "12px 14px",
              borderRadius: 16,
              background: "rgba(18,18,24,0.94)",
              border: `1px solid ${
                editMsg && /fail|error|could not|denied|missing|not found|busy|permission/i.test(editMsg)
                  ? "rgba(248,113,113,0.45)"
                  : "rgba(255,255,255,0.12)"
              }`,
              boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
              backdropFilter: "blur(12px)",
            }}
          >
            {editMsg && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span
                  style={{
                    marginTop: 3,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: /fail|error|could not|denied|missing|not found|busy|permission/i.test(
                      editMsg
                    )
                      ? "#F87171"
                      : /…$|Building|Exporting|Aligning|Merging|Uploading|Saving/.test(editMsg)
                        ? brass
                        : "#34D399",
                    boxShadow: "0 0 10px currentColor",
                  }}
                />
                <p
                  style={{
                    margin: 0,
                    flex: 1,
                    fontSize: 13,
                    fontWeight: 600,
                    lineHeight: 1.4,
                    color: "#F4F1EC",
                  }}
                >
                  {editMsg}
                </p>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => setEditMsg(null)}
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: "none",
                    background: "rgba(255,255,255,0.06)",
                    color: mutedText,
                    cursor: "pointer",
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            )}
            {layers.some((l) => l.uploadFailed) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {layers
                  .filter((l) => l.uploadFailed)
                  .map((l) => (
                    <React.Fragment key={l.id}>
                      <button
                        type="button"
                        onClick={() => void retryPendingUpload(l.id)}
                        style={{
                          padding: "7px 11px",
                          borderRadius: 999,
                          border: "none",
                          background: brass,
                          color: "#1A1208",
                          fontWeight: 700,
                          fontSize: 11,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Retry · {l.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadPendingTake(l.id)}
                        style={{
                          padding: "7px 11px",
                          borderRadius: 999,
                          border: `1px solid ${brass}88`,
                          background: "transparent",
                          color: brass,
                          fontWeight: 700,
                          fontSize: 11,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Download · {l.label}
                      </button>
                    </React.Fragment>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Track save/FX progress shows on the timeline lane — not in the header */}


      
      {!beatUrl && projectId && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "42%",
            transform: "translate(-50%, -50%)",
            zIndex: 20,
            width: "min(360px, 92vw)",
            padding: 20,
            borderRadius: 16,
            background: surface,
            border: `1px solid ${border}`,
            textAlign: "center",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>Start in Console</div>
          <p style={{ color: mutedText, fontSize: 13, lineHeight: 1.45, marginBottom: 14 }}>
            Upload a beat to run the same AI plan Booth uses, then record vocals here or switch to Booth.
          </p>
          <label
            style={{
              display: "inline-block",
              padding: "12px 18px",
              borderRadius: 999,
              background: `linear-gradient(180deg, #F0BC80, ${brass})`,
              color: "#1A1208",
              fontWeight: 800,
              cursor: planBusy ? "wait" : "pointer",
              opacity: planBusy ? 0.7 : 1,
            }}
          >
            {planBusy ? "Working…" : "Upload beat"}
            <input
              type="file"
              accept="audio/*"
              hidden
              disabled={planBusy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadBeatAndPlan(f);
              }}
            />
          </label>
        </div>
      )}

      {beatUrl && projectId && layers.length === 0 && (
        <div
          style={{
            margin: "8px 12px",
            padding: "12px 14px",
            borderRadius: 12,
            border: `1px solid ${border}`,
            background: surface,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ color: mutedText, fontSize: 13, flex: 1, minWidth: 160 }}>
            Beat loaded — generate a recording plan (same engine as Booth).
          </span>
          <button
            type="button"
            disabled={planBusy}
            onClick={() => void generatePlanOnly()}
            style={{
              padding: "10px 16px",
              borderRadius: 999,
              border: "none",
              background: `linear-gradient(180deg, #F0BC80, ${brass})`,
              color: "#1A1208",
              fontWeight: 800,
              cursor: planBusy ? "wait" : "pointer",
              fontFamily: "inherit",
              opacity: planBusy ? 0.7 : 1,
            }}
          >
            {planBusy ? "Working…" : "Generate plan"}
          </button>
        </div>
      )}



      {audioSetupOpen && (
        <div
          style={{
            flexShrink: 0,
            margin: "0 12px 8px",
            padding: 12,
            borderRadius: 12,
            border: `1px solid ${border}`,
            background: surface,
            maxHeight: "42vh",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: brass }}>
              AUDIO INTERFACE
            </div>
            <button
              type="button"
              onClick={() => setAudioSetupOpen(false)}
              style={{
                border: "none",
                background: "transparent",
                color: mutedText,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12,
              }}
            >
              Close
            </button>
          </div>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: mutedText, lineHeight: 1.4 }}>
            Same capture path as Booth. Select your interface, then Record into the armed track.
          </p>
          <div style={{ fontSize: 11, color: faint, marginBottom: 6 }}>
            Input: {micSummaryLabel(selectedMicId)}
          </div>
          <MicInputPicker
            selectedDeviceId={selectedMicId}
            disabled={isConsoleRecording}
            compact
            onSelect={(id) => {
              setSelectedMicId(id);
              writePreferredMicId(id);
            }}
          />
          <div style={{ height: 12 }} />
          <div style={{ fontSize: 11, color: faint, marginBottom: 6 }}>
            Monitor: {speakerSummaryLabel(selectedSpeakerId)}
          </div>
          <SpeakerOutputPicker
            selectedDeviceId={selectedSpeakerId}
            disabled={isConsoleRecording}
            onSelect={(id) => {
              setSelectedSpeakerId(id);
              writePreferredSpeakerId(id);
            }}
          />
        </div>
      )}


      {/* Shared beat picker for empty state + Add Track when no beat */}
      <input
        ref={beatFileInputRef}
        type="file"
        accept="audio/*"
        hidden
        disabled={planBusy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void uploadBeatAndPlan(f);
        }}
      />

      {/* Suno-style dual scroller: pinned headers | timeline, synced vertical scroll */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "row",
          background: bg,
          overflow: "hidden",
        }}
      >
        {/* LEFT: track headers — collapsible sidebar */}
        <div
          ref={headerScrollRef}
          onScroll={onHeaderScroll}
          style={{
            width: sidebarW,
            minWidth: sidebarW,
            maxWidth: sidebarW,
            flexShrink: 0,
            flexGrow: 0,
            transition: "width 0.15s ease",
            overflowY: "auto",
            overflowX: trackMenu ? "visible" : "hidden",
            WebkitOverflowScrolling: "touch",
            borderRight: `1px solid ${border}`,
            background: bg,
            overscrollBehavior: "contain",
          }}
        >
          <div
            data-console-ruler=""
            style={{
              position: "sticky",
              top: 0,
              zIndex: 5,
              height: TRACK_RULER_H,
              minHeight: TRACK_RULER_H,
              maxHeight: TRACK_RULER_H,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: isNarrow ? "0 4px 0 6px" : "0 8px",
              background: bg,
              borderBottom: `1px solid ${border}`,
              overflow: "visible",
              flexShrink: 0,
            }}
          >
            {/* Collapse always first + flexShrink 0 so it never clips behind badges */}
            <button
              type="button"
              onClick={toggleSidebar}
              style={{
                background: sidebarCollapsed ? "rgba(255,255,255,0.06)" : "rgba(231,169,97,0.12)",
                border: `1px solid ${sidebarCollapsed ? border : brass + "66"}`,
                borderRadius: 8,
                color: sidebarCollapsed ? mutedText : brass,
                cursor: "pointer",
                padding: isNarrow ? "4px 8px" : "4px 10px",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.04em",
                fontFamily: "inherit",
                flexShrink: 0,
                lineHeight: 1,
                minWidth: 36,
              }}
              title={sidebarCollapsed ? "Expand tracks" : "Collapse tracks"}
              aria-label={sidebarCollapsed ? "Expand tracks" : "Collapse tracks"}
            >
              {sidebarCollapsed ? "»" : "«"}
            </button>
            {!sidebarCollapsed && (
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  marginLeft: "auto",
                  flexShrink: 0,
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    color: brass,
                    border: `1px solid ${brass}88`,
                    borderRadius: 6,
                    padding: "3px 6px",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                  title="Console"
                >
                  CONSOLE
                </span>
                {(boothHref || onClose) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (boothHref) window.location.href = boothHref;
                      else onClose?.();
                    }}
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: mutedText,
                      border: `1px solid ${border}`,
                      borderRadius: 6,
                      padding: "3px 6px",
                      background: "transparent",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                    title="Open Booth"
                  >
                    BOOTH
                  </button>
                )}
              </div>
            )}
          </div>
          {tracks.map((tr, trackIdx) => {
            const isMuted = muted[tr.id];
            const isSolo = Boolean(soloIds[tr.id]) || soloId === tr.id;
            const isExpanded = expandedId === tr.id;
            const isTakeEditingSide = takeEditId === tr.id;
            const stackOpen = stackMenuId === tr.id;
            const colorOpen = colorPickerId === tr.id;
            const rowH = trackRowHeight({
              expanded: isExpanded,
              stackOpen,
              colorOpen,
              takeEditing: isTakeEditingSide,
              isNarrow,
              customHeight: trackHeightPx[tr.id] ?? null,
            });
            return (
              <div
                key={`h-${tr.id}`}
                onContextMenu={(e) => openTrackContextMenu(e, tr.id)}
                style={{
                  position: "relative",
                  height: rowH,
                  minHeight: rowH,
                  maxHeight: rowH,
                  boxSizing: "border-box",
                  borderBottom: `1px solid rgba(255,255,255,0.06)`,
                  borderLeft: `2px solid ${tr.color}`,
                  padding: sidebarCollapsed ? "6px 4px" : isExpanded || stackOpen ? "8px 10px" : "6px 8px",
                  background:
                    selectedTrackId === tr.id || armedTrackId === tr.id
                      ? "rgba(255,255,255,0.06)"
                      : isExpanded || stackOpen
                        ? "rgba(255,255,255,0.03)"
                        : "transparent",
                  overflow:
                    stackOpen || colorOpen || trackMenu?.trackId === tr.id
                      ? "visible"
                      : "hidden",
                  zIndex: stackOpen || colorOpen || trackMenu?.trackId === tr.id ? 12 : 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  gap: isNarrow ? 3 : 4,
                  boxShadow:
                    armedTrackId === tr.id ? `inset 0 0 0 1px ${brass}` : undefined,
                  transition: "height 0.15s ease, background 0.15s ease",
                }}
                onClick={
                  sidebarCollapsed
                    ? () => {
                        setSelectedTrackId(tr.id);
                        if (tr.kind === "vocal") setArmedTrackId(tr.id);
                        setExpandedId(tr.id);
                        setSidebarCollapsed(false);
                      }
                    : undefined
                }
              >
                {/* Name row — double-click (or Rename when expanded) to rename vocal tracks */}
                {renamingTrackId === tr.id && tr.kind === "vocal" ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      width: "100%",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        color: faint,
                        fontSize: 10,
                        fontVariantNumeric: "tabular-nums",
                        minWidth: 14,
                        flexShrink: 0,
                      }}
                    >
                      {trackIdx + 1}
                    </span>
                    <input
                      autoFocus
                      value={renameDraft}
                      disabled={renameBusy}
                      maxLength={80}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitRenameTrack();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setRenamingTrackId(null);
                        }
                      }}
                      onBlur={() => void commitRenameTrack()}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13,
                        fontWeight: 700,
                        fontFamily: "inherit",
                        color: text,
                        background: "rgba(255,255,255,0.06)",
                        border: `1px solid ${brass}`,
                        borderRadius: 6,
                        padding: "4px 8px",
                        outline: "none",
                      }}
                      aria-label="Rename track"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      // Toggle expand for sidebar + timeline together (same rowH)
                      if (isExpanded) {
                        setExpandedId(null);
                      } else {
                        setExpandedId(tr.id);
                      }
                      setSelectedTrackId(tr.id);
                      if (tr.kind === "vocal") setArmedTrackId(tr.id);
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      beginRenameTrack(tr);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: text,
                      fontWeight: 700,
                      fontSize: sidebarCollapsed ? 10 : isExpanded ? 14 : 13,
                      lineHeight: 1.25,
                      padding: 0,
                      textAlign: "left",
                      cursor: "pointer",
                      width: "100%",
                      minWidth: 0,
                      height: sidebarCollapsed ? "100%" : undefined,
                      fontFamily: "inherit",
                      display: "flex",
                      flexDirection: sidebarCollapsed ? "column" : "row",
                      alignItems: "center",
                      justifyContent: sidebarCollapsed ? "center" : "flex-start",
                      gap: sidebarCollapsed ? 2 : 6,
                      overflow: "hidden",
                      flexShrink: 0,
                    }}
                    title={tr.label || (tr.kind === "beat" ? "Beat" : "Vocal")}
                  >
                    {!sidebarCollapsed && (
                      <span
                        style={{
                          color: faint,
                          fontSize: 10,
                          fontVariantNumeric: "tabular-nums",
                          minWidth: 14,
                          flexShrink: 0,
                        }}
                      >
                        {trackIdx + 1}
                      </span>
                    )}
                    <span
                      style={
                        sidebarCollapsed
                          ? {
                              writingMode: "vertical-rl",
                              transform: "rotate(180deg)",
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: 0.04,
                              color: text,
                              maxHeight: "100%",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              lineHeight: 1.1,
                            }
                          : {
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              flex: 1,
                              minWidth: 0,
                            }
                      }
                    >
                      {tr.label || (tr.kind === "beat" ? "Beat" : "Vocal")}
                    </span>
                    {!sidebarCollapsed &&
                      (isExpanded ? (
                        <span style={{ color: faint, fontSize: 10, flexShrink: 0 }}>▾</span>
                      ) : (
                        <span style={{ color: faint, fontSize: 10, flexShrink: 0 }}>▸</span>
                      ))}
                  </button>
                )}
                {!sidebarCollapsed && tr.sub && isExpanded && renamingTrackId !== tr.id ? (
                  <div
                    style={{
                      fontSize: 11,
                      color: faint,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "100%",
                      paddingLeft: 20,
                      flexShrink: 0,
                    }}
                  >
                    {tr.sub}
                  </div>
                ) : null}
                {/* rename: double-click title or ⋮ → Rename — keeps expander compact */}
                {!sidebarCollapsed ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 2,
                    width: "100%",
                    minWidth: 0,
                    flexShrink: 0,
                  }}
                >
                  {/* Volume — primary Suno-style control */}
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={fxById[tr.id]?.gainDb ?? 0}
                    aria-label={`Volume ${tr.label}`}
                    title={`Gain ${(fxById[tr.id]?.gainDb ?? 0) >= 0 ? "+" : ""}${(fxById[tr.id]?.gainDb ?? 0).toFixed(1)} dB`}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelectedTrackId(tr.id);
                    }}
                    onInput={(e) => {
                      setSelectedTrackId(tr.id);
                      setGain(tr.id, parseFloat((e.target as HTMLInputElement).value), false);
                    }}
                    onChange={(e) => {
                      setSelectedTrackId(tr.id);
                      setGain(tr.id, parseFloat(e.target.value), false);
                    }}
                    onPointerUp={(e) => {
                      setSelectedTrackId(tr.id);
                      setGain(tr.id, parseFloat((e.target as HTMLInputElement).value), true);
                    }}
                    onMouseUp={(e) => {
                      setSelectedTrackId(tr.id);
                      setGain(tr.id, parseFloat((e.target as HTMLInputElement).value), true);
                    }}
                    onTouchEnd={(e) => {
                      const el = e.target as HTMLInputElement;
                      setSelectedTrackId(tr.id);
                      setGain(tr.id, parseFloat(el.value), true);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setSelectedTrackId(tr.id);
                      setGain(tr.id, 0, true);
                    }}
                    style={{
                      flex: 1,
                      minWidth: 48,
                      maxWidth: 110,
                      height: 28,
                      margin: 0,
                      accentColor: brass,
                      cursor: "pointer",
                      touchAction: "none",
                    }}
                  />
                  <button
                    type="button"
                    title={isMuted ? "Unmute" : "Mute"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMuted((m) => {
                        const next = { ...m, [tr.id]: !m[tr.id] };
                        mutedRef.current = next;
                        // Apply immediately so the in-flight RAF loop cannot un-mute
                        queueMicrotask(() => applyGains(undefined, true));
                        return next;
                      });
                    }}
                    style={{ ...miniChip(border, brass, isMuted, text, true), fontSize: 10 }}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    title={isSolo ? "Unsolo (multi-solo supported)" : "Solo — click multiple tracks to solo several"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSoloIds((prev) => {
                        const next = { ...prev };
                        if (next[tr.id]) delete next[tr.id];
                        else next[tr.id] = true;
                        soloIdsRef.current = next;
                        const keys = Object.keys(next).filter((k) => next[k]);
                        soloIdRef.current = keys.length === 1 ? keys[0] : keys.length ? keys[0] : null;
                        setSoloId(soloIdRef.current);
                        queueMicrotask(() => applyGains(undefined, true));
                        return next;
                      });
                    }}
                    style={miniChip(border, brass, isSolo, text, true)}
                  >
                    S
                  </button>
                    <div
                      role="separator"
                      aria-label="Resize track height"
                      title="Drag to resize track height"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                        const startH = trackHeightPx[tr.id] || rowH;
                        heightDragRef.current = { id: tr.id, startY: e.clientY, startH };
                        const onMove = (ev: PointerEvent) => {
                          const d = heightDragRef.current;
                          if (!d) return;
                          ev.preventDefault();
                          const next = d.startH + (ev.clientY - d.startY);
                          setTrackHeightPx((prev) => ({
                            ...prev,
                            [d.id]: Math.max(64, Math.min(560, next)),
                          }));
                        };
                        const onUp = (ev: PointerEvent) => {
                          heightDragRef.current = null;
                          try {
                            (e.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
                          } catch {
                            /* */
                          }
                          window.removeEventListener("pointermove", onMove);
                          window.removeEventListener("pointerup", onUp);
                          window.removeEventListener("pointercancel", onUp);
                        };
                        window.addEventListener("pointermove", onMove, { passive: false });
                        window.addEventListener("pointerup", onUp);
                        window.addEventListener("pointercancel", onUp);
                      }}
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: isNarrow ? 22 : 14,
                        cursor: "ns-resize",
                        touchAction: "none",
                        zIndex: 8,
                        background: isNarrow
                          ? "linear-gradient(180deg, transparent, rgba(240,188,128,0.18))"
                          : "linear-gradient(180deg, transparent, rgba(255,255,255,0.08))",
                      }}
                    />
                  {/* ⋮ overflow — opens fixed menu (not clipped by row) */}
                  <button
                    type="button"
                    title="More track actions"
                    aria-label="More track actions"
                    aria-expanded={trackMenu?.trackId === tr.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTrackId(tr.id);
                      if (trackMenu?.trackId === tr.id) {
                        setTrackMenu(null);
                        return;
                      }
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const menuW = 200;
                      const menuH = 360;
                      const x = Math.min(
                        r.left,
                        (typeof window !== "undefined" ? window.innerWidth : 400) - menuW - 8
                      );
                      const y = Math.min(
                        r.bottom + 4,
                        (typeof window !== "undefined" ? window.innerHeight : 600) - menuH - 8
                      );
                      setTrackMenu({ trackId: tr.id, x: Math.max(8, x), y: Math.max(8, y) });
                      setStackMenuId(null);
                      setColorPickerId(null);
                    }}
                    style={{
                      ...miniChip(border, brass, trackMenu?.trackId === tr.id, text, true),
                      width: 24,
                      fontSize: 14,
                      letterSpacing: 0.02,
                      lineHeight: 1,
                    }}
                  >
                    ⋮
                  </button>
                </div>
                ) : null}

                {colorPickerId === tr.id && !sidebarCollapsed && (
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                    }}
                  >
                    {TRACK_COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => void persistColor(tr.id, c)}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          border: tr.color === c ? `2px solid ${text}` : `1px solid ${border}`,
                          background: c,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      />
                    ))}
                  </div>
                )}

                                {stackMenuId === tr.id && tr.kind === "vocal" && !sidebarCollapsed && (
                  <div
                    role="menu"
                    aria-label="Stack and choir options"
                    style={{
                      marginTop: 6,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      padding: 8,
                      borderRadius: 8,
                      background: "rgba(12,10,8,0.95)",
                      border: `1px solid ${brass}`,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                      flexShrink: 0,
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 700, color: brass, letterSpacing: 0.04, marginBottom: 2 }}>
                      STACK / CHOIR
                    </div>
                    {(
                      [
                        ["double", "Double"],
                        ["chorus_lift", "Chorus lift"],
                        ["choir_light", "Choir light"],
                        ["choir_full", "Choir full"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={savingId === tr.id}
                        onClick={() => {
                          setStackMenuId(null);
                          void makeChoir(tr.id, mode);
                        }}
                        style={{
                          textAlign: "left",
                          padding: "6px 8px",
                          borderRadius: 6,
                          border: "none",
                          background: "transparent",
                          color: text,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

              </div>
            );
          })}
        </div>

        {/* RIGHT: timeline — horizontal + vertical scroll (vertical synced with headers) */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            position: "relative",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
        <div
          ref={timelineScrollRef}
          onScroll={onTimelineScroll}
          title="Scroll on ruler or Ctrl/⌘+scroll to zoom"
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflowX: "auto",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
            position: "relative",
            touchAction: "pan-x pan-y",
          }}
        >
          <div
            style={{
              width: timelineW,
              minWidth: timelineW,
              position: "relative",
              boxSizing: "border-box",
              // Suno-style vertical grid: subtle column lines under clips
              backgroundImage: `repeating-linear-gradient(
                90deg,
                transparent,
                transparent calc(${pxPerSec}px - 1px),
                rgba(255,255,255,0.045) calc(${pxPerSec}px - 1px),
                rgba(255,255,255,0.045) ${pxPerSec}px
              )`,
              backgroundSize: `${pxPerSec}px 100%`,
            }}
          >
            <div
              data-console-ruler=""
              style={{
                position: "sticky",
                top: 0,
                zIndex: 6,
                height: TRACK_RULER_H,
                width: timelineW,
                minWidth: timelineW,
                borderBottom: `1px solid ${border}`,
                background: surface,
                cursor: "ew-resize",
                touchAction: "none",
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                try {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                } catch {
                  /* */
                }
                seekFromClientX(e.clientX);
              }}
              onPointerMove={(e) => {
                if (e.pointerType === "mouse" && (e.buttons & 1) === 0) return;
                seekFromClientX(e.clientX);
              }}
              onClick={(e) => {
                seekFromClientX(e.clientX);
              }}
            >
              {sections.map((s) => (
                <div
                  key={s.id}
                  title={s.label}
                  style={{
                    position: "absolute",
                    left: msToX(s.startMs),
                    width: Math.max(8, msToX(s.endMs) - msToX(s.startMs)),
                    top: 6,
                    height: 28,
                    borderRadius: 8,
                    background: "rgba(231,169,97,0.22)",
                    border: `1.5px solid ${brass}`,
                    fontSize: 11,
                    fontWeight: 700,
                    color: text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    padding: "5px 8px",
                    boxSizing: "border-box",
                  }}
                >
                  {s.label}
                </div>
              ))}
            </div>

            {tracks.map((tr) => {
              const expanded = expandedId === tr.id;
              const dimmed = !isAudible(tr.id, tr.kind);
              const isMock = tr.kind === "vocal" && !tr.url && !peaksById[tr.id];
              const isArmed = armedTrackId === tr.id && tr.kind === "vocal";
              const isLiveRec =
                isConsoleRecording &&
                consoleRecRef.current?.taskId === tr.id &&
                tr.kind === "vocal";
              // DAW-style: live region grows from playhead where Record was pressed
              const liveRecStartMs = isLiveRec
                ? Math.max(0, consoleRecRef.current?.recordStartMs ?? playheadMs)
                : tr.startMs;
              const liveEndMs = isLiveRec
                ? liveRecStartMs + Math.max(400, recordSeconds * 1000)
                : tr.endMs;
              const displayEndMs = isLiveRec ? liveEndMs : tr.endMs;
              const isTakeEditing = takeEditId === tr.id;
              const stackOpen = stackMenuId === tr.id;
              const colorOpen = colorPickerId === tr.id;
              const multiClips =
                tr.kind === "vocal" && tr.clips && tr.clips.length > 1 ? tr.clips : null;
              const primaryClip = multiClips ? multiClips[0] : null;
              const clipStartMs = isLiveRec
                ? liveRecStartMs
                : primaryClip
                  ? primaryClip.startMs
                  : tr.startMs;
              const clipEndMs = isLiveRec
                ? displayEndMs
                : primaryClip
                  ? primaryClip.endMs
                  : displayEndMs;
              const dragKey =
                multiClips && primaryClip
                  ? `${tr.id}::${primaryClip.id}`
                  : tr.id;
              const clipW = Math.max(10, msToX(clipEndMs) - msToX(clipStartMs));
              const rowH = trackRowHeight({
                expanded,
                stackOpen,
                colorOpen,
                takeEditing: isTakeEditing,
                isNarrow,
                customHeight: trackHeightPx[tr.id] ?? null,
              });
              // Waveform/clip fills most of the row — expand grows the visual, not empty chrome
              const clipH = isTakeEditing
                ? Math.min(Math.max(48, rowH - 16), rowH - 12)
                : Math.min(Math.max(expanded || trackHeightPx[tr.id] ? 40 : 28, rowH - 14), rowH - 10);
              return (
                <div
                  key={`tl-${tr.id}`}
                  style={{
                    position: "relative",
                    height: rowH,
                    minHeight: rowH,
                    maxHeight: rowH,
                    width: timelineW,
                    minWidth: timelineW,
                    boxSizing: "border-box",
                    borderBottom: `1px solid rgba(255,255,255,0.055)`,
                    background:
                      selectedTrackId === tr.id || isArmed
                        ? "rgba(255,255,255,0.035)"
                        : "transparent",
                  }}
                  onContextMenu={(e) => openTrackContextMenu(e, tr.id)}
                  onClick={(e) => {
                    // Empty lane / background — place playhead like a DAW
                    seekFromClientX(e.clientX);
                    setSelectedTrackId(tr.id);
                    if (tr.kind === "vocal") setArmedTrackId(tr.id);
                  }}
                >
                  {trackBusy[tr.id] ? (
                    <div
                      aria-live="polite"
                      aria-busy="true"
                      style={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 40,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        pointerEvents: "none",
                        overflow: "hidden",
                        borderRadius: 4,
                        background:
                          "linear-gradient(90deg, rgba(8,8,12,0.55) 0%, rgba(18,18,28,0.72) 50%, rgba(8,8,12,0.55) 100%)",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background:
                            "linear-gradient(110deg, transparent 25%, rgba(231,169,97,0.14) 45%, rgba(123,235,212,0.12) 55%, transparent 75%)",
                          backgroundSize: "200% 100%",
                          animation: "apTrackShimmer 1.4s ease-in-out infinite",
                        }}
                      />
                      <div
                        style={{
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 14px",
                          borderRadius: 999,
                          background: "rgba(12,12,18,0.88)",
                          border: `1px solid rgba(231,169,97,0.35)`,
                          boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
                        }}
                      >
                        <span
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            border: "2px solid rgba(231,169,97,0.25)",
                            borderTopColor: brass,
                            animation: "apTrackSpin 0.7s linear infinite",
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#F4F1EC",
                            letterSpacing: "0.02em",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {trackBusy[tr.id]}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <div
                    data-layer-id={tr.id}
                    style={{
                      position: "absolute",
                      left: msToX(clipStartMs),
                      width: clipW,
                      top: expanded ? 12 : 8,
                      height: clipH,
                      borderRadius: 10,
                      background: isLiveRec
                        ? `linear-gradient(180deg, ${tr.color}ee, ${tr.color})`
                        : `linear-gradient(180deg, ${tr.color}f2, ${tr.color}d9)`,
                      border: `1px solid rgba(255,255,255,0.12)`,
                      boxShadow: isLiveRec
                        ? `0 0 0 2px #F07167, 0 0 16px ${tr.color}aa`
                        : isArmed
                          ? `0 0 0 2px ${brass}, 0 0 14px ${brass}99`
                          : selectedTrackId === tr.id
                            ? `0 0 0 2px #fff, 0 0 12px ${tr.color}88`
                            : `0 1px 0 rgba(0,0,0,0.35)`,
                      overflow: "hidden",
                      cursor: tr.kind === "vocal" ? (isTakeEditing ? "col-resize" : "grab") : "default",
                      touchAction: "none",
                      opacity: dimmed ? 0.4 : 1,
                      outline: isTakeEditing
                        ? `2px solid ${brass}`
                        : isArmed && !isLiveRec
                          ? `1px dashed ${brass}`
                          : undefined,
                    }}
                    onContextMenu={(e) =>
                      openTrackContextMenu(e, tr.id, primaryClip?.id || null)
                    }
                    onPointerDown={
                      tr.kind === "vocal"
                        ? (e) => {
                            // Long-press alternative is contextmenu event on most browsers
                            setSelectedTrackId(tr.id);
                            setArmedTrackId(tr.id);
                            if (isTakeEditing && takeDurationMs > 0) {
                              e.stopPropagation();
                              e.preventDefault();
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
                              const ms = x * takeDurationMs;
                              takeSelDragRef.current = {
                                mode: "create",
                                originX: e.clientX,
                                originStart: ms,
                                originEnd: ms,
                              };
                              setTakeSel({ startMs: ms, endMs: ms });
                              try {
                                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                              } catch {
                                /* */
                              }
                              return;
                            }
                            // Allow drag even before waveform URL resolves (uploaded takes).
                            if (!isLiveRec) {
                              onClipPointerDown(
                                e,
                                dragKey,
                                "move",
                                clipStartMs,
                                clipEndMs
                              );
                              if (primaryClip) setSelectedClipId(primaryClip.id);
                            }
                          }
                        : () => setSelectedTrackId(tr.id)
                    }
                    onPointerMove={
                      isTakeEditing
                        ? (e) => {
                            const d = takeSelDragRef.current;
                            if (!d || takeDurationMs <= 0) return;
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
                            const ms = x * takeDurationMs;
                            setTakeSel({
                              startMs: Math.min(d.originStart, ms),
                              endMs: Math.max(d.originStart, ms),
                            });
                          }
                        : onClipPointerMove
                    }
                    onPointerUp={
                      isTakeEditing
                        ? () => {
                            takeSelDragRef.current = null;
                            setTakeSel((sel) =>
                              sel && takeDurationMs > 0 ? normalizeRegion(sel, takeDurationMs) : sel
                            );
                          }
                        : onClipPointerUp
                    }
                    onPointerCancel={
                      isTakeEditing
                        ? () => {
                            takeSelDragRef.current = null;
                          }
                        : onClipPointerUp
                    }
                  >
                    {isLiveRec ? (
                      <LiveClipWave
                        peaks={livePeaks}
                        color={tr.color}
                        width={clipW}
                        height={clipH}
                      />
                    ) : (
                      <WaveformCanvas
                        peaks={
                          peaksById[primaryClip?.id || tr.id] ||
                          peaksById[tr.id] ||
                          null
                        }
                        color={tr.color}
                        width={clipW}
                        height={clipH}
                        dimmed={dimmed}
                        offsetMs={
                          primaryClip?.offsetMs ?? tr.mediaOffsetMs ?? 0
                        }
                        durationMs={Math.max(50, clipEndMs - clipStartMs)}
                        sourceDurationMs={(() => {
                          const url = primaryClip?.audioUrl || tr.url;
                          const buf = url ? bufferCache.get(url) : null;
                          if (buf && buf.duration > 0.05)
                            return Math.round(buf.duration * 1000);
                          const off = primaryClip?.offsetMs ?? tr.mediaOffsetMs ?? 0;
                          return Math.max(off + (clipEndMs - clipStartMs), 1000);
                        })()}
                        selected={
                          selectedTrackId === tr.id ||
                          selectedClipId === (primaryClip?.id || null)
                        }
                      />
                    )}
                    {/* Name on clip only when side editor is open (collapsed uses vertical rail name) */}
                    {!sidebarCollapsed && (
                      <div
                        style={{
                          position: "absolute",
                          left: 8,
                          top: 0,
                          bottom: 0,
                          maxWidth: "72%",
                          display: "flex",
                          alignItems: "center",
                          fontSize: clipH >= 40 ? 12 : 10,
                          fontWeight: 800,
                          letterSpacing: 0.01,
                          color: "rgba(255,255,255,0.95)",
                          textShadow:
                            "0 1px 2px rgba(0,0,0,0.65), 0 0 8px rgba(0,0,0,0.35)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          pointerEvents: "none",
                          zIndex: 2,
                          paddingRight: 8,
                        }}
                      >
                        {tr.label || (tr.kind === "beat" ? "Beat" : "Vocal")}
                      </div>
                    )}
                    {/* Region selection on the same recording waveform */}
                    {isTakeEditing && takeSel && takeDurationMs > 0 ? (
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: `${(Math.min(takeSel.startMs, takeSel.endMs) / takeDurationMs) * 100}%`,
                          width: `${(Math.abs(takeSel.endMs - takeSel.startMs) / takeDurationMs) * 100}%`,
                          background: "rgba(231,169,97,0.32)",
                          borderLeft: `2px solid #fff`,
                          borderRight: `2px solid #fff`,
                          boxShadow: "inset 0 0 0 1px rgba(231,169,97,0.8)",
                          pointerEvents: "none",
                          zIndex: 3,
                        }}
                      />
                    ) : null}
                    {tr.kind === "vocal" && !isTakeEditing && (
                      <>
                        <ClipEdgeHandle
                          side="start"
                          wide={isNarrow}
                          onPointerDown={(e) =>
                            onClipPointerDown(e, dragKey, "trim-start", clipStartMs, clipEndMs)
                          }
                        />
                        <ClipEdgeHandle
                          side="end"
                          wide={isNarrow}
                          onPointerDown={(e) =>
                            onClipPointerDown(e, dragKey, "trim-end", clipStartMs, clipEndMs)
                          }
                        />
                      </>
                    )}
                  </div>
                  {/* Additional split clips on the same track lane */}
                  {multiClips
                    ? multiClips.slice(1).map((clip) => {
                        const cW = Math.max(
                          10,
                          msToX(clip.endMs) - msToX(clip.startMs)
                        );
                        const cKey = `${tr.id}::${clip.id}`;
                        return (
                          <div
                            key={cKey}
                            data-layer-id={tr.id}
                            data-clip-id={clip.id}
                            style={{
                              position: "absolute",
                              left: msToX(clip.startMs),
                              width: cW,
                              top: expanded ? 12 : 8,
                              height: clipH,
                              borderRadius: 10,
                              background: `linear-gradient(180deg, ${tr.color}f2, ${tr.color}d9)`,
                              border: `1px solid rgba(255,255,255,0.12)`,
                              boxShadow:
                                selectedClipId === clip.id
                                  ? `0 0 0 2px #fff, 0 0 12px ${tr.color}88`
                                  : `0 1px 0 rgba(0,0,0,0.35)`,
                              overflow: "hidden",
                              cursor: "grab",
                              touchAction: "none",
                              opacity: dimmed ? 0.4 : 1,
                            }}
                            onContextMenu={(e) => openTrackContextMenu(e, tr.id, clip.id)}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setSelectedTrackId(tr.id);
                              setSelectedClipId(clip.id);
                              setArmedTrackId(tr.id);
                              onClipPointerDown(
                                e,
                                cKey,
                                "move",
                                clip.startMs,
                                clip.endMs
                              );
                            }}
                            onPointerMove={onClipPointerMove}
                            onPointerUp={onClipPointerUp}
                            onPointerCancel={onClipPointerUp}
                          >
                            <WaveformCanvas
                              peaks={peaksById[clip.id] || peaksById[tr.id] || null}
                              color={tr.color}
                              width={cW}
                              height={clipH}
                              dimmed={dimmed}
                              offsetMs={clip.offsetMs || 0}
                              durationMs={Math.max(50, clip.endMs - clip.startMs)}
                              sourceDurationMs={(() => {
                                const url = clip.audioUrl || tr.url;
                                const buf = url ? bufferCache.get(url) : null;
                                if (buf && buf.duration > 0.05)
                                  return Math.round(buf.duration * 1000);
                                return Math.max(
                                  (clip.offsetMs || 0) + (clip.endMs - clip.startMs),
                                  1000
                                );
                              })()}
                              selected={selectedClipId === clip.id}
                            />
                            <ClipEdgeHandle
                              side="start"
                              wide={isNarrow}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                onClipPointerDown(
                                  e,
                                  cKey,
                                  "trim-start",
                                  clip.startMs,
                                  clip.endMs
                                );
                              }}
                            />
                            <ClipEdgeHandle
                              side="end"
                              wide={isNarrow}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                onClipPointerDown(
                                  e,
                                  cKey,
                                  "trim-end",
                                  clip.startMs,
                                  clip.endMs
                                );
                              }}
                            />
                          </div>
                        );
                      })
                    : null}
                  {isTakeEditing ? (
                    <div
                      style={{
                        position: "absolute",
                        left: msToX(tr.startMs),
                        top: (expanded ? 12 : 8) + clipH + 6,
                        width: Math.max(clipW, 280),
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 6,
                        zIndex: 6,
                        padding: "4px 6px",
                        borderRadius: 8,
                        background: "rgba(12,12,16,0.92)",
                        border: `1px solid ${brass}`,
                        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <span style={{ fontSize: 10, fontWeight: 800, color: brass, marginRight: 4 }}>
                        EDIT
                        {retakeTarget ? " · RETAKE" : ""}
                      </span>
                      <button type="button" onClick={playTakeSelection}
                        style={{ height: 28, padding: "0 10px", borderRadius: 999, border: `1px solid ${border}`, background: "rgba(255,255,255,0.08)", color: text, fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                        ▶
                      </button>
                      <button type="button" disabled={!isValidRegion(takeSel, takeDurationMs) || takeEditBusy}
                        onClick={applyTakeDelete}
                        style={{ height: 28, padding: "0 10px", borderRadius: 999, border: "1px solid rgba(240,113,103,0.45)", background: "rgba(240,113,103,0.12)", color: "#F07167", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit", opacity: isValidRegion(takeSel, takeDurationMs) ? 1 : 0.4 }}>
                        Delete
                      </button>
                      <button type="button" disabled={!isValidRegion(takeSel, takeDurationMs) || takeEditBusy}
                        onClick={applyTakeKeep}
                        style={{ height: 28, padding: "0 10px", borderRadius: 999, border: `1px solid ${border}`, background: "rgba(255,255,255,0.08)", color: text, fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit", opacity: isValidRegion(takeSel, takeDurationMs) ? 1 : 0.4 }}>
                        Keep
                      </button>
                      <button type="button" disabled={!isValidRegion(takeSel, takeDurationMs) || takeEditBusy || isConsoleRecording}
                        onClick={startRetakeRegion}
                        style={{ height: 28, padding: "0 10px", borderRadius: 999, border: `1px solid ${brass}`, background: retakeTarget ? "rgba(231,169,97,0.22)" : "rgba(255,255,255,0.06)", color: brass, fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "inherit", opacity: isValidRegion(takeSel, takeDurationMs) ? 1 : 0.4 }}>
                        Retake
                      </button>
                      <button type="button" disabled={takeUndoDepth === 0 || takeEditBusy}
                        onClick={undoTakeEdit}
                        style={{ height: 28, padding: "0 10px", borderRadius: 999, border: `1px solid ${border}`, background: "rgba(255,255,255,0.08)", color: text, fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                        Undo
                      </button>
                      <button type="button" disabled={takeRedoStackRef.current.length === 0 || takeEditBusy}
                        onClick={redoTakeEdit}
                        style={{ height: 28, padding: "0 10px", borderRadius: 999, border: `1px solid ${border}`, background: "rgba(255,255,255,0.08)", color: text, fontWeight: 700, fontSize: 11, cursor: takeRedoStackRef.current.length ? "pointer" : "default", fontFamily: "inherit", opacity: takeRedoStackRef.current.length ? 1 : 0.4 }}>
                        Redo
                      </button>
                      <button type="button" onClick={cancelTakeEdit} disabled={takeEditBusy}
                        style={{ height: 28, padding: "0 10px", borderRadius: 999, border: `1px solid ${border}`, background: "transparent", color: mutedText, fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                        Cancel
                      </button>
                      <button type="button" onClick={() => void commitTakeEdit()} disabled={takeEditBusy}
                        style={{ height: 28, padding: "0 12px", borderRadius: 999, border: "none", background: `linear-gradient(180deg, #F0BC80, ${brass})`, color: "#1A1208", fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                        {takeEditBusy ? "…" : "Done"}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {/* Loop region highlight (selected track or session) */}
            {loopOn && loopRange ? (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  top: TRACK_RULER_H,
                  bottom: 0,
                  left: msToX(loopRange.startMs),
                  width: Math.max(2, msToX(loopRange.endMs) - msToX(loopRange.startMs)),
                  background: "rgba(231,169,97,0.08)",
                  borderLeft: `1px solid ${brass}`,
                  borderRight: `1px solid ${brass}`,
                  pointerEvents: "none",
                  zIndex: 4,
                }}
              />
            ) : null}
            {/* Single full-height playhead — one line through ruler + every track */}
            <div
              ref={playheadElRef}
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: 0,
                zIndex: 25,
                pointerEvents: "none",
                willChange: "transform",
              }}
            >
              {/* Triangle head on the ruler */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: -6,
                  width: 0,
                  height: 0,
                  borderLeft: "6px solid transparent",
                  borderRight: "6px solid transparent",
                  borderTop: "9px solid #F07167",
                  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))",
                }}
              />
              {/* Crisp 2px line */}
              <div
                style={{
                  position: "absolute",
                  top: 8,
                  bottom: 0,
                  left: -1,
                  width: 2,
                  background: "linear-gradient(180deg, #F07167 0%, #E85A52 100%)",
                  boxShadow: "0 0 0 1px rgba(240,113,103,0.25), 0 0 10px rgba(240,113,103,0.45)",
                  borderRadius: 1,
                }}
              />
            </div>
          </div>
        </div>

        {/* Zoom dock — bottom of timeline (Riffle-style): slider + buttons + fit */}
        <div
          style={{
            position: "absolute",
            left: isNarrow ? 8 : 12,
            bottom: isNarrow ? 8 : 12,
            zIndex: 28,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: isNarrow ? "6px 8px" : "8px 10px",
            borderRadius: 999,
            background: "rgba(18, 18, 24, 0.92)",
            border: `1px solid ${border}`,
            boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            pointerEvents: "auto",
            maxWidth: "calc(100% - 24px)",
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => applyTimelineZoom(0.85, (timelineScrollRef.current?.getBoundingClientRect().left || 0) + 40)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              border: "none",
              background: "transparent",
              color: text,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              fontSize: 18,
              lineHeight: 1,
              flexShrink: 0,
              opacity: pxPerSec <= 8 ? 0.35 : 1,
            }}
          >
            −
          </button>
          <input
            type="range"
            min={8}
            max={160}
            step={1}
            value={Math.round(pxPerSec)}
            aria-label="Timeline zoom"
            onChange={(e) => {
              const next = Math.max(8, Math.min(160, Number(e.target.value) || 56));
              const el = timelineScrollRef.current;
              if (!el) {
                setPxPerSec(next);
                return;
              }
              const rect = el.getBoundingClientRect();
              const centerX = rect.left + rect.width / 2;
              const cursorX = centerX - rect.left;
              const timeSec = (el.scrollLeft + cursorX) / Math.max(1e-6, pxPerSec);
              setPxPerSec(next);
              requestAnimationFrame(() => {
                const sc = timelineScrollRef.current;
                if (!sc) return;
                sc.scrollLeft = Math.max(0, timeSec * next - cursorX);
                const h = headerScrollRef.current;
                if (h) h.scrollLeft = sc.scrollLeft;
              });
            }}
            style={{
              width: isNarrow ? 88 : 120,
              height: 28,
              margin: 0,
              accentColor: brass,
              cursor: "pointer",
              flexShrink: 1,
              minWidth: 64,
            }}
          />
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => applyTimelineZoom(1.15, (timelineScrollRef.current?.getBoundingClientRect().left || 0) + 40)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              border: "none",
              background: "transparent",
              color: text,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              fontSize: 18,
              lineHeight: 1,
              flexShrink: 0,
              opacity: pxPerSec >= 160 ? 0.35 : 1,
            }}
          >
            +
          </button>
          <div
            style={{
              width: 1,
              height: 18,
              background: border,
              margin: "0 2px",
              flexShrink: 0,
            }}
          />
          <button
            type="button"
            aria-label="Fit to view"
            title="Fit song to view"
            onClick={() => fitTimelineToView()}
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              border: "none",
              background: "transparent",
              color: text,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <FitViewIcon />
          </button>
        </div>
        </div>
      </div>

      {layers.length === 0 && (
        <div
          style={{
            position: "absolute",
            left: 140,
            top: 120,
            margin: 16,
            padding: 16,
            borderRadius: 14,
            border: `1px dashed ${border}`,
            color: mutedText,
            fontSize: 14,
            lineHeight: 1.5,
            maxWidth: 420,
            zIndex: 5,
            pointerEvents: "none",
          }}
        >
          <strong style={{ color: text }}>No vocal layers yet</strong>
          <p style={{ margin: "8px 0 0" }}>
            Upload a beat to generate a plan, then Record Vocal here — same capture path as Booth. Or open Booth for guided flow.
          </p>
        </div>
      )}



      {/* Produce status — compact, non-blocking */}
      
{projectId && produceUi !== "idle" ? (
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            top: isNarrow ? 88 : 64,
            zIndex: 35,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <style>{`@keyframes apShimmer { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }`}</style>
          <div
            style={{
              pointerEvents: "auto",
              width: "100%",
              maxWidth: 420,
              borderRadius: 14,
              padding: "12px 14px",
              background: "rgba(18,18,24,0.94)",
              border: `1px solid ${
                produceUi === "failed"
                  ? "rgba(240,113,103,0.35)"
                  : produceUi === "complete"
                    ? "rgba(52,211,153,0.35)"
                    : "rgba(231,169,97,0.35)"
              }`,
              boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
              backdropFilter: "blur(12px)",
            }}
          >
            {produceUi === "producing" || produceUi === "starting" ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 800, color: brass, marginBottom: 4 }}>
                  {produceUi === "starting" ? "Starting production…" : "AP is producing your song"}
                </div>
                <div style={{ fontSize: 12, color: mutedText, lineHeight: 1.45, marginBottom: 6 }}>
                  {humanProduceStage(produceStage)}
                </div>
                <div style={{ fontSize: 11, color: mutedText, marginBottom: 8 }}>
                  {produceJobStatus
                    ? produceJobStatus === "queued"
                      ? "Status: queued — waiting for the studio worker"
                      : produceJobStatus === "processing"
                        ? "Status: processing on the studio engine"
                        : `Status: ${produceJobStatus}`
                    : "Connecting to production…"}
                  {typeof produceProgress === "number" && produceProgress > 0
                    ? ` · ${produceProgress}%`
                    : ""}
                </div>
                <div
                  style={{
                    height: 4,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.08)",
                    overflow: "hidden",
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.max(8, produceProgress || 8)}%`,
                      borderRadius: 999,
                      background: `linear-gradient(90deg, ${brass}, #F0BC80)`,
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {(
                    [
                      ["queued", "Queue job"],
                      ["analyzing", "Analyze vocals"],
                      ["restoring", "Clean vocals"],
                      ["arranging", "Arrange on beat"],
                      ["mixing", "Mix with beat"],
                      ["mastering", "Master"],
                      ["complete", "Export"],
                    ] as const
                  ).map(([key, label]) => {
                    const order = ["queued", "analyzing", "restoring", "arranging", "mixing", "mastering", "completed"];
                    const curRaw = String(produceStage || "queued").toLowerCase().trim();
                    const jobSt = String(produceJobStatus || "").toLowerCase();
                    const progress = typeof produceProgress === "number" ? produceProgress : 0;
                    const normalizeStage = (x: string): string => {
                      // Still waiting for worker — stay on first step
                      if (
                        jobSt === "queued" ||
                        jobSt === "pending" ||
                        !x ||
                        x === "queued" ||
                        x === "pending" ||
                        x.includes("waiting") ||
                        x.includes("preparing") ||
                        x.includes("queue")
                      ) {
                        return "queued";
                      }
                      if (x.includes("analy") || x.includes("collect") || x.includes("ingest"))
                        return "analyzing";
                      if (x.includes("restor") || x.includes("clean")) return "restoring";
                      if (x.includes("arrang") || x.includes("polish") || x.includes("space"))
                        return "arranging";
                      if (x.includes("mix")) return "mixing";
                      if (x.includes("master") || x.includes("quality") || x === "qc") return "mastering";
                      if (x.includes("complete") || x.includes("export") || x === "done") return "completed";
                      // progress fallback for unknown stage strings
                      if (progress >= 98 || progress >= 100) return "completed";
                      if (progress >= 90) return "completed";
                      if (progress >= 82) return "mastering";
                      if (progress >= 70) return "mixing";
                      if (progress >= 48) return "arranging";
                      if (progress >= 28) return "restoring";
                      if (progress >= 12) return "analyzing";
                      return "queued";
                    };
                    // If server says queued, never show Analyze/Arrange as active (stale progress)
                    const statusLower = String(produceJobStatus || "").toLowerCase();
                    const cur =
                      statusLower === "queued" || statusLower === "starting"
                        ? "queued"
                        : normalizeStage(curRaw);
                    let curIdx = order.indexOf(cur);
                    // Never assume "arranging" just because the UI is open — unknown → queued
                    if (curIdx < 0) curIdx = 0;
                    const stepIdx = order.indexOf(key);
                    // This block only renders while producing/starting — mark prior steps done
                    const done = stepIdx >= 0 && curIdx > stepIdx;
                    const active = stepIdx === curIdx;
                    return (
                      <div
                        key={key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 11,
                          color: active ? brass : done ? mutedText : "rgba(255,255,255,0.28)",
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        <span style={{ width: 12, textAlign: "center" }}>
                          {done ? "✓" : active ? "●" : "○"}
                        </span>
                        {label}
                      </div>
                    );
                  })}
                </div>
                {produceJobId ? (
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginTop: 8 }}>
                    Job {String(produceJobId).slice(0, 8)}…
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => void cancelProduce("user")}
                  style={{
                    marginTop: 14,
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(0,0,0,0.35)",
                    color: "rgba(255,255,255,0.85)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Cancel production
                </button>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", marginTop: 8, lineHeight: 1.4 }}>
                  Auto-cancels after 120 minutes if still running. Recordings stay safe either way.
                </div>
              </>
            ) : null}

            {produceUi === "complete" ? (
              <>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: "#6EE7B7",
                    marginBottom: 10,
                  }}
                >
                  Your song is ready
                </div>
                {masterUrl ? (
                  <>
                    <audio
                      ref={masterAudioRef}
                      src={masterUrl}
                      preload="metadata"
                      onTimeUpdate={(e) =>
                        setMasterTime((e.target as HTMLAudioElement).currentTime)
                      }
                      onLoadedMetadata={(e) =>
                        setMasterDur((e.target as HTMLAudioElement).duration || 0)
                      }
                      onEnded={() => setMasterPlaying(false)}
                      onPlay={() => setMasterPlaying(true)}
                      onPause={() => setMasterPlaying(false)}
                      style={{ display: "none" }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <button
                        type="button"
                        onClick={toggleMasterPlay}
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 999,
                          border: "none",
                          background: `linear-gradient(180deg, #F0BC80, ${brass})`,
                          color: "#1A1208",
                          fontWeight: 800,
                          fontSize: 14,
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                        aria-label={masterPlaying ? "Pause" : "Play"}
                      >
                        {masterPlaying ? "❚❚" : "▶"}
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            height: 4,
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.1)",
                            overflow: "hidden",
                            marginBottom: 4,
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${masterDur > 0 ? (masterTime / masterDur) * 100 : 0}%`,
                              background: brass,
                              borderRadius: 999,
                            }}
                          />
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: faint,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {formatMs(masterTime * 1000)} / {formatMs(masterDur * 1000)}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: mutedText, marginBottom: 10 }}>
                    Preparing playback… Download is available.
                  </div>
                )}
                {produceError ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#F07167",
                      marginBottom: 10,
                      lineHeight: 1.4,
                    }}
                  >
                    {produceError}
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={downloadBusy}
                    onClick={() => void downloadMaster("wav")}
                    style={{
                      flex: 1,
                      minWidth: 90,
                      height: 36,
                      borderRadius: 999,
                      border: "none",
                      background: `linear-gradient(180deg, #F0BC80, ${brass})`,
                      color: "#1A1208",
                      fontWeight: 800,
                      fontSize: 12,
                      cursor: downloadBusy ? "default" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {downloadBusy ? "…" : "Download WAV"}
                  </button>
                  <button
                    type="button"
                    disabled={downloadBusy}
                    onClick={() => void downloadMaster("mp3")}
                    style={{
                      flex: 1,
                      minWidth: 90,
                      height: 36,
                      borderRadius: 999,
                      border: `1px solid ${border}`,
                      background: "rgba(255,255,255,0.06)",
                      color: text,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: downloadBusy ? "default" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Download MP3
                  </button>
                  <button
                    type="button"
                    onClick={() => void startConsoleProduce()}
                    style={{
                      height: 36,
                      padding: "0 14px",
                      borderRadius: 999,
                      border: `1px solid ${border}`,
                      background: "rgba(255,255,255,0.06)",
                      color: text,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Produce again
                  </button>
                  <button
                    type="button"
                    onClick={dismissProducePanel}
                    style={{
                      height: 36,
                      padding: "0 14px",
                      borderRadius: 999,
                      border: `1px solid ${border}`,
                      background: "transparent",
                      color: mutedText,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : null}

            {produceUi === "failed" ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#F07167", marginBottom: 6 }}>
                  Production didn’t finish
                </div>
                <div style={{ fontSize: 12, color: mutedText, marginBottom: 10, lineHeight: 1.4 }}>
                  {produceError ||
                    humanProduceError(null, produceStage)}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void startConsoleProduce()}
                  style={{
                    height: 36,
                    padding: "0 16px",
                    borderRadius: 999,
                    border: "none",
                    background: `linear-gradient(180deg, #F0BC80, ${brass})`,
                    color: "#1A1208",
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={dismissProducePanel}
                  style={{
                    height: 36,
                    padding: "0 16px",
                    borderRadius: 999,
                    border: `1px solid ${border}`,
                    background: "transparent",
                    color: mutedText,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Close
                </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

            {/* AP working overlay — Suno-style generative studio */}
      {trackPromptBusy && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 60,
            display: "grid",
            placeItems: "center",
            background:
              "radial-gradient(ellipse at 50% 40%, rgba(231,169,97,0.18), transparent 55%), rgba(6,6,10,0.72)",
            backdropFilter: "blur(18px)",
            pointerEvents: "all",
          }}
        >
          <style>{`
            @keyframes apPulse {
              0%, 100% { transform: scale(1); opacity: 0.85; }
              50% { transform: scale(1.08); opacity: 1; }
            }
            @keyframes apOrbit {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
            @keyframes apBar {
              0%, 100% { height: 18%; }
              50% { height: 92%; }
            }
            @keyframes apShimmer {
              0% { background-position: 0% 50%; }
              100% { background-position: 200% 50%; }
            }
          `}</style>
          <div
            style={{
              width: "min(360px, 92vw)",
              padding: "28px 24px 24px",
              borderRadius: 20,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(18,18,24,0.92)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                position: "relative",
                width: 88,
                height: 88,
                margin: "0 auto 18px",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  border: "2px solid transparent",
                  borderTopColor: brass,
                  borderRightColor: "rgba(231,169,97,0.35)",
                  animation: "apOrbit 1.4s linear infinite",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 10,
                  borderRadius: "50%",
                  background: `linear-gradient(135deg, ${brass}, #F0BC80 40%, #A78BFA)`,
                  backgroundSize: "200% 200%",
                  animation: "apPulse 1.6s ease-in-out infinite, apShimmer 3s linear infinite",
                  display: "grid",
                  placeItems: "center",
                  color: "#1A1208",
                  fontWeight: 900,
                  fontSize: 15,
                  letterSpacing: "0.06em",
                }}
              >
                AP
              </div>
            </div>
            {/* mini equalizer bars */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                gap: 4,
                height: 36,
                marginBottom: 16,
              }}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 5,
                    borderRadius: 3,
                    background: i % 2 === 0 ? brass : "#A78BFA",
                    animation: `apBar ${0.7 + (i % 3) * 0.15}s ease-in-out ${i * 0.08}s infinite`,
                    height: "40%",
                  }}
                />
              ))}
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: text,
                marginBottom: 10,
                minHeight: 22,
              }}
            >
              {apSummary ||
                [
                  "Listening to your direction…",
                  "Reading the session…",
                  "Executing DAW moves…",
                  "Shaping the sound…",
                  "Finishing the pass…",
                ][apPhase % 5]}
            </div>
            {apSteps.length > 0 ? (
              <div
                style={{
                  textAlign: "left",
                  maxWidth: 300,
                  margin: "0 auto 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {apSteps.map((st, i) => (
                  <div
                    key={`${st.label}-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      color: st.active ? brass : st.done ? mutedText : faint,
                      fontWeight: st.active ? 700 : 500,
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 999,
                        border: `1.5px solid ${st.done || st.active ? brass : border}`,
                        background: st.done ? brass : "transparent",
                        color: st.done ? "#1A1208" : brass,
                        fontSize: 10,
                        fontWeight: 800,
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                      }}
                    >
                      {st.done ? "✓" : st.active ? "·" : ""}
                    </span>
                    <span>{st.label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  fontSize: 12,
                  color: mutedText,
                  lineHeight: 1.45,
                  maxWidth: 280,
                  margin: "0 auto",
                }}
              >
                {selectedTrackId && selectedTrackId !== "beat"
                  ? `Working on ${tracks.find((t) => t.id === selectedTrackId)?.label || "track"}`
                  : "Session direction"}
              </div>
            )}
            <div
              style={{
                marginTop: 14,
                height: 3,
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: "40%",
                  borderRadius: 999,
                  background: `linear-gradient(90deg, transparent, ${brass}, transparent)`,
                  backgroundSize: "200% 100%",
                  animation: "apShimmer 1.2s linear infinite",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Prompt: collapsed FAB by default — does not cover track rows */}
      {!promptBarOpen ? (
        <button
          type="button"
          onClick={() => setPromptBarOpen(true)}
          title="Open AP prompt"
          style={{
            position: "absolute",
            right: 14,
            bottom: "max(14px, env(safe-area-inset-bottom))",
            zIndex: 40,
            width: 48,
            height: 48,
            borderRadius: 999,
            border: `1px solid ${border}`,
            background: `linear-gradient(180deg, #F0BC80, ${brass})`,
            color: "#1A1208",
            fontWeight: 800,
            fontSize: 13,
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
            fontFamily: "inherit",
          }}
        >
          AP
        </button>
      ) : (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 40,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              margin: "0 12px max(12px, env(safe-area-inset-bottom))",
              pointerEvents: "auto",
              borderRadius: 16,
              padding: "12px 14px 14px",
              background: "rgba(22, 22, 26, 0.96)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
              backdropFilter: "blur(16px)",
              /* Mobile: many track chips must not push Close off-screen */
              maxHeight: "min(78dvh, 640px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
                flexShrink: 0,
                position: "sticky",
                top: 0,
                zIndex: 2,
                background: "rgba(22, 22, 26, 0.98)",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setPromptBarOpen(false);
                  setAddMenuOpen(true);
                }}
                title="Add track"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#E8E6EF",
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: "pointer",
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                +
              </button>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>
                {selectedTrackId && selectedTrackId !== "beat"
                  ? `AP · ${tracks.find((t) => t.id === selectedTrackId)?.label || "Track"}`
                  : "AP · Session"}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!trackPromptBusy) setPromptBarOpen(false);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255,255,255,0.45)",
                  fontSize: 18,
                  cursor: trackPromptBusy ? "default" : "pointer",
                  padding: 4,
                }}
                aria-label="Close prompt"
              >
                ×
              </button>
            </div>

            {/* Scope chips — scroll when many tracks (choir stacks) */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 10,
                alignItems: "center",
                alignContent: "flex-start",
                maxHeight: "min(36dvh, 280px)",
                overflowY: "auto",
                overflowX: "hidden",
                flexShrink: 1,
                WebkitOverflowScrolling: "touch",
                overscrollBehavior: "contain",
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedTrackId(null)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border:
                    !selectedTrackId || selectedTrackId === "beat"
                      ? `1px solid ${brass}`
                      : "1px solid rgba(255,255,255,0.12)",
                  background:
                    !selectedTrackId || selectedTrackId === "beat"
                      ? "rgba(231,169,97,0.18)"
                      : "rgba(255,255,255,0.05)",
                  color:
                    !selectedTrackId || selectedTrackId === "beat" ? brass : mutedText,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Whole song
              </button>
              {tracks
                .filter((t) => t.kind === "vocal")
                .map((t) => {
                  const on = selectedTrackId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTrackId(t.id)}
                      title={t.url ? t.label : `${t.label} (no take yet)`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 10px 4px 6px",
                        borderRadius: 999,
                        border: on
                          ? `1px solid ${t.color}`
                          : "1px solid rgba(255,255,255,0.12)",
                        background: on ? `${t.color}33` : "rgba(255,255,255,0.05)",
                        color: on ? text : mutedText,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        maxWidth: 140,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 3,
                          background: t.color,
                          flexShrink: 0,
                          opacity: t.url ? 1 : 0.35,
                        }}
                      />
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.label}
                      </span>
                      {!t.url ? (
                        <span style={{ fontSize: 9, opacity: 0.6, flexShrink: 0 }}>·</span>
                      ) : null}
                    </button>
                  );
                })}
            </div>

            {selectedTrackId && selectedTrackId !== "beat" ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                  padding: "6px 10px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background:
                      tracks.find((t) => t.id === selectedTrackId)?.color || brass,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, fontSize: 12, color: text, fontWeight: 600 }}>
                  Directing{" "}
                  {tracks.find((t) => t.id === selectedTrackId)?.label || "track"}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedTrackId(null)}
                  style={{
                    background: "none",
                    border: "none",
                    color: mutedText,
                    cursor: "pointer",
                    fontSize: 14,
                    padding: 2,
                  }}
                  title="Clear track scope"
                >
                  ×
                </button>
              </div>
            ) : null}

            {/* Input + suggestions stay pinned under scrollable chips */}
            <div style={{ flexShrink: 0, minHeight: 0 }}>
            {editMsg ? (
              <div
                style={{
                  marginBottom: 8,
                  padding: "8px 10px",
                  borderRadius: 10,
                  fontSize: 12,
                  lineHeight: 1.4,
                  background:
                    apLastResult === "err"
                      ? "rgba(240,113,103,0.12)"
                      : "rgba(52,211,153,0.1)",
                  color:
                    apLastResult === "err" ? "#F07167" : "#6EE7B7",
                  border: `1px solid ${
                    apLastResult === "err"
                      ? "rgba(240,113,103,0.25)"
                      : "rgba(52,211,153,0.2)"
                  }`,
                }}
              >
                {editMsg}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={trackPrompt}
                onChange={(e) => setTrackPrompt(e.target.value)}
                placeholder={
                  selectedTrackId && selectedTrackId !== "beat"
                    ? "e.g. solo this, pan left, more reverb, warmer…"
                    : "e.g. mute the beat, go to chorus, louder lead…"
                }
                disabled={trackPromptBusy}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && trackPrompt.trim() && !trackPromptBusy) {
                    e.preventDefault();
                    void submitTrackPrompt();
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10,
                  color: "#F4F1EC",
                  padding: "10px 12px",
                  fontSize: 14,
                  fontFamily: "inherit",
                }}
              />
              <button
                type="button"
                onClick={() => {
                  void submitTrackPrompt();
                }}
                disabled={trackPromptBusy || !trackPrompt.trim()}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  border: "none",
                  background:
                    !trackPromptBusy && trackPrompt.trim()
                      ? "linear-gradient(180deg, #F0BC80, #E7A961)"
                      : "rgba(255,255,255,0.1)",
                  color:
                    !trackPromptBusy && trackPrompt.trim()
                      ? "#1A1208"
                      : "rgba(255,255,255,0.35)",
                  fontWeight: 800,
                  cursor:
                    !trackPromptBusy && trackPrompt.trim()
                      ? "pointer"
                      : "default",
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                ↑
              </button>
            </div>
            {/* Suggestion chips — DAW mindset */}
            {!trackPromptBusy && !trackPrompt.trim() ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 10,
                }}
              >
                {AP_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setTrackPrompt(s);
                    }}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.04)",
                      color: mutedText,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
            <div
              style={{
                marginTop: 8,
                fontSize: 10,
                color: faint,
                lineHeight: 1.35,
              }}
            >
              Tell AP anything — mute, solo, pan, FX, jump to chorus, process a take. Tap a track to scope.
            </div>
            </div>
          </div>
        </div>
      )}

      {addMenuOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10040,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setAddMenuOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              borderRadius: "16px 16px 0 0",
              background: surface,
              border: `1px solid ${border}`,
              padding: "16px 16px max(20px, env(safe-area-inset-bottom))",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>Add track</div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", opacity: 0.55, marginBottom: 8 }}>
                GENERATE WITH AI
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(["drums", "bass", "guitar", "keys", "piano", "strings", "synth"] as const).map((inst) => (
                  <button
                    key={inst}
                    type="button"
                    disabled={aiInstrumentBusy || !projectId}
                    onClick={() => void generateAiInstrument(inst)}
                    style={{
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: aiInstrumentBusy ? "rgba(255,255,255,0.06)" : "rgba(231,169,97,0.12)",
                      color: "#F5E6D3",
                      borderRadius: 999,
                      padding: "8px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      textTransform: "capitalize",
                      cursor: aiInstrumentBusy ? "wait" : "pointer",
                      opacity: aiInstrumentBusy ? 0.7 : 1,
                    }}
                  >
                    {aiInstrumentBusy ? "Working…" : inst}
                  </button>
                ))}
              </div>
              {aiInstrumentError ? (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "#ff8f8f" }}>{aiInstrumentError}</p>
              ) : (
                <p style={{ margin: "8px 0 0", fontSize: 11, opacity: 0.5 }}>
                  AP generates a complementary layer from your song direction. One request per tap.
                </p>
              )}
              <button
                type="button"
                disabled={aiAroundBusy || !projectId}
                onClick={() => void buildAroundSelectedVocal()}
                style={{
                  marginTop: 12,
                  width: "100%",
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#F5E6D3",
                  borderRadius: 12,
                  padding: "12px 14px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: aiAroundBusy ? "wait" : "pointer",
                  textAlign: "left",
                }}
              >
                {aiAroundBusy ? "Building production around your vocal…" : "Build production around my vocal"}
              </button>
              {aiAroundError ? (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "#ff8f8f" }}>{aiAroundError}</p>
              ) : (
                <p style={{ margin: "6px 0 0", fontSize: 11, opacity: 0.5 }}>
                  Uses your recorded vocal as the guide. Becomes the instrumental bed for this session.
                </p>
              )}
              <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" }} />
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", opacity: 0.55, marginBottom: 8 }}>
                MANUAL
              </div>
            </div>
            {!beatUrl ? (
              <button
                type="button"
                disabled={planBusy}
                onClick={() => {
                  setAddMenuOpen(false);
                  beatFileInputRef.current?.click();
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 12px",
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  background: "rgba(255,255,255,0.04)",
                  color: text,
                  marginBottom: 8,
                  cursor: planBusy ? "wait" : "pointer",
                  fontFamily: "inherit",
                  fontWeight: 600,
                }}
              >
                Upload beat — runs AI plan (same as Booth)
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAddMenuOpen(false);
                  setShowAddTrack(true);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 12px",
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  background: "rgba(255,255,255,0.04)",
                  color: text,
                  marginBottom: 8,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 600,
                }}
              >
                Upload vocal / audio file — new track
              </button>
            )}
            {beatUrl && layers.filter((l) => l.id !== "beat").length === 0 && (
              <button
                type="button"
                disabled={planBusy}
                onClick={() => {
                  setAddMenuOpen(false);
                  void generatePlanOnly();
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 12px",
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  background: "rgba(255,255,255,0.04)",
                  color: text,
                  marginBottom: 8,
                  cursor: planBusy ? "wait" : "pointer",
                  fontFamily: "inherit",
                  fontWeight: 600,
                }}
              >
                Generate plan — structure tracks from this beat
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setAddMenuOpen(false);
                void startConsoleRecord();
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "14px 12px",
                borderRadius: 12,
                border: `1px solid ${border}`,
                background: "rgba(255,255,255,0.04)",
                color: text,
                marginBottom: 8,
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 600,
              }}
            >
              Record Vocal — live capture into a new/selected track
            </button>
            <button
              type="button"
              onClick={() => setAddMenuOpen(false)}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: 12,
                border: "none",
                background: "transparent",
                color: mutedText,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showAddTrack && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10040,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setShowAddTrack(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              margin: "0 12px max(12px, env(safe-area-inset-bottom))",
              pointerEvents: "auto",
              borderRadius: 14,
              padding: 12,
              background: "rgba(22, 22, 26, 0.95)",
              border: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              placeholder="Name (optional)"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: "#F4F1EC",
                fontFamily: "inherit",
                fontSize: 13,
              }}
            />
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: "#F4F1EC",
                fontFamily: "inherit",
                fontSize: 13,
              }}
            >
              <option value="custom">Custom</option>
              <option value="lead">Lead</option>
              <option value="double">Double</option>
              <option value="harmony">Harmony</option>
              <option value="harmony_high">Harmony high</option>
              <option value="harmony_low">Harmony low</option>
              <option value="adlib">Ad-lib</option>
              <option value="background">Background</option>
            </select>
            <input
              ref={addFileRef}
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.webm"
              style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={addBusy}
                onClick={() => {
                  const f = addFileRef.current?.files?.[0] || null;
                  void createTrack(f);
                }}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(180deg, #F0BC80, #E7A961)",
                  color: "#1A1208",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 13,
                }}
              >
                {addBusy ? "Adding…" : "Add"}
              </button>
              <button
                type="button"
                disabled={addBusy}
                onClick={() => setShowAddTrack(false)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "transparent",
                  color: "rgba(255,255,255,0.55)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}


      {paywallOpen && projectId ? (
        <ApPaywall
          open={paywallOpen}
          onClose={() => setPaywallOpen(false)}
          songTitle={titleDraft || projectTitle || undefined}
          projectId={projectId}
          colors={{
            text,
            textMuted: mutedText,
            surface: bg,
            border,
            accent: brass,
            bg,
          }}
          onUnlocked={() => {
            setPaywallOpen(false);
            void downloadMaster("wav");
          }}
        />
      ) : null}

      {/* FX modal — Suno-style plugin sheet */}
      <ConsoleMixer
        open={mixerOpen}
        onClose={() => setMixerOpen(false)}
        isNarrow={isNarrow}
        brass={brass}
        border={border}
        text={text}
        mutedText={mutedText}
        surface={bg}
        masterGainDb={masterGainDb}
        onMasterGain={(db) => {
          const clamped = Math.max(-24, Math.min(6, db));
          setMasterGainDb(clamped);
          for (const tr of tracks) {
            try {
              const base = fxByIdRef.current[tr.id] || DEFAULT_TRACK_FX;
              const audible = isAudible(tr.id, tr.kind);
              const lin =
                (audible ? Math.pow(10, (Number(base.gainDb) || 0) / 20) : 0) *
                Math.pow(10, clamped / 20);
              const graph = fxGraphRef.current.get(tr.id);
              const now = audioCtxRef.current?.currentTime ?? 0;
              if (graph) {
                graph.gain.gain.cancelScheduledValues(now);
                graph.gain.gain.setTargetAtTime(Math.min(lin, 2.5), now, 0.03);
              }
            } catch {
              /* */
            }
          }
        }}
        channels={tracks.map((tr): MixerChannel => {
          const fx = fxById[tr.id] || DEFAULT_TRACK_FX;
          const modeN = Number(fx.autoTuneMode) || 0;
          return {
            id: tr.id,
            label: String(tr.label || tr.sub || tr.id),
            kind: tr.kind === "beat" ? "beat" : "vocal",
            color: tr.color,
            muted: Boolean(muted[tr.id]),
            soloed: Boolean(soloIds[tr.id]) || soloId === tr.id,
            gainDb: Number(fx.gainDb) || 0,
            pan: Number(fx.pan) || 0,
            autoTuneEnabled: Number(fx.autoTuneEnabled) > 0,
            autoTuneAmount: Number(fx.autoTuneAmount) || 0.45,
            autoTuneMode: modeN >= 2 ? "hard" : modeN === 1 ? "modern" : "natural",
          };
        })}
        onGain={(id, db, commit) => setGain(id, db, Boolean(commit))}
        onPan={(id, pan, commit) => setPan(id, pan, Boolean(commit))}
        onMute={(id) => {
          setMuted((m) => {
            const next = { ...m, [id]: !m[id] };
            mutedRef.current = next;
            queueMicrotask(() => applyGains(undefined, true));
            return next;
          });
        }}
        onSolo={(id) => {
          setSoloIds((prev) => {
            const next = { ...prev };
            if (next[id]) delete next[id];
            else next[id] = true;
            soloIdsRef.current = next;
            const keys = Object.keys(next).filter((k) => next[k]);
            soloIdRef.current = keys.length ? keys[0] : null;
            setSoloId(soloIdRef.current);
            queueMicrotask(() => applyGains(undefined, true));
            return next;
          });
        }}
        onOpenFx={(id) => {
          setMixerOpen(false);
          setFxOpenId(id);
        }}
        onApplyMixProposal={applyMixProposal}
        onUndoMix={undoLastMix}
        canUndoMix={mixUndoStack.length > 0}
        onAutoTuneChange={patchAutoTune}
      />

      {fxOpenId && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10050,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setFxOpenId(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              maxHeight: "72dvh",
              overflowY: "auto",
              borderRadius: "18px 18px 0 0",
              background: surface,
              border: `1px solid ${border}`,
              borderBottom: "none",
              padding: "16px 16px max(16px, env(safe-area-inset-bottom))",
              boxShadow: "0 -8px 40px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    color: brass,
                  }}
                >
                  TRACK FX
                </div>
                <div style={{ fontWeight: 700, fontSize: 16, color: text }}>
                  {tracks.find((x) => x.id === fxOpenId)?.label || "Track"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFxOpenId(null)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: `1px solid ${border}`,
                  background: bg,
                  color: text,
                  cursor: "pointer",
                  fontSize: 16,
                }}
              >
                ×
              </button>
            </div>
            <TrackFxPanel
              fx={fxById[fxOpenId] || DEFAULT_TRACK_FX}
              trackId={fxOpenId}
              color={text}
              muted={mutedText}
              border={border}
              brass={brass}
              surface={bg}
              playheadMs={playheadMs}
              totalMs={totalMs || durationMs || 60000}
              automationDoc={automationDoc}
              onAutomationChange={(doc) => void persistAutomation(doc)}
              onChange={(fx) => {
                fxByIdRef.current = { ...fxByIdRef.current, [fxOpenId]: fx };
                setFxById((prev) => ({ ...prev, [fxOpenId]: fx }));
                const graph = fxGraphRef.current.get(fxOpenId);
                if (graph) {
                  const kind = tracks.find((x) => x.id === fxOpenId)?.kind || "vocal";
                  const on = isAudible(fxOpenId, kind);
                  try {
                    graph.apply(
                      trackFxToLiveParams(fx as unknown as Record<string, number>),
                      on
                    );
                  } catch {
                    /* */
                  }
                }
              }}
              onCommit={(fx) => {
                void persistFx(fxOpenId, fx);
                // Buffer-based preview FX — re-cue so gate/denoise/cleanup is audible
                if (
                  playingRef.current &&
                  ((Number(fx.gate) || 0) > 0.02 ||
                    (Number(fx.noiseReduce) || 0) > 0.02 ||
                    (Number(fx.deEss) || 0) > 0.04 ||
                    (Number(fx.phraseCleanup) || 0) > 0.02)
                ) {
                  const tMs = playheadMsRef.current;
                  void startPlayback(tMs);
                }
              }}
              rack={fxRackById[fxOpenId] || []}
              onRackChange={(rack) =>
                setFxRackById((prev) => ({ ...prev, [fxOpenId]: rack }))
              }
            />
          </div>
        </div>
      )}


      
      {trackMenu && (() => {
        const tr = tracks.find((x) => x.id === trackMenu.trackId);
        if (!tr) return null;
        const close = () => setTrackMenu(null);
        const item = (
          label: string,
          onClick: () => void,
          opts?: { danger?: boolean; disabled?: boolean }
        ) => (
          <button
            key={label}
            type="button"
            disabled={opts?.disabled}
            onClick={() => {
              if (opts?.disabled) return;
              onClick();
              close();
            }}
            style={menuItemStyle(opts?.danger ? "#F87171" : text, opts?.disabled)}
          >
            {label}
          </button>
        );
        return (
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 210 }}
              onClick={close}
              onContextMenu={(e) => {
                e.preventDefault();
                close();
              }}
            />
            <div
              role="menu"
              style={
                isNarrow
                  ? {
                      position: "fixed",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      zIndex: 211,
                      width: "100%",
                      maxHeight: "min(78dvh, 560px)",
                      overflowY: "auto",
                      WebkitOverflowScrolling: "touch",
                      overscrollBehavior: "contain",
                      touchAction: "pan-y",
                      borderRadius: "16px 16px 0 0",
                      border: `1px solid ${border}`,
                      borderBottom: "none",
                      background: "rgba(18,16,14,0.98)",
                      boxShadow: "0 -12px 48px rgba(0,0,0,0.55)",
                      padding: "8px 0 max(16px, env(safe-area-inset-bottom))",
                    }
                  : {
                      position: "fixed",
                      left: trackMenu.x,
                      top: trackMenu.y,
                      zIndex: 211,
                      minWidth: 196,
                      maxWidth: 240,
                      maxHeight: "min(70vh, 420px)",
                      overflowY: "auto",
                      WebkitOverflowScrolling: "touch",
                      overscrollBehavior: "contain",
                      borderRadius: 12,
                      border: `1px solid ${border}`,
                      background: "rgba(18,16,14,0.98)",
                      boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
                      padding: "6px 0",
                    }
              }
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {isNarrow ? (
                <div
                  style={{
                    width: 36,
                    height: 4,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.2)",
                    margin: "4px auto 10px",
                  }}
                />
              ) : null}
              <div
                style={{
                  padding: "6px 12px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: mutedText,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {(tr.sub || tr.label || "Track").toString().slice(0, 24)}
              </div>
              {tr.kind === "vocal" && tr.url
                ? item("Edit take", () => void beginTakeEdit(tr.id, tr.url))
                : null}
              {item(expandedId === tr.id ? "Collapse track" : "Expand track", () => {
                if (expandedId === tr.id) {
                  setExpandedId(null);
                  setTrackHeightPx((prev) => {
                    const n = { ...prev };
                    delete n[tr.id];
                    return n;
                  });
                } else {
                  setExpandedId(tr.id);
                  // Clear forced height so default expanded size applies to both lanes
                  setTrackHeightPx((prev) => {
                    const n = { ...prev };
                    delete n[tr.id];
                    return n;
                  });
                }
              })}
              {item("Taller track", () => {
                setExpandedId(tr.id);
                setTrackHeightPx((prev) => ({
                  ...prev,
                  [tr.id]: Math.min(
                    560,
                    (prev[tr.id] || trackRowHeight({
                      expanded: true,
                      stackOpen: false,
                      colorOpen: false,
                      takeEditing: false,
                      isNarrow,
                    })) + 48
                  ),
                }));
              })}
              {item("Shorter track", () => {
                setTrackHeightPx((prev) => {
                  const base =
                    prev[tr.id] ||
                    trackRowHeight({
                      expanded: expandedId === tr.id,
                      stackOpen: false,
                      colorOpen: false,
                      takeEditing: false,
                      isNarrow,
                    });
                  const next = Math.max(64, base - 48);
                  return { ...prev, [tr.id]: next };
                });
              })}
              {tr.kind === "vocal"
                ? item("Split at playhead", () => {
                    setSelectedTrackId(tr.id);
                    void splitSelectedAtPlayhead();
                  }, { disabled: takeEditBusy })
                : null}
              {tr.kind === "vocal"
                ? item("Snap to beat", () => {
                    setSelectedTrackId(tr.id);
                    void quantizeSelectedToBeat(1);
                  }, { disabled: takeEditBusy || tempoBpm == null })
                : null}
              {tr.kind === "vocal"
                ? item("Duplicate track", () => void duplicateLayer(tr.id))
                : null}
              {item("Track FX", () => {
                setSelectedTrackId(tr.id);
                setFxOpenId(tr.id);
              })}
              {tr.kind === "vocal"
                ? item("Stack / Choir", () => {
                    setExpandedId(tr.id);
                    setStackMenuId(tr.id);
                  })
                : null}
              {tr.kind === "vocal"
                ? item("Rename", () => beginRenameTrack(tr))
                : null}
              {tr.kind === "vocal" ? (
                <div
                  style={{
                    padding: "8px 12px",
                    borderTop: `1px solid ${border}`,
                    marginTop: 4,
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, color: faint, marginBottom: 6 }}>
                    Color
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {TRACK_COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        title="Set color"
                        onClick={() => {
                          void persistColor(tr.id, c);
                          close();
                        }}
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 5,
                          border:
                            tr.color === c ? `2px solid ${text}` : `1px solid ${border}`,
                          background: c,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 12px",
                  borderTop: `1px solid ${border}`,
                }}
              >
                <span style={{ fontSize: 10, color: faint, fontWeight: 700 }}>Pan</span>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={fxById[tr.id]?.pan ?? 0}
                  onChange={(e) => setPan(tr.id, parseFloat(e.target.value), false)}
                  onPointerUp={(e) =>
                    setPan(tr.id, parseFloat((e.target as HTMLInputElement).value), true)
                  }
                  style={{ flex: 1, height: 16, accentColor: brass }}
                />
              </div>
              {tr.kind === "vocal" && tr.id !== "beat"
                ? item("Delete clip / recording", () => {
                    setSelectedTrackId(tr.id);
                    void deleteSelectedClipOrRecording();
                  }, { danger: true })
                : null}
              {tr.kind === "vocal" && tr.id !== "beat"
                ? item("Remove track", () => void deleteLayer(tr.id), { danger: true })
                : null}
            </div>
          </>
        );
      })()}

      {ctxMenu && (() => {
        const tr = tracks.find((x) => x.id === ctxMenu.trackId);
        const isBeat = ctxMenu.trackId === "beat" || tr?.kind === "beat";
        const isMuted = Boolean(muted[ctxMenu.trackId]);
        const isSolo = Boolean(soloIds[ctxMenu.trackId]) || soloId === ctxMenu.trackId;
        const item = (
          label: string,
          onClick: () => void,
          opts?: { danger?: boolean; disabled?: boolean; shortcut?: string }
        ) => (
          <button
            key={label}
            type="button"
            disabled={opts?.disabled}
            onClick={() => {
              if (opts?.disabled) return;
              onClick();
              closeCtxMenu();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              padding: "10px 14px",
              border: "none",
              background: "transparent",
              color: opts?.disabled
                ? faint
                : opts?.danger
                  ? "#F87171"
                  : text,
              fontSize: 13,
              fontWeight: 600,
              cursor: opts?.disabled ? "default" : "pointer",
              fontFamily: "inherit",
              textAlign: "left",
              opacity: opts?.disabled ? 0.45 : 1,
            }}
            onMouseEnter={(e) => {
              if (!opts?.disabled)
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <span>{label}</span>
            {opts?.shortcut ? (
              <span style={{ color: faint, fontSize: 11, fontWeight: 500 }}>{opts.shortcut}</span>
            ) : null}
          </button>
        );
        return (
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 200 }}
              onClick={closeCtxMenu}
              onContextMenu={(e) => {
                e.preventDefault();
                closeCtxMenu();
              }}
            />
            <div
              role="menu"
              style={{
                position: "fixed",
                left: ctxMenu.x,
                top: ctxMenu.y,
                zIndex: 201,
                minWidth: 210,
                maxWidth: 260,
                borderRadius: 12,
                border: `1px solid ${border}`,
                background: "rgba(22,20,18,0.98)",
                boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
                padding: "6px 0",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "8px 14px 6px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: mutedText,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                {(tr?.sub || tr?.label || "Track").toString().slice(0, 28)}
              </div>
              {!isBeat &&
                item("Split at playhead", () => {
                  setSelectedTrackId(ctxMenu.trackId);
                  void splitSelectedAtPlayhead();
                }, { shortcut: "⌘E" })}
              {!isBeat &&
                item("Edit take…", () => {
                  void beginTakeEdit(ctxMenu.trackId, tr?.url);
                })}
              {!isBeat &&
                item("Track FX", () => {
                  setFxOpenId(ctxMenu.trackId);
                })}
              {!isBeat &&
                item("Clip color", () => {
                  setColorPickerId(ctxMenu.trackId);
                  setExpandedId(ctxMenu.trackId);
                  setSidebarCollapsed(false);
                })}
              <div style={{ height: 1, background: border, margin: "4px 0" }} />
              {item(
                isMuted ? "Unmute" : "Mute",
                () =>
                  setMuted((prev) => ({
                    ...prev,
                    [ctxMenu.trackId]: !prev[ctxMenu.trackId],
                  })),
                { shortcut: "M" }
              )}
              {item(
                isSolo ? "Unsolo" : "Solo",
                () => {
                  setSoloIds((prev) => {
                    const next = { ...prev };
                    if (next[ctxMenu.trackId]) delete next[ctxMenu.trackId];
                    else next[ctxMenu.trackId] = true;
                    soloIdsRef.current = next;
                    const keys = Object.keys(next).filter((k) => next[k]);
                    soloIdRef.current = keys[0] || null;
                    setSoloId(soloIdRef.current);
                    queueMicrotask(() => applyGains(undefined, true));
                    return next;
                  });
                },
                { shortcut: "S" }
              )}
              {!isBeat &&
                item("Arm for record", () => {
                  setArmedTrackId(ctxMenu.trackId);
                  setSelectedTrackId(ctxMenu.trackId);
                })}
              {tr?.url
                ? item("Download audio", () => {
                    const a = document.createElement("a");
                    a.href = tr.url!;
                    a.download = `${(tr.sub || tr.label || "take").toString()}.wav`;
                    a.target = "_blank";
                    a.rel = "noopener";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  })
                : null}
              {!isBeat ? (
                <div style={{ height: 1, background: border, margin: "4px 0" }} />
              ) : null}
              {!isBeat &&
                item(
                  "Delete clip / recording",
                  () => {
                    setSelectedTrackId(ctxMenu.trackId);
                    if (ctxMenu.clipId) setSelectedClipId(ctxMenu.clipId);
                    void deleteSelectedClipOrRecording();
                  },
                  { danger: true, shortcut: "⌫" }
                )}
              {!isBeat &&
                item(
                  "Remove track from plan",
                  () => {
                    void deleteLayer(ctxMenu.trackId);
                  },
                  { danger: true }
                )}
            </div>
          </>
        );
      })()}

      {projectId ? (
        <ApSessionsPanel
          projectId={projectId}
          open={sessionsOpen}
          onClose={() => setSessionsOpen(false)}
          transportPlaying={playing}
          transportPositionMs={playheadMs}
        />
      ) : null}
    </div>
  );
}

function TrackFxPanel({
  fx,
  trackId,
  color,
  muted,
  border,
  brass,
  surface,
  playheadMs,
  totalMs,
  automationDoc,
  onAutomationChange,
  onChange,
  onCommit,
  rack,
  onRackChange,
}: {
  fx: TrackFx;
  trackId: string;
  color: string;
  muted: string;
  border: string;
  brass: string;
  surface: string;
  playheadMs: number;
  totalMs: number;
  automationDoc: FxAutomationDoc;
  onAutomationChange: (doc: FxAutomationDoc) => void;
  onChange: (fx: TrackFx) => void;
  onCommit: (fx: TrackFx) => void;
  rack: string[];
  onRackChange: (rack: string[]) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [modalId, setModalId] = useState<string | null>(null);
  const [fxEditMode, setFxEditMode] = useState<"presets" | "custom">("custom");
  void playheadMs;
  void totalMs;
  void automationDoc;
  void onAutomationChange;
  void color;

  const effectiveRack = rack.length > 0 ? rack : rackFromFx(fx);
  React.useEffect(() => {
    if (rack.length === 0 && effectiveRack.length > 0) onRackChange(effectiveRack);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx]);

  type PluginDef = {
    id: string;
    label: string;
    group: "dynamics" | "tone" | "space" | "creative";
    accent: string;
    keys: (keyof TrackFx)[];
    blurb: string;
  };

  const PLUGINS: PluginDef[] = [
    { id: "compress", label: "Compressor", group: "dynamics", accent: "#F59E0B", keys: ["compress"], blurb: "Level out dynamics" },
    { id: "gate", label: "Gate", group: "dynamics", accent: "#A78BFA", keys: ["gate"], blurb: "Cut noise between phrases" },
    { id: "deess", label: "De-esser", group: "dynamics", accent: "#C4B5FD", keys: ["deEss"], blurb: "Tame harsh sibilance" },
    { id: "denoise", label: "Denoise", group: "dynamics", accent: "#67E8F9", keys: ["noiseReduce"], blurb: "Reduce room noise" },
    { id: "cleanup", label: "Phrase cleanup", group: "dynamics", accent: "#FBBF24", keys: ["phraseCleanup"], blurb: "Tighten gaps between phrases" },
    { id: "limiter", label: "Limiter", group: "dynamics", accent: "#F87171", keys: ["limiter"], blurb: "Catch peaks softly" },
    { id: "eq", label: "EQ", group: "tone", accent: "#818CF8", keys: ["eqLowDb", "eqMidDb", "eqHighDb", "air"], blurb: "Shape the tone" },
    { id: "hpf", label: "High-pass", group: "tone", accent: "#38BDF8", keys: ["highPassHz"], blurb: "Remove low rumble" },
    { id: "lpf", label: "Low-pass", group: "tone", accent: "#22D3EE", keys: ["lowPassHz"], blurb: "Soften highs" },
    { id: "air", label: "Air", group: "tone", accent: "#7DD3FC", keys: ["air"], blurb: "Open top end" },
    { id: "telephone", label: "Telephone", group: "tone", accent: "#C084FC", keys: ["telephone"], blurb: "Band-limit phone character" },
    { id: "reverb", label: "Reverb", group: "space", accent: "#34D399", keys: ["reverb"], blurb: "Room & depth" },
    { id: "plate", label: "Plate", group: "space", accent: "#6EE7B7", keys: ["plateReverb"], blurb: "Dense plate space" },
    { id: "delay", label: "Delay", group: "space", accent: "#FBBF24", keys: ["delay"], blurb: "Echo repeats" },
    { id: "slap", label: "Slap", group: "space", accent: "#FCD34D", keys: ["slapDelay"], blurb: "Short slapback" },
    { id: "chorus", label: "Chorus", group: "creative", accent: "#E879F9", keys: ["chorus"], blurb: "Width & movement" },
    { id: "doubler", label: "Doubler", group: "creative", accent: "#F472B6", keys: ["doubler"], blurb: "Stacked presence" },
    { id: "sat", label: "Distortion", group: "creative", accent: "#A78BFA", keys: ["saturation", "satMode", "satTilt", "satBias", "satMix", "satCutoff", "satOut"], blurb: "Shape harmonics & grit" },
    { id: "width", label: "Width", group: "creative", accent: "#FB7185", keys: ["width"], blurb: "Stereo image" },
    {
      id: "voice",
      label: "Voice changer",
      group: "creative",
      accent: "#F472B6",
      keys: ["voiceChanger", "voicePitchSemis", "voiceCharacter"],
      blurb: "Pitch & character (Produce)",
    },
    {
      id: "rotor",
      label: "Rotor Glow",
      group: "creative",
      accent: "#4ADE80",
      keys: ["rotorMix", "rotorSpeed", "rotorDepth", "rotorWarmth", "rotorFast"],
      blurb: "Rotary movement & warmth",
    },
    {
      id: "spring",
      label: "Spring Shimmer",
      group: "creative",
      accent: "#FF8A3D",
      keys: ["springMix", "springDelay", "springTension", "springDamp", "springMod"],
      blurb: "Spring-style space",
    },
  ];

  function defaultsForPlugin(id: string): Partial<TrackFx> {
    switch (id) {
      case "compress": return { compress: 0.35 };
      case "gate": return { gate: 0.25 };
      case "deess": return { deEss: 0.3 };
      case "denoise": return { noiseReduce: 0.25 };
      case "cleanup": return { phraseCleanup: 0.35 };
      case "limiter": return { limiter: 0.2 };
      case "sat": return { saturation: 0.28, satMode: 0, satTilt: 0, satBias: 0, satMix: 0.8, satCutoff: 0.55, satOut: 0.7 };
      case "eq": return { eqLowDb: 0, eqMidDb: 0.5, eqHighDb: 1, air: 0.15 };
      case "hpf": return { highPassHz: 80 };
      case "lpf": return { lowPassHz: 14000 };
      case "air": return { air: 0.25 };
      case "telephone": return { telephone: 0.35 };
      case "reverb": return { reverb: 0.22 };
      case "plate": return { plateReverb: 0.2 };
      case "delay": return { delay: 0.2 };
      case "slap": return { slapDelay: 0.22 };
      case "chorus": return { chorus: 0.25 };
      case "doubler": return { doubler: 0.28 };
      case "width": return { width: 0.35 };
      case "voice":
        return { voiceChanger: 0.4, voicePitchSemis: 0, voiceCharacter: 1 };
      case "rotor":
        return {
          rotorMix: 0.32,
          rotorSpeed: 0.4,
          rotorDepth: 0.45,
          rotorWarmth: 0.4,
          rotorFast: 0,
        };
      case "spring":
        return {
          springMix: 0.32,
          springDelay: 0.25,
          springTension: 0.4,
          springDamp: 0.35,
          springMod: 0.25,
        };
      default: return {};
    }
  }

  function setKey(key: keyof TrackFx, val: number, commit = false) {
    const next = { ...fx, [key]: val } as TrackFx;
    onChange(next);
    if (commit) onCommit(next);
  }

  function addPlugin(id: string) {
    const base = rack.length > 0 ? rack : rackFromFx(fx);
    const nextRack = base.includes(id) ? base : [...base, id];
    onRackChange(nextRack);
    const seeded = { ...fx, ...defaultsForPlugin(id) };
    onChange(seeded);
    onCommit(seeded);
    setAddOpen(false);
    setModalId(id);
    setFxEditMode((EFFECT_PLUGIN_PRESETS[id] || []).length > 0 ? "presets" : "custom");
  }

  function removePlugin(id: string) {
    const def = PLUGINS.find((p) => p.id === id);
    const nextFx = { ...fx };
    if (def) {
      for (const k of def.keys) {
        if (k === "eqLowDb" || k === "eqMidDb" || k === "eqHighDb") (nextFx as any)[k] = 0;
        else if (k === "highPassHz" || k === "lowPassHz") (nextFx as any)[k] = 0;
        else if (k === "rotorSpeed") (nextFx as any)[k] = 0.35;
        else if (k === "rotorDepth") (nextFx as any)[k] = 0.45;
        else if (k === "rotorWarmth") (nextFx as any)[k] = 0.4;
        else if (k === "springDelay") (nextFx as any)[k] = 0.25;
        else if (k === "springTension") (nextFx as any)[k] = 0.4;
        else if (k === "springDamp") (nextFx as any)[k] = 0.35;
        else if (k === "springMod") (nextFx as any)[k] = 0.2;
        else if (k === "voicePitchSemis" || k === "voiceCharacter") (nextFx as any)[k] = 0;
        else (nextFx as any)[k] = 0;
      }
    }
    onChange(nextFx);
    onCommit(nextFx);
    onRackChange((rack.length ? rack : effectiveRack).filter((x) => x !== id));
    if (modalId === id) setModalId(null);
  }

  /** Circular knob — Suno-style */
  function Knob({
    label,
    value,
    min,
    max,
    step,
    accent,
    onVal,
    format,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    accent: string;
    onVal: (n: number, commit?: boolean) => void;
    format?: (n: number) => string;
  }) {
    const pct = max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
    const deg = -135 + pct * 270;
    return (
      <label
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          minWidth: 64,
          flex: "1 1 64px",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: `conic-gradient(from -135deg, ${accent} 0deg, ${accent} ${pct * 270}deg, rgba(255,255,255,0.08) ${pct * 270}deg, rgba(255,255,255,0.08) 270deg, transparent 270deg)`,
            display: "grid",
            placeItems: "center",
            position: "relative",
            boxShadow: `0 0 0 1px rgba(255,255,255,0.06), 0 6px 20px rgba(0,0,0,0.4)`,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "radial-gradient(circle at 35% 30%, #2a2a32 0%, #121218 75%)",
              border: "1px solid rgba(255,255,255,0.1)",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 2,
                height: 14,
                marginLeft: -1,
                marginTop: -14,
                borderRadius: 2,
                background: accent,
                transformOrigin: "50% 100%",
                transform: `rotate(${deg}deg)`,
                boxShadow: `0 0 6px ${accent}`,
              }}
            />
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-label={label}
            onChange={(e) => onVal(parseFloat(e.target.value))}
            onMouseUp={(e) => onVal(parseFloat((e.target as HTMLInputElement).value), true)}
            onTouchEnd={(e) => onVal(parseFloat((e.target as HTMLInputElement).value), true)}
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0,
              cursor: "pointer",
              margin: 0,
            }}
          />
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: muted, letterSpacing: "0.02em" }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#F4F1EC" }}>
          {format ? format(value) : value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}
        </span>
      </label>
    );
  }

  /** EQ frequency response sketch */
  function EqGraph({ accent }: { accent: string }) {
    const lo = Number(fx.eqLowDb) || 0;
    const mid = Number(fx.eqMidDb) || 0;
    const hi = Number(fx.eqHighDb) || 0;
    const air = Number(fx.air) || 0;
    const w = 320;
    const h = 140;
    const pts: string[] = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      // rough three-band + air shape
      const yDb =
        lo * Math.exp(-Math.pow((t - 0.15) / 0.18, 2)) +
        mid * Math.exp(-Math.pow((t - 0.45) / 0.14, 2)) +
        hi * Math.exp(-Math.pow((t - 0.72) / 0.16, 2)) +
        air * 6 * Math.exp(-Math.pow((t - 0.9) / 0.12, 2));
      const y = h / 2 - (yDb / 18) * (h / 2 - 12);
      pts.push(`${12 + t * (w - 24)},${Math.max(8, Math.min(h - 8, y))}`);
    }
    return (
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block", borderRadius: 12, background: "rgba(0,0,0,0.4)" }}>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={12} y1={h * g} x2={w - 12} y2={h * g} stroke="rgba(255,255,255,0.06)" />
        ))}
        <polyline fill="none" stroke={accent} strokeWidth={2.5} strokeLinejoin="round" points={pts.join(" ")} />
        <polygon
          fill={`${accent}33`}
          points={`12,${h - 8} ${pts.join(" ")} ${w - 12},${h - 8}`}
        />
        {[0.15, 0.45, 0.72, 0.9].map((t, i) => (
          <circle
            key={i}
            cx={12 + t * (w - 24)}
            cy={h / 2 - ([lo, mid, hi, air * 6][i] / 18) * (h / 2 - 12)}
            r={5}
            fill="#fff"
            stroke={accent}
            strokeWidth={2}
          />
        ))}
      </svg>
    );
  }

  /** Compressor transfer curve */
  function CompGraph({ accent }: { accent: string }) {
    const c = Math.max(0, Math.min(1, Number(fx.compress) || 0));
    const thresh = -12 - c * 20;
    const ratio = 1 + c * 7;
    const w = 280;
    const h = 140;
    const pts: string[] = [];
    for (let i = 0; i <= 40; i++) {
      const xin = -60 + (i / 40) * 60; // dB in
      let xout = xin;
      if (xin > thresh) xout = thresh + (xin - thresh) / ratio;
      const x = 12 + ((xin + 60) / 60) * (w - 24);
      const y = h - 12 - ((xout + 60) / 60) * (h - 24);
      pts.push(`${x},${y}`);
    }
    const tx = 12 + ((thresh + 60) / 60) * (w - 24);
    return (
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block", borderRadius: 12, background: "rgba(0,0,0,0.4)" }}>
        <line x1={12} y1={h - 12} x2={w - 12} y2={12} stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4" />
        <polyline fill="none" stroke={accent} strokeWidth={2.5} points={pts.join(" ")} />
        <circle cx={tx} cy={h - 12 - ((thresh + 60) / 60) * (h - 24)} r={6} fill={accent} stroke="#111" strokeWidth={1} />
      </svg>
    );
  }

  /** Gate envelope sketch */
  function GateGraph({ accent }: { accent: string }) {
    const g = Math.max(0, Math.min(1, Number(fx.gate) || 0));
    const floor = -48 + g * 8;
    const open = -6;
    const w = 280;
    const h = 130;
    // fake speech envelope vs gate
    const env = [0.1, 0.15, 0.8, 0.9, 0.2, 0.15, 0.85, 0.95, 0.3, 0.1, 0.7, 0.8, 0.15, 0.9, 0.85, 0.2];
    const envPts = env
      .map((v, i) => {
        const x = 12 + (i / (env.length - 1)) * (w - 24);
        const y = h - 12 - v * (h - 28);
        return `${x},${y}`;
      })
      .join(" ");
    const gateY = h - 12 - ((open - (-60)) / 60) * (h - 28) * (0.4 + g * 0.5);
    return (
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block", borderRadius: 12, background: "rgba(0,0,0,0.4)" }}>
        <polyline fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} points={envPts} />
        <line x1={12} y1={gateY} x2={w - 12} y2={gateY} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
        <polyline
          fill="none"
          stroke={accent}
          strokeWidth={2.5}
          points={env
            .map((v, i) => {
              const x = 12 + (i / (env.length - 1)) * (w - 24);
              const openAmt = v > 0.35 - g * 0.15 ? 1 : 0.15;
              const y = h - 12 - openAmt * (0.55 + g * 0.35) * (h - 28);
              return `${x},${y}`;
            })
            .join(" ")}
        />
      </svg>
    );
  }

  /** Distortion transfer */
  function DistGraph({ accent }: { accent: string }) {
    const s = Math.max(0, Math.min(1, Number(fx.saturation) || 0));
    const mode = Math.round(Number(fx.satMode) || 0);
    const tilt = Number(fx.satTilt) || 0;
    const bias = Number(fx.satBias) || 0;
    const w = 300;
    const h = 130;
    const pts: string[] = [];
    const drive = 1 + s * 14;
    for (let i = 0; i <= 48; i++) {
      let xIn = -1 + (i / 48) * 2;
      xIn = xIn + tilt * 0.25 * xIn * xIn * Math.sign(xIn || 1) + bias * 0.35;
      let yOut: number;
      if (s < 0.02) yOut = xIn;
      else if (mode === 1) yOut = Math.max(-1, Math.min(1, xIn * drive));
      else if (mode === 2) yOut = Math.sin(xIn * drive * Math.PI * 0.5);
      else if (mode === 3) yOut = xIn >= 0 ? Math.tanh(xIn * drive) : Math.tanh(xIn * drive * 0.55);
      else if (mode === 4) yOut = Math.sin(xIn * Math.PI * (0.5 + s * 1.2));
      else if (mode === 5) {
        const steps = Math.max(2, Math.round(16 - s * 12));
        yOut = Math.tanh((Math.round(xIn * steps) / steps) * drive);
      } else yOut = Math.tanh(xIn * drive);
      const x = 12 + (i / 48) * (w - 24);
      const y = h / 2 - yOut * (h / 2 - 12);
      pts.push(`${x},${y}`);
    }
    return (
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block", borderRadius: 12, background: "rgba(0,0,0,0.4)" }}>
        <line x1={12} y1={h / 2} x2={w - 12} y2={h / 2} stroke="rgba(255,255,255,0.1)" />
        <line x1={w / 2} y1={8} x2={w / 2} y2={h - 8} stroke="rgba(255,255,255,0.08)" />
        <line x1={12} y1={h - 12} x2={w - 12} y2={12} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
        <polyline fill="none" stroke={accent} strokeWidth={2.5} points={pts.join(" ")} />
        {[0.25, 0.5, 0.75].map((t) => (
          <circle
            key={t}
            cx={12 + t * (w - 24)}
            cy={h / 2 - (Math.tanh((-1 + t * 2) * drive) * (h / 2 - 12)) * (s > 0.02 ? 1 : 0)}
            r={4}
            fill="#fff"
            stroke={accent}
            strokeWidth={1.5}
          />
        ))}
      </svg>
    );
  }

  function SpaceGraph({ wet, accent }: { wet: number; accent: string }) {
    const a = Math.max(0, Math.min(1, wet));
    return (
      <div
        style={{
          height: 100,
          borderRadius: 12,
          background: "rgba(0,0,0,0.4)",
          display: "flex",
          alignItems: "flex-end",
          gap: 3,
          padding: "12px 14px",
        }}
      >
        {Array.from({ length: 28 }).map((_, i) => {
          const decay = Math.exp(-i * (0.06 + (1 - a) * 0.12));
          const hh = 10 + decay * a * 70 + Math.sin(i * 0.55) * 5 * a;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: hh,
                borderRadius: 2,
                background: `linear-gradient(180deg, ${accent}, ${accent}44)`,
                opacity: 0.3 + decay * 0.7,
              }}
            />
          );
        })}
      </div>
    );
  }

  function MiniPreview({ id, accent }: { id: string; accent: string }) {
    if (id === "eq") return <EqGraph accent={accent} />;
    if (id === "compress") return <CompGraph accent={accent} />;
    if (id === "gate") return <GateGraph accent={accent} />;
    if (id === "sat") return <DistGraph accent={accent} />;
    if (id === "reverb" || id === "plate")
      return <SpaceGraph wet={Number(id === "plate" ? fx.plateReverb : fx.reverb) || 0.3} accent={accent} />;
    if (id === "delay" || id === "slap")
      return <SpaceGraph wet={Number(id === "slap" ? fx.slapDelay : fx.delay) || 0.25} accent={accent} />;
    return (
      <div style={{ height: 72, borderRadius: 12, background: "rgba(0,0,0,0.35)", display: "grid", placeItems: "center" }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", border: `2px solid ${accent}`, opacity: 0.7 }} />
      </div>
    );
  }

  const modalDef = modalId ? PLUGINS.find((p) => p.id === modalId) : null;

  function renderModalKnobs(id: string, accent: string) {
    const k = (key: keyof TrackFx, label: string, min: number, max: number, step: number, fmt?: (n: number) => string) => (
      <Knob
        key={String(key)}
        label={label}
        value={Number(fx[key]) || 0}
        min={min}
        max={max}
        step={step}
        accent={accent}
        format={fmt}
        onVal={(n, commit) => setKey(key, n, commit)}
      />
    );
    switch (id) {
      case "compress":
        return (
          <>
            {k("compress", "Thresh", 0, 1, 0.01, (n) => `${Math.round(-12 - n * 20)}dB`)}
            {k("compress", "Ratio", 0, 1, 0.01, (n) => `${(1 + n * 7).toFixed(1)}:1`)}
            {k("limiter", "Gain", 0, 1, 0.01)}
          </>
        );
      case "eq":
        return (
          <>
            {k("eqLowDb", "Low", -12, 12, 0.5, (n) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`)}
            {k("eqMidDb", "Mid", -12, 12, 0.5, (n) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`)}
            {k("eqHighDb", "High", -12, 12, 0.5, (n) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`)}
            {k("air", "Air", 0, 1, 0.01)}
          </>
        );
      case "gate":
        return (
          <>
            {k("gate", "Thresh", 0, 1, 0.01)}
            {k("noiseReduce", "Floor", 0, 1, 0.01)}
          </>
        );
      case "sat": {
        const modes = [
          { id: 0, label: "Soft" },
          { id: 1, label: "Hard" },
          { id: 2, label: "Fold" },
          { id: 3, label: "Asym" },
          { id: 4, label: "Sine" },
          { id: 5, label: "Crush" },
        ] as const;
        const mode = Math.round(Number(fx.satMode) || 0);
        return (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {k("saturation", "Drive", 0, 1, 0.01, (n) => `${(n * 12).toFixed(1)} dB`)}
              {k("satTilt", "Tilt", -1, 1, 0.01)}
              {k("satBias", "Bias", -1, 1, 0.01)}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                justifyContent: "center",
              }}
            >
              {modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    const next = { ...fx, satMode: m.id } as TrackFx;
                    onChange(next);
                    onCommit(next);
                  }}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 999,
                    border: "none",
                    background: mode === m.id ? accent : "rgba(255,255,255,0.06)",
                    color: mode === m.id ? "#111" : "#F4F1EC",
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {k("satMix", "Mix", 0, 1, 0.01)}
              {k("satCutoff", "Cutoff", 0, 1, 0.01)}
              {k("satOut", "Out", 0, 1, 0.01)}
            </div>
          </div>
        );
      }
      case "reverb":
        return (
          <>
            {k("reverb", "Size", 0, 1, 0.01, (n) => n.toFixed(1))}
            {k("reverb", "Mix", 0, 1, 0.01)}
            {k("plateReverb", "Damping", 0, 1, 0.01)}
          </>
        );
      case "plate":
        return <>{k("plateReverb", "Mix", 0, 1, 0.01)}{k("reverb", "Width", 0, 1, 0.01)}</>;
      case "delay":
        return <>{k("delay", "Time", 0, 1, 0.01)}{k("delay", "Mix", 0, 1, 0.01)}</>;
      case "slap":
        return <>{k("slapDelay", "Slap", 0, 1, 0.01)}</>;
      case "hpf":
        return <>{k("highPassHz", "Freq", 20, 400, 5, (n) => `${Math.round(n)} Hz`)}</>;
      case "lpf":
        return <>{k("lowPassHz", "Freq", 2000, 18000, 50, (n) => `${Math.round(n)} Hz`)}</>;
      case "air":
        return <>{k("air", "Air", 0, 1, 0.01)}</>;
      case "deess":
        return <>{k("deEss", "Amount", 0, 1, 0.01)}</>;
      case "denoise":
        return <>{k("noiseReduce", "Amount", 0, 1, 0.01)}</>;
      case "limiter":
        return <>{k("limiter", "Ceiling", 0, 1, 0.01)}</>;
      case "chorus":
        return <>{k("chorus", "Depth", 0, 1, 0.01)}</>;
      case "doubler":
        return <>{k("doubler", "Amount", 0, 1, 0.01)}</>;
      case "width":
        return <>{k("width", "Width", 0, 1, 0.01)}</>;
      case "cleanup":
        return <>{k("phraseCleanup", "Tighten", 0, 1, 0.01)}</>;
      case "telephone":
        return <>{k("telephone", "Amount", 0, 1, 0.01)}</>;
      case "voice":
        return (
          <>
            {k("voiceChanger", "Mix", 0, 1, 0.01)}
            {k("voicePitchSemis", "Pitch", -12, 12, 1, (n) => `${n > 0 ? "+" : ""}${Math.round(n)} st`)}
            {k("voiceCharacter", "Character", 0, 6, 1, (n) => String(Math.round(n)))}
          </>
        );
      case "rotor":
        return (
          <>
            {k("rotorMix", "Mix", 0, 1, 0.01)}
            {k("rotorSpeed", "Speed", 0, 1, 0.01)}
            {k("rotorDepth", "Depth", 0, 1, 0.01)}
            {k("rotorWarmth", "Warmth", 0, 1, 0.01)}
            {k("rotorFast", "Fast", 0, 1, 0.01, (n) => (n > 0.5 ? "Fast" : "Slow"))}
          </>
        );
      case "spring":
        return (
          <>
            {k("springMix", "Mix", 0, 1, 0.01)}
            {k("springDelay", "Pre-delay", 0, 1, 0.01)}
            {k("springTension", "Tension", 0, 1, 0.01)}
            {k("springDamp", "Damp", 0, 1, 0.01)}
            {k("springMod", "Mod", 0, 1, 0.01)}
          </>
        );
      default:
        return null;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Utility row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <Knob
          label="Gain"
          value={Number(fx.gainDb) || 0}
          min={-18}
          max={12}
          step={0.5}
          accent={brass}
          format={(n) => `${n > 0 ? "+" : ""}${n.toFixed(1)} dB`}
          onVal={(n, c) => setKey("gainDb", n, c)}
        />
        <Knob
          label="Pan"
          value={Number(fx.pan) || 0}
          min={-1}
          max={1}
          step={0.01}
          accent="#94A3B8"
          format={(n) => (Math.abs(n) < 0.02 ? "C" : n < 0 ? `L${Math.round(-n * 100)}` : `R${Math.round(n * 100)}`)}
          onVal={(n, c) => setKey("pan", n, c)}
        />
        <Knob
          label="Width"
          value={Number(fx.width) || 0}
          min={0}
          max={1}
          step={0.01}
          accent="#FB7185"
          onVal={(n, c) => setKey("width", n, c)}
        />
      </div>

      {/* Plugin dock — Suno-style chain */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          padding: "10px 12px",
          borderRadius: 14,
          background: "rgba(0,0,0,0.35)",
          border: `1px solid ${border}`,
          maxWidth: "100%",
        }}
      >
        {effectiveRack.map((id) => {
          const def = PLUGINS.find((p) => p.id === id);
          const active = modalId === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                setModalId(id);
                setFxEditMode(
                  (EFFECT_PLUGIN_PRESETS[id] || []).length > 0 ? "presets" : "custom"
                );
              }}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: active ? `1px solid ${def?.accent || brass}` : `1px solid ${border}`,
                background: active ? `${def?.accent || brass}22` : "rgba(18,18,24,0.9)",
                color: "#F4F1EC",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: def?.accent || brass,
                  boxShadow: `0 0 8px ${def?.accent || brass}`,
                }}
              />
              {def?.label || id}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            border: `1px dashed ${brass}88`,
            background: "transparent",
            color: brass,
            fontSize: 12,
            fontWeight: 800,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          + Effect
        </button>
      </div>

      <p style={{ margin: 0, fontSize: 11, color: muted, lineHeight: 1.45 }}>
        Tap an effect to open its panel. Drag knobs to shape the sound — changes apply live on this track.
      </p>

      {/* Track-wide FX presets (preserved) */}
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: brass,
            marginBottom: 6,
          }}
        >
          PRESETS
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {FX_PRESETS.map((pr) => (
            <button
              key={pr.id}
              type="button"
              onClick={() => {
                const next = applyFxPreset(fx as never, pr.id) as TrackFx;
                onChange(next);
                onCommit(next);
                const need = [
                  "eq",
                  "compress",
                  "reverb",
                  "sat",
                  "deess",
                  "plate",
                  "delay",
                  "doubler",
                  "chorus",
                  "hpf",
                  "gate",
                  "limiter",
                  "air",
                ];
                const base = rack.length > 0 ? rack : effectiveRack;
                const nextRack = Array.from(
                  new Set([
                    ...base,
                    ...need.filter((id) => {
                      const def = PLUGINS.find((p) => p.id === id);
                      if (!def) return false;
                      return def.keys.some(
                        (k) => Math.abs(Number((next as any)[k]) || 0) > 0.02
                      );
                    }),
                  ])
                );
                onRackChange(nextRack);
              }}
              style={{
                padding: "6px 11px",
                borderRadius: 999,
                border: `1px solid ${border}`,
                background: "rgba(0,0,0,0.3)",
                color: "#F4F1EC",
                fontSize: 11,
                fontWeight: 650,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {pr.label}
            </button>
          ))}
        </div>
      </div>

      {/* Effect inspector modal */}
      {modalDef && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10100,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: 12,
          }}
          onClick={() => setModalId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(460px, 100%)",
              maxHeight: "min(85dvh, 100%)",
              overflowY: "auto",
              borderRadius: 18,
              background: "linear-gradient(180deg, #1a1a22 0%, #121218 100%)",
              border: `1px solid ${modalDef.accent}55`,
              boxShadow: `0 24px 80px rgba(0,0,0,0.65), 0 0 40px ${modalDef.accent}18`,
              padding: "14px 16px max(16px, env(safe-area-inset-bottom))",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: modalDef.accent,
                    boxShadow: `0 0 10px ${modalDef.accent}`,
                  }}
                />
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: "#F4F1EC" }}>{modalDef.label}</div>
                  <div style={{ fontSize: 11, color: muted }}>Custom · live on this track</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => removePlugin(modalDef.id)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    background: "transparent",
                    color: "#F87171",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => setModalId(null)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    background: "rgba(0,0,0,0.35)",
                    color: "#F4F1EC",
                    cursor: "pointer",
                    fontSize: 16,
                  }}
                >
                  ×
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <MiniPreview id={modalDef.id} accent={modalDef.accent} />
            </div>

            {/* Per-effect: Presets | Custom */}
            <div
              style={{
                display: "flex",
                gap: 4,
                padding: 3,
                borderRadius: 12,
                background: "rgba(0,0,0,0.35)",
                marginBottom: 14,
              }}
            >
              {([
                ["presets", "Presets"],
                ["custom", "Custom"],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFxEditMode(id)}
                  style={{
                    flex: 1,
                    padding: "8px 6px",
                    borderRadius: 10,
                    border: "none",
                    background: fxEditMode === id ? modalDef.accent : "transparent",
                    color: fxEditMode === id ? "#111" : muted,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {fxEditMode === "presets" ? (
              <div>
                <p style={{ margin: "0 0 10px", fontSize: 12, color: muted, lineHeight: 1.4 }}>
                  Starting points for this effect. Switch to Custom to fine-tune knobs.
                </p>
                {(EFFECT_PLUGIN_PRESETS[modalDef.id] || []).length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: muted }}>No presets for this effect yet.</p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {(EFFECT_PLUGIN_PRESETS[modalDef.id] || []).map((pr) => (
                      <button
                        key={pr.id}
                        type="button"
                        onClick={() => {
                          const next = applyEffectPluginPreset(
                            fx as never,
                            modalDef.id,
                            pr.id
                          ) as TrackFx;
                          onChange(next);
                          onCommit(next);
                        }}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 10,
                          border: `1px solid ${modalDef.accent}66`,
                          background: "rgba(0,0,0,0.35)",
                          color: "#F4F1EC",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {pr.label}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setFxEditMode("custom")}
                  style={{
                    marginTop: 14,
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: `1px solid ${border}`,
                    background: "transparent",
                    color: brass,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Edit custom knobs →
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {renderModalKnobs(modalDef.id, modalDef.accent)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Effects browser — Suno grid */}
      {addOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10120,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setAddOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 100%)",
              maxHeight: "min(88dvh, 100%)",
              overflow: "auto",
              borderRadius: 18,
              border: `1px solid ${border}`,
              background: "#121218",
              padding: 16,
              boxShadow: "0 28px 90px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", color: muted }}>AUDIO EFFECTS</div>
                <div style={{ fontWeight: 800, fontSize: 17, color: "#F4F1EC" }}>Add to chain</div>
              </div>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: `1px solid ${border}`,
                  background: "transparent",
                  color: muted,
                  cursor: "pointer",
                  fontSize: 18,
                }}
              >
                ×
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 132px), 1fr))",
                gap: 10,
              }}
            >
              {PLUGINS.map((p) => {
                const on = effectiveRack.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addPlugin(p.id)}
                    style={{
                      textAlign: "left",
                      padding: 10,
                      borderRadius: 14,
                      border: on ? `1px solid ${p.accent}` : `1px solid ${border}`,
                      background: on ? `${p.accent}18` : "rgba(255,255,255,0.03)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      color: "#F4F1EC",
                    }}
                  >
                    <div
                      style={{
                        height: 64,
                        borderRadius: 10,
                        background: "rgba(0,0,0,0.35)",
                        marginBottom: 8,
                        overflow: "hidden",
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <div
                        style={{
                          width: "70%",
                          height: 28,
                          borderRadius: 4,
                          background: `linear-gradient(90deg, transparent, ${p.accent}88, transparent)`,
                          opacity: 0.85,
                        }}
                      />
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{p.label}</div>
                    <div style={{ fontSize: 10, color: muted, marginTop: 2 }}>{p.blurb}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



function menuItemStyle(color: string, disabled?: boolean): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "10px 14px",
    border: "none",
    background: "transparent",
    color: disabled ? "rgba(244,241,236,0.35)" : color,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    borderRadius: 8,
    opacity: disabled ? 0.55 : 1,
  };
}

function iconBtn(border: string, surface: string, text: string): React.CSSProperties {
  return {
    width: 36,
    height: 36,
    minWidth: 36,
    minHeight: 36,
    maxHeight: 36,
    flexShrink: 0,
    borderRadius: 10,
    border: `1px solid ${border}`,
    background: surface,
    color: text,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 15,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
    boxSizing: "border-box",
    padding: 0,
  };
}

function miniChip(
  border: string,
  brass: string,
  on: boolean,
  text: string,
  compact?: boolean
): React.CSSProperties {
  const s = compact ? 22 : 26;
  const h = compact ? 22 : 24;
  return {
    width: s,
    height: h,
    borderRadius: 6,
    border: `1px solid ${on ? brass : border}`,
    background: on ? "rgba(231,169,97,0.2)" : "transparent",
    color: text,
    fontSize: compact ? 9 : 10,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
