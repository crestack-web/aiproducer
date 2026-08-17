"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { StudioPlayer, PlayerLoadingState } from "@/components/studio-player";
import { AppShell } from "@/components/app-shell";
import { SessionSteps, isTaskOpen, isTaskDone } from "@/components/session-steps";
import { PlanEditor, type PlanEditorTask } from "@/components/plan-editor";
import { useTheme } from "@/lib/theme";
import { type PlanMode } from "@/lib/plan";

/** Marker: real booth UI (not a null placeholder). Survives minify. */
export const FULL_SESSION_UI = true as const;

type Task = {
  id: string;
  type: string;
  title?: string | null;
  instruction: string;
  status: string;
  required: boolean;
  start_ms: number | null;
  end_ms: number | null;
  section_id?: string | null;
  metadata?: { section_label?: string };
};

type ProjectMeta = {
  id: string;
  status: string;
  title?: string | null;
  genre?: string | null;
  mood?: string | null;
  tempo?: number | null;
};

type Screen = "beat" | "analyzing" | "plan" | "session" | "assemble";

function screenForStatus(status: string, hasTasks: boolean, hasProgress: boolean): Screen {
  const s = (status || "").toLowerCase();
  if (s === "processing" || s === "mixing" || s === "mastering") return "assemble";
  if (s === "recording" || s === "in_progress") return "session";
  if (s === "blueprint_ready" || s === "ready" || s === "planned") {
    if (hasProgress) return "session";
    return hasTasks ? "plan" : "beat";
  }
  if (s === "analyzing") return "analyzing";
  if (s === "beat_ready" || s === "draft" || s === "generating_beat" || s === "failed") return "beat";
  if (hasProgress) return "session";
  return hasTasks ? "plan" : "beat";
}

