"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useTheme } from "@/lib/theme";

/** Scene keys map to cassette label + copy tone */
export type EmptyScene =
  | "home"
  | "songs"
  | "beats"
  | "recordings"
  | "sessions"
  | "preview"
  | "default";

const SCENE: Record<
  EmptyScene,
  { tape: string; code: string; play: string }
> = {
  home: { tape: "NEW", code: "001", play: "START" },
  songs: { tape: "SONG", code: "000", play: "MIX" },
  beats: { tape: "BEAT", code: "BPM", play: "LOAD" },
  recordings: { tape: "VOX", code: "REC", play: "TAKE" },
  sessions: { tape: "PLAN", code: "…", play: "GO" },
  preview: { tape: "FULL", code: "PRE", play: "HEAR" },
  default: { tape: "JAZZ", code: "237", play: "PLAY" },
};

/** Inline mascot so cassette text can change per empty state */
export function StudioMascot({
  scene = "default",
  size = 200,
}: {
  scene?: EmptyScene;
  size?: number;
}) {
  const s = SCENE[scene] || SCENE.default;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 400 400"
      width={size}
      height={size}
      fill="none"
      role="img"
      aria-label="Studio character"
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
    >
      <ellipse cx="200" cy="355" rx="110" ry="18" fill="#eaf4f7" opacity="0.6" />
      <rect x="95" y="230" width="160" height="95" rx="10" fill="#eaf4f7" stroke="#09799f" strokeWidth="2.5" />
      <rect x="105" y="242" width="140" height="55" rx="6" fill="#cee4ec" stroke="#3a94b2" strokeWidth="1.5" />
      <rect x="115" y="252" width="50" height="18" rx="3" fill="#fff" stroke="#09799f" strokeWidth="1.5" />
      <text
        x="140"
        y="265"
        fontFamily="system-ui, sans-serif"
        fontSize="9"
        fill="#07617f"
        textAnchor="middle"
        fontWeight="600"
      >
        {s.code}
      </text>
      <circle cx="185" cy="261" r="8" fill="#fff" stroke="#09799f" strokeWidth="1.5" />
      <path d="M182 261 L188 261 M185 258 L185 264" stroke="#09799f" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="205" y="252" width="32" height="14" rx="3" fill="#57a202" stroke="#468202" strokeWidth="1" />
      <text
        x="221"
        y="262"
        fontFamily="system-ui, sans-serif"
        fontSize="6.5"
        fill="#fff"
        textAnchor="middle"
        fontWeight="600"
      >
        {s.play}
      </text>
      <line x1="115" y1="280" x2="235" y2="280" stroke="#3a94b2" strokeWidth="1" opacity="0.5" />
      <line x1="115" y1="288" x2="235" y2="288" stroke="#3a94b2" strokeWidth="1" opacity="0.5" />
      <line x1="115" y1="296" x2="235" y2="296" stroke="#3a94b2" strokeWidth="1" opacity="0.5" />
      <g transform="translate(145, 195)">
        <rect x="0" y="0" width="70" height="42" rx="4" fill="#fff" stroke="#09799f" strokeWidth="2" />
        <rect x="8" y="8" width="54" height="26" rx="2" fill="#eaf4f7" stroke="#3a94b2" strokeWidth="1" />
        <circle cx="22" cy="21" r="6" fill="none" stroke="#09799f" strokeWidth="1.5" />
        <circle cx="48" cy="21" r="6" fill="none" stroke="#09799f" strokeWidth="1.5" />
        <line x1="28" y1="21" x2="42" y2="21" stroke="#09799f" strokeWidth="1.2" />
        <text
          x="35"
          y="38"
          fontFamily="system-ui, sans-serif"
          fontSize="6"
          fill="#07617f"
          textAnchor="middle"
          fontWeight="600"
        >
          {s.tape}
        </text>
      </g>
      <ellipse cx="230" cy="210" rx="38" ry="48" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="2" />
      <ellipse cx="230" cy="220" rx="22" ry="28" fill="#fce8d0" />
      <circle cx="230" cy="145" r="42" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="2" />
      <ellipse cx="205" cy="155" rx="14" ry="12" fill="#f8c8a0" />
      <ellipse cx="255" cy="155" rx="14" ry="12" fill="#f8c8a0" />
      <ellipse cx="200" cy="115" rx="14" ry="18" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="2" />
      <ellipse cx="200" cy="115" rx="7" ry="10" fill="#f8c8a0" />
      <ellipse cx="260" cy="115" rx="14" ry="18" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="2" />
      <ellipse cx="260" cy="115" rx="7" ry="10" fill="#f8c8a0" />
      <ellipse cx="215" cy="140" rx="8" ry="10" fill="#fff" stroke="#333" strokeWidth="1.5" />
      <ellipse cx="245" cy="140" rx="8" ry="10" fill="#fff" stroke="#333" strokeWidth="1.5" />
      <circle cx="217" cy="141" r="4" fill="#333" />
      <circle cx="247" cy="141" r="4" fill="#333" />
      <circle cx="218.5" cy="139.5" r="1.5" fill="#fff" />
      <circle cx="248.5" cy="139.5" r="1.5" fill="#fff" />
      <ellipse cx="230" cy="158" rx="7" ry="5" fill="#c48a5a" />
      <path d="M218 168 Q230 178 242 168" fill="none" stroke="#c48a5a" strokeWidth="2" strokeLinecap="round" />
      <path d="M200 190 Q175 195 160 210" fill="none" stroke="#c48a5a" strokeWidth="8" strokeLinecap="round" />
      <path d="M260 190 Q250 200 215 215" fill="none" stroke="#c48a5a" strokeWidth="8" strokeLinecap="round" />
      <circle cx="158" cy="212" r="9" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="1.5" />
      <circle cx="212" cy="218" r="9" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="1.5" />
      <ellipse cx="215" cy="270" rx="12" ry="20" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="2" />
      <ellipse cx="245" cy="270" rx="12" ry="20" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="2" />
      <ellipse cx="215" cy="290" rx="14" ry="7" fill="#c48a5a" />
      <ellipse cx="245" cy="290" rx="14" ry="7" fill="#c48a5a" />
      <path d="M265 230 Q295 200 300 160 Q302 140 285 145" fill="none" stroke="#c48a5a" strokeWidth="10" strokeLinecap="round" />
      <path d="M265 230 Q295 200 300 160 Q302 140 285 145" fill="none" stroke="#f5d0a9" strokeWidth="6" strokeLinecap="round" />
      <path d="M200 185 Q230 195 260 185" fill="none" stroke="#09799f" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
      <path d="M205 185 L200 230" stroke="#09799f" strokeWidth="2.5" opacity="0.7" />
      <path d="M255 185 L260 230" stroke="#09799f" strokeWidth="2.5" opacity="0.7" />
      <ellipse cx="70" cy="300" rx="18" ry="8" fill="#eef6e6" />
      <path d="M70 300 Q60 270 55 250" fill="none" stroke="#57a202" strokeWidth="3" strokeLinecap="round" />
      <path d="M70 300 Q80 265 85 245" fill="none" stroke="#79b535" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="55" cy="248" rx="10" ry="6" fill="#9ac767" transform="rotate(-20 55 248)" />
      <ellipse cx="85" cy="243" rx="10" ry="6" fill="#79b535" transform="rotate(15 85 243)" />
      <circle cx="330" cy="280" r="22" fill="#cee4ec" stroke="#09799f" strokeWidth="1.5" opacity="0.7" />
      <circle cx="330" cy="280" r="8" fill="#eaf4f7" stroke="#3a94b2" strokeWidth="1" />
    </svg>
  );
}


