"use client";

import { useRef, useState } from "react";
import "@/app/app/suno-ui.css";

/**
 * Booth view for a song that was handed off to Console.
 * Read-only: a Listen button plus a link into Console. No plan, no recording.
 */
export function EditingInConsole({
  projectId,
  songTitle,
  listenUrl,
}: {
  projectId: string;
  songTitle?: string | null;
  listenUrl?: string | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#0B0A0F",
        color: "#F4F1EC",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400, textAlign: "center" }}>
        <p style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: "#E7A961", margin: 0 }}>
          Editing in Console
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", margin: "10px 0 8px" }}>
          {songTitle || "Your song"}
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.45, color: "rgba(244,241,236,.6)", margin: "0 0 24px" }}>
          This song moved to Console, so the Booth plan is locked. You can still listen here.
        </p>
        {listenUrl ? (
          <>
            <audio ref={audioRef} src={listenUrl} preload="none" onEnded={() => setPlaying(false)} />
            <button type="button" className="ap-sheet-btn primary" onClick={toggle} aria-pressed={playing}>
              {playing ? "Pause" : "Listen"}
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="ap-sheet-btn"
          style={{ marginTop: 10 }}
          onClick={() => {
            window.location.href = `/app/console/${projectId}`;
          }}
        >
          Open Console
        </button>
        <button
          type="button"
          className="ap-sheet-btn ghost"
          onClick={() => {
            window.location.href = "/app";
          }}
        >
          Back to Library
        </button>
      </div>
    </div>
  );
}
