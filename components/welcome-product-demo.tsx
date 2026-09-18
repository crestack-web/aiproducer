"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

const START_HREF = "/auth?mode=signup&next=/onboarding";
const AUTO_MS = 5000;

type Slide = {
  id: string;
  title: string;
  body: string;
  imageSrc: string;
  imageAlt: string;
};

const SLIDES: Slide[] = [
  {
    id: "console",
    title: "Your complete creative workspace",
    body:
      "AP Studio Console is a web-based production desk that combines guided recording, timeline layers, and AI-assisted direction — so you build real songs with your voice, not synthetic vocals.",
    imageSrc: "/welcome/console-workspace.jpg",
    imageAlt: "AP Studio Console — tracks, Produce, and AI direction",
  },
  {
    id: "timeline",
    title: "Arrange every vocal layer",
    body:
      "See intro, verse, and chorus on the timeline. Place leads, doubles, harmonies, and adlibs exactly where they belong — then Produce a finished song without opening a traditional DAW.",
    imageSrc: "/welcome/timeline-arrangement.jpg",
    imageAlt: "AP Studio timeline — lead, double, harmony, and adlib regions",
  },
];

/**
 * Suno-style product demo — auto-rotating slides, no manual controls.
 */
export function WelcomeProductDemo() {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[Math.min(index, SLIDES.length - 1)];

  useEffect(() => {
    if (SLIDES.length < 2) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="product-demo" id="workspace" aria-label="Product demo">
      <div className="product-demo-card">
        <h2 className="product-demo-title">{slide.title}</h2>
        <p className="product-demo-body">{slide.body}</p>
        <div className="product-demo-frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={slide.id}
            src={slide.imageSrc}
            alt={slide.imageAlt}
            className="product-demo-img"
            loading="eager"
          />
        </div>
        <div className="product-demo-cta">
          <Link href={START_HREF} className="primary">
            Open Studio
          </Link>
        </div>
      </div>
    </section>
  );
}
