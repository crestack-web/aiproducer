"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";

type Sample = {
  id: string;
  kind: string;
  title?: string | null;
  original_filename?: string | null;
  audio_url?: string | null;
  duration_ms?: number | null;
};

const KINDS: { value: string; label: string }[] = [
  { value: "loop", label: "Loop" },
  { value: "one_shot", label: "One-shot" },
  { value: "vocal_sample", label: "Vocal sample" },
  { value: "reference", label: "Reference" },
  { value: "other", label: "Other" },
];

export function ProjectSamplesPanel({ projectId }: { projectId: string }) {
  const { colors: C } = useTheme();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState("loop");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/samples`);
      if (!res.ok) throw new Error("Could not load samples");
      const j = await res.json();
      setSamples(j.samples || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      const res = await fetch(`/api/projects/${projectId}/samples`, { method: "POST", body: form });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Upload failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}/samples?sample_id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Delete failed");
      }
      setSamples((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div
      style={{
        marginTop: 18,
        padding: 14,
        borderRadius: 16,
        border: `1px solid ${C.border}`,
        background: C.surface,
        boxShadow: C.cardShadow,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.6, color: C.brass, marginBottom: 6 }}>
        SAMPLES & LOOPS
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: C.textMuted, lineHeight: 1.45 }}>
        Drop loops or reference audio into this song. They stay with the project for production.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: kind === k.value ? `1px solid ${C.brass}` : `1px solid ${C.border}`,
              background: kind === k.value ? C.brassSoft : "transparent",
              color: kind === k.value ? C.brass : C.textMuted,
              fontSize: 12,
              fontWeight: kind === k.value ? 600 : 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {k.label}
          </button>
        ))}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm"
        style={{ display: "none" }}
        onChange={(e) => onFile(e.target.files?.[0] || null)}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        style={{
          width: "100%",
          padding: "11px 14px",
          borderRadius: 12,
          border: `1px solid ${C.border}`,
          background: C.inputFill,
          color: C.text,
          fontWeight: 500,
          fontSize: 13.5,
          cursor: uploading ? "wait" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {uploading ? "Uploading…" : "Add sample or loop"}
      </button>

      {error && <p style={{ color: C.danger, fontSize: 13, marginTop: 10 }}>{error}</p>}

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {loading && <p style={{ color: C.textMuted, fontSize: 13, margin: 0 }}>Loading samples…</p>}
        {!loading && samples.length === 0 && (
          <p style={{ color: C.textFaint, fontSize: 13, margin: 0 }}>No samples yet.</p>
        )}
        {samples.map((s) => (
          <div
            key={s.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${C.border}`,
              background: C.inputFill,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: C.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.title || s.original_filename || "Sample"}
              </div>
              <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
                {s.kind.replace(/_/g, " ")}
                {s.duration_ms ? ` · ${Math.round(s.duration_ms / 1000)}s` : ""}
              </div>
            </div>
            {s.audio_url && (
              <audio controls src={s.audio_url} style={{ height: 28, maxWidth: 140 }} preload="none" />
            )}
            <button
              type="button"
              onClick={() => remove(s.id)}
              style={{
                background: "none",
                border: "none",
                color: C.textFaint,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
