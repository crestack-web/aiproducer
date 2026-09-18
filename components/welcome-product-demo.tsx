"use client";

import React, { useState } from "react";
import Link from "next/link";

const START_HREF = "/auth?mode=signup&next=/onboarding";

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
    imageAlt: "AP Studio Console — timeline, tracks, and AI direction",
  },
];

/**
 * Suno-style product demo card on the welcome page.
 * First slide: live Console workspace screenshot.
 */
export function WelcomeProductDemo() {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[Math.min(index, SLIDES.length - 1)];

  return (
    <section className="product-demo" id="workspace" aria-label="Product demo">
      <div className="product-demo-card">
        <h2 className="product-demo-title">{slide.title}</h2>
        <p className="product-demo-body">{slide.body}</p>
        <div className="product-demo-frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slide.imageSrc}
            alt={slide.imageAlt}
            className="product-demo-img"
            loading="lazy"
          />
        </div>
        {SLIDES.length > 1 && (
          <div className="product-demo-dots" role="tablist" aria-label="Demo slides">
            {SLIDES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                className={`product-demo-dot${i === index ? " on" : ""}`}
                onClick={() => setIndex(i)}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        )}
        <div className="product-demo-cta">
          <Link href={START_HREF} className="primary">
            Open Studio
          </Link>
        </div>
      </div>
    </section>
  );
}
