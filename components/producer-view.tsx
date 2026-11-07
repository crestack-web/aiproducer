"use client";

import { useEffect } from "react";

/** Temporary stub while full Console UI is restored from commit 5547f53 + add-track patch. */
export function ProducerView(_props: { projectId?: string | null }) {
  useEffect(() => {
    console.error("[producer-view] temporary stub — restore in progress");
  }, []);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "#0B0A0F",
        color: "#F4F1EC",
        fontFamily: "system-ui, sans-serif",
        padding: 24,
        textAlign: "center",
        zIndex: 9999,
      }}
    >
      <div style={{ maxWidth: 360 }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Console is updating</div>
        <p style={{ color: "#9B96A3", fontSize: 14, lineHeight: 1.45, margin: 0 }}>
          The session timeline is being restored. Please refresh in a minute.
        </p>
      </div>
    </div>
  );
}

export default ProducerView;
