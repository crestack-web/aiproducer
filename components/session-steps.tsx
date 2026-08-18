"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";

export type SessionTask = {
  id: string;
  type: string;
  title?: string | null;
  instruction: string;
  status: string;
  required: boolean;
  recommendation?: string | null;
  active?: boolean | null;
  selected_in_plan?: boolean | null;
  start_ms?: number | null;
  end_ms?: number | null;
  section_id?: string | null;
  metadata?: { section_label?: string; vocal_part?: string; section_id?: string };
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

/** @deprecated AI recommended ≠ required. Prefer activePlanOpen from plan helpers. */
export function requiredOpen(tasks: SessionTask[]) {
  // Treat recommended/required as "suggested priority" for ordering only — never blocks produce
  return tasks.filter(
    (t) =>
      isTaskOpen(t) &&
      (t.required ||
        (t as SessionTask & { recommendation?: string }).recommendation === "recommended")
  );
}

export function optionalOpen(tasks: SessionTask[]) {
  return tasks.filter((t) => {
    const rec = (t as SessionTask & { recommendation?: string }).recommendation;
    const isRec = t.required || rec === "recommended";
    return !isRec && isTaskOpen(t);
  });
}

/** All open tasks in the current session list (active plan only is already filtered by API). */
export function allOpen(tasks: SessionTask[]) {
  return tasks.filter(isTaskOpen);
}

/**
 * Core song sections the artist must work through (lead / required).
 * Production layers (double, harmony, adlib, …) are NOT core.
 */
export function isCoreTask(t: SessionTask): boolean {
  if (t.required) return true;
  const ty = (t.type || "").toLowerCase();
  if (ty.includes("double") || ty.includes("harmony") || ty.includes("adlib") || ty.includes("ad-lib")) {
    return false;
  }
  if (ty.includes("hum") || ty.includes("background") || ty.includes("texture") || ty.includes("whisper")) {
    return false;
  }
  if (ty.includes("call") || ty.includes("response") || ty.includes("chant")) {
    return false;
  }
  // LEAD and unknown required-shaped types
  if (ty.includes("lead") || ty === "lead_vocal") return true;
  return Boolean(t.required);
}

export function isProductionLayer(t: SessionTask): boolean {
  return !isCoreTask(t);
}

export function coreTasks(tasks: SessionTask[]): SessionTask[] {
  return tasks.filter(isCoreTask);
}

export function coreOpen(tasks: SessionTask[]): SessionTask[] {
  return tasks.filter((t) => isCoreTask(t) && isTaskOpen(t));
}

export function coreDone(tasks: SessionTask[]): SessionTask[] {
  return tasks.filter((t) => isCoreTask(t) && isTaskDone(t));
}

export function productionLayersAdded(tasks: SessionTask[]): SessionTask[] {
  return tasks.filter((t) => isProductionLayer(t) && t.status === "completed");
}

function sectionKey(t: SessionTask): string {
  const sid = t.section_id || t.metadata?.section_id || null;
  if (sid) return `s:${sid}`;
  if (t.start_ms != null) return `ms:${t.start_ms}`;
  return `id:${t.id}`;
}

/**
 * After finishing a core (or any) take, recommend at most ONE open production layer
 * for the same section — never flood the artist with a list of "sections".
 */
export function nextProductionRecommendation(
  tasks: SessionTask[],
  parent: SessionTask
): SessionTask | null {
  const key = sectionKey(parent);
  const layers = tasks.filter(
    (t) => isProductionLayer(t) && isTaskOpen(t) && sectionKey(t) === key
  );
  // Prefer doubles, then harmony, then others (stable product priority)
  const rank = (type: string) => {
    const ty = (type || "").toLowerCase();
    if (ty.includes("double")) return 0;
    if (ty.includes("harmony")) return 1;
    if (ty.includes("background")) return 2;
    if (ty.includes("adlib") || ty.includes("ad-lib")) return 3;
    if (ty.includes("response") || ty.includes("call")) return 4;
    return 5;
  };
  layers.sort((a, b) => rank(a.type) - rank(b.type));
  return layers[0] || null;
}

export function layerRecommendationCopy(type: string): {
  headline: string;
  body: string;
  cta: string;
} {
  const ty = (type || "").toLowerCase();
  if (ty.includes("double")) {
    return {
      headline: "Let's make this bigger.",
      body: "Record the same melody again. I'll layer it underneath your lead.",
      cta: "Record Double",
    };
  }
  if (ty.includes("harmony")) {
    return {
      headline: "One more idea — harmony.",
      body: "Sing a higher version of this melody. Try it on the lines that need lift.",
      cta: "Record Harmony",
    };
  }
  if (ty.includes("adlib") || ty.includes("ad-lib")) {
    return {
      headline: "Add some ad-libs.",
      body: "Add free, expressive vocal responses in the open spaces.",
      cta: "Record Ad-libs",
    };
  }
  if (ty.includes("background")) {
    return {
      headline: "Background vocal.",
      body: "Add a softer background response behind the lead.",
      cta: "Record Background",
    };
  }
  if (ty.includes("hum")) {
    return {
      headline: "A soft hum.",
      body: "Give me a soft hum to thicken the texture under this part.",
      cta: "Record Hum",
    };
  }
  if (ty.includes("response") || ty.includes("call")) {
    return {
      headline: "Call and response.",
      body: "Answer the lead with a short response vocal.",
      cta: "Record Response",
    };
  }
  return {
    headline: "Optional production layer.",
    body: "This is optional — record it if you want more depth, or skip.",
    cta: "Record layer",
  };
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
  const { colors: C, mode } = useTheme();
  const isLight = mode === "light";
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  const updateScrollChrome = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < max - 4);
    setScrollProgress(max > 0 ? el.scrollLeft / max : 0);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateScrollChrome();
    el.addEventListener("scroll", updateScrollChrome, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateScrollChrome) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollChrome);
      ro?.disconnect();
    };
  }, [tasks.length, updateScrollChrome]);

  useEffect(() => {
    if (!highlightId || !scrollerRef.current) return;
    const el = scrollerRef.current.querySelector(`[data-task-id="${highlightId}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      requestAnimationFrame(updateScrollChrome);
    }
  }, [highlightId, updateScrollChrome]);

  function slideBy(dir: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = Math.max(140, Math.floor(el.clientWidth * 0.72)) * dir;
    el.scrollBy({ left: amount, behavior: "smooth" });
  }

  if (!tasks.length) return null;
  const requiredTasks = tasks.filter((t) => t.required);
  const requiredDoneCount = requiredTasks.filter(isTaskDone).length;
  const reqLeft = requiredOpen(tasks);
  const optLeft = optionalOpen(tasks);
  const totalDone = tasks.filter(isTaskDone).length;

  const trackBg = isLight ? "rgba(55,40,22,0.10)" : "rgba(255,255,255,0.06)";
  const edgeFade = isLight ? "rgba(250,246,240,0.98)" : "rgba(11,10,15,0.92)";
  const chevronBg = isLight ? "#FFFFFF" : "rgba(18,16,24,0.88)";
  const chevronBorder = isLight ? "rgba(55,40,22,0.14)" : C.border;

  return (
    <div style={{ marginTop: compact ? 8 : 14, marginBottom: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>
          <span style={{ color: C.brass, fontWeight: 700 }}>
            {requiredDoneCount}/{requiredTasks.length || 0}
          </span>{" "}
          required done
          {reqLeft.length > 0 ? (
            <span style={{ color: C.textFaint }}> · {reqLeft.length} left</span>
          ) : (
            <span style={{ color: C.signal, fontWeight: 600 }}> · required complete</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: 0.3, fontWeight: 500 }}>
          {totalDone}/{tasks.length} parts
        </div>
      </div>

      <div
        style={{
          height: 3,
          borderRadius: 999,
          background: trackBg,
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

      <div style={{ position: "relative" }}>
        <div
          aria-hidden
          style={{
            pointerEvents: "none",
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 14,
            width: 28,
            zIndex: 2,
            background: `linear-gradient(90deg, ${edgeFade}, transparent)`,
            opacity: canLeft ? 1 : 0,
            transition: "opacity 0.2s ease",
          }}
        />
        <div
          aria-hidden
          style={{
            pointerEvents: "none",
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 14,
            width: 28,
            zIndex: 2,
            background: `linear-gradient(270deg, ${edgeFade}, transparent)`,
            opacity: canRight ? 1 : 0,
            transition: "opacity 0.2s ease",
          }}
        />

        {canLeft && (
          <button
            type="button"
            aria-label="Previous sections"
            onClick={() => slideBy(-1)}
            style={{
              position: "absolute",
              left: 4,
              top: "42%",
              transform: "translateY(-50%)",
              zIndex: 3,
              width: 30,
              height: 30,
              borderRadius: 999,
              border: `1px solid ${chevronBorder}`,
              background: chevronBg,
              color: C.text,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              fontSize: 16,
              lineHeight: 1,
              fontWeight: 600,
              boxShadow: isLight
                ? "0 2px 8px rgba(40,28,12,0.10)"
                : "0 4px 16px rgba(0,0,0,0.35)",
            }}
          >
            ‹
          </button>
        )}
        {canRight && (
          <button
            type="button"
            aria-label="Next sections"
            onClick={() => slideBy(1)}
            style={{
              position: "absolute",
              right: 4,
              top: "42%",
              transform: "translateY(-50%)",
              zIndex: 3,
              width: 30,
              height: 30,
              borderRadius: 999,
              border: `1px solid ${chevronBorder}`,
              background: chevronBg,
              color: C.text,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              fontSize: 16,
              lineHeight: 1,
              fontWeight: 600,
              boxShadow: isLight
                ? "0 2px 8px rgba(40,28,12,0.10)"
                : "0 4px 16px rgba(0,0,0,0.35)",
            }}
          >
            ›
          </button>
        )}

        <div
          ref={scrollerRef}
          className="session-steps-slider"
          style={{
            display: "flex",
            flexDirection: "row",
            gap: isLight ? 12 : 10,
            overflowX: "auto",
            overflowY: "hidden",
            WebkitOverflowScrolling: "touch",
            scrollSnapType: "x mandatory",
            scrollBehavior: "smooth",
            paddingBottom: 12,
            marginInline: -2,
            paddingInline: 6,
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {tasks.map((t, i) => {
            const done = isTaskDone(t);
            const active = t.id === highlightId;

            const cardBg = active
              ? isLight
                ? "linear-gradient(165deg, #FFF8EE 0%, #FFFFFF 55%)"
                : `linear-gradient(160deg, ${C.brassSoft}, rgba(255,255,255,0.04))`
              : isLight
                ? "#FFFFFF"
                : C.surface;

            const cardBorder = active
              ? `1.5px solid ${C.brass}`
              : isLight
                ? "1px solid rgba(55,40,22,0.14)"
                : `1px solid ${C.border}`;

            const cardShadow = active
              ? isLight
                ? "0 0 0 1px rgba(168,107,31,0.18), 0 6px 18px rgba(40,28,12,0.10)"
                : "0 0 0 1px rgba(231,169,97,0.25), 0 8px 24px rgba(0,0,0,0.25)"
              : isLight
                ? "0 1px 2px rgba(40,28,12,0.05), 0 4px 12px rgba(40,28,12,0.06)"
                : "0 1px 0 rgba(255,255,255,0.03)";

            const statusColor = done
              ? C.signal
              : active
                ? C.brass
                : t.required
                  ? isLight
                    ? "#8B5A12"
                    : C.brass
                  : C.textMuted;

            const titleColor = isLight ? "#1C1916" : C.text;
            const subColor = isLight ? "#5E574F" : C.textMuted;

            return (
              <button
                key={t.id}
                type="button"
                data-task-id={t.id}
                disabled={locked}
                onClick={() => onSelect(t.id)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 5,
                  flex: "0 0 auto",
                  minWidth: compact ? 120 : 140,
                  maxWidth: 176,
                  padding: "12px 14px",
                  borderRadius: 16,
                  border: cardBorder,
                  background: cardBg,
                  color: titleColor,
                  textAlign: "left",
                  cursor: locked ? "default" : "pointer",
                  fontFamily: "inherit",
                  opacity: done && !active ? (isLight ? 0.88 : 0.72) : 1,
                  scrollSnapAlign: "center",
                  boxShadow: cardShadow,
                  transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease",
                  transform: active ? "translateY(-1px)" : "none",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
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
                        ? isLight
                          ? "rgba(10,138,118,0.14)"
                          : "rgba(61,214,140,0.18)"
                        : active
                          ? isLight
                            ? "rgba(168,107,31,0.16)"
                            : C.brassSoft
                          : isLight
                            ? "rgba(55,40,22,0.08)"
                            : "rgba(255,255,255,0.06)",
                      color: done ? C.signal : active ? C.brass : isLight ? "#5E574F" : C.textFaint,
                      border: `1px solid ${
                        done
                          ? isLight
                            ? "rgba(10,138,118,0.35)"
                            : "rgba(10,138,118,0.3)"
                          : active
                            ? C.brass
                            : isLight
                              ? "rgba(55,40,22,0.14)"
                              : C.border
                      }`,
                    }}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      textTransform: "uppercase",
                      color: statusColor,
                      marginLeft: "auto",
                    }}
                  >
                    {done
                      ? t.status === "skipped"
                        ? "Skip"
                        : "Done"
                      : active
                        ? "Now"
                        : t.required || t.recommendation === "recommended"
                          ? "AI"
                          : "Opt"}
                  </span>
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: active ? 700 : 600,
                    lineHeight: 1.3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    width: "100%",
                    color: titleColor,
                  }}
                >
                  {sectionLabel(t)}
                </span>
                {!compact && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: subColor,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      width: "100%",
                    }}
                  >
                    {humanTitle(t.type)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div
          style={{
            height: 3,
            borderRadius: 999,
            background: trackBg,
            overflow: "hidden",
            marginTop: 2,
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: "28%",
              left: `${scrollProgress * 72}%`,
              borderRadius: 999,
              background: `linear-gradient(90deg, ${C.brass}, ${C.signal})`,
              transition: "left 0.12s ease-out",
              boxShadow: isLight ? "none" : "0 0 8px rgba(231,169,97,0.35)",
            }}
          />
        </div>
      </div>

      <style>{`
        .session-steps-slider::-webkit-scrollbar { display: none; }
      `}</style>

      {!compact && reqLeft.length > 0 && (
        <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5, color: C.textMuted }}>
          Still needed:{" "}
          <span style={{ color: C.text, fontWeight: 600 }}>
            {reqLeft.map((t) => sectionLabel(t)).join(" · ")}
          </span>
        </p>
      )}
      {!compact && reqLeft.length === 0 && optLeft.length > 0 && (
        <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5, color: C.textMuted }}>
          Required done. Optional left: {optLeft.map((t) => sectionLabel(t)).join(" · ")}
        </p>
      )}
      {!compact && reqLeft.length === 0 && optLeft.length === 0 && tasks.length > 0 && (
        <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5, color: C.signal, fontWeight: 600 }}>
          All parts complete — continue to produce when ready.
        </p>
      )}
    </div>
  );
}
