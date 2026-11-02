"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";

type StemRow = {
  id: string;
  label: string;
  color: string;
  listenUrl: string | null;
};

type StemsResponse = {
  stems?: StemRow[];
  canDownload?: boolean;
  stemsReady?: boolean;
  message?: string;
  error?: string;
  upgrade?: boolean;
};

/**
 * Daydream instrumental stems under a generated beat.
 * Everyone can listen; only paid users get Download.
 */
export function BeatStemsPanel({ projectId }: { projectId: string }) {
  const { colors: C } = useTheme();
  const [stems, setStems] = useState<StemRow[]>([]);
  const [canDownload, setCanDownload] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/beat/stems`);
      const j = (await res.json().catch(() => ({}))) as StemsResponse;
      if (!res.ok) {
        setErr(typeof j.error === "string" ? j.error : "Could not load stems");
        setStems([]);
        return;
      }
      setStems(Array.isArray(j.stems) ? j.stems : []);
      setCanDownload(Boolean(j.canDownload));
      setMessage(typeof j.message === "string" ? j.message : null);
    } catch {
      setErr("Could not load stems");
      setStems([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    return () => {
      try {
        audioRef.current?.pause();
      } catch {
        /* */
      }
      audioRef.current = null;
    };
  }, [load]);

  function stopAudio() {
    try {
      audioRef.current?.pause();
    } catch {
      /* */
    }
    audioRef.current = null;
    setPlayingId(null);
  }

  function toggleListen(stem: StemRow) {
    if (!stem.listenUrl) return;
    if (playingId === stem.id) {
      stopAudio();
      return;
    }
    stopAudio();
    const a = new Audio(stem.listenUrl);
    audioRef.current = a;
    setPlayingId(stem.id);
    a.onended = () => setPlayingId(null);
    a.onerror = () => {
      setPlayingId(null);
      setErr("Could not play this stem");
    };
    void a.play().catch(() => {
      setPlayingId(null);
      setErr("Playback blocked — tap again");
    });
  }

  async function downloadStem(stem: StemRow) {
    if (!canDownload) {
      setErr("Upgrade to download stems. Listening is free.");
      return;
    }
    setBusyId(stem.id);
    setErr(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/beat/stems?download=${encodeURIComponent(stem.id)}`
      );
      if (res.status === 402) {
        const j = (await res.json().catch(() => ({}))) as StemsResponse;
        setErr(j.error || "Stem downloads require a paid plan");
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as StemsResponse;
        setErr(j.error || "Download failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ap-${stem.id}.flac`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErr("Download failed");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div style={{ marginTop: 14, fontSize: 12, color: C.textMuted }}>
        Loading stems…
      </div>
    );
  }

  if (!stems.length) {
    return null;
  }

  return (
    <div
      style={{
        marginTop: 16,
        padding: 14,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
        background: "rgba(0,0,0,0.22)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0.08,
            color: C.brass,
            textTransform: "uppercase",
          }}
        >
          Stems
        </div>
        <div style={{ fontSize: 11, color: C.textMuted }}>
          {canDownload ? "Listen · Download" : "Listen free · Download on paid"}
        </div>
      </div>
      {message && !err ? (
        <p style={{ margin: "0 0 10px", fontSize: 12, color: C.textMuted, lineHeight: 1.4 }}>
          {message}
        </p>
      ) : null}
      {err ? (
        <p style={{ margin: "0 0 10px", fontSize: 12, color: C.danger || "#E57373" }}>{err}</p>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {stems.map((stem) => {
          const playing = playingId === stem.id;
          return (
            <div
              key={stem.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${C.border}`,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: stem.color,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14 }}>
                {stem.label}
              </div>
              <button
                type="button"
                onClick={() => toggleListen(stem)}
                disabled={!stem.listenUrl}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  border: `1px solid ${C.border}`,
                  background: playing ? C.brass : "rgba(255,255,255,0.06)",
                  color: playing ? "#1A1208" : C.text,
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: stem.listenUrl ? "pointer" : "default",
                  opacity: stem.listenUrl ? 1 : 0.4,
                }}
                aria-label={playing ? `Pause ${stem.label}` : `Play ${stem.label}`}
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <button
                type="button"
                onClick={() => void downloadStem(stem)}
                disabled={busyId === stem.id}
                title={
                  canDownload
                    ? `Download ${stem.label}`
                    : "Upgrade to download stems"
                }
                style={{
                  height: 36,
                  padding: "0 12px",
                  borderRadius: 999,
                  border: `1px solid ${canDownload ? C.brassLine || C.brass : C.border}`,
                  background: canDownload
                    ? "rgba(231,169,97,0.15)"
                    : "rgba(255,255,255,0.04)",
                  color: canDownload ? C.brass : C.textMuted,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                  opacity: busyId === stem.id ? 0.6 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                {busyId === stem.id ? "…" : canDownload ? "Download" : "Locked"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
