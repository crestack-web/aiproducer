import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Studio — AI Music Producer",
  description: "Create a beat. Get guided through recording. Finish a real song with your voice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#050508", color: "#F4F1EC" }}>{children}</body>
    </html>
  );
}
