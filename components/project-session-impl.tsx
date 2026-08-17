"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PlayerLoadingState } from "@/components/studio-player";
import { useTheme } from "@/lib/theme";
import { isTaskDone, isTaskOpen } from "@/components/session-steps";

type Task = {
  id: string;
  type: string;
  title?: string | null;
  instruction: string;
  status: string;
  required: boolean;
  start_ms: number | null;
  end_ms: number | null;
};

type ProjectMeta = {
  id: string;
  status: string;
  title?: string | null;
};

type Screen = "beat" | "plan" | "session" | "assemble" | "done" | "analyzing";

function screenForStatus(
  status: string,
  hasTasks: boolean,
  hasProgress: boolean
): Screen | null {
  const s = (status || "").toLowerCase();
  if (s === "complete" || s === "produced" || s === "done") return "done";
  if (s === "processing" || s === "mixing" || s === "mastering") return "assemble";
  // Always resume the recording booth once a session has started
  if (s === "recording" || s === "in_progress") return "session";
  if (s === "blueprint_ready" || s === "ready" || s === "planned") {
    if (hasProgress) return "session";
    return hasTasks ? "plan" : "beat";
  }
  if (s === "analyzing") return "analyzing";
  if (hasProgress) return "session";
  return hasTasks ? "plan" : "beat";
}

/**
 * Session router — full recording UI is loaded after resume decision.
 * This module prioritizes correct reopen behavior: return to recording
 * when the artist already has progress, not the plan chooser.
 */
export default function ProjectDetailPage() {
  const id = useParams().id as string;
  const { colors: C } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("beat");
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const resumedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pr, br, tr, sr] = await Promise.all([
        fetch(`/api/projects/${id}`),
        fetch(`/api/projects/${id}/beat`),
        fetch(`/api/projects/${id}/recording-tasks`),
        fetch(`/api/projects/${id}/status`),
      ]);

      let loadedProject: ProjectMeta | null = null;
      let loadedTasks: Task[] = [];
      let recordingCount = 0;

      if (pr.ok) {
        const j = await pr.json();
        loadedProject = j.project || j;
        setProject(loadedProject);
      }
      if (br.ok) setBeatUrl((await br.json()).audio_url || null);
      if (tr.ok) {
        loadedTasks = (await tr.json()).tasks || [];
        setTasks(loadedTasks);
      }

      // Plan list may lag — fall back to /plan active tasks
      if (loadedTasks.length === 0) {
        try {
          const planRes = await fetch(`/api/projects/${id}/plan`);
          if (planRes.ok) {
            const pj = await planRes.json();
            if (Array.isArray(pj.tasks) && pj.tasks.length) {
              const active = (pj.tasks as Task[]).filter((t) => t.status !== "skipped");
              if (active.length) {
                loadedTasks = active;
                setTasks(active);
              }
            }
          }
        } catch {
          /* non-fatal */
        }
      }

      if (sr.ok) {
        const st = await sr.json();
        if (st.project) {
          loadedProject = st.project;
          setProject(st.project);
        }
        if (typeof st.recording_count === "number") recordingCount = st.recording_count;

        const jobs = (st.jobs || []) as { type?: string; status?: string }[];
        const produceJob = jobs.find((j) => j.type === "PRODUCE_SONG");
        const js = (produceJob?.status || "").toLowerCase();
        if (js === "queued" || js === "processing") {
          setScreen("assemble");
          resumedRef.current = true;
          setReady(true);
          setLoading(false);
          return;
        }
      }

      if (loadedProject && !resumedRef.current) {
        const hasProgress =
          recordingCount > 0 ||
          loadedTasks.some(
            (t) =>
              t.status === "completed" ||
              t.status === "in_progress" ||
              isTaskDone(t)
          );
        const next = screenForStatus(
          loadedProject.status,
          loadedTasks.length > 0,
          hasProgress
        );
        if (next) {
          setScreen(next);
          // Stick status so the next visit also resumes in the booth
          if (
            next === "session" &&
            (loadedProject.status || "").toLowerCase() !== "recording"
          ) {
            void fetch(`/api/projects/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "recording" }),
            }).then(async (res) => {
              if (!res.ok) return;
              const j = await res.json().catch(() => ({}));
              if (j.project) setProject(j.project);
            });
          }
        }
        resumedRef.current = true;
      }

      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Once resume decision is made, load the full session UI module
  const [FullSession, setFullSession] = useState<React.ComponentType | null>(null);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void import("@/components/project-session-full")
      .then((mod) => {
        if (!cancelled) setFullSession(() => mod.default);
      })
      .catch(() => {
        // Full module optional during restore — stay on router screens
      });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  if (loading) {
    return (
      <AppShell active="studio">
        <div style={{ padding: 28, maxWidth: 920, margin: "0 auto" }}>
          <PlayerLoadingState
            title="Loading session"
            subtitle="Pulling your beat, plan, and takes…"
            seed={`load-${id}`}
          />
        </div>
      </AppShell>
    );
  }

  // Prefer full session UI when available
  if (FullSession) return <FullSession />;

  const wrap: React.CSSProperties = {
    width: "100%",
    maxWidth: 920,
    margin: "0 auto",
    padding: "28px 20px 40px",
    color: C.text,
    fontFamily: "system-ui, sans-serif",
  };
  const btn: React.CSSProperties = {
    width: "100%",
    padding: "14px 18px",
    borderRadius: 14,
    border: "none",
    background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
    color: "#1A1208",
    fontWeight: 600,
    fontSize: 15,
    cursor: "pointer",
    marginTop: 16,
  };

  return (
    <AppShell active="studio" userName="Artist">
      <div style={wrap}>
        <Link href="/app/studio" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>
          ← Studio
        </Link>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 24, marginTop: 16 }}>
          {project?.title || "Session"}
        </h1>
        {error && <p style={{ color: C.danger }}>{error}</p>}
        <p style={{ color: C.textMuted, fontSize: 14 }}>
          Screen: <strong>{screen}</strong>
          {tasks.length ? ` · ${tasks.length} parts` : ""}
        </p>
        {beatUrl && (
          <audio controls src={beatUrl} style={{ width: "100%", marginTop: 12 }} />
        )}
        <button type="button" style={btn} onClick={() => setScreen("session")}>
          Go to recording
        </button>
        <button
          type="button"
          style={{ ...btn, background: C.surface, color: C.text, border: `1px solid ${C.border}` }}
          onClick={() => setScreen("plan")}
        >
          Open plan
        </button>
        <button
          type="button"
          style={{ ...btn, background: C.surface, color: C.text, border: `1px solid ${C.border}` }}
          onClick={() => setScreen("assemble")}
        >
          Preview / Produce
        </button>
        <p style={{ color: C.textFaint, fontSize: 12, marginTop: 20 }}>
          Resume prefers recording when status is recording or takes already exist.
        </p>
      </div>
    </AppShell>
  );
}
