"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/** Resolved appearance applied to the UI */
export type ThemeMode = "dark" | "light";

/** Stored user preference (includes follow-system) */
export type ThemePreference = "dark" | "light" | "system";

export type ThemeColors = {
  bg: string;
  bgDeep: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  borderHi: string;
  brass: string;
  brassSoft: string;
  brassLine: string;
  signal: string;
  text: string;
  textMuted: string;
  textFaint: string;
  danger: string;
  navGlass: string;
  shadow: string;
  cardShadow: string;
  inputFill: string;
};

/** Dark mode — keep the original Studio night look intact. */
export const DARK: ThemeColors = {
  bg: "#0B0A0F",
  bgDeep: "#050508",
  surface: "rgba(255,255,255,0.045)",
  surfaceRaised: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.09)",
  borderHi: "rgba(255,255,255,0.16)",
  brass: "#E7A961",
  brassSoft: "rgba(231,169,97,0.15)",
  brassLine: "rgba(231,169,97,0.55)",
  signal: "#7BEBD4",
  text: "#F4F1EC",
  textMuted: "#9B96A3",
  textFaint: "#5C5866",
  danger: "#E8756A",
  navGlass: "rgba(11,10,15,0.94)",
  shadow: "rgba(0,0,0,0.35)",
  cardShadow: "0 1px 0 rgba(255,255,255,0.04)",
  inputFill: "rgba(0,0,0,0.28)",
};

/**
 * Light mode — warm paper / daytime studio.
 * Distinct from dark: solid ivory surfaces, soft shadows, deeper brass.
 */
export const LIGHT: ThemeColors = {
  bg: "#FAF6F0",
  bgDeep: "#F0E9DF",
  surface: "#FFFFFF",
  surfaceRaised: "#FFFFFF",
  border: "rgba(55, 40, 22, 0.10)",
  borderHi: "rgba(55, 40, 22, 0.16)",
  brass: "#A86B1F",
  brassSoft: "rgba(168, 107, 31, 0.11)",
  brassLine: "rgba(168, 107, 31, 0.42)",
  signal: "#0A8A76",
  text: "#1C1916",
  textMuted: "#5E574F",
  textFaint: "#8C847A",
  danger: "#C53D32",
  navGlass: "rgba(250, 246, 240, 0.88)",
  shadow: "rgba(40, 28, 12, 0.10)",
  cardShadow: "0 1px 2px rgba(40, 28, 12, 0.04), 0 8px 24px rgba(40, 28, 12, 0.06)",
  inputFill: "#F5EFE6",
};

type ThemeContextValue = {
  /** Resolved light/dark currently shown */
  mode: ThemeMode;
  /** User preference including system */
  preference: ThemePreference;
  colors: ThemeColors;
  /** Cycles dark → light → system → dark */
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
  setPreference: (p: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "studio-theme";

function systemMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function resolveThemeMode(preference: ThemePreference): ThemeMode {
  if (preference === "system") return systemMode();
  return preference;
}

function applyDomTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", mode);
  const c = mode === "light" ? LIGHT : DARK;
  root.style.colorScheme = mode;
  document.body.style.background = c.bgDeep;
  document.body.style.color = c.text;
}

function readStoredPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    /* ignore */
  }
  return "system";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [mode, setModeState] = useState<ThemeMode>("dark");

  useEffect(() => {
    const pref = readStoredPreference();
    const resolved = resolveThemeMode(pref);
    setPreferenceState(pref);
    setModeState(resolved);
    applyDomTheme(resolved);
  }, []);

  // Follow OS when preference is system
  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const resolved = systemMode();
      setModeState(resolved);
      applyDomTheme(resolved);
    };
    mq.addEventListener?.("change", onChange);
    // Safari < 14
    mq.addListener?.(onChange);
    return () => {
      mq.removeEventListener?.("change", onChange);
      mq.removeListener?.(onChange);
    };
  }, [preference]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    const resolved = resolveThemeMode(p);
    setModeState(resolved);
    applyDomTheme(resolved);
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* ignore */
    }
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setPreference(m);
  }, [setPreference]);

  const toggle = useCallback(() => {
    setPreferenceState((prev) => {
      const next: ThemePreference =
        prev === "dark" ? "light" : prev === "light" ? "system" : "dark";
      const resolved = resolveThemeMode(next);
      setModeState(resolved);
      applyDomTheme(resolved);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      mode,
      preference,
      colors: mode === "light" ? LIGHT : DARK,
      toggle,
      setMode,
      setPreference,
    }),
    [mode, preference, toggle, setMode, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      mode: "dark",
      preference: "dark",
      colors: DARK,
      toggle: () => undefined,
      setMode: () => undefined,
      setPreference: () => undefined,
    };
  }
  return ctx;
}
