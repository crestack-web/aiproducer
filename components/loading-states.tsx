"use client";

import type { CSSProperties } from "react";
import { STUDIO_LOGO_URL } from "@/lib/brand";

const CSS = `
@keyframes ap-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
@keyframes ap-eq { 0%,100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
@keyframes ap-pulse { 0%,100% { opacity: .85; transform: scale(1); } 50% { opacity: 1; transform: scale(1.06); } }
@keyframes ap-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.ap-skel {
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.10) 40%, rgba(255,255,255,0.04) 80%);
  background-size: 200% 100%;
  animation: ap-shimmer 1.4s ease-in-out infinite;
  border-radius: 10px;
}
.ap-loading-wrap { animation: ap-fade-in 240ms ease both; }
@media (prefers-reduced-motion: reduce) { .ap-skel, .ap-eq-bar, .ap-logo-pulse { animation: none !important; } }
`;

export function LoadingStyles() {
  return <style>{CSS}</style>;
}

export function SkeletonCardGrid({ count = 4, style }: { count?: number; style?: CSSProperties }) {
  return (
    <>
      <LoadingStyles />
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="ap-loading-wrap" style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, ...style }} aria-hidden>
          <div className="ap-skel" style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 16 }} />
          <div className="ap-skel" style={{ height: 12, width: "72%", borderRadius: 6 }} />
          <div className="ap-skel" style={{ height: 10, width: "44%", borderRadius: 6 }} />
        </div>
      ))}
      <span role="status" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Loading</span>
    </>
  );
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <LoadingStyles />
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="ap-loading-wrap"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: 10,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div className="ap-skel" style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="ap-skel" style={{ height: 12, width: `${60 - i * 6}%`, borderRadius: 6 }} />
            <div className="ap-skel" style={{ height: 10, width: "32%", borderRadius: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Full-screen branded loader: logo + animated equalizer. */
export function FullPageLoader({ label = "Loading your studio" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "radial-gradient(ellipse at 50% 35%, rgba(255,138,91,0.10), transparent 55%), #05060A",
        color: "#A1A5B3",
      }}
    >
      <LoadingStyles />
      <div className="ap-loading-wrap" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="ap-logo-pulse"
          src={STUDIO_LOGO_URL}
          alt=""
          width={56}
          height={56}
          style={{
            borderRadius: 16,
            objectFit: "cover",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 12px 40px -8px rgba(255,138,91,0.55)",
            animation: "ap-pulse 1.8s ease-in-out infinite",
          }}
        />
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 22 }} aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="ap-eq-bar"
              style={{
                width: 4,
                height: "100%",
                borderRadius: 4,
                background: "linear-gradient(180deg, #FFB089, #FF8A5B)",
                transformOrigin: "bottom",
                animation: `ap-eq 0.9s ease-in-out ${i * 0.12}s infinite`,
              }}
            />
          ))}
        </div>
        <span style={{ fontSize: 13, letterSpacing: 0.2, fontFamily: "Inter, system-ui, sans-serif" }}>{label}</span>
      </div>
    </div>
  );
}
