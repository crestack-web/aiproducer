"use client";

import { IconBack, IconCheck, IconMore } from "./booth-icons";
import { canMakeSong, fmtSeconds, nextPart, progressRatio, remainingRequired, type BoothPart } from "./booth-parts";

/** Step 2 — vertical list of song parts the AI wrote. Tap a card to record it. */
export function BoothPlanStep({
  title,
  parts,
  busy,
  error,
  onRetry,
  onBack,
  onMore,
  onRecordPart,
  onRecordNext,
  onMake,
}: {
  title: string;
  parts: BoothPart[];
  busy: boolean;
  error: string | null;
  onRetry?: () => void;
  onBack: () => void;
  onMore: () => void;
  onRecordPart: (id: string) => void;
  onRecordNext: () => void;
  onMake: () => void;
}) {
  const next = nextPart(parts);
  const ready = canMakeSong(parts);
  const left = remainingRequired(parts);
  const pct = Math.round(progressRatio(parts) * 100);

  return (
    <div className="bx">
      <div className="bx-top">
        <button type="button" className="bx-icon-btn" aria-label="Back to beat" onClick={onBack}>
          <IconBack />
        </button>
        <span className="bx-chip">{pct}% recorded</span>
        <button type="button" className="bx-icon-btn" aria-label="More options" onClick={onMore}>
          <IconMore />
        </button>
      </div>

      <p className="bx-eyebrow">Your song plan</p>
      <h1 className="bx-h1">{title}</h1>
      <p className="bx-sub">
        {parts.length === 0
          ? "No parts yet."
          : ready
            ? "Every part is done. Make your song whenever you're ready."
            : `${left} part${left === 1 ? "" : "s"} to go. Tap any card to record it.`}
      </p>
      <div className="bx-progress" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>

      {error ? (
        <p className="bx-error">
          <span>{error}</span>
          {onRetry ? (
            <button type="button" className="bx-chip" style={{ border: 0, cursor: "pointer" }} onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </p>
      ) : null}

      <ul className="bx-parts">
        {parts.map((p, i) => (
          <li key={p.id} style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}>
            <button
              type="button"
              className="bx-part"
              data-state={p.state}
              data-next={next?.id === p.id}
              onClick={() => onRecordPart(p.id)}
              aria-label={`${p.label}, ${p.title}${p.state === "done" ? ", recorded" : ""}`}
            >
              <span className="bx-part-num">{p.state === "done" ? <IconCheck /> : i + 1}</span>
              <span className="bx-part-body">
                <span className="bx-part-title">
                  {p.label}
                  {p.optional ? <span className="bx-part-tag">optional</span> : null}
                </span>
                {p.hint ? <span className="bx-part-hint" style={{ display: "block" }}>“{p.hint}”</span> : null}
              </span>
              <span className="bx-part-len">{fmtSeconds(p.durationSec)}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="bx-dock">
        <div className="bx-dock-inner">
          {ready ? (
            <button type="button" className="bx-cta glow" disabled={busy} onClick={onMake}>
              Make my song
            </button>
          ) : (
            <button type="button" className="bx-cta" disabled={busy || !next} onClick={onRecordNext}>
              {next ? `Record ${next.label}` : "Record"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
