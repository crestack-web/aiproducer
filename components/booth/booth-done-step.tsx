"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { IconMore } from "./booth-icons";

/** Step 5 — the finished song. It is already in the Library. */
export function BoothDoneStep({
  title,
  player,
  hasMaster,
  onDownload,
  onMake,
  onMore,
  extras,
}: {
  title: string;
  player: ReactNode;
  hasMaster: boolean;
  onDownload: () => void;
  onMake: () => void;
  onMore: () => void;
  extras?: ReactNode;
}) {
  return (
    <div className="bx">
      <div className="bx-top">
        <Link href="/app" className="bx-chip" style={{ textDecoration: "none" }}>
          Library
        </Link>
        <span />
        <button type="button" className="bx-icon-btn" aria-label="More options" onClick={onMore}>
          <IconMore />
        </button>
      </div>
      <p className="bx-eyebrow">Your song is ready</p>
      <h1 className="bx-h1">{title}</h1>
      <p className="bx-sub">{hasMaster ? "Saved to your Library." : "The master isn't ready yet."}</p>
      {player}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
        {hasMaster ? (
          <button type="button" className="bx-cta" onClick={onDownload}>
            Download
          </button>
        ) : (
          <button type="button" className="bx-cta glow" onClick={onMake}>
            Make my song
          </button>
        )}
        <Link href="/app" className="bx-link" style={{ textAlign: "center", textDecoration: "none" }}>
          Go to Library
        </Link>
      </div>
      {extras}
    </div>
  );
}
