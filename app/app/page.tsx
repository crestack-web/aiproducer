"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const C = {
  bg: "#0B0A0F",
  bgDeep: "#050508",
  surface: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.09)",
  borderHi: "rgba(255,255,255,0.16)",
  brass: "#E7A961",
  brassSoft: "rgba(231,169,97,0.15)",
  brassLine: "rgba(231,169,97,0.55)",
  text: "#F4F1EC",
  textMuted: "#9B96A3",
  textFaint: "#5C5866",
};

export default function StudioAppPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/auth?mode=login");
        return;
      }
      setLoading(false);
    })();
  }, [router]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.bgDeep, color: C.text, display: "grid", placeItems: "center", fontFamily: "Inter, system-ui, sans-serif" }}>
        Loading Studio…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bgDeep, color: C.text, fontFamily: "Inter, system-ui, sans-serif", padding: 40 }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ fontFamily: "monospace", fontSize: 12, color: C.brass, letterSpacing: 2, marginBottom: 16 }}>◆ STUDIO</div>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 36, fontWeight: 500, margin: "0 0 12px" }}>Make music.<br />With your voice.</h1>
        <p style={{ color: C.textMuted, lineHeight: 1.5, marginBottom: 24 }}>
          Dashboard is updating. Please hard-refresh in a moment — Create and Library are being restored with the full UI.
        </p>
        <Link href="/" style={{ color: C.brass }}>Back to welcome</Link>
      </div>
    </div>
  );
}
