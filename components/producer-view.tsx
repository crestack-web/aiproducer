"use client";

/**
 * Console — AI-DAW timeline for a project (/app/console/[id]).
 *
 * Naming: Booth = guided record (/app/studio/[id]); Studio = hub (/app/studio).
 * Shared: same recording_tasks / takes as Booth. Capture uses Booth live pipeline
 * (openRecordingStream + createVocalRecorder) — never a parallel recorder.
 * Offline AP (restore/pitch/mix/master) only after save, same as Booth.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import { STUDIO_LOGO_URL } from "@/lib/brand";
import { openRecordingStream, createVocalRecorder } from "@/lib/audio/recording-engine";
import {
  parseConsoleCommands,
  AP_SUGGESTIONS,
  type DawAction,
} from "@/lib/ap-engine/console-commands";
import { forceDownloadFromApi } from "@/lib/download-audio";
import { produceReadinessFromTasks } from "@/lib/production/readiness";
import type { PlanTaskRow } from "@/lib/plan";
import { prepareTakesForProduce } from "@/lib/client/prepare-takes-for-produce";
import {
  decodeAudioUrl,
  deleteRegionFromBuffer,
  keepRegionFromBuffer,
  spliceReplacementIntoBuffer,
  encodeWavBlob,
  bufferDurationMs,
  peaksFromBuffer,
  isValidRegion,
  normalizeRegion,
  type TakeRegion,
} from "@/lib/client/take-edit";

export type TrackFx = {
  gainDb: number;
  eqLowDb: number;
  eqMidDb: number;
  eqHighDb: number;
  compress: number; // 0–1
  reverb: number;
  delay: number;
  saturation: number;
  /** Stereo pan: -1 = full left, 0 = center, 1 = full right */
  pan: number;
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
  pan: 0,
};

export type ProducerLayer = {
  id: string;
  label: string;
  role: string;
  sectionLabel?: string;
  startMs: number;
  endMs: number;
  audioUrl?: string | null;
  color?: string;
  trackFx?: TrackFx | null;
};

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
    queued: "AP is getting everything ready…",
    prepare_vocals: "AP is getting everything ready…",
    arrange: "AP is getting everything ready…",
    render_stems: "AP is getting everything ready…",
    "preparing takes": "AP is getting everything ready…",
    analyzing: "AP is listening to your recording…",
    restoring: "Cleaning up your vocal…",
    producing: "Building your vocal sound…",
    mixing: "Blending your voice with the beat…",
    mix: "Blending your voice with the beat…",
    mix_submit: "Blending your voice with the beat…",
    mix_poll: "Blending your voice with the beat…",
    mix_store: "Blending your voice with the beat…",
    mastering: "Adding the final polish…",
    master: "Adding the final polish…",
    master_submit: "Adding the final polish…",
    master_poll: "Adding the final polish…",
    quality_check: "AP is checking your final mix…",
    webhook_received: "Adding the final polish…",
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

