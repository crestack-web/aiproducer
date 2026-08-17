"use client";
import React, { useMemo, useState } from "react";
import { useTheme } from "@/lib/theme";
import { recommendationLabel, type PlanMode } from "@/lib/plan";

export type PlanEditorTask = {
  id: string;
  type: string;
  title?: string | null;
  instruction?: string | null;
  reason?: string | null;
  start_ms: number | null;
  end_ms: number | null;
  required?: boolean | null;
  status: string;
  section_id?: string | null;
  active?: boolean | null;
  selected_in_plan?: boolean | null;
  plan_source?: string | null;
  recommendation?: string | null;
  metadata?: { section_label?: string; section_type?: string } | null;
  song_sections?: { label?: string | null; type?: string | null } | null;
};

function fmtMs(ms: number | null | undefined) {
  if (ms == null || Number.isNaN(ms)) return "—";
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

function roleLabel(type: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("harmony")) return "Harmony";
  if (t.includes("adlib") || t.includes("ad-lib")) return "Ad-lib";
  if (t.includes("double")) return "Double";
  if (t.includes("background")) return "Background";
  if (t.includes("lead")) return "Lead";
  return type || "Vocal";
}

const ROLES = ["LEAD", "DOUBLE", "HARMONY", "ADLIB", "BACKGROUND", "HUM", "TEXTURE"];

