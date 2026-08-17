"use client";

import { useEffect, useState } from "react";

const PHRASES = [
  "Radio-ready songs",
  "Commercial-ready songs",
  "Show-ready songs",
  "Chart-ready songs",
];

const INTERVAL_MS = 2800;
const FADE_MS = 400;

export function RotatingHeadline() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      const timeout = setTimeout(() => {
        setIndex((i) => (i + 1) % PHRASES.length);
        setVisible(true);
      }, FADE_MS);
      return () => clearTimeout(timeout);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className="rotating-phrase"
      aria-live="polite"
      style={{
        display: "inline-block",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(0.25em)",
        transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
      }}
    >
      {PHRASES[index]}.
    </span>
  );
}
