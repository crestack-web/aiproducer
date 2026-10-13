"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function JoinInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (!token) {
      setError("Missing invite token");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = await res.json();
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
        <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800 }}>Join AP Session</h1>
        <p style={{ margin: "0 0 20px", color: "rgba(245,240,232,0.55)", fontSize: 14, lineHeight: 1.5 }}>
          You were invited to collaborate on a project in AP Studio. Sign in if needed, then join.
        </p>
        {error && (
          <p style={{ color: "#F87171", fontSize: 13, marginBottom: 12 }}>{error}</p>
        )}
        {!token ? (
          <p style={{ color: "#F87171", fontSize: 13 }}>This invite link is missing a token.</p>
        ) : (
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