export function PlanEditor({
  projectId,
  tasks,
  planMode,
  onTasksChange,
  onModeChange,
}: {
  projectId: string;
  tasks: PlanEditorTask[];
  planMode: PlanMode;
  onTasksChange: (tasks: PlanEditorTask[]) => void;
  onModeChange: (mode: PlanMode) => void;
}) {
  const { colors: C } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    type: string;
    title: string;
    start_ms: string;
    end_ms: string;
  } | null>(null);

  const visible = useMemo(() => {
    if (planMode === "scratch") {
      return tasks.filter((t) => t.active !== false && t.selected_in_plan !== false);
    }
    return tasks;
  }, [tasks, planMode]);

  async function call(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Plan update failed");
      if (j.tasks) onTasksChange(j.tasks);
      if (j.task) {
        onTasksChange(
          tasks.map((t) => (t.id === j.task.id ? { ...t, ...j.task } : t)).concat(
            tasks.some((t) => t.id === j.task.id) ? [] : [j.task]
          )
        );
      }
      if (j.plan_mode) onModeChange(j.plan_mode as PlanMode);
      return j;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Plan update failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Tab switch must ONLY change selection state — no API requests.
   * restore_ai_plan / clear_to_scratch are destructive and must be explicit actions.
   * Mode is persisted when Generate / Start recording runs (parent).
   */
  function setMode(mode: PlanMode) {
    if (mode === planMode) return;
    onModeChange(mode);
  }

  function startEdit(t: PlanEditorTask) {
    setEditingId(t.id);
    setDraft({
      type: t.type || "LEAD",
      title: t.title || roleLabel(t.type),
      start_ms: String(t.start_ms ?? 0),
      end_ms: String(t.end_ms ?? 0),
    });
  }

  async function saveEdit(taskId: string) {
    if (!draft) return;
    await call("update", {
      task_id: taskId,
      patch: {
        type: draft.type,
        title: draft.title,
        start_ms: Number(draft.start_ms) || 0,
        end_ms: Number(draft.end_ms) || 0,
      },
    });
    setEditingId(null);
    setDraft(null);
    // Refresh full list
    const res = await fetch(`/api/projects/${projectId}/plan`);
    if (res.ok) {
      const j = await res.json();
      if (j.tasks) onTasksChange(j.tasks);
    }
  }

  async function addCustom() {
    await call("add", {
      task: {
        type: "LEAD",
        title: "Custom lead",
        instruction: "Record your vocal for this part.",
        start_ms: 0,
        end_ms: 8000,
      },
    });
    const res = await fetch(`/api/projects/${projectId}/plan`);
    if (res.ok) {
      const j = await res.json();
      if (j.tasks) onTasksChange(j.tasks);
      if (j.plan_mode) onModeChange(j.plan_mode);
    }
  }

  const modeBtn = (mode: PlanMode, label: string) => {
    const active = planMode === mode;
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setMode(mode)}
        style={{
          flex: 1,
          padding: "10px 8px",
          borderRadius: 12,
          border: active ? `1.5px solid ${C.brass}` : `1px solid ${C.border}`,
          background: active ? C.brassSoft : C.surface,
          color: C.text,
          fontWeight: active ? 700 : 500,
          fontSize: 12,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {modeBtn("ai", "AI Plan")}
        {modeBtn("customize", "Customize")}
        {modeBtn("scratch", "Build from scratch")}
      </div>

      <p style={{ fontSize: 13, color: C.textMuted, marginTop: 0, marginBottom: 12, lineHeight: 1.45 }}>
        {planMode === "ai" &&
          "AI suggested these parts. You can customize or remove any of them — nothing is forced."}
        {planMode === "customize" &&
          "Select the parts you want. AI recommendations are suggestions only — not requirements."}
        {planMode === "scratch" &&
          "Start empty and add only the parts you want to record."}
      </p>

      {error && <p style={{ color: C.danger, fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((t) => {
          const selected = t.active !== false && t.selected_in_plan !== false;
          const section =
            t.metadata?.section_label ||
            t.song_sections?.label ||
            t.metadata?.section_type ||
            "Section";
          const recorded = t.status === "completed";
          const editing = editingId === t.id;

          return (
            <div
              key={t.id}
              style={{
                padding: 12,
                borderRadius: 14,
                border: `1px solid ${selected ? C.brass : C.border}`,
                background: C.surface,
                opacity: selected ? 1 : 0.55,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.checked) void call("restore", { task_id: t.id });
                    else void call("remove", { task_id: t.id });
                  }}
                  style={{ marginTop: 4, width: 18, height: 18 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{String(section).toUpperCase()}</span>
                    <span style={{ fontSize: 12, color: C.brass, fontWeight: 600 }}>
                      {roleLabel(t.type)}
                    </span>
                    <span style={{ fontSize: 11, color: C.textMuted }}>{recommendationLabel(t)}</span>
                    {recorded && (
                      <span style={{ fontSize: 11, color: C.signal, fontWeight: 600 }}>Recorded</span>
                    )}
                    {!selected && (
                      <span style={{ fontSize: 11, color: C.textMuted }}>Not in plan</span>
                    )}
                  </div>
                  {!editing && (
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: C.textMuted }}>
                      {fmtMs(t.start_ms)} → {fmtMs(t.end_ms)}
                      {t.instruction ? ` · ${t.instruction}` : ""}
                    </p>
                  )}
                  {editing && draft && (
                    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                      <select
                        value={draft.type}
                        onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                        style={{ padding: 8, borderRadius: 8, border: `1px solid ${C.border}` }}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <input
                        value={draft.title}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                        placeholder="Title"
                        style={{ padding: 8, borderRadius: 8, border: `1px solid ${C.border}` }}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          value={draft.start_ms}
                          onChange={(e) => setDraft({ ...draft, start_ms: e.target.value })}
                          placeholder="start_ms"
                          style={{ flex: 1, padding: 8, borderRadius: 8, border: `1px solid ${C.border}` }}
                        />
                        <input
                          value={draft.end_ms}
                          onChange={(e) => setDraft({ ...draft, end_ms: e.target.value })}
                          placeholder="end_ms"
                          style={{ flex: 1, padding: 8, borderRadius: 8, border: `1px solid ${C.border}` }}
                        />
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" onClick={() => void saveEdit(t.id)} disabled={busy}>
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setDraft(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {selected && !editing && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startEdit(t)}
                    style={{
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      background: "transparent",
                      color: C.textMuted,
                      cursor: "pointer",
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {(planMode === "customize" || planMode === "scratch") && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void addCustom()}
          style={{
            width: "100%",
            marginTop: 12,
            padding: "12px 14px",
            borderRadius: 12,
            border: `1px dashed ${C.border}`,
            background: "transparent",
            color: C.text,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + Add custom part
        </button>
      )}
    </div>
  );
}
