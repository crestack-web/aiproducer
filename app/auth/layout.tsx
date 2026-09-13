import { Suspense } from "react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100dvh",
            display: "grid",
            placeItems: "center",
            background: "#0B0A0F",
            color: "#9B96A3",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Loading…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
