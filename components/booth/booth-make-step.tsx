"use client";

import type { ReactNode } from "react";
import { IconBack, IconMore } from "./booth-icons";

/** Step 4 — "Make my song": preview, one button, then a progress screen. */
export function BoothMakeStep({
  producing,
  progress,
  stageText,
  error,
  preview,
  canMake,
  onMake,
  onBack,
  onMore,
}: {
  producing: boolean;
  progress: number;
  stageText: string | null;
  error: string | null;
  preview: ReactNode;
  canMake: boolean;
  onMake: () => void;
  onBack: () => void;
  onMore: () => void;
}) {
  if (producing) {
    return (
      <div className="bx">
        <div className="bx-make" aria-live="polite">
          <p className="bx-eyebrow">Making your song</p>
          <div className="bx-orb" aria-hidden />
          <div className="bx-pct">{progress > 0 ? `${Math.round(progress)}%` : "…"}</div>
          <h1 className="bx-h1">Mixing and mastering</h1>
          <p className="bx-sub">{stageText || "This takes a minute or two."} Your song will land in your Library.</p>
          {error ? <p className="bx-error">{error}</p> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="bx">
      <div className="bx-top">
        <button type="button" className="bx-icon-btn" aria-label="Back to song plan" onClick={onBack}>
          <IconBack />
        </button>
        <span className="bx-chip">Preview</span>
        <button type="button" className="bx-icon-btn" aria-label="More options" onClick={onMore}>
          <IconMore />
        </button>
      </div>
      <p className="bx-eyebrow">Almost there</p>
      <h1 className="bx-h1">Hear it together</h1>
      <p className="bx-sub">Your beat with every part you kept. Happy? Make your song.</p>
      {error ? <p className="bx-error">{error}</p> : null}
      {preview}
      <div className="bx-dock">
        <div className="bx-dock-inner">
          <button type="button" className="bx-cta glow" disabled={!canMake} onClick={onMake}>
            Make my song
          </button>
        </div>
      </div>
    </div>
  );
}
