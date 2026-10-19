"use client";

/**
 * AP Studio intro — karaoke diamond + mic animation.
 * Plays once per browser session when the app shell mounts.
 */

import { useCallback, useEffect, useState } from "react";

const SESSION_KEY = "ap_studio_intro_v1";
const INTRO_MS = 3400;

type Props = {
  /** Force show (e.g. debug). Default: once per session. */
  force?: boolean;
};

export function AppIntro({ force = false }: Props) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [playKey, setPlayKey] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* ignore */
      }
      return;
    }
    let seen = false;
    try {
      seen = sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      seen = false;
    }
    if (seen && !force) return;

    setVisible(true);
    setPlayKey((k) => k + 1);

    const t = window.setTimeout(() => {
      setExiting(true);
      window.setTimeout(() => {
        setVisible(false);
        try {
          sessionStorage.setItem(SESSION_KEY, "1");
        } catch {
          /* ignore */
        }
      }, 420);
    }, INTRO_MS);

    return () => window.clearTimeout(t);
  }, [force]);

  const skip = useCallback(() => {
    setExiting(true);
    window.setTimeout(() => {
      setVisible(false);
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* ignore */
      }
    }, 280);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="AP Studio intro"
      onClick={skip}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))",
        background: "#2a2218",
        opacity: exiting ? 0 : 1,
        transition: "opacity 0.4s ease",
        cursor: "pointer",
      }}
    >
      <style>{INTRO_CSS}</style>

      <div className="ap-intro-stage">
        <svg
          key={playKey}
          className="ap-intro-svg play"
          viewBox="0 0 1930 1930"
          role="img"
          aria-label="AP Studio"
        >
          <defs>
            <clipPath id="ap-intro-clip">
              <polygon points="965,370 1640,965 965,1560 290,965" />
            </clipPath>
          </defs>

          <polygon
            className="diamond"
            points="965,370 1640,965 965,1560 290,965"
            fill="#cd8821"
          />

          <g clipPath="url(#ap-intro-clip)">
            <circle className="ring r1" cx="1103" cy="828" r="140" fill="none" stroke="#9c6212" strokeWidth="8" />
            <circle className="ring r2" cx="1103" cy="828" r="140" fill="none" stroke="#9c6212" strokeWidth="8" />
            <circle className="ring r3" cx="1103" cy="828" r="140" fill="none" stroke="#9c6212" strokeWidth="8" />
          </g>

          <g className="mic">
            <g transform="translate(1103 828) rotate(135)">
              <rect x="500" y="-16" width="46" height="32" rx="16" fill="#000" />
              <polygon points="110,-80 110,80 425,50 425,-50" fill="#000" />
              <circle cx="425" cy="0" r="50" fill="#000" />
              <circle cx="0" cy="0" r="132" fill="#000" stroke="#cd8821" strokeWidth="14" paintOrder="stroke" />
              <circle cx="0" cy="0" r="132" fill="#000" />
              <rect x="-22" y="-150" width="44" height="300" rx="22" fill="#cd8821" />
              <rect x="-11" y="-146" width="22" height="292" rx="11" fill="#000" />
            </g>
          </g>

          <g className="note note-a" fill="none" stroke="#000" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round">
            <path d="M745 872V771L861 725V848" />
            <circle cx="722" cy="870" r="33" fill="#000" stroke="none" />
            <circle cx="838" cy="848" r="33" fill="#000" stroke="none" />
          </g>

          <g className="note note-b" fill="none" stroke="#000" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1105 1123V1022L1221 976V1099" />
            <circle cx="1082" cy="1121" r="33" fill="#000" stroke="none" />
            <circle cx="1198" cy="1099" r="33" fill="#000" stroke="none" />
          </g>
        </svg>
      </div>

      <div key={`brand-${playKey}`} className="ap-intro-brand play" aria-hidden>
        <div className="ap-intro-wordmark-clip">
          <h1 className="ap-intro-wordmark">
            AP <span>Studio</span>
          </h1>
        </div>
        <p className="ap-intro-tagline">Your voice. Produced.</p>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "#b9a88c", opacity: 0.7 }}>Tap to skip</p>
    </div>
  );
}

