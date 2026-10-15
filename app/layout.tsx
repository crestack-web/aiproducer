import type { Metadata } from "next";
import { STUDIO_LOGO_URL } from "@/lib/brand";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/env";
import { ThemeProvider } from "@/lib/theme";
import { PwaRegister } from "@/components/pwa-install";

export const metadata: Metadata = {
  title: "AP Studio",
  description:
    "Create a beat. Get guided through recording. Finish a real song with your voice.",
  applicationName: "AP Studio",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "AP Studio",
    statusBarStyle: "black-translucent",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [{ url: STUDIO_LOGO_URL, type: "image/png" }],
    apple: [{ url: STUDIO_LOGO_URL, type: "image/png" }],
    shortcut: STUDIO_LOGO_URL,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const supabasePublic = {
    url: getSupabaseUrl() || "",
    anonKey: getSupabaseAnonKey() || "",
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" href={STUDIO_LOGO_URL} type="image/png" />
        <link rel="apple-touch-icon" href={STUDIO_LOGO_URL} />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#050508" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="AP Studio" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{document.documentElement.setAttribute('data-theme','dark');document.documentElement.style.colorScheme='dark';document.documentElement.style.background='#050508';localStorage.setItem('studio-theme','dark')}catch(e){}})();`,
          }}
        />
      </head>
      <body style={{ margin: 0, minHeight: "100vh" }}>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__AP_SUPABASE__=${JSON.stringify(supabasePublic)};`,
          }}
        />

        <ThemeProvider>
          <PwaRegister />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
