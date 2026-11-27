"use client";

import type { ReactNode } from "react";
import { IconClose, IconMore } from "./booth-icons";

type Phase = "ready" | "countdown" | "recording" | "review";

/**
 * Step 3 — full-screen dark booth. Big glowing record button, 4-beat count-in,
 * live waveform and lyrics. After a take: Keep or Try again. No mixer, FX or timeline.
 */
export function BoothRecordStage({
  phase,
  sectionLabel,
  partTitle,
  lyric,
  meta,
  stepText,
  countdown,
  canRecordAgain,
  showReview,
  saving,
  canKeep,
  error,
  visualizer,
  reviewPlayer,
  onRecord,
  onStop,
  onCancelCount,
  onKeep,
  onRetry,
  onClose,
  onMore,
}: {
  phase: Phase;
  sectionLabel: string;
  partTitle: string;
  lyric: string | null;
  meta: string | null;
  stepText: string;
  countdown: number;
  canRecordAgain: boolean;
  showReview: boolean;
  saving: boolean;
  canKeep: boolean;
  error: string | null;
  visualizer: ReactNode;
  reviewPlayer: ReactNode;
  onRecord: () => void;
  onStop: () => void;
  onCancelCount: () => void;
  onKeep: () => void;
  onRetry: () => void;
  onClose: () => void;
  onMore: () => void;
}) {
  const busy = phase === "recording" || phase === "countdown";
  return (
    <div className="bx-stage" data-phase={phase} role="dialog" aria-label={`Recording ${sectionLabel}`}>
      <div className="bx-stage-inner">
        <div className="bx-top">
          <button type="button" className="bx-icon-btn" aria-label="Back to song plan" disabled={busy} onClick={onClose}>
            <IconClose />
          </button>
          <span className="bx-chip">{stepText}</span>
          <button type="button" className="bx-icon-btn" aria-label="More options" disabled={busy} onClick={onMore}>
            <IconMore />
          </button>
        </div>

        <div className="bx-stage-mid">
          {phase === "countdown" ? (
            <>
              <div key={countdown} className="bx-count" aria-live="assertive">
                {Math.max(1, countdown)}
              </div>
              <div className="bx-beats" aria-hidden>
                {[4, 3, 2, 1].map((b) => (
                  <i key={b} data-on={countdown <= b} />
                ))}
              </div>
              {lyric ? <p className="bx-lyric">“{lyric}”</p> : null}
            </>
          ) : (
            <>
              <p className="bx-eyebrow">{sectionLabel}</p>
              <h1 className="bx-h1" style={{ color: "#fff" }}>{partTitle}</h1>
              {lyric ? <p className="bx-lyric">“{lyric}”</p> : null}
              {meta ? <p className="bx-stage-meta">{meta}</p> : null}
              {phase === "recording" ? <div className="bx-viz">{visualizer}</div> : null}
              {showReview ? (
                <div style={{ marginTop: 18, textAlign: "left" }}>
                  {reviewPlayer}
                  <p className="bx-stage-meta" style={{ textAlign: "center" }}>
                    {saving ? "Saving your take…" : "Take saved. Keep it or try again."}
                  </p>
                </div>
              ) : null}
            </>
          )}
          {error && !busy ? <p className="bx-error" style={{ marginTop: 16 }}>{error}</p> : null}
        </div>

        <p className="bx-guide" aria-live="polite">
          {phase === "countdown"
            ? "Get ready. Start singing right after 1."
            : phase === "recording"
              ? "You're live. Sing the part, then tap stop."
              : showReview
                ? saving
                  ? "Saving your take…"
                  : "Listen back. Happy? Tap Keep."
                : canRecordAgain
                  ? "Want a better take? Record again."
                  : "Headphones on, then tap the red button."}
        </p>
        {phase === "countdown" ? (
          <button type="button" className="bx-ghost" onClick={onCancelCount}>
            Cancel
          </button>
        ) : phase === "recording" ? (
          <div className="bx-rec-wrap">
            <button type="button" className="bx-rec" data-stop="true" aria-label="Stop recording" onClick={onStop} />
            <span className="bx-rec-label">Tap to stop</span>
          </div>
        ) : showReview ? (
          <div className="bx-review">
            <button type="button" className="bx-ghost" disabled={saving} onClick={onRetry}>
              Try again
            </button>
            <button type="button" className="bx-cta glow" disabled={saving || !canKeep} onClick={onKeep}>
              Keep
            </button>
          </div>
        ) : (
          <div className="bx-rec-wrap">
            <button
              type="button"
              className="bx-rec"
              aria-label={canRecordAgain ? "Record again" : "Record"}
              onClick={onRecord}
            />
            <span className="bx-rec-label">{canRecordAgain ? "Record again" : "Tap to record"}</span>
          </div>
        )}
      </div>
    </div>
  );
}
