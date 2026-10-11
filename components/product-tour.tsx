"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/lib/theme";

export const TOUR_STORAGE_KEY = "studio_product_tour_v1";
export const TOUR_ACTIVE_KEY = "studio_product_tour_active";

export type TourStep = {
  id: string;
  title: string;
  body: string;
  nav?: "home" | "studio" | "library" | "profile";
  href?: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Studio",
    body: "Studio helps you turn a beat and your voice into a finished song. An AI producer plans the session, you record section by section, then we mix and master.",
  },
  {
    id: "home",
    title: "Home",
    body: "Your dashboard. See recent projects, jump back into a session, or start a new song.",
    nav: "home",
    href: "/app",
  },
  {
    id: "studio",
    title: "Studio",
    body: "Create or upload a beat, then start with the AI Producer. Record each section with the beat.",
    nav: "studio",
    href: "/app/studio",
  },
  {
    id: "flow",
    title: "How a song is made",
    body: "1) Beat  2) AI Producer plan  3) Record  4) Preview  5) Produce",
    nav: "studio",
  },
  {
    id: "library",
    title: "Library",
    body: "Your catalog: finished songs, beats, and sessions.",
    nav: "library",
    href: "/app?tab=library",
  },
  {
    id: "profile",
    title: "Profile",
    body: "Your artist identity and account controls. Replay this tour from Profile anytime.",
    nav: "profile",
    href: "/app?tab=profile",
  },
  {
    id: "done",
    title: "You're ready",
    body: "Studio → create a beat → AI Producer → record → preview → Produce. Use headphones when recording.",
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
    return { open: parsed.open, index: Math.max(0, Math.min(TOUR_STEPS.length - 1, parsed.index)) };
  } catch {
    return null;
  }
}

function writeActiveTour(state: ActiveTour | null) {
  if (typeof window === "undefined") return;
  try {
    if (!state || !state.open) sessionStorage.removeItem(TOUR_ACTIVE_KEY);
    else sessionStorage.setItem(TOUR_ACTIVE_KEY, JSON.stringify(state));
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
  index: number;
  onIndexChange: (index: number) => void;
};

export function ProductTour({ open, onClose, index, onIndexChange }: Props) {
  const { colors: C } = useTheme();
  const router = useRouter();
  const step = TOUR_STEPS[index] || TOUR_STEPS[0];
  const isLast = index >= TOUR_STEPS.length - 1;

  useEffect(() => {
    if (!open || !step?.href) return;
    const target = step.href;
    try {
      const current = `${window.location.pathname}${window.location.search}`;
      if (current === target) return;
      if (target.startsWith("/app/studio") && window.location.pathname.startsWith("/app/studio")) return;
      router.push(target);
    } catch {
      /* ignore */
    }
  }, [open, step?.href, router]);

  if (!open) return null;

  const next = () => {
    if (isLast) {
      markTourCompleted();
      onClose();
      return;
    }
    onIndexChange(index + 1);
  };

  const back = () => {
    if (index > 0) onIndexChange(index - 1);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="studio-tour-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
      onClick={() => {
        markTourCompleted();
        onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          borderRadius: "18px 18px 0 0",
          background: C.modalSurface || C.surfaceRaised || C.surface || "#16141C",
          border: `1px solid ${C.border}`,
          padding: "20px 16px 28px",
          color: C.text,
          boxShadow: "0 -8px 40px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>
          {index + 1} / {TOUR_STEPS.length}
        </div>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>{step.title}</div>
        <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.5, color: C.textMuted, whiteSpace: "pre-line" }}>
          {step.body}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          {index > 0 && (
            <button
              type="button"
              onClick={back}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: C.modalSurface || C.surfaceRaised || C.surface,
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

export function useProductTour(enabled = true) {
  const [open, setOpen] = useState(false);
  const [index, setIndexState] = useState(0);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
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

  return { open, index, setIndex, setOpen, start, close };
}