/** Animated 3-2-1 countdown for recordings empty state */
function RecordingCountdownIllustration({ size = 180 }: { size?: number }) {
  const [step, setStep] = useState(0); // 0=3, 1=2, 2=1

  useEffect(() => {
    const id = window.setInterval(() => {
      setStep((s) => (s + 1) % 3);
    }, 900);
    return () => window.clearInterval(id);
  }, []);

  const active = 3 - step; // 3, 2, 1

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 480 480"
      width={size}
      height={size}
      fill="none"
      role="img"
      aria-label={`Countdown ${active}`}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
    >
      <ellipse cx="240" cy="445" rx="130" ry="16" fill="#eaf4f7" opacity="0.5" />

      {/* Animated countdown numbers — active digit pops */}
      <g>
        {[3, 2, 1].map((n) => {
          const x = n === 3 ? 120 : n === 2 ? 240 : 360;
          const isActive = n === active;
          return (
            <text
              key={`${n}-${isActive}`}
              x={x}
              y={140}
              textAnchor="middle"
              fontFamily="system-ui, sans-serif"
              fontWeight={800}
              fontSize={isActive ? 80 : 56}
              fill={isActive ? "#09799f" : "#9dc9d9"}
              opacity={isActive ? 1 : 0.38}
              style={{
                transition: "font-size 0.28s ease, opacity 0.28s ease, fill 0.28s ease",
              }}
            >
              {n}
            </text>
          );
        })}
      </g>

      {/* Record button — gentle pulse */}
      <circle cx="240" cy="200" r="28" fill="#db2428" stroke="#b91c1c" strokeWidth="2">
        <animate attributeName="r" values="26;30;26" dur="1.2s" repeatCount="indefinite" />
      </circle>
      <circle cx="240" cy="200" r="12" fill="#fff" />

      <g id="character">
        <path
          d="M310 350 Q345 320 355 280 Q360 255 335 260"
          fill="none"
          stroke="#c48a5a"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M310 350 Q345 320 355 280 Q360 255 335 260"
          fill="none"
          stroke="#f5d0a9"
          strokeWidth="5"
          strokeLinecap="round"
        />

        <ellipse cx="240" cy="330" rx="38" ry="46" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="1.8" />
        <ellipse cx="240" cy="342" rx="22" ry="26" fill="#fce8d0" />

        <circle cx="240" cy="260" r="38" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="1.8" />
        <ellipse cx="217" cy="270" rx="11" ry="10" fill="#f8c8a0" />
        <ellipse cx="263" cy="270" rx="11" ry="10" fill="#f8c8a0" />

        <ellipse cx="214" cy="232" rx="11" ry="14" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="1.5" />
        <ellipse cx="214" cy="232" rx="5.5" ry="8" fill="#f8c8a0" />
        <ellipse cx="266" cy="232" rx="11" ry="14" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="1.5" />
        <ellipse cx="266" cy="232" rx="5.5" ry="8" fill="#f8c8a0" />

        <ellipse cx="227" cy="256" rx="8" ry="9.5" fill="#fff" stroke="#333" strokeWidth="1.3" />
        <ellipse cx="253" cy="256" rx="8" ry="9.5" fill="#fff" stroke="#333" strokeWidth="1.3" />
        <circle cx="228.5" cy="257" r="3.5" fill="#333" />
        <circle cx="254.5" cy="257" r="3.5" fill="#333" />
        <circle cx="230" cy="255.5" r="1.3" fill="#fff" />
        <circle cx="256" cy="255.5" r="1.3" fill="#fff" />

        <ellipse cx="240" cy="272" rx="5.5" ry="4" fill="#c48a5a" />
        <path d="M228 282 Q240 290 252 282" fill="none" stroke="#c48a5a" strokeWidth="1.6" strokeLinecap="round" />

        <path
          d="M212 288 Q240 296 268 288"
          fill="none"
          stroke="#09799f"
          strokeWidth="2.3"
          strokeLinecap="round"
          opacity="0.85"
        />

        <path d="M210 310 Q195 300 200 280" fill="none" stroke="#c48a5a" strokeWidth="6.5" strokeLinecap="round" />
        <path d="M270 310 Q285 300 280 280" fill="none" stroke="#c48a5a" strokeWidth="6.5" strokeLinecap="round" />
        <circle cx="202" cy="278" r="7" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="1.2" />
        <circle cx="278" cy="278" r="7" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="1.2" />

        <ellipse cx="228" cy="390" rx="10" ry="14" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="1.5" />
        <ellipse cx="252" cy="390" rx="10" ry="14" fill="#f5d0a9" stroke="#c48a5a" strokeWidth="1.5" />
        <ellipse cx="228" cy="405" rx="11" ry="5.5" fill="#c48a5a" />
        <ellipse cx="252" cy="405" rx="11" ry="5.5" fill="#c48a5a" />
      </g>
    </svg>
  );
}

