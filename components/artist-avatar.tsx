"use client";

import React, { useMemo } from "react";


/** Stable, case-insensitive seed for a user identity across routes. */
export function stableAvatarSeed(parts: {
  userId?: string | null;
  email?: string | null;
  name?: string | null;
}): string {
  const id = (parts.userId || "").trim();
  if (id) return `uid:${id.toLowerCase()}`;
  const email = (parts.email || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = (parts.name || "").trim().toLowerCase();
  if (name && name !== "artist") return `name:${name}`;
  return "artist";
}

/** Deterministic 0–1 PRNG from string seed */
function seededRandom(seed: string) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0xfffffff) / 0xfffffff;
  };
}

function hsl(h: number, s: number, l: number, a = 1) {
  return `hsla(${Math.round(h) % 360}, ${Math.round(s)}%, ${Math.round(l)}%, ${a})`;
}

/**
 * Unique generative artist mark — organic “planet / waveform world” per seed.
 * Not a letter monogram; each user gets a stable, distinct composition.
 */
export function ArtistAvatar({
  seed,
  size = 88,
  className,
  style,
}: {
  seed: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const normalized = (seed || "artist").trim().toLowerCase() || "artist";
  const art = useMemo(() => {
    const rnd = seededRandom(normalized);
    const baseHue = rnd() * 360;
    // Palette: deep base + warm accent + cool accent (Suno-adjacent but original)
    const deep = hsl(baseHue, 55 + rnd() * 25, 12 + rnd() * 10);
    const warm = hsl((baseHue + 25 + rnd() * 40) % 360, 75 + rnd() * 20, 48 + rnd() * 18);
    const cool = hsl((baseHue + 180 + rnd() * 50) % 360, 60 + rnd() * 30, 42 + rnd() * 20);
    const glow = hsl((baseHue + 40) % 360, 80, 60, 0.55);
    const uid = `av-${Math.abs(
      Array.from(normalized).reduce((a, c) => a * 31 + c.charCodeAt(0), 7)
    ).toString(36)}`;

    // Organic blobs
    const blobs = Array.from({ length: 4 }, (_, i) => {
      const cx = 20 + rnd() * 60;
      const cy = 20 + rnd() * 60;
      const rx = 18 + rnd() * 28;
      const ry = 16 + rnd() * 26;
      const rot = rnd() * 360;
      return { cx, cy, rx, ry, rot, fill: i % 2 === 0 ? warm : cool, op: 0.55 + rnd() * 0.4 };
    });

    // Wave arcs (music DNA)
    const waves = Array.from({ length: 3 }, (_, i) => {
      const y = 30 + i * 18 + rnd() * 8;
      const amp = 6 + rnd() * 10;
      const phase = rnd() * Math.PI * 2;
      let d = `M 8 ${y}`;
      for (let x = 8; x <= 92; x += 4) {
        const yy = y + Math.sin(x / 10 + phase) * amp;
        d += ` L ${x} ${yy}`;
      }
      return { d, stroke: i === 1 ? warm : cool, op: 0.35 + rnd() * 0.35, w: 1.2 + rnd() };
    });

    // Speckles
    const dots = Array.from({ length: 12 }, () => ({
      cx: 10 + rnd() * 80,
      cy: 10 + rnd() * 80,
      r: 0.6 + rnd() * 1.8,
      fill: rnd() > 0.5 ? "#fff" : warm,
      op: 0.2 + rnd() * 0.5,
    }));

    return { deep, warm, cool, glow, uid, blobs, waves, dots };
  }, [normalized]);

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        flexShrink: 0,
        position: "relative",
        boxShadow: "0 8px 28px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.08)",
        ...style,
      }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id={`${art.uid}-bg`} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor={art.warm} stopOpacity={0.9} />
            <stop offset="45%" stopColor={art.cool} stopOpacity={0.75} />
            <stop offset="100%" stopColor={art.deep} stopOpacity={1} />
          </radialGradient>
          <radialGradient id={`${art.uid}-glow`} cx="70%" cy="75%" r="50%">
            <stop offset="0%" stopColor={art.glow} />
            <stop offset="100%" stopColor={art.deep} stopOpacity={0} />
          </radialGradient>
          <filter id={`${art.uid}-blur`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <clipPath id={`${art.uid}-clip`}>
            <circle cx="50" cy="50" r="50" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${art.uid}-clip)`}>
          <rect width="100" height="100" fill={`url(#${art.uid}-bg)`} />
          <rect width="100" height="100" fill={`url(#${art.uid}-glow)`} />
          {art.blobs.map((b, i) => (
            <ellipse
              key={i}
              cx={b.cx}
              cy={b.cy}
              rx={b.rx}
              ry={b.ry}
              fill={b.fill}
              opacity={b.op}
              transform={`rotate(${b.rot} ${b.cx} ${b.cy})`}
              filter={`url(#${art.uid}-blur)`}
            />
          ))}
          {art.waves.map((w, i) => (
            <path
              key={`w${i}`}
              d={w.d}
              fill="none"
              stroke={w.stroke}
              strokeWidth={w.w}
              strokeLinecap="round"
              opacity={w.op}
            />
          ))}
          {art.dots.map((d, i) => (
            <circle key={`d${i}`} cx={d.cx} cy={d.cy} r={d.r} fill={d.fill} opacity={d.op} />
          ))}
          {/* Soft rim light */}
          <circle
            cx="50"
            cy="50"
            r="48"
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="1.5"
          />
        </g>
      </svg>
    </div>
  );
}

/** Gear / settings — real vector icon, not emoji */
export function IconSettings({
  size = 20,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
      <path d="M12 6.2a5.8 5.8 0 0 1 5.8 5.8A5.8 5.8 0 0 1 12 17.8 5.8 5.8 0 0 1 6.2 12 5.8 5.8 0 0 1 12 6.2z" opacity="0.35" />
    </svg>
  );
}

/** Cleaner cog matching common app UI */
export function IconSettingsCog({
  size = 20,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.77 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.25.1.54 0 .68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
    </svg>
  );
}
