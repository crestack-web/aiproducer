"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArtistAvatar } from "@/components/artist-avatar";
import { useTheme } from "@/lib/theme";

type Props = {
  seed?: string;
  variant?: "home" | "library";
};

/** Motivational artist lines — rotate like the public welcome hero */
const HOME_HERO_LINES: { title: string; body: string }[] = [
  {
    title: "Your voice. Your song. Today.",
    body: "Stop waiting for a studio slot. Build the beat, record the take, and ship something you’re proud of.",
  },
  {
    title: "The booth is open whenever you are.",
    body: "Ideas fade fast. Capture the melody, stack the harmonies, and let AP finish the polish.",
  },
  {
    title: "From hum to radio-ready.",
    body: "Generate a beat, follow the plan, record in the Booth — then mix and master without leaving Studio.",
  },
  {
    title: "Make music that sounds like you.",
    body: "Not a synthetic singer. Your real voice, guided layers, and a mix built for the song you wrote.",
  },
  {
    title: "One session. Full song.",
    body: "Beat → plan → record → produce. Stay in the flow until the track feels finished.",
  },
  {
    title: "Artists who ship win.",
    body: "Less gear anxiety, more finished songs. Open Studio and move the idea out of your head.",
  },
];

const INTERVAL_MS = 3200;
const FADE_MS = 420;

/**
 * Promotional feature strip under the app header (Suno-style),
 * highlighting AP capabilities already shipped: beats, plan, booth, produce.
 */
export function FeatureBanner({ seed = "ap-studio", variant = "home" }: Props) {
  const router = useRouter();
  const { colors: C, mode } = useTheme();
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (variant !== "home") return;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const intervalId = setInterval(() => {
      setVisible(false);
      timeoutId = setTimeout(() => {
        setIndex((i) => (i + 1) % HOME_HERO_LINES.length);
        setVisible(true);
      }, FADE_MS);
    }, INTERVAL_MS);
    return () => {
      clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [variant]);

  const copy =
    variant === "library"
      ? {
          title: "Your catalog, ready to ship",
          body: "Beats, takes, and masters in one place — open Studio to create the next one.",
          cta: "Create a beat",
          href: "/app/studio",
        }
      : {
          title: HOME_HERO_LINES[index].title,
          body: HOME_HERO_LINES[index].body,
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
          boxShadow:
            mode === "light"
              ? "0 8px 24px rgba(0,0,0,0.06)"
              : "0 12px 32px rgba(0,0,0,0.35)",
        }}
      >
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

        <div style={{ position: "relative", zIndex: 1, maxWidth: "78%" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: C.brass,
              marginBottom: 6,
            }}
          >
            AP Studio
          </div>
          <div
            aria-live="polite"
            style={{
              minHeight: variant === "home" ? 52 : undefined,
              opacity: variant === "home" ? (visible ? 1 : 0) : 1,
              transform:
                variant === "home"
                  ? visible
                    ? "translateY(0)"
                    : "translateY(6px)"
                  : undefined,
              transition:
                variant === "home"
                  ? `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`
                  : undefined,
            }}
          >
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
          </div>
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

      {variant === "home" && (
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
      )}
    </div>
  );
}
