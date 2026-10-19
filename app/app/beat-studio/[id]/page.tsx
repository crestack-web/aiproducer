"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import BeatStudioPanel from "@/components/beat-studio/beat-studio-panel";
import { STUDIO_LOGO_URL } from "@/lib/brand";
import { createClient } from "@/lib/supabase/client";

const BEAT_CREATOR_ALLOWLIST = new Set(["crestack@gmail.com"]);

/**
 * Standalone Beat Studio — /app/beat-studio/[id]
 * Slim mobile chrome; name lives inside the panel timeline.
 */
export default function BeatStudioPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params?.id || "");
  const [title, setTitle] = useState("Untitled beat");
  const [tempo, setTempo] = useState<number | null>(null);
  const [access, setAccess] = useState<"loading" | "ok" | "denied">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        const email = data.user?.email?.trim().toLowerCase() || "";
        if (!email || !BEAT_CREATOR_ALLOWLIST.has(email)) {
          if (!cancelled) {
            setAccess("denied");
            router.replace("/app/studio");
          }
          return;
        }
        if (!cancelled) setAccess("ok");
      } catch {
        if (!cancelled) {
          setAccess("denied");
          router.replace("/app/studio");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!projectId || access !== "ok") return;
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((j) => {
        const p = j.project || j;
        if (p?.title) setTitle(p.title);
        if (typeof p?.tempo === "number") setTempo(p.tempo);
      })
      .catch(() => {});
  }, [projectId, access]);

  if (!projectId) {
    return <p style={{ padding: 24, color: "#9B96A3" }}>Missing project id</p>;
  }

  if (access !== "ok") {
    return (
      <p style={{ padding: 24, color: "#9B96A3" }}>
        {access === "denied"
          ? "Beat Studio is not available on your account yet."
          : "Checking access…"}
      </p>
    );
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/app" style={logoStyle}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={STUDIO_LOGO_URL} alt="" width={24} height={24} style={{ borderRadius: 6 }} />
          <span>AP Studio</span>
        </Link>
        <span style={badgeStyle}>beat studio</span>
      </header>
      <main style={mainStyle}>
        <BeatStudioPanel
          projectId={projectId}
          initialTempo={tempo ?? undefined}
          initialTitle={title}
          onTitleChange={setTitle}
        />
        <nav style={navStyle}>
          <Link href={`/app/console/${projectId}`} style={linkStyle}>
            Console
          </Link>
          <Link href={`/app/studio/${projectId}`} style={linkStyle}>
            Booth
          </Link>
          <Link href="/app" style={linkStyle}>
            Library
          </Link>
        </nav>
      </main>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100dvh",
  background: "#050508",
  color: "#F4F1EC",
  fontFamily: "Inter, system-ui, sans-serif",
  overflowX: "hidden",
  maxWidth: "100vw",
};
const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 14px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  position: "sticky",
  top: 0,
  zIndex: 30,
  background: "rgba(5,5,8,0.92)",
  backdropFilter: "blur(10px)",
};
const logoStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#F4F1EC",
  textDecoration: "none",
  fontWeight: 700,
  fontSize: 15,
};
const badgeStyle: React.CSSProperties = {
  color: "#E7A961",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "lowercase",
};
const mainStyle: React.CSSProperties = {
  padding: "10px 12px 24px",
  maxWidth: 720,
  margin: "0 auto",
  width: "100%",
  boxSizing: "border-box",
  overflowX: "hidden",
};
const navStyle: React.CSSProperties = {
  display: "flex",
  gap: 16,
  justifyContent: "center",
  marginTop: 20,
  paddingTop: 12,
  borderTop: "1px solid rgba(255,255,255,0.06)",
};
const linkStyle: React.CSSProperties = {
  color: "rgba(244,241,236,0.55)",
  fontSize: 12,
  fontWeight: 600,
  textDecoration: "none",
};
