"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const C = {
  surface: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.09)",
  brass: "#E7A961",
  brassSoft: "rgba(231,169,97,0.15)",
  signal: "#7BEBD4",
  text: "#F4F1EC",
  textMuted: "#9B96A3",
  textFaint: "#5C5866",
  danger: "#E8756A",
};

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

  async function remove(sampleId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/samples/${sampleId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Delete failed");
      }
      setSamples((prev) => prev.filter((s) => s.id !== sampleId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div
      style={{
        marginTop: 20,
        padding: "16px 14px",
        borderRadius: 16,
        border: `1px solid ${C.border}`,
        background: C.surface,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Samples & loops</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            Optional audio to layer later (loops, one-shots, reference)
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            style={{
              padding: "6px 10px",
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
          marginTop: 12,
          padding: "11px 14px",
          borderRadius: 12,
          border: `1px solid ${C.border}`,
          background: "rgba(255,255,255,0.04)",
          color: C.text,
          fontWeight: 500,
          fontSize: 13.5,
          cursor: uploading ? "wait" : "pointer",
          fontFamily: "inherit",
          opacity: uploading ? 0.6 : 1,
        }}
      >
        {uploading ? "Uploading…" : "Add sample / loop"}
      </button>

      {error && (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: C.danger }}>{error}</p>
      )}

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {loading && <p style={{ margin: 0, fontSize: 13, color: C.textMuted }}>Loading samples…</p>}
        {!loading && samples.length === 0 && (
          <p style={{ margin: 0, fontSize: 13, color: C.textFaint }}>No samples yet.</p>
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
              background: "rgba(0,0,0,0.2)",
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
              {s.audio_url && (
                <audio src={s.audio_url} controls preload="none" style={{ width: "100%", height: 32, marginTop: 6 }} />
              )}
            </div>
            <button
              type="button"
              onClick={() => remove(s.id)}
              style={{
                flexShrink: 0,
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: "transparent",
                color: C.textMuted,
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
