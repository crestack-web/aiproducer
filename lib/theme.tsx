"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemeMode = "dark" | "light";

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
};

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
};

export const LIGHT: ThemeColors = {
  bg: "#F6F3EE",
  bgDeep: "#EDE8E1",
  surface: "rgba(255,255,255,0.72)",
  surfaceRaised: "#FFFFFF",
  border: "rgba(26,18,8,0.08)",
  borderHi: "rgba(26,18,8,0.14)",
  brass: "#C4842E",
  brassSoft: "rgba(196,132,46,0.12)",
  brassLine: "rgba(196,132,46,0.45)",
  signal: "#0D9B84",
  text: "#1A1714",
  textMuted: "#6B6560",
  textFaint: "#9A948C",
  danger: "#D14B3F",
  navGlass: "rgba(246,243,238,0.92)",
  shadow: "rgba(26,18,8,0.08)",
};

type ThemeContextValue = {
  mode: ThemeMode;
  colors: ThemeColors;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "studio-theme";

function applyDomTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", mode);
  const c = mode === "light" ? LIGHT : DARK;
  root.style.colorScheme = mode;
  document.body.style.background = c.bgDeep;
  document.body.style.color = c.text;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("dark");

  useEffect(() => {
    let initial: ThemeMode = "dark";
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
      if (saved === "light" || saved === "dark") initial = saved;
      else if (window.matchMedia("(prefers-color-scheme: light)").matches) initial = "light";
    } catch {
      /* ignore */
    }
    setModeState(initial);
    applyDomTheme(initial);
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    applyDomTheme(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const next: ThemeMode = prev === "dark" ? "light" : "dark";
      applyDomTheme(next);
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
      colors: mode === "light" ? LIGHT : DARK,
      toggle,
      setMode,
    }),
    [mode, toggle, setMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      mode: "dark",
      colors: DARK,
      toggle: () => undefined,
      setMode: () => undefined,
    };
  }
  return ctx;
}
