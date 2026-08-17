"use client";

/**
 * Session entry: load full booth UI when available.
 * NEVER render a blank page (return null). Always show loading or recovery UI.
 */
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PlayerLoadingState } from "@/components/studio-player";
import { useTheme } from "@/lib/theme";

type FullMod = {
  default: React.ComponentType;
  FULL_SESSION_UI?: boolean;
};

export default function ProjectSessionEntry() {
  const id = (useParams()?.id as string) || "";
  const { colors: C } = useTheme();
  const [FullUI, setFullUI] = useState<React.ComponentType | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("@/components/project-session-ui")
      .then((mod: FullMod) => {
        if (cancelled) return;
        // Require explicit marker — never trust a null placeholder even if minified name differs
        if (mod.FULL_SESSION_UI === true && typeof mod.default === "function") {
          setFullUI(() => mod.default);
        } else {
          setLoadError(
            "Recording booth module is not fully deployed (placeholder only). Refresh after deploy."
          );
        }
        setTried(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Could not load session UI");
        setTried(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (FullUI) {
    return <FullUI />;
  }

  // Always visible loading / recovery — never blank
  return (
    <AppShell active="studio">
      <div
        style={{
          width: "100%",
          maxWidth: 920,
          margin: "0 auto",
          padding: "28px 20px 40px",
          color: C.text,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <Link href="/app/studio" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>
          ← Studio
        </Link>
        {!tried && (
          <PlayerLoadingState
            title="Loading session"
            subtitle="Opening planner and recording booth…"
            seed={`entry-${id}`}
          />
        )}
        {tried && loadError && (
          <div style={{ marginTop: 24 }}>
            <h1 style={{ fontFamily: "Georgia, serif", fontSize: 22, marginBottom: 8 }}>
              Session unavailable
            </h1>
            <p style={{ color: C.danger, fontSize: 14, lineHeight: 1.45 }}>{loadError}</p>
            <p style={{ color: C.textMuted, fontSize: 13, marginTop: 12 }}>
              Project: <code>{id || "(missing id)"}</code>
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16,
                padding: "12px 18px",
                borderRadius: 12,
                border: "none",
                background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
                color: "#1A1208",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        )}
        {tried && !loadError && !FullUI && (
          <PlayerLoadingState
            title="Preparing session"
            subtitle="Almost ready…"
            seed={`wait-${id}`}
          />
        )}
      </div>
    </AppShell>
  );
}