function formatPlayhead(ms: number): string {
  const totalSec = Math.max(0, ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

function ZoomIcon({ zoomIn }: { zoomIn: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {zoomIn ? (
        <>
          <path d="M11 8v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <path d="M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

/** Fit entire timeline into the visible scroll area */
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

/** Locked heights so left rail rows and timeline lanes share one grid */
const TRACK_RULER_H = 40;
const TRACK_ROW_H = 72;
const TRACK_ROW_H_EXPANDED = 128;

function formatMs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** Peak buckets cached per URL — shared across zoom redraws. */
const peakCache = new Map<string, Float32Array>();
const bufferCache = new Map<string, AudioBuffer>();

async function fetchDecode(
  ctx: AudioContext,
  url: string
): Promise<AudioBuffer | null> {
  if (bufferCache.has(url)) return bufferCache.get(url)!;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr.slice(0));
    bufferCache.set(url, buf);
    return buf;
  } catch (e) {
    console.warn("[producer-view] decode failed", url, e);
    return null;
  }
}

/** Downsample channel peaks into `buckets` max-abs values. */
function computePeaks(buf: AudioBuffer, buckets: number): Float32Array {
  const cacheKey = `${buf.length}:${buf.sampleRate}:${buckets}`;
  // Prefer URL-level cache set by caller; this is compute-only
  const ch = buf.getChannelData(0);
  const peaks = new Float32Array(buckets);
  const block = Math.max(1, Math.floor(ch.length / buckets));
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * block;
    const end = Math.min(ch.length, start + block);
    for (let j = start; j < end; j++) {
      const v = Math.abs(ch[j]);
      if (v > max) max = v;
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

function WaveformCanvas({
  peaks,
  color,
  width,
  height,
  dimmed,
}: {
  peaks: Float32Array | null;
  color: string;
  width: number;
  height: number;
  dimmed?: boolean;
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
    if (!peaks || peaks.length === 0) {
      ctx.fillStyle = dimmed ? color + "33" : color + "55";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    // Peak-normalize so quiet takes still read clearly (errors / dropouts stand out)
    let peakMax = 0;
    for (let i = 0; i < peaks.length; i++) {
      if (peaks[i] > peakMax) peakMax = peaks[i];
    }
    const norm = peakMax > 1e-4 ? 1 / peakMax : 1;
    const mid = height / 2;
    // Bold solid clip body (same language as beat)
    ctx.fillStyle = dimmed ? color + "55" : color + "DD";
    ctx.fillRect(0, 0, width, height);
    // Soft top sheen
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, "rgba(255,255,255,0.14)");
    grad.addColorStop(0.5, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.18)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    // Center reference (helps spot silence / clipping)
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();
    const n = peaks.length;
    const barW = Math.max(1.5, width / n);
    for (let i = 0; i < n; i++) {
      const raw = peaks[i] * norm;
      // floor so true silence is a hairline; loud is full height
      const amp = Math.min(1, raw * 1.05);
      const h = Math.max(amp < 0.04 ? 1.5 : 3, amp * (height * 0.88));
      const x = i * barW;
      const bw = Math.max(1.4, barW - 0.4);
      // Near-silence: dim so dropouts read as gaps
      if (amp < 0.04) {
        ctx.fillStyle = dimmed ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.2)";
      } else {
        ctx.fillStyle = dimmed ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.95)";
      }
      ctx.fillRect(x, mid - h / 2, bw, h);
    }
  }, [peaks, color, width, height, dimmed]);
  return (
    <canvas
      ref={ref}
      style={{ display: "block", width, height, borderRadius: 6 }}
    />
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
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef(0);

  const [layers, setLayers] = useState(layersProp);
  const [durationMs, setDurationMs] = useState(durationProp || 0);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>("beat");
  const [pxPerSec, setPxPerSec] = useState(56);
  const [loopOn, setLoopOn] = useState(false);
  const loopOnRef = useRef(false);

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
  useEffect(() => {
    setTitleDraft(projectTitle || "Session");
  }, [projectTitle]);
  const [soloId, setSoloId] = useState<string | null>(null);
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [peaksById, setPeaksById] = useState<Record<string, Float32Array | null>>({});

  const [decodeStatus, setDecodeStatus] = useState<string>("");
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [showAddTrack, setShowAddTrack] = useState(false);
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
  /** Live input level 0–1 — passive analyser tap, not in monitor/capture path */
  const [liveLevel, setLiveLevel] = useState(0);
  /** Rolling peak samples for in-clip live waveform while recording */
  const [livePeaks, setLivePeaks] = useState<number[]>([]);
  /** Armed task — Record captures into this planned/mock clip */
  const [armedTrackId, setArmedTrackId] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const monitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const consoleRecRef = useRef<{
    recorder: MediaRecorder;
    chunks: BlobPart[];
    stream: MediaStream;
    dispose: () => void;
    taskId: string;
    startedAt: number;
  } | null>(null);
  const recordTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveMeterRafRef = useRef<number | null>(null);
  const liveMeterCtxRef = useRef<AudioContext | null>(null);
  const livePeaksBufRef = useRef<number[]>([]);
  const beatFileInputRef = useRef<HTMLInputElement | null>(null);
  const [fxById, setFxById] = useState<Record<string, TrackFx>>({});
  const [fxOpenId, setFxOpenId] = useState<string | null>(null);
  const [colorById, setColorById] = useState<Record<string, string>>({});
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [trackPrompt, setTrackPrompt] = useState("");
  const [trackPromptBusy, setTrackPromptBusy] = useState(false);
  const [apPhase, setApPhase] = useState(0);
  const [apLastResult, setApLastResult] = useState<"ok" | "err" | null>(null);
  const [apSteps, setApSteps] = useState<{ label: string; done: boolean; active: boolean }[]>([]);
  const [apSummary, setApSummary] = useState<string | null>(null);

  // —— Produce (shared job API — same as Booth) ——
  type ProduceUi = "idle" | "starting" | "producing" | "complete" | "failed";
  const [produceUi, setProduceUi] = useState<ProduceUi>("idle");
  const [produceStage, setProduceStage] = useState<string | null>(null);
  const [produceJobId, setProduceJobId] = useState<string | null>(null);
  const [masterUrl, setMasterUrl] = useState<string | null>(null);
  /** Job id that owns the currently shown master — avoid stale “ready” after re-produce */
  const [masterJobId, setMasterJobId] = useState<string | null>(null);
  const [produceError, setProduceError] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const producePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const produceStartedAtRef = useRef(0);
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
  const dragRef = useRef<{
    id: string;
    mode: "move" | "trim-start" | "trim-end";
    originX: number;
    originStart: number;
    originEnd: number;
    lastStart: number;
    lastEnd: number;
  } | null>(null);

  async function runDawAction(action: DawAction) {
    switch (action.type) {
      case "mute":
        setMuted((m) => ({ ...m, [action.trackId]: action.value }));
        break;
      case "solo":
        setSoloId(action.trackId);
        break;
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
          const raw = Number(cur[action.key]) || 0;
          let nextVal = raw + action.delta;
          if (action.key === "eqLowDb" || action.key === "eqMidDb" || action.key === "eqHighDb") {
            nextVal = Math.max(-12, Math.min(12, nextVal));
          } else {
            nextVal = Math.max(0, Math.min(1, nextVal));
          }
          const next = { ...cur, [action.key]: nextVal };
          void persistFx(action.trackId, next);
          return { ...prev, [action.trackId]: next };
        });
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
              setEditMsg("Record or upload a take on this track first — AP needs audio to shape.");
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
            const j = await res.json().catch(() => ({}));
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
          const j = await res.json().catch(() => ({}));
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
        const j = await res.json().catch(() => ({}));
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

  async function persistFx(id: string, fx: TrackFx) {
    setFxById((prev) => ({ ...prev, [id]: fx }));
    setSavingId(id);
    try {
      const res = await fetch(`/api/recording-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_fx: fx }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setEditMsg(typeof j.error === "string" ? j.error : "Could not save FX");
      } else {
        onLayersChanged?.();
      }
    } catch {
      setEditMsg("Network error saving FX");
    } finally {
      setSavingId(null);
    }
  }

  async function persistLayer(
    id: string,
    patch: { start_ms?: number; end_ms?: number; status?: string }
  ) {
    setSavingId(id);
    setEditMsg(null);
    try {
      const res = await fetch(`/api/recording-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setEditMsg(typeof j.error === "string" ? j.error : "Could not save edit");
        return false;
      }
      onLayersChanged?.();
      return true;
    } catch {
      setEditMsg("Network error saving edit");
      return false;
    } finally {
      setSavingId(null);
    }
  }

  function updateLocalLayer(id: string, startMs: number, endMs: number) {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, startMs, endMs } : l)));
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
      lastStart: startMs,
      lastEnd: endMs,
    };
  }

  function onClipPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dxMs = ((e.clientX - d.originX) / pxPerSec) * 1000;
    let start = d.originStart;
    let end = d.originEnd;
    const minLen = 400;
    if (d.mode === "move") {
      const dur = d.originEnd - d.originStart;
      start = Math.max(0, d.originStart + dxMs);
      end = start + dur;
      if (end > totalMs) {
        end = totalMs;
        start = Math.max(0, end - dur);
      }
    } else if (d.mode === "trim-start") {
      start = Math.max(0, Math.min(d.originEnd - minLen, d.originStart + dxMs));
    } else {
      end = Math.min(totalMs, Math.max(d.originStart + minLen, d.originEnd + dxMs));
    }
    const s = Math.round(start);
    const en = Math.round(end);
    d.lastStart = s;
    d.lastEnd = en;
    updateLocalLayer(d.id, s, en);
  }

  function onClipPointerUp() {
    const d = dragRef.current;
    if (!d || d.id === "beat") {
      dragRef.current = null;
      return;
    }
    const { id, lastStart, lastEnd } = d;
    dragRef.current = null;
    void persistLayer(id, { start_ms: lastStart, end_ms: lastEnd });
  }

  async function deleteLayer(id: string) {
    if (id === "beat") return;
    if (!window.confirm("Remove this layer from the plan? The recorded take stays saved.")) return;
    const ok = await persistLayer(id, { status: "skipped" });
    if (ok) setLayers((prev) => prev.filter((l) => l.id !== id));
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
      }),
    });
    const j = await res.json().catch(() => ({}));
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
      stopSources();
      setPlaying(false);
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
    const durationMs = Math.max(500, Date.now() - rec.startedAt);
    const taskId = rec.taskId;
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

    setEditMsg("Saving take…");
    try {
      const fd = new FormData();
      fd.append("file", blob, `console-take-${Date.now()}.webm`);
      fd.append("duration_ms", String(durationMs));
      const up = await fetch(`/api/recording-tasks/${taskId}/recordings`, {
        method: "POST",
        body: fd,
      });
      const uj = await up.json().catch(() => ({}));
      if (!up.ok) {
        setEditMsg(typeof uj.error === "string" ? uj.error : "Upload failed");
        return;
      }
      await fetch(`/api/recording-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          end_ms: Math.round((layers.find((l) => l.id === taskId)?.startMs || playheadMs) + durationMs),
        }),
      }).catch(() => null);

      const audioUrl =
        uj.recording?.audio_url || uj.audio_url || uj.recording?.url || null;
      if (audioUrl) {
        setLayers((prev) =>
          prev.map((l) =>
            l.id === taskId
              ? {
                  ...l,
                  audioUrl,
                  endMs: Math.max(l.endMs, l.startMs + durationMs),
                }
              : l
          )
        );
      }
      setEditMsg("Take saved — shared with Booth (same recording_tasks)");
      setArmedTrackId(taskId);
      setSelectedTrackId(taskId);
      onLayersChanged?.();
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Save failed");
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
        preferredInputId: "",
        outputPreference: "__headphones__",
      });
      const { recorder, mimeType } = createVocalRecorder(opened.recordStream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      consoleRecRef.current = {
        recorder,
        chunks,
        stream: opened.stream,
        dispose: opened.dispose,
        taskId,
        startedAt: Date.now(),
      };
      recorder.start(250);
      setIsConsoleRecording(true);
      setRecordSeconds(0);
      // Passive level meter on cloned mic tracks (not in capture or monitor path)
      startLiveMeter(opened.stream);
      recordTickRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);

      // Monitor beat on a separate <audio> (never connected to MediaRecorder)
      const layer = layers.find((l) => l.id === taskId);
      const fromMs = layer?.startMs ?? playheadMs;
      setPlayheadMs(fromMs);
      if (beatUrl) {
        try {
          const a = new Audio(beatUrl);
          a.currentTime = Math.max(0, fromMs / 1000);
          monitorAudioRef.current = a;
          void a.play();
        } catch {
          /* ignore */
        }
      }
      setEditMsg(`Recording into track… (${mimeType.split(";")[0]})`);
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Mic permission failed");
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
    setTakeUndoDepth(takeUndoStackRef.current.length);
  }

  function refreshTakePeaks(buf: AudioBuffer) {
    setTakePeaks(peaksFromBuffer(buf, 96));
    setTakeDurationMs(bufferDurationMs(buf));
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
  }

  function undoTakeEdit() {
    const prev = takeUndoStackRef.current.pop();
    if (!prev) return;
    takeWorkingRef.current = prev;
    setTakeUndoDepth(takeUndoStackRef.current.length);
    refreshTakePeaks(prev);
    setTakeSel(null);
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
      src.start(0, start, dur);
    } else {
      src.start(0);
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
      const uj = await up.json().catch(() => ({}));
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
        uj.recording?.audio_url || uj.audio_url || uj.recording?.url || null;
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
      const uj = await up.json().catch(() => ({}));
      if (!up.ok) {
        setEditMsg(typeof uj.error === "string" ? uj.error : "Beat upload failed");
        return;
      }
      setEditMsg("Building producer plan (same as Booth)…");
      const ar = await fetch(`/api/projects/${projectId}/analyze`, { method: "POST" });
      const aj = await ar.json().catch(() => ({}));
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
      const aj = await ar.json().catch(() => ({}));
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
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
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
        // ~30 samples/sec into clip history (every other frame ~)
        frame += 1;
        if (frame % 2 === 0) {
          livePeaksBufRef.current.push(Math.min(1, peak * 1.4));
          if (livePeaksBufRef.current.length > 2400) {
            livePeaksBufRef.current = livePeaksBufRef.current.slice(-2400);
          }
          if (frame % 4 === 0) {
            setLivePeaks(livePeaksBufRef.current.slice());
          }
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
      const j = await res.json().catch(() => ({}));
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
        const uj = await up.json().catch(() => ({}));
        if (!up.ok) {
          setEditMsg(
            typeof uj.error === "string"
              ? uj.error
              : "Track created; upload failed — record a take in the booth"
          );
        } else {
          audioUrl =
            uj.recording?.audio_url ||
            uj.audio_url ||
            uj.recording?.url ||
            null;
          // mark completed if upload ok
          await fetch(`/api/recording-tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "completed" }),
          }).catch(() => null);
        }
      }

      setLayers((prev) => [
        ...prev,
        {
          id: task.id,
          label: (task.type || addType).replace(/_/g, " "),
          role: task.type || addType,
          sectionLabel: task.title || addTitle || "Custom",
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
      const urlById = new Map(prev.map((l) => [l.id, l.audioUrl]));
      return layersProp.map((l) => ({
        ...l,
        audioUrl: l.audioUrl || urlById.get(l.id) || null,
      }));
    });
    setFxById((prev) => {
      const next = { ...prev };
      for (const l of layersProp) {
        if (l.trackFx) next[l.id] = { ...DEFAULT_TRACK_FX, ...l.trackFx };
        else if (!next[l.id]) next[l.id] = { ...DEFAULT_TRACK_FX };
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
      const end = Number(l.endMs) || 0;
      max = Math.max(max, end, start + 500);
    }
    // Prefer real beat length when known; never cap the scroll region to the first section only
    return Math.max(max, 60_000);
  }, [durationMs, sections, layers]);

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
    }[] = [];
    list.push({
      id: "beat",
      label: "Beat",
      kind: "beat",
      color: ROLE_COLORS.beat,
      startMs: 0,
      endMs: totalMs,
      url: beatUrl,
    });
    for (const l of layers) {
      list.push({
        id: l.id,
        label: l.label,
        kind: "vocal",
        color: colorById[l.id] || l.color || roleColor(l.role),
        startMs: l.startMs,
        endMs: Math.max(l.endMs, l.startMs + 500),
        sub: l.sectionLabel,
        url: l.audioUrl,
      });
    }
    return list;
  }, [layers, totalMs, beatUrl, colorById]);

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
      const next: Record<string, Float32Array | null> = {};
      for (const tr of tracks) {
        if (!tr.url) {
          next[tr.id] = null;
          continue;
        }
        const buf = await fetchDecode(ctx, tr.url);
        if (cancelled) return;
        if (buf) {
          if (tr.id === "beat") {
            setDurationMs((d) => Math.max(d, Math.round(buf.duration * 1000)));
          }
          // store high-res peaks once
          peaksForUrl(tr.url, buf, 2048);
          next[tr.id] = peaksForUrl(tr.url, buf, peakBuckets);
        } else {
          next[tr.id] = null;
        }
      }
      if (!cancelled) {
        setPeaksById(next);
        setDecodeStatus("");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.map((t) => t.url).join("|"), getCtx]);

  // Re-bucket peaks when zoom changes (from cache, no re-decode)
  useEffect(() => {
    setPeaksById((prev) => {
      const next: Record<string, Float32Array | null> = { ...prev };
      for (const tr of tracks) {
        if (!tr.url) continue;
        const hi = peakCache.get(`${tr.url}::2048`);
        if (hi) {
          next[tr.id] = peaksForUrl(tr.url, bufferCache.get(tr.url)!, peakBuckets);
        }
      }
      return next;
    });
  }, [peakBuckets, tracks]);

  function isAudible(id: string, kind: "beat" | "vocal") {
    // Solo = selected track + beat for context (producer checking a layer against the beat)
    if (soloId) {
      if (id === soloId) return true;
      if (kind === "beat") return true;
      return false;
    }
    return !muted[id];
  }

  function applyGains() {
    for (const tr of tracks) {
      const g = gainsRef.current.get(tr.id);
      if (!g) continue;
      const on = isAudible(tr.id, tr.kind);
      const fx = fxById[tr.id] || DEFAULT_TRACK_FX;
      const lin = Math.pow(10, (fx.gainDb || 0) / 20);
      g.gain.setTargetAtTime(on ? lin : 0, audioCtxRef.current?.currentTime || 0, 0.02);
      const panNode = panNodesRef.current.get(tr.id);
      if (panNode) {
        const p = Math.max(-1, Math.min(1, Number(fx.pan) || 0));
        panNode.pan.setTargetAtTime(p, audioCtxRef.current?.currentTime || 0, 0.02);
      }
    }
  }

  useEffect(() => {
    applyGains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, soloId, tracks, fxById]);

  function stopSources() {
    for (const s of sourcesRef.current) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    sourcesRef.current = [];
    gainsRef.current.clear();
    panNodesRef.current.clear();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }

  useEffect(() => {
    loopOnRef.current = loopOn;
  }, [loopOn]);

  function tickPlayhead() {
    const ctx = audioCtxRef.current;
    if (!ctx || !playing) return;
    const elapsed = (ctx.currentTime - startedAtRef.current) * 1000 + offsetRef.current;
    setPlayheadMs(Math.min(totalMs, Math.max(0, elapsed)));
    if (elapsed >= totalMs) {
      if (loopOnRef.current && totalMs > 0) {
        // Restart from start without dropping loop state
        void startPlayback(0);
        return;
      }
      setPlaying(false);
      stopSources();
      return;
    }
    rafRef.current = requestAnimationFrame(tickPlayhead);
  }

  async function startPlayback(fromMs: number) {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") await ctx.resume();
    stopSources();
    offsetRef.current = fromMs;
    startedAtRef.current = ctx.currentTime;
    const startSec = fromMs / 1000;

    for (const tr of tracks) {
      if (!tr.url) continue;
      let buf = bufferCache.get(tr.url) || null;
      if (!buf) buf = await fetchDecode(ctx, tr.url);
      if (!buf) continue;

      const gain = ctx.createGain();
      const on = isAudible(tr.id, tr.kind);
      const fx = fxById[tr.id] || DEFAULT_TRACK_FX;
      const gainLin = Math.pow(10, (fx.gainDb || 0) / 20);
      gain.gain.value = on ? gainLin : 0;
      gainsRef.current.set(tr.id, gain);

      // Phase 4 FX chain: src → EQ → compress → sat (wave shape via gain) → delay/reverb mix → gain → dest
      const low = ctx.createBiquadFilter();
      low.type = "lowshelf";
      low.frequency.value = 200;
      low.gain.value = fx.eqLowDb || 0;
      const mid = ctx.createBiquadFilter();
      mid.type = "peaking";
      mid.frequency.value = 1200;
      mid.Q.value = 0.9;
      mid.gain.value = fx.eqMidDb || 0;
      const high = ctx.createBiquadFilter();
      high.type = "highshelf";
      high.frequency.value = 5000;
      high.gain.value = fx.eqHighDb || 0;

      const comp = ctx.createDynamicsCompressor();
      const cAmt = fx.compress || 0;
      comp.threshold.value = -10 - cAmt * 30;
      comp.knee.value = 12;
      comp.ratio.value = 1 + cAmt * 11;
      comp.attack.value = 0.01;
      comp.release.value = 0.2;

      const dry = ctx.createGain();
      dry.gain.value = 1;
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.28;
      const delayGain = ctx.createGain();
      delayGain.gain.value = (fx.delay || 0) * 0.45;
      const delayFb = ctx.createGain();
      delayFb.gain.value = 0.25;

      // Lightweight "reverb": multi-tap delays
      const revGain = ctx.createGain();
      revGain.gain.value = (fx.reverb || 0) * 0.35;
      const rev1 = ctx.createDelay(1.0);
      rev1.delayTime.value = 0.05;
      const rev2 = ctx.createDelay(1.0);
      rev2.delayTime.value = 0.12;
      const rev3 = ctx.createDelay(1.0);
      rev3.delayTime.value = 0.23;

      const satGain = ctx.createGain();
      // soft drive approximation via pre-gain into compressor
      satGain.gain.value = 1 + (fx.saturation || 0) * 1.5;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(low);
      low.connect(mid);
      mid.connect(high);
      high.connect(satGain);
      satGain.connect(comp);
      comp.connect(dry);
      dry.connect(gain);

      comp.connect(delay);
      delay.connect(delayGain);
      delay.connect(delayFb);
      delayFb.connect(delay);
      delayGain.connect(gain);

      comp.connect(rev1);
      rev1.connect(rev2);
      rev2.connect(rev3);
      rev1.connect(revGain);
      rev2.connect(revGain);
      rev3.connect(revGain);
      revGain.connect(gain);

      const panNode = ctx.createStereoPanner();
      const panVal = Math.max(-1, Math.min(1, Number(fx.pan) || 0));
      panNode.pan.value = panVal;
      panNodesRef.current.set(tr.id, panNode);
      gain.connect(panNode);
      panNode.connect(ctx.destination);

      // Vocals: offset by section start on the timeline
      if (tr.kind === "vocal") {
        const layerStart = tr.startMs / 1000;
        const localOffset = startSec - layerStart;
        if (localOffset >= buf.duration) {
          // past this clip
          continue;
        }
        if (localOffset >= 0) {
          src.start(0, localOffset);
        } else {
          // playhead before clip — schedule start later
          src.start(ctx.currentTime + -localOffset, 0);
        }
      } else {
        if (startSec >= buf.duration) continue;
        src.start(0, startSec);
      }
      sourcesRef.current.push(src);
    }

    setPlaying(true);
    setPlayheadMs(fromMs);
    rafRef.current = requestAnimationFrame(tickPlayhead);
  }


  function fitTimelineToView() {
    const el = timelineScrollRef.current;
    if (!el || totalMs <= 0) return;
    const usable = Math.max(160, el.clientWidth - 16);
    const sec = Math.max(0.5, totalMs / 1000);
    // Allow slightly wider range than +/- buttons so long songs can fit
    const next = Math.max(8, Math.min(160, usable / sec));
    setPxPerSec(next);
    el.scrollLeft = 0;
  }

  function togglePlay() {
    if (playing) {
      const ctx = audioCtxRef.current;
      if (ctx) {
        offsetRef.current =
          (ctx.currentTime - startedAtRef.current) * 1000 + offsetRef.current;
      }
      stopSources();
      setPlaying(false);
    } else {
      void startPlayback(playheadMs);
    }
  }


  function clearProducePoll() {
    if (producePollRef.current) {
      clearTimeout(producePollRef.current);
      producePollRef.current = null;
    }
    produceActiveRef.current = false;
  }

  const pollProduceOnce = useCallback(async (): Promise<"complete" | "failed" | "pending" | "error"> => {
    if (!projectId) return "error";
    try {
      const sr = await fetch(`/api/projects/${projectId}/status`);
      const st = await sr.json().catch(() => ({}));
      if (!sr.ok) return "error";

      const jobs = (st.jobs || []) as {
        id?: string;
        type?: string;
        status?: string;
        stage?: string;
        error?: string;
      }[];
      const produceJob =
        jobs.find((j) => j.type === "PRODUCE_SONG") ||
        (produceJobId ? jobs.find((j) => j.id === produceJobId) : undefined);

      if (produceJob?.id) setProduceJobId(String(produceJob.id));
      if (produceJob?.stage) setProduceStage(String(produceJob.stage));

      const jobStatus = (produceJob?.status || "").toLowerCase();
      const projectStatus = String(st.project?.status || st.status || "").toLowerCase();

      if (jobStatus === "failed" || projectStatus === "failed") {
        const raw = produceJob?.error || "AP couldn’t finish producing this version.";
        // Strip provider-ish language
        const clean = String(raw)
          .replace(/\bRoEx\b/gi, "AP")
          .replace(/\bmixer\b/gi, "production")
          .slice(0, 180);
        setProduceError(clean || "AP couldn’t finish producing this version.");
        setProduceUi("failed");
        return "failed";
      }

      const masterReady =
        Boolean(st.master_url) ||
        (st.master?.audio_path &&
          typeof st.master.audio_path === "string" &&
          !String(st.master.audio_path).startsWith("http") &&
          !String(st.master.audio_path).startsWith("mock://"));

      if (
        (jobStatus === "complete" ||
          jobStatus === "completed" ||
          projectStatus === "complete" ||
          projectStatus === "completed" ||
          projectStatus === "produced") &&
        (st.master_url || masterReady)
      ) {
        let url = st.master_url ? String(st.master_url) : null;
        if (!url) {
          const alt = st.master?.url || st.audio_url;
          if (alt) url = String(alt);
        }
        if (!url) {
          url = await resolveMasterPlayUrl();
        }
        if (url) setMasterUrl(url);
        if (produceJob?.id) setMasterJobId(String(produceJob.id));
        setProduceStage("complete");
        setProduceUi("complete");
        setProduceError(null);
        return "complete";
      }

      if (jobStatus === "complete" || jobStatus === "completed") {
        // Job done but URL lag — keep pending briefly
        setProduceStage(produceJob?.stage || "complete");
        return "pending";
      }

      if (jobStatus === "queued" || jobStatus === "processing" || jobStatus === "running") {
        setProduceUi("producing");
        return "pending";
      }

      return "pending";
    } catch {
      return "error";
    }
  }, [projectId, produceJobId]);

  const scheduleProducePoll = useCallback(() => {
    clearProducePoll();
    produceActiveRef.current = true;
    const PRODUCE_POLL_MS = 3500;
    const PRODUCE_MAX_MS = 10 * 60 * 1000;
    const tick = async () => {
      if (!produceActiveRef.current) return;
      if (Date.now() - produceStartedAtRef.current > PRODUCE_MAX_MS) {
        setProduceUi("failed");
        setProduceError(
          "This is taking longer than expected. Tap Try again — if AP is still working, production will resume."
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
        const st = await sr.json().catch(() => ({}));
        const jobs = (st.jobs || []) as {
          id?: string;
          type?: string;
          status?: string;
          stage?: string;
        }[];
        const produceJob = jobs.find((j) => j.type === "PRODUCE_SONG");
        const js = (produceJob?.status || "").toLowerCase();
        if (produceJob?.id) setProduceJobId(String(produceJob.id));
        if (js === "queued" || js === "processing" || js === "running") {
          setProduceUi("producing");
          setProduceStage(produceJob?.stage || "processing");
          produceStartedAtRef.current = Date.now();
          scheduleProducePoll();
        } else if (js === "failed") {
          setProduceUi("failed");
          setProduceError("AP couldn’t finish this production.");
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
        const st = await sr.json().catch(() => ({}));
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

  async function startConsoleProduce() {
    if (!projectId) return;
    if (produceUi === "producing" || produceUi === "starting") return;

    setProduceUi("starting");
    setProduceError(null);
    setMasterUrl(null);
    setMasterJobId(null);
    setMasterPlaying(false);

    let planTasks: PlanTaskRow[] = [];
    try {
      const tr = await fetch(`/api/projects/${projectId}/recording-tasks?all=1`);
      const tj = await tr.json().catch(() => ({}));
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

    setProduceStage("preparing takes");
    setProduceUi("producing");

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
      const res = await fetch(`/api/projects/${projectId}/produce`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
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
      if (jid) setProduceJobId(String(jid));

      if (j.deduped && (j.status === "queued" || j.status === "processing")) {
        setProduceStage(j.stage || "queued");
        produceStartedAtRef.current = Date.now();
        scheduleProducePoll();
        return;
      }

      if (
        j.master_url &&
        res.status === 200 &&
        (j.status === "complete" || j.status === "completed")
      ) {
        setMasterUrl(String(j.master_url));
        if (jid) setMasterJobId(String(jid));
        setProduceUi("complete");
        setProduceStage("complete");
        return;
      }

      setProduceStage(j.stage || "queued");
      produceStartedAtRef.current = Date.now();
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

  function seekTo(ms: number) {
    const clamped = Math.max(0, Math.min(totalMs, ms));
    setPlayheadMs(clamped);
    if (playing) {
      void startPlayback(clamped);
    }
  }

  function nudgePan(trackId: string, delta: number) {
    if (!trackId) return;
    setFxById((prev) => {
      const cur = prev[trackId] || { ...DEFAULT_TRACK_FX };
      const nextPan = Math.max(-1, Math.min(1, (Number(cur.pan) || 0) + delta));
      const next = { ...cur, pan: Math.round(nextPan * 20) / 20 };
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
      if (commit) void persistFx(trackId, next);
      return { ...prev, [trackId]: next };
    });
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
      if (!sel) return;
      if (key === "m" || key === "M") {
        e.preventDefault();
        setMuted((m) => ({ ...m, [sel]: !m[sel] }));
        return;
      }
      if (key === "s" || key === "S") {
        e.preventDefault();
        setSoloId((cur) => (cur === sel ? null : sel));
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

  const msToX = (ms: number) => (ms / 1000) * pxPerSec;

  const bg = C.bg || "#0a0a0c";
  const surface = C.surface || "rgba(255,255,255,0.06)";
  const border = C.border || "rgba(255,255,255,0.12)";
  const text = C.text || "#F4F1EC";
  const mutedText = C.textMuted || "#9B96A3";
  const faint = C.textFaint || "#5C5866";
  const brass = C.brass || "#E7A961";

  // Expanded rail must fit labels + M/S/FX without shrinking text (overflow, not scale)
  const sidebarW = sidebarCollapsed ? (isNarrow ? 56 : 64) : isNarrow ? 180 : 280;
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
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          paddingTop: "max(8px, env(safe-area-inset-top))",
          borderBottom: `1px solid ${border}`,
          flexShrink: 0,
          background: surface,
          minHeight: isNarrow ? 48 : 56,
          flexWrap: isNarrow ? "wrap" : "nowrap",
          rowGap: 6,
        }}
      >
        <a
          href={libraryHref || "/app"}
          style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: text, flexShrink: 0 }}
          title="Library"
        >
          <img
            src={STUDIO_LOGO_URL}
            alt="Studio"
            width={28}
            height={28}
            style={{ borderRadius: 8, objectFit: "cover", display: "block" }}
          />
          <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: "0.04em", color: brass }}>CONSOLE</span>
        </a>

        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          aria-label="Song title"
          style={{ flex: 1, minWidth: 0, maxWidth: isNarrow ? 120 : 280, background: "rgba(255,255,255,0.06)", border: `1px solid ${border}`, borderRadius: 8, color: text, fontWeight: 600, fontSize: isNarrow ? 13 : 14, padding: "6px 10px", fontFamily: "inherit" }}
        />


        {projectId ? (
          <button
            type="button"
            onClick={() => void startConsoleProduce()}
            disabled={produceUi === "producing" || produceUi === "starting"}
            title="Produce finished song with AP"
            style={{
              flexShrink: 0,
              height: 36,
              padding: "0 14px",
              borderRadius: 999,
              border: "none",
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

        <button
          type="button"
          title={isConsoleRecording ? "Stop recording" : "Record vocal into selected track (raw capture, same as Booth)"}
          onClick={() => void toggleConsoleRecord()}
          style={{
            ...iconBtn(border, surface, text),
            width: 40,
            height: 40,
            borderRadius: 999,
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
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
          style={{ width: 44, height: 44, borderRadius: 999, border: "none", background: `linear-gradient(180deg, #F0BC80, ${brass})`, color: "#1A1208", fontWeight: 800, fontSize: 16, cursor: "pointer", flexShrink: 0 }}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 13, color: mutedText, minWidth: 88, fontWeight: 600 }}>
          {formatPlayhead(playheadMs)}
        </div>

        <div
          style={{ fontSize: 12, color: tempoBpm != null ? text : faint, fontWeight: 600, minWidth: 64, padding: "4px 8px", borderRadius: 6, border: `1px solid ${border}`, background: "rgba(255,255,255,0.04)" }}
          title={tempoBpm != null ? "Project tempo" : "BPM not detected for this project yet"}
        >
          {tempoBpm != null && Number.isFinite(tempoBpm) ? `${Math.round(tempoBpm)} BPM` : "— BPM"}
        </div>

        <button type="button" onClick={() => setPxPerSec((z) => Math.max(28, z - 12))} style={iconBtn(border, surface, text)} aria-label="Zoom out" title="Zoom out">
          <ZoomIcon zoomIn={false} />
        </button>
        <button type="button" onClick={() => setPxPerSec((z) => Math.min(140, z + 12))} style={iconBtn(border, surface, text)} aria-label="Zoom in" title="Zoom in">
          <ZoomIcon zoomIn={true} />
        </button>
        <button
          type="button"
          onClick={() => fitTimelineToView()}
          style={iconBtn(border, surface, text)}
          aria-label="Fit to view"
          title="Fit song to view"
        >
          <FitViewIcon />
        </button>
        <button
          type="button"
          onClick={() => setLoopOn((v) => !v)}
          style={{
            ...iconBtn(border, surface, text),
            color: loopOn ? brass : text,
            borderColor: loopOn ? brass : border,
            background: loopOn ? "rgba(231,169,97,0.15)" : surface,
          }}
          aria-label={loopOn ? "Loop on" : "Loop off"}
          title={loopOn ? "Loop on — click to disable" : "Loop session"}
          aria-pressed={loopOn}
        >
          <LoopIcon />
        </button>

        {!isNarrow && (
          <a href={libraryHref || "/app"} style={{ ...iconBtn(border, surface, text), textDecoration: "none", fontSize: 12, fontWeight: 700, padding: "0 12px", width: "auto", color: text }}>
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
            style={{ ...iconBtn(border, surface, text), width: "auto", padding: "0 12px", fontSize: 12, fontWeight: 700 }}
          >
            Booth
          </button>
        )}
      </div>
      {editMsg && (
        <div
          style={{
            padding: "8px 14px",
            fontSize: 12,
            color: "#E8756A",
            background: "rgba(232,117,106,0.1)",
            borderBottom: `1px solid ${border}`,
          }}
        >
          {editMsg}
        </div>
      )}
      {savingId && (
        <div style={{ padding: "6px 14px", fontSize: 12, color: faint, borderBottom: `1px solid ${border}` }}>
          Saving edit…
        </div>
      )}


      
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
            overflowX: "hidden",
            WebkitOverflowScrolling: "touch",
            borderRight: `1px solid ${border}`,
            background: bg,
            overscrollBehavior: "contain",
          }}
        >
          <div
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
              gap: 6,
              padding: "0 8px",
              background: bg,
              borderBottom: `1px solid ${border}`,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={toggleSidebar}
              style={{
                background: "none",
                border: "none",
                color: faint,
                cursor: "pointer",
                padding: 0,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                fontFamily: "inherit",
                flexShrink: 0,
              }}
              title={sidebarCollapsed ? "Expand tracks" : "Collapse tracks"}
            >
              {sidebarCollapsed ? "»" : "TRACKS"}
            </button>
            {!sidebarCollapsed && (
              <div style={{ display: "flex", gap: 4, marginLeft: "auto", minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: brass,
                    border: `1px solid ${brass}88`,
                    borderRadius: 6,
                    padding: "2px 6px",
                    whiteSpace: "nowrap",
                  }}
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
                      fontSize: 10,
                      fontWeight: 700,
                      color: mutedText,
                      border: `1px solid ${border}`,
                      borderRadius: 6,
                      padding: "2px 6px",
                      background: "transparent",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    BOOTH
                  </button>
                )}
              </div>
            )}
          </div>
          {tracks.map((tr, trackIdx) => {
            const isMuted = muted[tr.id];
            const isSolo = soloId === tr.id;
            const isExpanded = expandedId === tr.id;
            const rowH = isExpanded ? TRACK_ROW_H_EXPANDED : TRACK_ROW_H;
            return (
              <div
                key={`h-${tr.id}`}
                style={{
                  height: rowH,
                  minHeight: rowH,
                  maxHeight: rowH,
                  boxSizing: "border-box",
                  borderBottom: `1px solid rgba(255,255,255,0.06)`,
                  borderLeft: `3px solid ${tr.color}`,
                  padding: sidebarCollapsed ? "6px 4px" : isExpanded ? "8px 10px" : "6px 8px",
                  background:
                    selectedTrackId === tr.id || armedTrackId === tr.id
                      ? "rgba(255,255,255,0.06)"
                      : isExpanded
                        ? "rgba(255,255,255,0.03)"
                        : "transparent",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: isExpanded ? "flex-start" : "center",
                  gap: isExpanded ? 6 : 4,
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
                {/* Name row — always visible when panel open */}
                <button
                  type="button"
                  onClick={() => {
                    // Click expands this track (and collapses others) — big panel like pre-record UX
                    setExpandedId(isExpanded ? null : tr.id);
                    setSelectedTrackId(tr.id);
                    if (tr.kind === "vocal") setArmedTrackId(tr.id);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: text,
                    fontWeight: 700,
                    fontSize: sidebarCollapsed ? 11 : isExpanded ? 14 : 13,
                    lineHeight: 1.25,
                    padding: 0,
                    textAlign: "left",
                    cursor: "pointer",
                    width: "100%",
                    minWidth: 0,
                    fontFamily: "inherit",
                    display: sidebarCollapsed ? "none" : "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    overflow: "hidden",
                    flexShrink: 0,
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
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                      minWidth: 0,
                    }}
                    title={tr.label}
                  >
                    {tr.label || (tr.kind === "beat" ? "Beat" : "Vocal")}
                  </span>
                  {isExpanded ? (
                    <span style={{ color: faint, fontSize: 10, flexShrink: 0 }}>▾</span>
                  ) : (
                    <span style={{ color: faint, fontSize: 10, flexShrink: 0 }}>▸</span>
                  )}
                </button>
                {!sidebarCollapsed && tr.sub && isExpanded ? (
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
                {!sidebarCollapsed ? (
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    marginTop: isExpanded ? 2 : 0,
                    flexWrap: "wrap",
                    alignItems: "center",
                    maxWidth: "100%",
                    flexShrink: 0,
                  }}
                >
                  <button
                    type="button"
                    title={isMuted ? "Unmute" : "Mute"}
                    onClick={() => setMuted((m) => ({ ...m, [tr.id]: !m[tr.id] }))}
                    style={{ ...miniChip(border, brass, isMuted, text), fontSize: 11 }}
                  >
                    {isMuted ? "🔇" : "🔊"}
                  </button>
                  <button
                    type="button"
                    title="Solo"
                    onClick={() => setSoloId(soloId === tr.id ? null : tr.id)}
                    style={miniChip(border, brass, isSolo, text)}
                  >
                    S
                  </button>
                  {isExpanded && tr.url && tr.id !== "beat" && takeEditId !== tr.id ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void beginTakeEdit(tr.id, tr.url);
                      }}
                      style={{
                        ...miniChip(border, brass, false, text),
                        padding: "0 8px",
                        fontSize: 10,
                        fontWeight: 700,
                        width: "auto",
                      }}
                      title="Edit take — delete, keep, or retake a region"
                    >
                      Edit
                    </button>
                  ) : null}
                  {isExpanded ? (
                    <>
                  <div
                    title="Pan — drag, double-click to center (L/[ · ]/Shift+R)"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                      flex: "1 1 72px",
                      minWidth: 72,
                      maxWidth: 120,
                      padding: "0 2px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        color: (fxById[tr.id]?.pan ?? 0) < -0.05 ? brass : faint,
                        letterSpacing: "0.02em",
                        userSelect: "none",
                      }}
                    >
                      L
                    </span>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={fxById[tr.id]?.pan ?? 0}
                      aria-label={`Pan ${tr.label}`}
                      onChange={(e) => {
                        setSelectedTrackId(tr.id);
                        setPan(tr.id, parseFloat(e.target.value), false);
                      }}
                      onPointerUp={(e) => {
                        setSelectedTrackId(tr.id);
                        setPan(tr.id, parseFloat((e.target as HTMLInputElement).value), true);
                      }}
                      onDoubleClick={() => {
                        setSelectedTrackId(tr.id);
                        setPan(tr.id, 0, true);
                      }}
                      style={{
                        flex: 1,
                        minWidth: 40,
                        height: 18,
                        margin: 0,
                        accentColor: brass,
                        cursor: "pointer",
                      }}
                    />
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        color: (fxById[tr.id]?.pan ?? 0) > 0.05 ? brass : faint,
                        letterSpacing: "0.02em",
                        userSelect: "none",
                      }}
                    >
                      R
                    </span>
                  </div>
                  <button
                    type="button"
                    title="Effects"
                    onClick={() => {
                      setSelectedTrackId(tr.id);
                      setFxOpenId(tr.id);
                    }}
                    style={miniChip(border, brass, fxOpenId === tr.id, text)}
                  >
                    FX
                  </button>
                  {tr.kind === "vocal" && (
                    <>
                      <button
                        type="button"
                        title="Color"
                        onClick={() =>
                          setColorPickerId(colorPickerId === tr.id ? null : tr.id)
                        }
                        style={{
                          width: 22,
                          height: 20,
                          borderRadius: 5,
                          border: `1px solid ${border}`,
                          background: tr.color,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      />
                      <button
                        type="button"
                        title="Remove"
                        onClick={() => void deleteLayer(tr.id)}
                        style={miniChip(border, "#E8756A", false, text)}
                      >
                        ×
                      </button>
                    </>
                  )}
                    </>
                  ) : null}
                </div>
                ) : (
                  <div
                    style={{
                      marginTop: 4,
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: tr.color,
                      marginLeft: "auto",
                      marginRight: "auto",
                    }}
                    title={tr.label}
                  />
                )}
                {colorPickerId === tr.id && tr.kind === "vocal" && !sidebarCollapsed && (
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
              </div>
            );
          })}
        </div>

        {/* RIGHT: timeline — horizontal + vertical scroll (vertical synced with headers) */}
        <div
          ref={timelineScrollRef}
          onScroll={onTimelineScroll}
          style={{
            flex: 1,
            minWidth: 0,
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
            }}
          >
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 6,
                height: TRACK_RULER_H,
                width: timelineW,
                minWidth: timelineW,
                borderBottom: `1px solid ${border}`,
                background: surface,
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left + (timelineScrollRef.current?.scrollLeft || 0);
                seekTo((x / pxPerSec) * 1000);
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
              <div
                style={{
                  position: "absolute",
                  left: msToX(playheadMs),
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: "#F07167",
                  pointerEvents: "none",
                  zIndex: 4,
                  boxShadow: "0 0 8px rgba(240,113,103,0.6)",
                }}
              />
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
              // Take length wins while recording: clip grows with elapsed time
              const liveEndMs = isLiveRec
                ? tr.startMs + Math.max(400, recordSeconds * 1000)
                : tr.endMs;
              const displayEndMs = isLiveRec ? Math.max(tr.endMs, liveEndMs) : tr.endMs;
              const clipW = Math.max(10, msToX(displayEndMs) - msToX(tr.startMs));
              const rowH = expanded ? TRACK_ROW_H_EXPANDED : TRACK_ROW_H;
              const clipH = expanded ? Math.min(96, rowH - 20) : Math.min(48, rowH - 16);
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
                    borderBottom: `1px solid rgba(255,255,255,0.06)`,
                    background:
                      selectedTrackId === tr.id || isArmed
                        ? "rgba(255,255,255,0.04)"
                        : "transparent",
                  }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x =
                      e.clientX - rect.left + (timelineScrollRef.current?.scrollLeft || 0);
                    seekTo((x / pxPerSec) * 1000);
                    setSelectedTrackId(tr.id);
                    if (tr.kind === "vocal") setArmedTrackId(tr.id);
                  }}
                >
                  <div
                    data-layer-id={tr.id}
                    onPointerMove={onClipPointerMove}
                    onPointerUp={onClipPointerUp}
                    onPointerCancel={onClipPointerUp}
                    style={{
                      position: "absolute",
                      left: msToX(tr.startMs),
                      width: clipW,
                      top: expanded ? 12 : 8,
                      height: clipH,
                      borderRadius: 6,
                      background: isLiveRec
                        ? `linear-gradient(180deg, ${tr.color}cc, ${tr.color})`
                        : tr.color,
                      boxShadow: isLiveRec
                        ? `0 0 0 2px #F07167, 0 0 16px ${tr.color}aa`
                        : isArmed
                          ? `0 0 0 2px ${brass}, 0 0 14px ${brass}99`
                          : selectedTrackId === tr.id
                            ? `0 0 0 2px #fff, 0 0 12px ${tr.color}88`
                            : `0 1px 0 rgba(0,0,0,0.35)`,
                      overflow: "hidden",
                      cursor: tr.kind === "vocal" ? (isMock ? "pointer" : "grab") : "default",
                      touchAction: "none",
                      opacity: dimmed ? 0.4 : 1,
                      outline: isArmed && !isLiveRec ? `1px dashed ${brass}` : undefined,
                    }}
                    onPointerDown={
                      tr.kind === "vocal"
                        ? (e) => {
                            setSelectedTrackId(tr.id);
                            setArmedTrackId(tr.id);
                            // Mock/unrecorded: arm only (no drag). Recorded: move/trim as before.
                            if (!isMock && !isLiveRec) {
                              onClipPointerDown(e, tr.id, "move", tr.startMs, tr.endMs);
                            }
                          }
                        : () => setSelectedTrackId(tr.id)
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
                        peaks={peaksById[tr.id] || null}
                        color={tr.color}
                        width={clipW}
                        height={clipH}
                        dimmed={dimmed}
                      />
                    )}
                    <div
                      style={{
                        position: "absolute",
                        left: 6,
                        top: 4,
                        right: 6,
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#0B0A0F",
                        textShadow: "0 0 4px rgba(255,255,255,0.35)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                      }}
                    >
                      {tr.label}
                      {tr.sub ? ` — ${tr.sub}` : ""}
                    </div>
                    {tr.kind === "vocal" && (
                      <>
                        <div
                          onPointerDown={(e) =>
                            onClipPointerDown(e, tr.id, "trim-start", tr.startMs, tr.endMs)
                          }
                          style={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: 14,
                            background: "rgba(255,255,255,0.35)",
                            cursor: "ew-resize",
                            touchAction: "none",
                          }}
                        />
                        <div
                          onPointerDown={(e) =>
                            onClipPointerDown(e, tr.id, "trim-end", tr.startMs, tr.endMs)
                          }
                          style={{
                            position: "absolute",
                            right: 0,
                            top: 0,
                            bottom: 0,
                            width: 14,
                            background: "rgba(255,255,255,0.35)",
                            cursor: "ew-resize",
                            touchAction: "none",
                          }}
                        />
                      </>
                    )}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: msToX(playheadMs),
                      top: 0,
                      bottom: 0,
                      width: 2,
                      background: "#F07167",
                      pointerEvents: "none",
                      zIndex: 4,
                    }}
                  />
                </div>
              );
            })}
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
      
      {/* Take edit — performance region tools */}
      {takeEditId ? (
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: promptBarOpen ? 140 : 72,
            zIndex: 40,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              pointerEvents: "auto",
              width: "100%",
              maxWidth: 480,
              borderRadius: 14,
              padding: "12px 14px",
              background: "rgba(18,18,24,0.96)",
              border: `1px solid ${brass}`,
              boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: brass }}>
                Edit take
                {retakeTarget ? " · Retake armed" : ""}
              </div>
              <div style={{ fontSize: 11, color: mutedText }}>
                {takeDurationMs > 0 ? `${(takeDurationMs / 1000).toFixed(1)}s` : ""}
              </div>
            </div>

            {/* Simple peak strip + selection */}
            <div
              style={{
                position: "relative",
                height: 56,
                borderRadius: 8,
                background: "rgba(0,0,0,0.35)",
                border: `1px solid ${border}`,
                overflow: "hidden",
                touchAction: "none",
                marginBottom: 10,
              }}
              onPointerDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
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
              }}
              onPointerMove={(e) => {
                const d = takeSelDragRef.current;
                if (!d || takeDurationMs <= 0) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const ms = x * takeDurationMs;
                if (d.mode === "create") {
                  setTakeSel({
                    startMs: Math.min(d.originStart, ms),
                    endMs: Math.max(d.originStart, ms),
                  });
                }
              }}
              onPointerUp={() => {
                takeSelDragRef.current = null;
                if (takeSel && takeDurationMs > 0) {
                  setTakeSel(normalizeRegion(takeSel, takeDurationMs));
                }
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-end", height: "100%", gap: 1, padding: "4px 2px" }}>
                {takePeaks.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      height: `${Math.max(6, p * 100)}%`,
                      background: brass,
                      opacity: 0.55,
                      borderRadius: 1,
                    }}
                  />
                ))}
              </div>
              {takeSel && takeDurationMs > 0 ? (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: `${(Math.min(takeSel.startMs, takeSel.endMs) / takeDurationMs) * 100}%`,
                    width: `${(Math.abs(takeSel.endMs - takeSel.startMs) / takeDurationMs) * 100}%`,
                    background: "rgba(231,169,97,0.28)",
                    borderLeft: `2px solid ${brass}`,
                    borderRight: `2px solid ${brass}`,
                    pointerEvents: "none",
                  }}
                />
              ) : null}
            </div>

            <div style={{ fontSize: 11, color: mutedText, marginBottom: 8 }}>
              {takeSel && isValidRegion(takeSel, takeDurationMs)
                ? `Selected ${(Math.min(takeSel.startMs, takeSel.endMs) / 1000).toFixed(2)}s – ${(Math.max(takeSel.startMs, takeSel.endMs) / 1000).toFixed(2)}s`
                : "Drag on the waveform to select a region"}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              <button
                type="button"
                onClick={playTakeSelection}
                style={{
                  height: 34,
                  padding: "0 12px",
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
                ▶ Play
              </button>
              <button
                type="button"
                disabled={!isValidRegion(takeSel, takeDurationMs) || takeEditBusy}
                onClick={applyTakeDelete}
                style={{
                  height: 34,
                  padding: "0 12px",
                  borderRadius: 999,
                  border: "1px solid rgba(240,113,103,0.4)",
                  background: "rgba(240,113,103,0.12)",
                  color: "#F07167",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: isValidRegion(takeSel, takeDurationMs) ? "pointer" : "default",
                  opacity: isValidRegion(takeSel, takeDurationMs) ? 1 : 0.4,
                  fontFamily: "inherit",
                }}
              >
                Delete
              </button>
              <button
                type="button"
                disabled={!isValidRegion(takeSel, takeDurationMs) || takeEditBusy}
                onClick={applyTakeKeep}
                style={{
                  height: 34,
                  padding: "0 12px",
                  borderRadius: 999,
                  border: `1px solid ${border}`,
                  background: "rgba(255,255,255,0.06)",
                  color: text,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: isValidRegion(takeSel, takeDurationMs) ? "pointer" : "default",
                  opacity: isValidRegion(takeSel, takeDurationMs) ? 1 : 0.4,
                  fontFamily: "inherit",
                }}
              >
                Keep
              </button>
              <button
                type="button"
                disabled={!isValidRegion(takeSel, takeDurationMs) || takeEditBusy || isConsoleRecording}
                onClick={startRetakeRegion}
                style={{
                  height: 34,
                  padding: "0 12px",
                  borderRadius: 999,
                  border: `1px solid ${brass}`,
                  background: retakeTarget ? "rgba(231,169,97,0.2)" : "rgba(255,255,255,0.04)",
                  color: brass,
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: isValidRegion(takeSel, takeDurationMs) ? "pointer" : "default",
                  opacity: isValidRegion(takeSel, takeDurationMs) ? 1 : 0.4,
                  fontFamily: "inherit",
                }}
              >
                Retake
              </button>
              <button
                type="button"
                disabled={takeUndoDepth === 0 || takeEditBusy}
                onClick={undoTakeEdit}
                style={{
                  height: 34,
                  padding: "0 12px",
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
                Undo
              </button>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={cancelTakeEdit}
                disabled={takeEditBusy}
                style={{
                  flex: 1,
                  height: 36,
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
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void commitTakeEdit()}
                disabled={takeEditBusy}
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 999,
                  border: "none",
                  background: `linear-gradient(180deg, #F0BC80, ${brass})`,
                  color: "#1A1208",
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: takeEditBusy ? "default" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {takeEditBusy ? "…" : "Done"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {projectId && produceUi !== "idle" ? (
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            top: isNarrow ? 58 : 64,
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
            {produceUi === "producing" ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 800, color: brass, marginBottom: 4 }}>
                  AP is producing your song
                </div>
                <div style={{ fontSize: 12, color: mutedText, lineHeight: 1.4 }}>
                  {humanProduceStage(produceStage)}
                </div>
                <div
                  style={{
                    marginTop: 10,
                    height: 3,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.08)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: "45%",
                      borderRadius: 999,
                      background: `linear-gradient(90deg, transparent, ${brass}, transparent)`,
                      backgroundSize: "200% 100%",
                      animation: "apShimmer 1.2s linear infinite",
                    }}
                  />
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
                  AP couldn’t finish producing this version
                </div>
                {produceError ? (
                  <div style={{ fontSize: 12, color: mutedText, marginBottom: 10, lineHeight: 1.4 }}>
                    {produceError}
                  </div>
                ) : null}
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
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
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

            {/* Scope chips — tap a track to attach it here */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 10,
                alignItems: "center",
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

      {/* FX modal — Suno-style plugin sheet */}
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
              color={text}
              muted={mutedText}
              border={border}
              brass={brass}
              surface={bg}
              onChange={(fx) => setFxById((prev) => ({ ...prev, [fxOpenId]: fx }))}
              onCommit={(fx) => void persistFx(fxOpenId, fx)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TrackFxPanel({
  fx,
  color,
  muted,
  border,
  brass,
  surface,
  onChange,
  onCommit,
}: {
  fx: TrackFx;
  color: string;
  muted: string;
  border: string;
  brass: string;
  surface: string;
  onChange: (fx: TrackFx) => void;
  onCommit: (fx: TrackFx) => void;
}) {
  function slider(
    key: keyof TrackFx,
    label: string,
    min: number,
    max: number,
    step: number
  ) {
    return (
      <label
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontSize: 11,
          color: muted,
        }}
      >
        <span style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{label}</span>
          <span style={{ color }}>{Number(fx[key]).toFixed(1)}</span>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={fx[key]}
          onChange={(e) => {
            const next = { ...fx, [key]: parseFloat(e.target.value) };
            onChange(next);
          }}
          onPointerUp={(e) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            onCommit({ ...fx, [key]: v });
          }}
          onTouchEnd={(e) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            onCommit({ ...fx, [key]: v });
          }}
          style={{ width: "100%", accentColor: brass }}
        />
      </label>
    );
  }
  return (
    <div
      style={{
        marginTop: 10,
        padding: 10,
        borderRadius: 12,
        border: `1px solid ${border}`,
        background: surface,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: undefined as unknown as number,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.06em", color: brass }}>
        TRACK FX
      </div>
      {slider("gainDb", "Gain dB", -12, 12, 0.5)}
      {slider("pan", "Pan L/R", -1, 1, 0.05)}
      {slider("eqLowDb", "Low", -12, 12, 0.5)}
      {slider("eqMidDb", "Mid", -12, 12, 0.5)}
      {slider("eqHighDb", "High / air", -12, 12, 0.5)}
      {slider("compress", "Compress", 0, 1, 0.05)}
      {slider("reverb", "Reverb", 0, 1, 0.05)}
      {slider("delay", "Delay", 0, 1, 0.05)}
      {slider("saturation", "Saturation", 0, 1, 0.05)}
      <button
        type="button"
        onClick={() => {
          onChange(DEFAULT_TRACK_FX);
          onCommit(DEFAULT_TRACK_FX);
        }}
        style={{
          marginTop: 4,
          padding: "8px",
          borderRadius: 8,
          border: `1px solid ${border}`,
          background: "transparent",
          color: muted,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Reset FX
      </button>
    </div>
  );
}

function iconBtn(border: string, surface: string, text: string): React.CSSProperties {
  return {
    width: 40,
    height: 40,
    borderRadius: 12,
    border: `1px solid ${border}`,
    background: surface,
    color: text,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 16,
  };
}

function miniChip(border: string, brass: string, on: boolean, text: string): React.CSSProperties {
  return {
    width: 26,
    height: 24,
    borderRadius: 6,
    border: `1px solid ${on ? brass : border}`,
    background: on ? "rgba(231,169,97,0.2)" : "transparent",
    color: text,
    fontSize: 10,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
