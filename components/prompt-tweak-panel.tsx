"use client";

import React, { useState } from "react";

type VersionInfo = {
  version: number;
  prompt?: string | null;
  summary?: string;
  at?: string;
};

type Props = {
  projectId: string;
  colors: {
    text: string;
    textMuted: string;
    surface: string;
    border: string;
    bg?: string;
  };
  onMasterUrl?: (url: string) => void;
  playbackMs?: number | null;
};

export function PromptTweakPanel({
  projectId,
  colors: C,
  onMasterUrl,
  playbackMs,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [clarification, setClarification] = useState<string | null>(null);

  async function runTweak() {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setClarification(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/tweak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tweak",
          prompt: text,
          playbackMs: playbackMs ?? null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.needsClarification) {
        setClarification(j.interpret?.clarification || j.interpret?.plain_summary || "Try a clearer mix request.");
        return;
      }
      if (!res.ok || !j.ok) {
        throw new Error(j.error || j.message || "Tweak failed");
      }
      setSummary(j.summary || null);
      setVersions(j.versions || []);
      setCurrentVersion(j.currentVersion || 0);
      if (j.master_url && onMasterUrl) onMasterUrl(j.master_url as string);
      setPrompt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tweak failed");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (busy || currentVersion <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/tweak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revert", version: currentVersion - 1 }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || "Revert failed");
      setSummary(j.summary || "Reverted");
      setVersions(j.versions || []);
      setCurrentVersion(j.currentVersion || 0);
      if (j.master_url && onMasterUrl) onMasterUrl(j.master_url as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revert failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginTop: 20,
        padding: "16px 16px 14px",
        borderRadius: 16,
        border: `1px solid ${C.border}`,
        background: C.bg || C.surface,
        textAlign: "left",
      }}
    >
      <div style={{ fontFamily: "Georgia, serif", fontSize: 17, marginBottom: 4, color: C.text }}>
        Tweak with a prompt
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: C.textMuted, lineHeight: 1.45 }}>
        Describe a change in plain language — e.g. “make the chorus louder” or “less reverb on the verse”.
        Only the affected parts are re-rendered.
      </p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={2}
        placeholder='e.g. "pull the vocal forward a bit"'
        disabled={busy}
        style={{
          width: "100%",
          boxSizing: "border-box",
          borderRadius: 12,
          border: `1px solid ${C.border}`,
          background: C.surface,
          color: C.text,
          padding: "12px 14px",
          fontSize: 14,
          fontFamily: "inherit",
          resize: "vertical",
          minHeight: 64,
        }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={busy || !prompt.trim()}
          onClick={() => void runTweak()}
          style={{
            flex: 1,
            minWidth: 120,
            padding: "12px 16px",
            borderRadius: 999,
            border: "none",
            background: "linear-gradient(180deg, #F0BC80, #E7A961)",
            color: "#1A1208",
            fontWeight: 700,
            fontSize: 14,
            cursor: busy ? "wait" : "pointer",
            opacity: busy || !prompt.trim() ? 0.55 : 1,
          }}
        >
          {busy ? "Updating…" : "Apply tweak"}
        </button>
        <button
          type="button"
          disabled={busy || currentVersion <= 0}
          onClick={() => void undo()}
          style={{
            padding: "12px 16px",
            borderRadius: 999,
            border: `1px solid ${C.border}`,
            background: "transparent",
            color: C.text,
            fontWeight: 600,
            fontSize: 14,
            cursor: currentVersion <= 0 ? "not-allowed" : "pointer",
            opacity: currentVersion <= 0 ? 0.45 : 1,
          }}
        >
          Undo
        </button>
      </div>

      {clarification && (
        <p style={{ margin: "12px 0 0", fontSize: 13, color: "#F0BC80" }}>{clarification}</p>
      )}
      {summary && (
        <p style={{ margin: "12px 0 0", fontSize: 13, color: C.textMuted }}>
          <strong style={{ color: C.text }}>AP:</strong> {summary}
        </p>
      )}
      {error && (
        <p style={{ margin: "12px 0 0", fontSize: 13, color: "#f87171" }}>{error}</p>
      )}
      {versions.length > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 11, color: C.textMuted }}>
          Version {currentVersion} of {versions.length}
          {versions[currentVersion - 1]?.prompt
            ? ` · “${versions[currentVersion - 1].prompt}”`
            : ""}
        </p>
      )}
    </div>
  );
}
