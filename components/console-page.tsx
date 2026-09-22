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
  /** Canonical Producer View FX (column). Prefer over metadata.track_fx. */
  track_fx?: Record<string, number> | null;
  /** Canonical track chrome color (column). Prefer over metadata.track_color. */
  track_color?: string | null;
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
  const [hasMaster, setHasMaster] = useState(false);

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    // soft=true refreshes data without unmounting Console (avoids full-page flash on small edits)
    if (!opts?.soft) setLoading(true);
    setError(null);
    try {
      const [pr, br, tr, prev] = await Promise.all([
        fetch(`/api/projects/${projectId}`),
        fetch(`/api/projects/${projectId}/beat`),
        fetch(`/api/projects/${projectId}/recording-tasks?all=1`),
        fetch(`/api/projects/${projectId}/session-preview`),
      ]);
      const audioByTask = new Map<string, string>();
      const recordingIdByTask = new Map<string, string>();
      /** Canonical timeline placement from session-preview (includes recordingOffset). */
      const placementByTask = new Map<
        string,
        { startMs: number; endMs: number | null; durationMs: number | null }
      >();
      if (prev.ok) {
        try {
          const pj = await prev.json();
          const layersIn = (pj.layers || pj.recordings || []) as {
            task_id?: string;
            recording_id?: string;
            audio_url?: string;
            start_ms?: number;
            end_ms?: number | null;
            duration_ms?: number | null;
          }[];
          for (const row of layersIn) {
            if (row.task_id && row.audio_url) audioByTask.set(row.task_id, row.audio_url);
            if (row.task_id && row.recording_id) recordingIdByTask.set(row.task_id, row.recording_id);
            if (row.task_id && typeof row.start_ms === "number") {
              placementByTask.set(row.task_id, {
                startMs: row.start_ms,
                endMs: typeof row.end_ms === "number" ? row.end_ms : null,
                durationMs: typeof row.duration_ms === "number" ? row.duration_ms : null,
              });
            }
          }
          // beat may already be set from /beat; only fill gaps
          if (pj.beat_url || pj.beatUrl) {
            setBeatUrl((prev) => prev || pj.beat_url || pj.beatUrl);
          }
          if (typeof pj.beat_duration_ms === "number") {
            setBeatDurationMs((prev) => prev ?? pj.beat_duration_ms);
          }
        } catch {
          /* ignore */
        }
      }
      if (pr.ok) {
        const j = await pr.json();
        const p = j.project || j;
        setTitle(p?.title || "Session");
        setTempo(typeof p?.tempo === "number" ? p.tempo : null);
        const st = String(p?.status || "").toLowerCase();
        setHasMaster(
          st === "complete" ||
            st === "mastering" ||
            st === "mixing" ||
            Boolean(p?.master_url) ||
            Boolean(p?.has_master)
        );
      }
      if (br.ok) {
        const bj = await br.json();
        setBeatUrl(bj.audio_url || bj.url || null);
        if (typeof bj.duration_ms === "number") setBeatDurationMs(bj.duration_ms);
        else if (typeof bj.duration_sec === "number") setBeatDurationMs(Math.round(bj.duration_sec * 1000));
        else if (typeof bj.duration === "number") setBeatDurationMs(bj.duration > 1000 ? bj.duration : Math.round(bj.duration * 1000));
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
            // Prefer first-class columns; fall back to legacy metadata
            const tfRaw =
              tk.track_fx && typeof tk.track_fx === "object" && !Array.isArray(tk.track_fx)
                ? tk.track_fx
                : meta.track_fx && typeof meta.track_fx === "object"
                  ? meta.track_fx
                  : null;
            const colorRaw =
              typeof tk.track_color === "string" && tk.track_color
                ? tk.track_color
                : typeof meta.track_color === "string"
                  ? meta.track_color
                  : undefined;
            const sectionLabel =
              meta.section_label ||
              tk.song_sections?.label ||
              undefined;
            const place = placementByTask.get(tk.id);
            // Prefer session-preview placement (placementStartMs) over bare plan section times
            const resolvedStart = place?.startMs ?? startMs;
            let resolvedEnd = endMs;
            if (place?.endMs != null) resolvedEnd = place.endMs;
            else if (place?.durationMs != null)
              resolvedEnd = resolvedStart + place.durationMs;
            return {
              id: tk.id,
              label: ((typeof tk.title === "string" && tk.title.trim()) || tk.type || "lead").replace(/_/g, " "),
              role: tk.type || "lead",
              sectionLabel,
              startMs: resolvedStart,
              endMs: resolvedEnd,
              audioUrl: audioByTask.get(tk.id) || null,
              recordingId: recordingIdByTask.get(tk.id) || null,
              color: colorRaw,
              trackFx: tfRaw
                ? {
                    gainDb: Number(tfRaw.gainDb) || 0,
                    eqLowDb: Number(tfRaw.eqLowDb) || 0,
                    eqMidDb: Number(tfRaw.eqMidDb) || 0,
                    eqHighDb: Number(tfRaw.eqHighDb) || 0,
                    compress: Number(tfRaw.compress) || 0,
                    reverb: Number(tfRaw.reverb) || 0,
                    delay: Number(tfRaw.delay) || 0,
                    saturation: Number(tfRaw.saturation) || 0,
                    pan: Number(tfRaw.pan) || 0,
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
        let derived = Array.from(byKey.values()).sort((a, b) => a.startMs - b.startMs);
        try {
          const secRes = await fetch(`/api/projects/${projectId}/blueprint`);
          if (secRes.ok) {
            const sj = await secRes.json();
            const raw = sj.sections || sj.song_sections || sj.blueprint?.sections || [];
            if (Array.isArray(raw) && raw.length) {
              derived = raw.map((s: { id?: string; label?: string; name?: string; start_ms?: number; end_ms?: number }, i: number) => ({
                id: String(s.id || `sec-${i}`),
                label: s.label || s.name || `Section ${i + 1}`,
                startMs: Number(s.start_ms) || 0,
                endMs: Number(s.end_ms) || (Number(s.start_ms) || 0) + 8000,
              }));
            }
          }
        } catch {
          /* keep derived from tasks */
        }
        setSections(derived);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Console");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load({ soft: false });
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
      onLayersChanged={() => void load({ soft: true })}
      onOpenTweak={() => void load({ soft: true })}
      tweaksEnabled={Boolean(beatUrl) || layers.some((l) => Boolean(l.audioUrl))}
      tweaksGateMessage={
        "Add a beat or record a take to start directing AP"
      }
    />
  );
}
