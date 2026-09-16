"use client";

/**
 * Console page loader — /app/console/[id]
 * Reads recording_tasks + beat; same source of truth as Booth (/app/studio/[id]).
 */

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ProducerView,
  type ProducerLayer,
  type ProducerSection,
} from "@/components/producer-view";

type TaskRow = {
  id: string;
  type?: string | null;
  title?: string | null;
  status?: string | null;
  start_ms?: number | null;
  end_ms?: number | null;
  metadata?: {
    track_fx?: Record<string, number>;
    track_color?: string;
    section_label?: string;
  } | null;
  song_sections?: { label?: string | null; type?: string | null } | null;
};

export default function ConsolePage({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("Session");
  const [tempo, setTempo] = useState<number | null>(null);
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [beatDurationMs, setBeatDurationMs] = useState<number | null>(null);
  const [layers, setLayers] = useState<ProducerLayer[]>([]);
  const [sections, setSections] = useState<ProducerSection[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pr, br, tr] = await Promise.all([
        fetch(`/api/projects/${projectId}`),
        fetch(`/api/projects/${projectId}/beat`),
        fetch(`/api/projects/${projectId}/recording-tasks?all=1`),
      ]);
      if (pr.ok) {
        const j = await pr.json();
        const p = j.project || j;
        setTitle(p?.title || "Session");
        setTempo(typeof p?.tempo === "number" ? p.tempo : null);
      }
      if (br.ok) {
        const bj = await br.json();
        setBeatUrl(bj.audio_url || bj.url || null);
        if (typeof bj.duration_ms === "number") setBeatDurationMs(bj.duration_ms);
      }
      if (tr.ok) {
        const tj = await tr.json();
        const tasks = (tj.tasks || []) as TaskRow[];
        const nextLayers: ProducerLayer[] = tasks
          .filter((tk) => {
            const st = (tk.status || "").toLowerCase();
            if (st === "skipped" || st === "cancelled") return false;
            return tk.start_ms != null || st === "completed" || st === "pending";
          })
          .map((tk) => {
            const startMs = Number(tk.start_ms) || 0;
            const endMs = Number(tk.end_ms) || startMs + 8000;
            const meta = tk.metadata || {};
            const tf = meta.track_fx;
            const sectionLabel =
              meta.section_label ||
              tk.song_sections?.label ||
              tk.title ||
              undefined;
            return {
              id: tk.id,
              label: (tk.type || "lead").replace(/_/g, " "),
              role: tk.type || "lead",
              sectionLabel,
              startMs,
              endMs,
              color: typeof meta.track_color === "string" ? meta.track_color : undefined,
              trackFx: tf
                ? {
                    gainDb: Number(tf.gainDb) || 0,
                    eqLowDb: Number(tf.eqLowDb) || 0,
                    eqMidDb: Number(tf.eqMidDb) || 0,
                    eqHighDb: Number(tf.eqHighDb) || 0,
                    compress: Number(tf.compress) || 0,
                    reverb: Number(tf.reverb) || 0,
                    delay: Number(tf.delay) || 0,
                    saturation: Number(tf.saturation) || 0,
                  }
                : null,
            };
          });
        setLayers(nextLayers);
        const byKey = new Map<string, ProducerSection>();
        for (const l of nextLayers) {
          const key = `${l.sectionLabel || "Section"}:${l.startMs}`;
          if (!byKey.has(key)) {
            byKey.set(key, {
              id: key,
              label: l.sectionLabel || "Section",
              startMs: l.startMs,
              endMs: l.endMs,
            });
          } else {
            const s = byKey.get(key)!;
            s.endMs = Math.max(s.endMs, l.endMs);
          }
        }
        setSections(Array.from(byKey.values()).sort((a, b) => a.startMs - b.startMs));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Console");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0B0A0F", color: "#9B96A3", fontFamily: "system-ui, sans-serif" }}>
        Opening Console…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0B0A0F", color: "#F4F1EC", fontFamily: "system-ui, sans-serif", padding: 24, textAlign: "center" }}>
        <div>
          <p style={{ color: "#F07167" }}>{error}</p>
          <button type="button" onClick={() => router.push(`/app/studio/${projectId}`)} style={{ marginTop: 16, padding: "10px 16px", borderRadius: 999, border: "none", background: "#E7A961", color: "#1A1208", fontWeight: 700, cursor: "pointer" }}>
            Back to Booth
          </button>
        </div>
      </div>
    );
  }

  return (
    <ProducerView
      projectId={projectId}
      projectTitle={title}
      beatUrl={beatUrl}
      beatDurationMs={beatDurationMs}
      sections={sections}
      layers={layers}
      tempoBpm={tempo}
      boothHref={`/app/studio/${projectId}`}
      libraryHref="/app"
      onClose={() => router.push(`/app/studio/${projectId}`)}
      onLayersChanged={() => void load()}
    />
  );
}