const INTRO_CSS = `
.ap-intro-stage {
  width: min(72vw, 280px);
  aspect-ratio: 1;
  margin-bottom: -12px;
}
.ap-intro-svg {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}
.ap-intro-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}
.ap-intro-wordmark-clip {
  overflow: hidden;
  padding-block: 4px;
}
.ap-intro-wordmark {
  margin: 0;
  font: 800 clamp(28px, 8vw, 44px)/1.05 system-ui, -apple-system, "Segoe UI", sans-serif;
  letter-spacing: -0.02em;
  color: #f3e6cf;
}
.ap-intro-wordmark span {
  color: #cd8821;
}
.ap-intro-tagline {
  margin: 0;
  font: 400 clamp(12px, 3.2vw, 15px)/1.4 system-ui, -apple-system, sans-serif;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #b9a88c;
}

.ap-intro-svg.play .diamond {
  transform-origin: 965px 965px;
  animation: ap-intro-pop 0.85s cubic-bezier(.2,1.25,.3,1) both;
}
.ap-intro-svg.play .mic {
  transform-origin: 1103px 828px;
  animation: ap-intro-mic-in 0.95s cubic-bezier(.2,1.2,.3,1) 0.65s both, ap-intro-sing 2.4s ease-in-out 1.9s infinite;
}
.ap-intro-svg.play .note {
  transform-box: fill-box;
  transform-origin: center;
}
.ap-intro-svg.play .note-a {
  animation: ap-intro-note-in 0.7s cubic-bezier(.2,1.3,.3,1) 1.15s both, ap-intro-bob 2.6s ease-in-out 1.9s infinite alternate;
}
.ap-intro-svg.play .note-b {
  animation: ap-intro-note-in 0.7s cubic-bezier(.2,1.3,.3,1) 1.35s both, ap-intro-bob-rev 3s ease-in-out 2.1s infinite alternate;
}
.ap-intro-svg .ring {
  opacity: 0;
  transform-origin: 1103px 828px;
}
.ap-intro-svg.play .ring {
  animation: ap-intro-ripple 2.4s ease-out infinite;
  animation-delay: calc(1.9s + var(--d, 0s));
}
.ap-intro-svg .r2 { --d: 0.8s; }
.ap-intro-svg .r3 { --d: 1.6s; }

.ap-intro-brand.play .ap-intro-wordmark {
  animation: ap-intro-rise 0.8s cubic-bezier(.2,.9,.3,1) 1.9s both;
}
.ap-intro-brand.play .ap-intro-tagline {
  animation: ap-intro-fade-up 0.8s ease-out 2.5s both;
}

@keyframes ap-intro-rise {
  from { transform: translateY(110%); }
  to { transform: none; }
}
@keyframes ap-intro-fade-up {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: none; opacity: 1; }
}
@keyframes ap-intro-pop {
  from { transform: scale(0) rotate(-90deg); }
  to { transform: scale(1) rotate(0); }
}
@keyframes ap-intro-mic-in {
  0% { transform: translate(-260px, 260px) rotate(-40deg) scale(0.6); opacity: 0; }
  60% { opacity: 1; }
  100% { transform: none; opacity: 1; }
}
@keyframes ap-intro-sing {
  0%, 100% { transform: rotate(0) scale(1); }
  50% { transform: rotate(-5deg) scale(1.04); }
}
@keyframes ap-intro-note-in {
  from { transform: translateY(70px) scale(0) rotate(-20deg); opacity: 0; }
  to { transform: none; opacity: 1; }
}
@keyframes ap-intro-bob {
  from { transform: translateY(0) rotate(-4deg); }
  to { transform: translateY(-22px) rotate(5deg); }
}
@keyframes ap-intro-bob-rev {
  from { transform: translateY(-12px) rotate(5deg); }
  to { transform: translateY(10px) rotate(-4deg); }
}
@keyframes ap-intro-ripple {
  0% { transform: scale(0.7); opacity: 0.55; }
  100% { transform: scale(2.6); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .ap-intro-svg.play .diamond,
  .ap-intro-svg.play .mic,
  .ap-intro-svg.play .note,
  .ap-intro-svg.play .ring,
  .ap-intro-brand.play .ap-intro-wordmark,
  .ap-intro-brand.play .ap-intro-tagline {
    animation: none !important;
  }
}
`;
