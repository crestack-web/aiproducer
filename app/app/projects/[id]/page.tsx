"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Task = {
  id: string;
  type: string;
  title?: string | null;
  instruction: string;
  reason?: string | null;
  status: string;
  required: boolean;
  start_ms: number | null;
  end_ms: number | null;
  metadata?: { section_label?: string; vocal_part?: string; production_type?: string };
};

type Take = {
  id: string;
  take_number: number;
  audio_url?: string | null;
  duration_ms?: number | null;
  is_selected?: boolean;
};

type ProjectMeta = {
  id: string;
  status: string;
  title?: string | null;
  genre?: string | null;
  mood?: string | null;
  tempo?: number | null;
};

type Screen = "beat" | "analyzing" | "plan" | "session" | "done";
type SessionPhase = "ready" | "recording" | "review";

const C = {
  bg: "#0B0A0F",
  bgDeep: "#050508",
  surface: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.09)",
  brass: "#E7A961",
  brassSoft: "rgba(231,169,97,0.15)",
  brassLine: "rgba(231,169,97,0.55)",
  signal: "#7BEBD4",
  waveMuted: "rgba(255,255,255,0.14)",
  text: "#F4F1EC",
  textMuted: "#9B96A3",
  textFaint: "#5C5866",
  danger: "#E8756A",
  purple: "#8b5cf6",
};

const GRAD = [
  ["#3A2E52", "#0B0A0F"],
  ["#2E4A4A", "#0B0A0F"],
  ["#4A2E3A", "#0B0A0F"],
];

function seededRandom(seed: string) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0xfffffff) / 0xfffffff;
  };
}

function makeWave(seed: string, n = 48) {
  const rnd = seededRandom(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = 0.35 + 0.3 * Math.sin(i / 3.1 + seed.length) + rnd() * 0.35;
    out.push(Math.max(0.12, Math.min(1, base)));
  }
  return out;
}

function fmtClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function coverFor(seed: string) {
  let n = 0;
  for (let i = 0; i < seed.length; i++) n = (n + seed.charCodeAt(i) * (i + 1)) % GRAD.length;
  return GRAD[n];
}

function humanTitle(type: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("double")) return "Sing it again (thicker)";
  if (t.includes("harmony")) return "Harmony line";
  if (t.includes("adlib")) return "Ad-libs / answers";
  if (t.includes("hum")) return "Soft hum / atmosphere";
  return "Lead vocal";
}

function sectionLabel(t: Task) {
  return (t.metadata?.section_label || t.title || humanTitle(t.type) || "SECTION").toUpperCase();
}

function roleLabel(t: Task) {
  return t.reason || t.metadata?.vocal_part || humanTitle(t.type);
}

// NOTE: Full file content continues - this is a truncated attempt. Use push with file read.
export default function ProjectDetailPage() {
  return <div>Loading producer session…</div>;
}
