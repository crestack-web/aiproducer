"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import BeatStudioPanel from "@/components/beat-studio/beat-studio-panel";
import { STUDIO_LOGO_URL } from "@/lib/brand";

/**
 * Standalone Beat Studio MVP — /app/beat-studio/[id]
 * Isolated from Booth vocal recording and Console timeline.
 */
export default function BeatStudioPage() {
  const params = useParams();
  const projectId = String(params?.id || "");
  const [title, setTitle] = useState("Beat Studio");
  const [tempo, setTempo] = useState<number | null>(null);

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((j) => {
        const p = j.project || j;
        if (p?.title) setTitle(p.title);
        if (typeof p?.tempo === "number") setTempo(p.tempo);
      })
      .catch(() => {});
  }, [projectId]);

  if (!projectId) {
    return <p style={{ padding: 24, color: "#9B96A3" }}>Missing project id</p>;
  }

  return (
    <div style={pageStyle}>
      <div style={ambientStyle} aria-hidden />
      <header style={headerStyle}>
        <Link href="/app" style={logoStyle}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={STUDIO_LOGO_URL} alt="" width={28} height={28} style={{ borderRadius: 8 }} />
          AP Studio
        </Link>
        <span style={{ color: "#E7A961", fontSize: 12, fontWeight: 600, letterSpacing: "0.06em" }}>
          beat studio
        </span>
      </header>
      <main style={mainStyle}>
        <h1 style={h1Style}>{title}</h1>
        <p style={subStyle}>Program drums, sketch melodies, save the pattern with your project.</p>
        <BeatStudioPanel projectId={projectId} initialTempo={tempo ?? undefined} />
        <div style={{ marginTop: 28, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Link href={`/app/console/${projectId}`} style={linkStyle}>
            Open Console →
          </Link>
          <Link href={`/app/studio/${projectId}`} style={linkStyle}>
            Open Booth →
          </Link>
          <Link href="/app" style={linkStyle}>
            ← Library
          </Link>
        </div>
      </main>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#050508",
  color: "#F4F1EC",
  fontFamily: "Inter, system-ui, sans-serif",
  position: "relative",
};
const ambientStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
  background:
    "radial-gradient(ellipse at 50% -12%, rgba(123,235,212,.1), transparent 50%), radial-gradient(ellipse at 100% 20%, rgba(231,169,97,.08), transparent 45%)",
};
const headerStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 20px",
  background: "rgba(5,5,8,.88)",
  backdropFilter: "blur(12px)",
  borderBottom: "1px solid rgba(255,255,255,.09)",
};
const logoStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  color: "#F4F1EC",
  textDecoration: "none",
  fontWeight: 700,
  fontSize: 15,
};
const mainStyle: React.CSSProperties = {
  position: "relative",
  zIndex: 1,
  maxWidth: 900,
  margin: "0 auto",
  padding: "28px 20px 80px",
};
const h1Style: React.CSSProperties = {
  fontFamily: "Fraunces, Georgia, serif",
  fontWeight: 500,
  fontSize: "clamp(1.5rem, 4vw, 2rem)",
  margin: "0 0 8px",
};
const subStyle: React.CSSProperties = {
  color: "#9B96A3",
  margin: "0 0 24px",
  fontSize: 14,
  lineHeight: 1.5,
};
const linkStyle: React.CSSProperties = {
  color: "#E7A961",
  fontSize: 14,
  textDecoration: "none",
};
