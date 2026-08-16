import type { Metadata } from "next";
import { STUDIO_LOGO_URL } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Studio — AI Music Producer",
  description:
    "Create a beat. Get guided through recording. Finish a real song with your voice.",
  icons: {
    icon: [{ url: STUDIO_LOGO_URL, type: "image/png" }],
    apple: [{ url: STUDIO_LOGO_URL, type: "image/png" }],
    shortcut: STUDIO_LOGO_URL,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" href={STUDIO_LOGO_URL} type="image/png" />
        <link rel="apple-touch-icon" href={STUDIO_LOGO_URL} />
      </head>
      <body style={{ margin: 0, background: "#050508", color: "#F4F1EC" }}>{children}</body>
    </html>
  );
}