export function EmptyState({
  scene = "default",
  title,
  description,
  action,
  size = 180,
}: {
  scene?: EmptyScene;
  title: string;
  description?: string;
  action?: ReactNode;
  size?: number;
}) {
  const { colors: C } = useTheme();

  const box: CSSProperties = {
    marginTop: 8,
    padding: "28px 20px 24px",
    textAlign: "center",
    borderRadius: 18,
    background: C.surface,
    border: `1px solid ${C.border}`,
    boxShadow: C.cardShadow,
  };

  const illustration =
    scene === "home" ? (
      // Home / no projects: walk into the studio
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/illustrations/home-empty.svg"
        alt="Enter the studio"
        width={size}
        height={size}
        style={{ display: "block", maxWidth: "100%", height: "auto" }}
      />
    ) : scene === "songs" ? (
      // Songs empty: new song studio panel + ready mascot
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/illustrations/song-empty.svg"
        alt="Create a new song"
        width={size}
        height={size}
        style={{ display: "block", maxWidth: "100%", height: "auto" }}
      />
    ) : scene === "beats" ? (
      // Beat shelf empty: chipmunk putting on headphones while the instrumental plays
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/illustrations/beat-empty.svg"
        alt="Put on headphones and listen to the beat"
        width={size}
        height={size}
        style={{ display: "block", maxWidth: "100%", height: "auto" }}
      />
    ) : scene === "recordings" ? (
      <RecordingCountdownIllustration size={size} />
    ) : (
      <StudioMascot scene={scene} size={size} />
    );

  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        {illustration}
      </div>
      <p style={{ fontWeight: 600, fontSize: 16, margin: "0 0 6px", color: C.text }}>{title}</p>
      {description && (
        <p
          style={{
            color: C.textMuted,
            fontSize: 14,
            lineHeight: 1.5,
            margin: "0 auto",
            maxWidth: 320,
          }}
        >
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}
