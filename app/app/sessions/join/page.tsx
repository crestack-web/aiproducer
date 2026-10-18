"use client";

import React, { useState, Suspense, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function JoinInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needAuth, setNeedAuth] = useState(false);

  const returnPath = useMemo(() => {
    if (!token) return "/app";
    return `/app/sessions/join?token=${encodeURIComponent(token)}`;
  }, [token]);

  const authHref = `/auth?next=${encodeURIComponent(returnPath)}`;

  async function join() {
    if (!token) {
      setError("Missing invite token");
      return;
    }
    setBusy(true);
    setError(null);
    setNeedAuth(false);
    try {
      const res = await fetch("/api/sessions/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = await res.json();
      if (res.status === 401) {
        setNeedAuth(true);
        setError("Sign in or create an account to join this session.");
        return;
      }
      if (!res.ok) {
        setError(j.error || "Could not join");
        return;
      }
      router.replace(`/app/console/${j.projectId}?session=${j.sessionId}`);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0c0b0a",
        color: "#F5F0E8",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "min(400px, 100%)",
          padding: 24,
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(22,20,18,0.98)",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#E7A961",
            marginBottom: 10,
          }}
        >
          AP Studio
        </div>
        <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800 }}>Join session</h1>
        <p style={{ margin: "0 0 20px", color: "rgba(245,240,232,0.55)", fontSize: 14, lineHeight: 1.5 }}>
          You were invited to collaborate on a project. Sign in or create a free account, then join to
          open the Console with access.
        </p>
        {error && (
          <p style={{ color: "#F87171", fontSize: 13, marginBottom: 12 }}>{error}</p>
        )}
        {!token ? (
          <p style={{ color: "#F87171", fontSize: 13 }}>This invite link is missing a token.</p>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void join()}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: 12,
                border: "none",
                background: "#E7A961",
                color: "#1A1208",
                fontWeight: 800,
                fontSize: 15,
                cursor: busy ? "wait" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {busy ? "Joining…" : "Join session"}
            </button>
            {(needAuth || true) && (
              <p style={{ margin: "16px 0 0", fontSize: 13, color: "rgba(245,240,232,0.55)", textAlign: "center", lineHeight: 1.5 }}>
                Need an account?{" "}
                <Link href={authHref} style={{ color: "#E7A961", fontWeight: 700 }}>
                  Sign in / Sign up
                </Link>
                {" "}then return here to join.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function JoinSessionPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100vh", background: "#0c0b0a", color: "#F5F0E8", padding: 40 }}>
          Loading…
        </div>
      }
    >
      <JoinInner />
    </Suspense>
  );
}
