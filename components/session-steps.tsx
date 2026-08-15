"use client";
import React from "react";

export type SessionTask = {
  id: string;
  type: string;
  title?: string | null;
  instruction: string;
  status: string;
  required: boolean;
  metadata?: { section_label?: string; vocal_part?: string };
};

const C = {
  surface: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.09)",
  brass: "#E7A961",
  brassSoft: "rgba(231,169,97,0.15)",
  signal: "#7BEBD4",
  text: "#F4F1EC",
  textMuted: "#9B96A3",
  textFaint: "#5C5866",
};

function humanTitle(type: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("harmony")) return "Harmony";
  if (t.includes("adlib")) return "Ad-libs";
  if (t.includes("double")) return "Double";
  return "Lead vocal";
}

export function sectionLabel(t: SessionTask) {
  return (t.metadata?.section_label || t.title || humanTitle(t.type) || "SECTION").toUpperCase();
}

export function isTaskOpen(t: SessionTask) {
  return t.status === "pending" || t.status === "in_progress";
}

export function isTaskDone(t: SessionTask) {
  return t.status === "completed" || t.status === "skipped";
}

export function requiredOpen(tasks: SessionTask[]) {
  return tasks.filter((t) => t.required && isTaskOpen(t));
}

export function optionalOpen(tasks: SessionTask[]) {
  return tasks.filter((t) => !t.required && isTaskOpen(t));
}

export function SessionSteps({
  tasks,
  highlightId,
  locked,
  compact,
  onSelect,
}: {
  tasks: SessionTask[];
  highlightId?: string | null;
  locked?: boolean;
  compact?: boolean;
  onSelect: (taskId: string) => void;
}) {
  if (!tasks.length) return null;
  const requiredTasks = tasks.filter((t) => t.required);
  const requiredDoneCount = requiredTasks.filter(isTaskDone).length;
  const reqLeft = requiredOpen(tasks);
  const optLeft = optionalOpen(tasks);
  const totalDone = tasks.filter(isTaskDone).length;

  return (
    <div style={{ marginTop: compact ? 10 : 14, marginBottom: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 12, color: C.textMuted }}>
          <span style={{ color: C.brass, fontWeight: 600 }}>
            {requiredDoneCount}/{requiredTasks.length || 0}
          </span>{" "}
          required done
          {reqLeft.length > 0 ? (
            <span style={{ color: C.textFaint }}> · {reqLeft.length} required left</span>
          ) : (
            <span style={{ color: C.signal }}> · required complete</span>
          )}
          {optLeft.length > 0 && (
            <span style={{ color: C.textFaint }}> · {optLeft.length} optional left</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: C.textFaint, letterSpacing: 0.3 }}>
          {totalDone}/{tasks.length} parts
        </div>
      </div>

      <div
        style={{
          height: 4,
          borderRadius: 999,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${tasks.length ? Math.round((totalDone / tasks.length) * 100) : 0}%`,
            background: `linear-gradient(90deg, ${C.brass}, ${C.signal})`,
            borderRadius: 999,
            transition: "width 0.25s ease",
          }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {tasks.map((t, i) => {
          const done = isTaskDone(t);
          const active = t.id === highlightId;
          return (
            <button
              key={t.id}
              type="button"
              disabled={locked}
              onClick={() => onSelect(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: active ? `1px solid ${C.brass}` : `1px solid ${C.border}`,
                background: active ? C.brassSoft : C.surface,
                color: C.text,
                textAlign: "left",
                cursor: locked ? "default" : "pointer",
                fontFamily: "inherit",
                opacity: done && !active ? 0.72 : 1,
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  background: done
                    ? "rgba(61,214,140,0.18)"
                    : active
                      ? C.brassSoft
                      : "rgba(255,255,255,0.06)",
                  color: done ? C.signal : active ? C.brass : C.textFaint,
                  border: `1px solid ${done ? "rgba(61,214,140,0.35)" : active ? C.brass : C.border}`,
                }}
              >
                {done ? "✓" : i + 1}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: active ? 600 : 500 }}>
                  {sectionLabel(t)}
                  {!compact ? (
                    <span
                      style={{
                        display: "block",
                        fontSize: 11.5,
                        color: C.textMuted,
                        fontWeight: 400,
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {humanTitle(t.type)}
                    </span>
                  ) : null}
                </span>
              </span>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: 0.3,
                  textTransform: "uppercase",
                  color: done ? C.signal : t.required ? C.brass : C.textFaint,
                  padding: "3px 7px",
                  borderRadius: 999,
                  border: `1px solid ${
                    done
                      ? "rgba(61,214,140,0.3)"
                      : t.required
                        ? "rgba(231,169,97,0.35)"
                        : C.border
                  }`,
                  background: done ? "rgba(61,214,140,0.1)" : t.required ? C.brassSoft : "transparent",
                }}
              >
                {done
                  ? t.status === "skipped"
                    ? "Skipped"
                    : "Done"
                  : active
                    ? "Now"
                    : t.required
                      ? "Required"
                      : "Optional"}
              </span>
            </button>
          );
        })}
      </div>

      {reqLeft.length > 0 && (
        <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5, color: C.textMuted }}>
          Still needed:{" "}
          <span style={{ color: C.text }}>{reqLeft.map((t) => sectionLabel(t)).join(" · ")}</span>
        </p>
      )}
      {reqLeft.length === 0 && optLeft.length > 0 && (
        <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5, color: C.textMuted }}>
          Required done. Optional left: {optLeft.map((t) => sectionLabel(t)).join(" · ")}
        </p>
      )}
      {reqLeft.length === 0 && optLeft.length === 0 && tasks.length > 0 && (
        <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5, color: C.signal }}>
          All parts complete — continue to produce when ready.
        </p>
      )}
    </div>
  );
}
