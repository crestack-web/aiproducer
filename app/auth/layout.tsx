import { Suspense } from "react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div style={{ padding: 40, color: "#9B96A3" }}>Loading…</div>}>{children}</Suspense>;
}
