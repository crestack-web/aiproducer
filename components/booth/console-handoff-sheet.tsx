"use client";

import "@/app/app/suno-ui.css";

/**
 * Advanced → Open in Console confirm sheet.
 * Explains the one-way hand-off before the song moves to Console.
 */
export function ConsoleHandoffSheet({
  open,
  songTitle,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  songTitle?: string | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  const clean = (songTitle || "")
    .replace(/\.(mp3|wav|m4a|aac|flac|ogg)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const shortTitle = clean.length > 28 ? clean.slice(0, 27).trimEnd() + "…" : clean;
  return (
    <div
      className="ap-sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ap-handoff-title"
      onClick={busy ? undefined : onCancel}
    >
      <div className="ap-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 id="ap-handoff-title" className="ap-sheet-title">
          Open {shortTitle ? `“${shortTitle}”` : "this song"} in Console?
        </h2>
        <p className="ap-sheet-sub">
          Your kept takes move to Console, the full studio. You&apos;ll keep editing there.
          This can&apos;t be undone.
        </p>
        <button type="button" className="ap-sheet-btn primary" disabled={busy} onClick={onConfirm}>
          {busy ? "Moving to Console…" : "Open in Console"}
        </button>
        <button type="button" className="ap-sheet-btn ghost" disabled={busy} onClick={onCancel}>
          Stay in Booth
        </button>
      </div>
    </div>
  );
}
