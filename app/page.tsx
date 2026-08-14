export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, sans-serif" }}>
      <p style={{ letterSpacing: 2, color: "#E7A961", fontSize: 12, marginBottom: 12 }}>◆ STUDIO</p>
      <h1 style={{ fontSize: 36, fontWeight: 600, margin: 0 }}>AI Music Producer</h1>
      <p style={{ color: "#9B96A3", marginTop: 12, lineHeight: 1.5 }}>
        Backend scaffold is live. Open <code>studio-app.html</code> for the full UI prototype, or wire the React screens into this Next.js app next.
      </p>
      <ul style={{ color: "#9B96A3", marginTop: 24, lineHeight: 1.8 }}>
        <li>POST /api/projects</li>
        <li>GET /api/projects</li>
        <li>GET /api/projects/:id</li>
        <li>GET /api/projects/:id/status</li>
        <li>GET /api/jobs/:id</li>
      </ul>
      <p style={{ color: "#7BEBD4", marginTop: 32, fontSize: 14 }}>
        Set DEV_MODE=true and Supabase env vars in .env.local — see .env.example
      </p>
    </main>
  );
}