export default function ProjectDetailPage() {
  const id = (useParams()?.id as string) || "";
  const { colors: C } = useTheme();
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [screen, setScreen] = useState<Screen>("beat");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planMode, setPlanMode] = useState<PlanMode>("ai");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const resumedRef = useRef(false);

  const current =
    tasks.find((t) => t.id === activeTaskId) || tasks.find((t) => isTaskOpen(t)) || null;

  const load = useCallback(async () => {
    if (!id) {
      setError("Missing project id in URL");
      setLoading(false);
      return;
    }
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

      if (pr.status === 401) {
        setError("Unauthorized — please sign in again");
        setLoading(false);
        return;
      }
      if (pr.status === 404) {
        setError("Project not found");
        setLoading(false);
        return;
      }
      if (pr.ok) {
        const j = await pr.json();
        loadedProject = j.project || j;
        setProject(loadedProject);
      } else if (!pr.ok) {
        setError(`Could not load project (${pr.status})`);
      }

      if (br.ok) setBeatUrl((await br.json()).audio_url || null);
      if (tr.ok) {
        loadedTasks = (await tr.json()).tasks || [];
        setTasks(loadedTasks);
      }

      // Plan may exist with zero active tasks — that is OK before AI plan
      try {
        const planRes = await fetch(`/api/projects/${id}/plan`);
        if (planRes.ok) {
          const pj = await planRes.json();
          if (pj.plan_mode) setPlanMode(pj.plan_mode);
          if (!loadedTasks.length && Array.isArray(pj.tasks) && pj.tasks.length) {
            const active = (pj.tasks as (Task & { active?: boolean; selected_in_plan?: boolean })[]).filter(
              (t) => t.active !== false && t.selected_in_plan !== false && t.status !== "skipped"
            );
            if (active.length) {
              loadedTasks = active;
              setTasks(active);
            }
          }
        }
      } catch {
        /* non-fatal */
      }

      if (sr.ok) {
        const st = await sr.json();
        if (st.project) {
          loadedProject = st.project;
          setProject(st.project);
        }
        if (typeof st.recording_count === "number") recordingCount = st.recording_count;
      }

      if (loadedProject && !resumedRef.current) {
        const hasProgress =
          recordingCount > 0 ||
          loadedTasks.some(
            (t) => t.status === "completed" || t.status === "in_progress" || isTaskDone(t)
          );
        const next = screenForStatus(
          loadedProject.status,
          loadedTasks.length > 0,
          hasProgress
        );
        setScreen(next);
        resumedRef.current = true;
      } else if (!loadedProject) {
        setScreen("beat");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
      setScreen("beat");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Beat Ready → analyze → Planner. Never skip Planner. */
  async function startProducerSession() {
    const st = (project?.status || "").toLowerCase();
    if (
      tasks.length > 0 &&
      ["blueprint_ready", "recording", "planned", "ready", "processing", "complete"].includes(st)
    ) {
      setScreen("plan");
      return;
    }
    setAnalyzing(true);
    setError(null);
    setScreen("analyzing");
    try {
      const res = await fetch(`/api/projects/${id}/analyze`, { method: "POST" });
      const j = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        throw new Error(
          (typeof j.error === "string" && j.error) ||
            (typeof j.message === "string" && j.message) ||
            `Analyze failed (${res.status})`
        );
      }
      const tr = await fetch(`/api/projects/${id}/recording-tasks`);
      if (tr.ok) setTasks((await tr.json()).tasks || []);
      const sr = await fetch(`/api/projects/${id}/status`);
      if (sr.ok) setProject((await sr.json()).project);
      else if (j.project_status) {
        setProject((p) => (p ? { ...p, status: String(j.project_status) } : p));
      }
      setScreen("plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyze failed");
      setScreen("beat");
    } finally {
      setAnalyzing(false);
    }
  }

  async function enterSession() {
    const open =
      tasks.find((t) => t.status === "pending" || t.status === "in_progress") || tasks[0];
    if (!open) {
      setError("Create or select at least one plan part before recording");
      setScreen("plan");
      return;
    }
    setActiveTaskId(open.id);
    setScreen("session");
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

  const wrap: React.CSSProperties = {
    width: "100%",
    maxWidth: 920,
    margin: "0 auto",
    padding: "28px 20px 40px",
    color: C.text,
    fontFamily: "system-ui, sans-serif",
  };
  const titleStyle: React.CSSProperties = {
    fontFamily: "Georgia, serif",
    fontSize: "1.75rem",
    margin: 0,
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
  const btn2: React.CSSProperties = {
    ...btn,
    background: C.surface,
    color: C.text,
    border: `1px solid ${C.border}`,
  };

  if (loading) {
    return (
      <AppShell active="studio">
        <div style={wrap}>
          <PlayerLoadingState
            title="Loading session"
            subtitle="Pulling beat, plan, and takes…"
            seed={`load-${id}`}
          />
        </div>
      </AppShell>
    );
  }

  if (!id) {
    return (
      <AppShell active="studio">
        <div style={wrap}>
          <h1 style={titleStyle}>Missing project</h1>
          <p style={{ color: C.danger }}>No project id in the URL.</p>
          <Link href="/app/studio" style={{ color: C.brass }}>
            ← Studio
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="studio" userName="Artist">
      {screen === "beat" && (
        <div style={wrap}>
          <Link href="/app/studio" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>
            ← Studio
          </Link>
          <h1 style={{ ...titleStyle, marginTop: 20 }}>{project?.title || "Your beat"}</h1>
          <p style={{ color: C.textMuted, fontSize: 13, marginTop: 6 }}>
            Status: <strong>{project?.status || "unknown"}</strong>
            {beatUrl ? " · Beat ready" : " · Waiting for beat"}
          </p>
          {error && <p style={{ color: C.danger }}>{error}</p>}
          {beatUrl && (
            <StudioPlayer
              src={beatUrl}
              title={project?.title || "Beat"}
              subtitle={[project?.genre, project?.mood, project?.tempo ? `${project.tempo} BPM` : null]
                .filter(Boolean)
                .join(" · ")}
              seed={project?.title || "beat"}
            />
          )}
          <button
            type="button"
            style={btn}
            disabled={analyzing || !beatUrl}
            onClick={() => void startProducerSession()}
          >
            {analyzing
              ? "Analyzing…"
              : tasks.length > 0
                ? "Continue to plan"
                : "Start with AI Producer"}
          </button>
          {!beatUrl && (
            <p style={{ color: C.textMuted, fontSize: 13, marginTop: 12 }}>
              Upload or generate a beat from Studio, then return here.
            </p>
          )}
        </div>
      )}

      {screen === "analyzing" && (
        <div style={wrap}>
          <PlayerLoadingState
            title="Producer is listening"
            subtitle="Mapping sections…"
            seed={`analyze-${id}`}
          />
        </div>
      )}

      {screen === "plan" && (
        <div style={wrap}>
          <Link href="/app/studio" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>
            ← Studio
          </Link>
          <h1 style={{ ...titleStyle, marginTop: 16 }}>Song plan</h1>
          <p style={{ color: C.textMuted, fontSize: 14, marginTop: 4 }}>
            AI suggests. You decide. Only parts you keep are in your active plan.
          </p>
          {error && <p style={{ color: C.danger }}>{error}</p>}
          <PlanEditor
            projectId={id}
            tasks={tasks as PlanEditorTask[]}
            planMode={planMode}
            onModeChange={setPlanMode}
            onTasksChange={(next) => {
              setTasks(
                next
                  .filter((t) => t.active !== false && t.selected_in_plan !== false)
                  .map((t) => ({
                    id: t.id,
                    type: t.type,
                    title: t.title,
                    instruction: t.instruction || "",
                    status: t.status,
                    required: Boolean(t.required),
                    start_ms: t.start_ms,
                    end_ms: t.end_ms,
                    section_id: t.section_id,
                    metadata: t.metadata as Task["metadata"],
                  }))
              );
              void fetch(`/api/projects/${id}/recording-tasks`)
                .then((r) => r.json())
                .then((j) => {
                  if (Array.isArray(j.tasks)) setTasks(j.tasks);
                })
                .catch(() => undefined);
            }}
          />
          <SessionSteps
            tasks={tasks}
            locked={false}
            onSelect={(taskId) => {
              setActiveTaskId(taskId);
              setScreen("session");
            }}
          />
          <button
            type="button"
            style={btn}
            onClick={() => void enterSession()}
            disabled={tasks.filter((t) => t.status !== "skipped").length === 0}
          >
            Start recording
          </button>
        </div>
      )}

      {screen === "session" && (
        <div style={wrap}>
          <button
            type="button"
            style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer" }}
            onClick={() => setScreen("plan")}
          >
            ← Plan
          </button>
          <SessionSteps
            tasks={tasks}
            highlightId={current?.id}
            locked={false}
            compact
            onSelect={(taskId) => setActiveTaskId(taskId)}
          />
          {current ? (
            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 14,
                border: `1px solid ${C.brass}`,
                background: C.brassSoft,
              }}
            >
              <h1 style={{ ...titleStyle, fontSize: "1.35rem" }}>
                {current.title || current.type}
              </h1>
              <p style={{ color: C.textMuted, fontSize: 14 }}>{current.instruction}</p>
              <p style={{ color: C.textMuted, fontSize: 13, marginTop: 12 }}>
                Plan is ready. Use the parts above to navigate. Full mic booth controls ship with the
                extended session module — your plan and tasks are loaded from the project id in the
                URL.
              </p>
            </div>
          ) : (
            <p style={{ color: C.textMuted, marginTop: 16 }}>
              No open parts — return to the plan to add or restore sections.
            </p>
          )}
          {error && <p style={{ color: C.danger }}>{error}</p>}
          <button type="button" style={btn2} onClick={() => setScreen("plan")}>
            Back to plan
          </button>
        </div>
      )}

      {screen === "assemble" && (
        <div style={wrap}>
          <h1 style={titleStyle}>Produce</h1>
          <p style={{ color: C.textMuted }}>Finish plan parts, then produce from the full session.</p>
          <button type="button" style={btn2} onClick={() => setScreen("plan")}>
            ← Plan
          </button>
        </div>
      )}
    </AppShell>
  );
}
