"use client";

import { useTheme } from "@/lib/theme";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, toggle, colors } = useTheme();
  const isLight = mode === "light";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isLight}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      onClick={toggle}
      style={{
        position: "relative",
        width: compact ? 44 : 52,
        height: compact ? 26 : 30,
        borderRadius: 999,
        border: `1px solid ${colors.borderHi}`,
        background: isLight
          ? "linear-gradient(135deg, #F5E6D0, #E8D4B8)"
          : "linear-gradient(135deg, #1A1822, #0F0E14)",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        boxShadow: isLight
          ? "inset 0 1px 2px rgba(255,255,255,0.7), 0 1px 3px rgba(26,18,8,0.08)"
          : "inset 0 1px 2px rgba(255,255,255,0.06), 0 1px 4px rgba(0,0,0,0.35)",
        transition: "background 0.25s ease, border-color 0.2s ease",
      }}
    >
      {/* Track icons */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: compact ? 7 : 8,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: compact ? 10 : 11,
          opacity: isLight ? 0.35 : 0.9,
          transition: "opacity 0.2s ease",
          lineHeight: 1,
        }}
      >
        ☾
      </span>
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: compact ? 7 : 8,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: compact ? 10 : 11,
          opacity: isLight ? 0.9 : 0.35,
          transition: "opacity 0.2s ease",
          lineHeight: 1,
        }}
      >
        ☀
      </span>
      {/* Thumb */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: compact ? 3 : 3,
          left: isLight ? (compact ? 20 : 24) : 3,
          width: compact ? 20 : 24,
          height: compact ? 20 : 24,
          borderRadius: 999,
          background: isLight
            ? "linear-gradient(180deg, #FFFCF7, #F0E6D6)"
            : "linear-gradient(180deg, #F0BC80, #E7A961)",
          boxShadow: isLight
            ? "0 2px 6px rgba(26,18,8,0.18)"
            : "0 2px 8px rgba(231,169,97,0.45)",
          transition: "left 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
          display: "grid",
          placeItems: "center",
          fontSize: compact ? 9 : 10,
        }}
      />
    </button>
  );
}
