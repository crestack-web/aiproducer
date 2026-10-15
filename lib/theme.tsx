"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  /** Opaque panel for dialogs / sheets (never transparent) */
  modalSurface: string;
};

/** Dark mode — keep the original Studio night look intact. */
export const DARK: ThemeColors = {
  bg: "#0B0A0F",
  bgDeep: "#050508",
  surface: "rgba(22,20,28,0.92)",
  surfaceRaised: "rgba(28,26,36,0.96)",
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
  modalSurface: "#16141C",
};

/**
 * Light mode — warm paper / daytime studio.
 * Distinct from dark: solid ivory surfaces, soft shadows, deeper brass.
 */
export const LIGHT: ThemeColors = {
  bg: "#F3EBE0",
  bgDeep: "#E8DFD2",
  surface: "#FFFFFF",
  surfaceRaised: "#FFFBF6",
  border: "rgba(48, 36, 22, 0.12)",
  borderHi: "rgba(48, 36, 22, 0.2)",
  brass: "#C47820",
  brassSoft: "rgba(196, 120, 32, 0.16)",
  brassLine: "rgba(196, 120, 32, 0.45)",
  signal: "#0A8F7A",
  text: "#14110E",
  textMuted: "#3F3830",
  textFaint: "#6E655C",
  danger: "#E85D4C",
  navGlass: "rgba(255, 251, 246, 0.96)",
  shadow: "rgba(40, 28, 12, 0.10)",
  cardShadow: "0 2px 4px rgba(40, 28, 12, 0.05), 0 12px 32px rgba(40, 28, 12, 0.08)",
  inputFill: "#F3EDE4",
  modalSurface: "#FFFFFF",
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

/** App is dark-only — light mode and system preference are disabled. */
export function resolveThemeMode(_preference?: ThemePreference): ThemeMode {
  return "dark";
}

function applyDomTheme(_mode?: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", "dark");
  root.style.colorScheme = "dark";
  document.body.style.background = DARK.bgDeep;
  document.body.style.color = DARK.text;
  try {
    localStorage.setItem(STORAGE_KEY, "dark");
  } catch {
    /* ignore */
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyDomTheme("dark");
  }, []);

  const setPreference = useCallback((_p: ThemePreference) => {
    applyDomTheme("dark");
  }, []);

  const setMode = useCallback((_m: ThemeMode) => {
    applyDomTheme("dark");
  }, []);

  const toggle = useCallback(() => {
    /* dark-only — no-op */
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode: "dark",
      preference: "dark",
      colors: DARK,
      toggle,
      setMode,
      setPreference,
    }),
    [toggle, setMode, setPreference]
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
