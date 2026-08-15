"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function ProjectRedirect() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  useEffect(() => {
    if (id) router.replace(`/app/studio/${id}`);
  }, [id, router]);
  return (
    <div style={{ minHeight: "100vh", background: "#0B0A0F", color: "#9B96A3", display: "grid", placeItems: "center", fontFamily: "system-ui" }}>
      Opening Studio…
    </div>
  );
}
