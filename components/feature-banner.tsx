"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ArtistAvatar } from "@/components/artist-avatar";
import { useTheme } from "@/lib/theme";

type Props = {
  seed?: string;
  variant?: "home" | "library";
};

/**
 * Promotional feature strip under the app header (Suno-style),
 * highlighting AP capabilities already shipped: beats, plan, booth, produce.
 */
export function FeatureBanner({ seed = "ap-studio", variant = "home" }: Props) {
  const router = useRouter();
  const { colors: C, mode } = useTheme();

  const copy =
    variant === "library"
      ? {
          title: "Your catalog, ready to ship",
          body: "Beats, takes, and masters in one place — open Studio to create the next one.",
          cta: "Create a beat",
          href: "/app/studio",
        }
      : {
          title: "Beat → Plan → Record → Produce",
          body: "Generate an AP beat, get a section plan, record in the Booth, then mix & master.",
          cta: "Open Studio",
          href: "/app/studio",
        };

  const chips =
    variant === "home"
      ? [
          { label: "AP beats", href: "/app/studio" },
          { label: "AI Producer plan", href: "/app/studio" },
          { label: "Recording Booth", href: "/app/studio" },
          { label: "Mix & master", href: "/app/studio" },
        ]
      : [
          { label: "Songs", href: "/app?tab=library" },
          { label: "Beats", href: "/app?tab=library" },
          { label: "New session", href: "/app/studio" },
        ];

  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 18,
          border: `1px solid ${C.border}`,
          background:
            mode === "light"
              ? `linear-gradient(135deg, rgba(231,169,97,0.18) 0%, rgba(123,92,255,0.12) 50%, ${C.surface} 100%)`
              : `linear-gradient(135deg, rgba(40,28,18,0.95) 0%, rgba(28,22,48,0.9) 45%, ${C.surface} 100%)`,
          padding: "16px 16px 14px",
          boxShadow: mode === "light" ? "0 8px 24px rgba(0,0,0,0.06)" : "0 12px 32px rgba(0,0,0,0.35)",
        }}
      >
        {/* Decorative generative mark */}
        <div
          style={{
            position: "absolute",
            right: -12,
            top: -16,
            opacity: 0.55,
            pointerEvents: "none",
          }}
        >
          <ArtistAvatar seed={seed} size={120} />
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              mode === "light"
                ? "linear-gradient(90deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.15) 55%, transparent 100%)"
                : "linear-gradient(90deg, rgba(10,8,14,0.75) 0%, rgba(10,8,14,0.35) 55%, transparent 100%)",
            pointerEvents: "none",
          }}
        />

        <div style={{ position: "relative", zIndex: 1, maxWidth: "78%" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.06,
              textTransform: "uppercase",
              color: C.brass,
              marginBottom: 6,
            }}
          >
            AP Studio
          </div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 750,
              color: C.text,
              lineHeight: 1.25,
              marginBottom: 6,
            }}
          >
            {copy.title}
          </div>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 13,
              lineHeight: 1.45,
              color: C.textMuted,
            }}
          >
            {copy.body}
          </p>
          <button
            type="button"
            onClick={() => router.push(copy.href)}
            style={{
              border: "none",
              borderRadius: 999,
              padding: "10px 16px",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
              background: C.text,
              color: mode === "light" ? "#fff" : "#0a0a0c",
            }}
          >
            {copy.cta}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 10,
        }}
      >
        {chips.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => router.push(c.href)}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${C.border}`,
              background: C.surface,
              color: C.text,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
