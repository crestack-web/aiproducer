import type { NextConfig } from "next";

const STUDIO_LOGO =
  "https://res.cloudinary.com/dzjoqbg2u/image/upload/v1786866729/Untitled_-_August_15_2026_at_17.55.54-2_ipkio0.png";

const nextConfig: NextConfig = {
  // Vercel Supabase integration often sets SUPABASE_URL / SUPABASE_ANON_KEY (server-only).
  // Map them into NEXT_PUBLIC_* at build so the browser client can connect.
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      "",
  },

  reactStrictMode: true,
  // Keep ffmpeg-static out of webpack bundling; load via require at runtime
  serverExternalPackages: ["ffmpeg-static"],
  // Ensure the native binary is copied into Vercel serverless function traces
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/ffmpeg-static/**/*",
    ],
    "/*": [
      "./node_modules/ffmpeg-static/**/*",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
    ],
  },
  async redirects() {
    return [
      { source: "/logo.svg", destination: STUDIO_LOGO, permanent: false },
      { source: "/icon.svg", destination: STUDIO_LOGO, permanent: false },
      { source: "/favicon.ico", destination: STUDIO_LOGO, permanent: false },
    ];
  },
};

export default nextConfig;
