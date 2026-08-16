"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/lib/theme";

export const TOUR_STORAGE_KEY = "studio_product_tour_v1";
/** In-progress tour survives AppShell remounts across /app ↔ /app/studio */
export const TOUR_ACTIVE_KEY = "studio_product_tour_active";

export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** Optional nav target highlight */
  nav?: "home" | "studio" | "library" | "profile";
  /** Route to open when this step starts (optional) */
  href?: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Studio",
    body: "Studio helps you turn a beat and your voice into a finished song. An AI producer plans the session, you record section by section, then we mix and master with RoEx. This short tour shows every main area.",
  },
  {
    id: "home",
    title: "Home",
    body: "Your dashboard. See recent projects, jump back into a session, or start a new song. Everything you make shows up here first.",
    nav: "home",
    href: "/app",
  },
  {
    id: "studio",
    title: "Studio",
    body: "This is where songs are made. Create or upload a beat, then start with the AI Producer. You’ll get a section plan (verse, chorus, etc.) and record each part with the beat.",
    nav: "studio",
    href: "/app/studio",
  },
  {
    id: "flow",
    title: "How a song is made",
    body: "1) Beat — generate or upload an instrumental.\n2) AI Producer — maps sections and gives you a recording plan.\n3) Record — mic + headphones recommended; each section auto-stops at its window.\n4) Preview — hear the full song (beat + all takes) before produce.\n5) Produce — RoEx preview mix & master into a playable master.",
    nav: "studio",
  },
  {
    id: "library",
    title: "Library",
    body: "Your catalog: finished songs, beats, and sessions with recordings. Open anything to keep working or play what you’ve produced.",
    nav: "library",
    href: "/app?tab=library",
  },
  {
    id: "profile",
    title: "Profile",
    body: "Your artist identity, session count, and account controls. You can replay this tour anytime from Profile.",
    nav: "profile",
    href: "/app?tab=profile",
  },
  {
    id: "done",
    title: "You’re ready",
    body: "Start from Studio → create a beat → Start with AI Producer → record your sections → preview the full song → Produce. Use headphones when recording for the cleanest vocal.",
    href: "/app/studio",
  },
];

type ActiveTour = { open: boolean; index: number };

function readActiveTour(): ActiveTour | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(TOUR_ACTIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveTour;
    if (typeof parsed?.open !== "boolean" || typeof parsed?.index !== "number") return null;
    return {
      open: parsed.open,
      index: Math.max(0, Math.min(TOUR_STEPS.length - 1, parsed.index)),
    };
  } catch {
    return null;
  }
}

function writeActiveTour(state: ActiveTour | null) {
  if (typeof window === "undefined") return;
  try {
    if (!state || !state.open) {
      sessionStorage.removeItem(TOUR_ACTIVE_KEY);
    } else {
      sessionStorage.setItem(TOUR_ACTIVE_KEY, JSON.stringify(state));
    }
  } catch {
    /* ignore */
  }
}

export function markTourCompleted() {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, "done");
  } catch {
    /* ignore */
  }
  writeActiveTour(null);
}

export function isTourCompleted(): boolean {
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY) === "done";
  } catch {
    return false;
  }
}

