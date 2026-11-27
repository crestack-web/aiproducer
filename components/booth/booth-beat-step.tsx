"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { coverGrad } from "@/components/studio-player";
import { IconBack, IconMore, IconPlay } from "./booth-icons";

/** Step 1 — one big beat card with artwork and a play button. */
export function BoothBeatStep({
  title,
  subtitle,
  beatUrl,
  seed,
  ctaLabel,
  busy,
  error,
  onStart,
  onMore,
}: {
  title: string;
  subtitle: string;
  beatUrl: string | null;
  seed: string;
  ctaLabel: string;
  busy: boolean;
  error: string | null;
  onStart: () => void;
  onMore: () => void;
}) {
  const [a, b] = coverGrad(seed);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => audioRef.current?.pause(), []);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else {
      el.pause();
      setPlaying(false);
    }
  }

  return (
    <div className="bx">
      <div className="bx-top">
        <Link href="/app/studio" className="bx-icon-btn" aria-label="Back to Studio">
          <IconBack />
        </Link>
        <span className="bx-chip">Booth</span>
        <button type="button" className="bx-icon-btn" aria-label="More options" onClick={onMore}>
          <IconMore />
        </button>
      </div>

      <div className="bx-beat">
        <div className="bx-beat-art" style={{ background: `linear-gradient(145deg, ${a}, ${b})` }} />
        <div className="bx-beat-shade" />
        <div className="bx-beat-meta">
          <p className="bx-eyebrow" style={{ color: "rgba(255,255,255,.8)" }}>Your beat</p>
          <h1 className="bx-beat-title">{title}</h1>
          {subtitle ? <p className="bx-beat-sub">{subtitle}</p> : null}
        </div>
        {beatUrl ? (
          <>
            <audio ref={audioRef} src={beatUrl} preload="none" onEnded={() => setPlaying(false)} />
            <button type="button" className="bx-play" aria-label={playing ? "Pause beat" : "Play beat"} onClick={toggle}>
              <IconPlay playing={playing} />
            </button>
          </>
        ) : null}
      </div>

      {error ? <p className="bx-error">{error}</p> : null}
      <ol className="bx-steps" aria-label="How recording works">
          <li data-on="true"><b>1</b><span>Play your beat<small>Get the vibe. Headphones on if you have them.</small></span></li>
          <li><b>2</b><span>Get your song plan<small>We split the beat into parts to sing.</small></span></li>
          <li><b>3</b><span>Record part by part<small>Tap record, wait for the 4-count, sing.</small></span></li>
        </ol>

      <div className="bx-dock">
        <div className="bx-dock-inner">
          <button type="button" className="bx-cta glow" disabled={busy || !beatUrl} onClick={onStart}>
            {busy ? "Writing your plan…" : ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
