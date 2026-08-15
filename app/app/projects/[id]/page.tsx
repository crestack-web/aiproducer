"use client";

export default function ProjectDetailPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#0B0A0F", color: "#F4F1EC", display: "grid", placeItems: "center", fontFamily: "system-ui" }}>
      <div style={{ textAlign: "center", maxWidth: 400, padding: 24 }}>
        <p style={{ fontSize: 18, marginBottom: 12 }}>Updating producer session…</p>
        <p style={{ color: "#9B96A3", fontSize: 14 }}>Please refresh in a moment.</p>
        <a href="/app" style={{ color: "#E7A961", display: "inline-block", marginTop: 20 }}>← Back to projects</a>
      </div>
    </div>
  );
}