export function resetTourFlag() {
  try {
    localStorage.removeItem(TOUR_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** Controlled step index (persisted by parent). */
  index: number;
  onIndexChange: (index: number) => void;
};

export function ProductTour({ open, onClose, index, onIndexChange }: Props) {
  const { colors: C } = useTheme();
  const router = useRouter();

  const step = TOUR_STEPS[index] || TOUR_STEPS[0];
  const isLast = index >= TOUR_STEPS.length - 1;

  // Navigate when step has an href (survives remount via persisted index)
  useEffect(() => {
    if (!open || !step?.href) return;
    const target = step.href;
    try {
      const current = `${window.location.pathname}${window.location.search}`;
      if (current === target || (target.startsWith("/app/studio") && window.location.pathname.startsWith("/app/studio"))) {
        return;
      }
      if (target.startsWith("/app?") && window.location.pathname === "/app") {
        const want = new URL(target, window.location.origin).searchParams.get("tab");
        const have = new URLSearchParams(window.location.search).get("tab");
        if ((want || "home") === (have || "home") || (!want && !have)) {
          // still push for tab changes
        }
      }
    } catch {
      /* ignore */
    }
    router.push(target);
  }, [open, step?.id, step?.href, router]);

  // Highlight nav targets after route settles
  useEffect(() => {
    if (!open) {
      document.querySelectorAll("[data-tour-active]").forEach((el) => {
        el.removeAttribute("data-tour-active");
      });
      return;
    }
    const apply = () => {
      document.querySelectorAll("[data-tour-active]").forEach((el) => {
        el.removeAttribute("data-tour-active");
      });
      if (step?.nav) {
        document.querySelectorAll(`[data-tour-nav="${step.nav}"]`).forEach((el) => {
          el.setAttribute("data-tour-active", "true");
        });
      }
    };
    apply();
    const t = window.setTimeout(apply, 350);
    return () => {
      window.clearTimeout(t);
      document.querySelectorAll("[data-tour-active]").forEach((el) => {
        el.removeAttribute("data-tour-active");
      });
    };
  }, [open, step?.nav, step?.id]);

  const finish = useCallback(() => {
    markTourCompleted();
    onClose();
  }, [onClose]);

  const next = () => {
    if (isLast) finish();
    else onIndexChange(index + 1);
  };

  const back = () => {
    if (index > 0) onIndexChange(index - 1);
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-tour-title"
      className="studio-tour-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))",
        background: "rgba(0,0,0,0.55)",
        boxSizing: "border-box",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) finish();
      }}
    >
      <style>{`
        [data-tour-active="true"] {
          outline: 2px solid ${C.brass} !important;
          outline-offset: 3px;
          box-shadow: 0 0 0 6px ${C.brassSoft} !important;
          border-radius: 12px;
          position: relative;
          z-index: 201;
        }
        @media (max-width: 899px) {
          .studio-tour-overlay {
            padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px)) !important;
          }
        }
      `}</style>

      <div
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 20,
          background: C.surfaceRaised || C.surface,
          border: `1px solid ${C.border}`,
          boxShadow: C.cardShadow,
          padding: "22px 20px 18px",
          color: C.text,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {TOUR_STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: 99,
                background: i <= index ? C.brass : C.border,
              }}
            />
          ))}
        </div>

        <h2
          id="studio-tour-title"
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 22,
            fontWeight: 500,
            margin: "0 0 10px",
            color: C.text,
          }}
        >
          {step.title}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 14.5,
            lineHeight: 1.55,
            color: C.textMuted,
            whiteSpace: "pre-line",
          }}
        >
          {step.body}
        </p>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          {index > 0 && (
            <button
              type="button"
              onClick={back}
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: C.surface,
                color: C.text,
                fontWeight: 500,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={next}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: 12,
              border: "none",
              background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
              color: "#1A1208",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {isLast ? "Start creating" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Auto-open tour once for new users; state survives route changes via sessionStorage. */
export function useProductTour(enabled = true) {
  const [open, setOpen] = useState(false);
  const [index, setIndexState] = useState(0);

  // Restore in-progress tour after AppShell remount (e.g. /app → /app/studio)
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    const active = readActiveTour();
    if (active?.open) {
      setOpen(true);
      setIndexState(active.index);
      return;
    }
    if (!isTourCompleted()) {
      const t = setTimeout(() => {
        setOpen(true);
        setIndexState(0);
        writeActiveTour({ open: true, index: 0 });
      }, 600);
      return () => clearTimeout(t);
    }
  }, [enabled]);

  const setIndex = useCallback((next: number | ((prev: number) => number)) => {
    setIndexState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      const clamped = Math.max(0, Math.min(TOUR_STEPS.length - 1, value));
      writeActiveTour({ open: true, index: clamped });
      return clamped;
    });
  }, []);

  const start = useCallback(() => {
    resetTourFlag();
    setIndexState(0);
    setOpen(true);
    writeActiveTour({ open: true, index: 0 });
  }, []);

  const close = useCallback(() => {
    markTourCompleted();
    setOpen(false);
    writeActiveTour(null);
  }, []);

  return {
    open,
    index,
    setIndex,
    setOpen,
    start,
    close,
  };
}
