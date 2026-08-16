"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";

type Sample = {
  id: string;
  kind: string;
  title?: string | null;
  original_filename?: string | null;
  duration_ms?: number | null;
  start_ms?: number | null;
  end_ms?: number | null;
  include_in_produce?: boolean | null;
  audio_url?: string | null;
  metadata?: Record<string, unknown> | null;
};

const KINDS = [
  { value: "loop", label: "Loop" },
  { value: "one_shot", label: "One-shot" },
  { value: "vocal_sample", label: "Vocal sample" },
  { value: "reference", label: "Reference (not mixed)" },
  { value: "other", label: "Other" },
];

const MAX_DIRECT = 4.5 * 1024 * 1024;

async function measureDurationMs(file: File): Promise<number | null> {
  try {
    const url = URL.createObjectURL(file);
    const dur = await new Promise<number | null>((resolve) => {
      const a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = () => {
        const d = a.duration;
        resolve(Number.isFinite(d) ? Math.round(d * 1000) : null);
      };
      a.onerror = () => resolve(null);
      a.src = url;
    });
    URL.revokeObjectURL(url);
    return dur;
  } catch {
    return null;
  }
}

export function ProjectSamplesPanel({ projectId }: { projectId: string }) {
  const { colors: C } = useTheme();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("loop");
  const [startMs, setStartMs] = useState("");
  const [title, setTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/samples`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not load samples");
      setSamples(j.samples || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadViaSigned(file: File, durationMs: number | null) {
    const signRes = await fetch(`/api/projects/${projectId}/samples`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "sign",
        filename: file.name,
        contentType: file.type || "audio/wav",
      }),
    });
    const sign = await signRes.json().catch(() => ({}));
    if (!signRes.ok) throw new Error(sign.error || "Could not start signed upload");

    const put = await fetch(sign.signedUrl as string, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!put.ok) {
      throw new Error(`Storage upload failed (${put.status}). Check bucket policies.`);
    }

    const completeRes = await fetch(`/api/projects/${projectId}/samples`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "complete",
        sample_id: sign.sample_id,
        path: sign.path,
        kind,
        title: title.trim() || file.name,
        filename: file.name,
        contentType: file.type,
        size: file.size,
        duration_ms: durationMs,
        start_ms: startMs === "" ? null : Number(startMs),
        include_in_produce: kind !== "reference",
      }),
    });
    const complete = await completeRes.json().catch(() => ({}));
    if (!completeRes.ok) throw new Error(complete.error || "Could not save sample");
  }

  async function uploadDirect(file: File, durationMs: number | null) {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    if (title.trim()) form.append("title", title.trim());
    if (durationMs != null) form.append("duration_ms", String(durationMs));
    if (startMs !== "") form.append("start_ms", String(Number(startMs)));
    const res = await fetch(`/api/projects/${projectId}/samples`, {
      method: "POST",
      body: form,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (j.code === "FILE_TOO_LARGE" || j.code === "BODY_TOO_LARGE" || res.status === 413) {
        await uploadViaSigned(file, durationMs);
        return;
      }
      throw new Error(j.error || "Upload failed");
    }
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      if (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|ogg|webm|flac|aac)$/i.test(file.name)) {
        throw new Error("Please choose an audio file (wav, mp3, m4a, …)");
      }
      const durationMs = await measureDurationMs(file);
      if (file.size > MAX_DIRECT) {
        await uploadViaSigned(file, durationMs);
      } else {
        try {
          await uploadDirect(file, durationMs);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (/large|413|body/i.test(msg)) {
            await uploadViaSigned(file, durationMs);
          } else {
            throw e;
          }
        }
      }
      setTitle("");
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
      const res = await fetch(`/api/projects/${projectId}/samples?sample_id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Delete failed");
      }
      setSamples((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function savePlacement(s: Sample, nextStart: string) {
    const start_ms = nextStart === "" ? null : Math.round(Number(nextStart));
    if (nextStart !== "" && !Number.isFinite(start_ms as number)) {
      setError("Start time must be a number (milliseconds)");
      return;
    }
    try {
      const res = await fetch(`/api/projects/${projectId}/samples`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample_id: s.id, start_ms }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not update placement");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  const inputStyle: import("react").CSSProperties = {
    width: "100%",
    minHeight: 40,
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: C.inputFill,
    color: C.text,
    padding: "8px 12px",
    fontSize: 14,
    fontFamily: "inherit",
  };

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
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0.6,
          color: C.brass,
          marginBottom: 6,
        }}
      >
        SAMPLES & LOOPS
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: C.textMuted, lineHeight: 1.45 }}>
        Add a loop, one-shot, or vocal sample and set where it starts on the song timeline.
        Included samples are mixed with your vocals when you Produce (reference files are kept
        for listening only).
      </p>

      <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: C.textMuted }}>
          Type
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            style={{ ...inputStyle, marginTop: 4 }}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: C.textMuted }}>
          Title (optional)
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Vinyl crackle loop"
            style={{ ...inputStyle, marginTop: 4 }}
          />
        </label>
        <label style={{ fontSize: 12, color: C.textMuted }}>
          Start on timeline (ms, optional — 0 = song start)
          <input
            value={startMs}
            onChange={(e) => setStartMs(e.target.value)}
            placeholder="0"
            inputMode="numeric"
            style={{ ...inputStyle, marginTop: 4 }}
          />
        </label>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm,.aac"
        style={{ display: "none" }}
        onChange={(e) => void onFile(e.target.files?.[0] || null)}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        style={{
          width: "100%",
          minHeight: 44,
          borderRadius: 12,
          border: `1px solid ${C.brass}`,
          background: C.brassSoft,
          color: C.brass,
          fontWeight: 600,
          fontSize: 14,
          cursor: uploading ? "wait" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {uploading ? "Uploading…" : "Add sample or loop"}
      </button>

      {error && (
        <p style={{ color: C.danger, fontSize: 13, margin: "10px 0 0" }}>{error}</p>
      )}

      <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
        {loading && (
          <p style={{ color: C.textMuted, fontSize: 13, margin: 0 }}>Loading samples…</p>
        )}
        {!loading && samples.length === 0 && (
          <p style={{ color: C.textFaint, fontSize: 13, margin: 0 }}>No samples yet.</p>
        )}
        {samples.map((s) => {
          const placement =
            typeof s.start_ms === "number"
              ? s.start_ms
              : typeof s.metadata?.start_ms === "number"
                ? (s.metadata.start_ms as number)
                : null;
          return (
            <div
              key={s.id}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: C.inputFill,
              }}
            >
              <div style={{ flex: 1, minWidth: 120 }}>
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
                  {placement != null ? ` · starts ${placement}ms` : " · start not set (0)"}
                  {s.kind === "reference" ? " · not mixed" : ""}
                </div>
              </div>
              {s.audio_url && (
                <audio
                  controls
                  src={s.audio_url}
                  style={{ height: 28, maxWidth: 140 }}
                  preload="none"
                />
              )}
              <label style={{ fontSize: 11, color: C.textMuted }}>
                Start ms
                <input
                  defaultValue={placement != null ? String(placement) : ""}
                  onBlur={(e) => void savePlacement(s, e.target.value)}
                  style={{
                    ...inputStyle,
                    minHeight: 32,
                    width: 88,
                    marginTop: 2,
                    fontSize: 12,
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => void remove(s.id)}
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
          );
        })}
      </div>
    </div>
  );
}
