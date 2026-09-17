import type { NextConfig } from "next";

const STUDIO_LOGO =
  "https://res.cloudinary.com/dzjoqbg2u/image/upload/v1786866729/Untitled_-_August_15_2026_at_17.55.54-2_ipkio0.png";

/**
 * Map Vercel Supabase integration server vars into NEXT_PUBLIC_* at build time
 * so the browser client can auth. Never inject empty strings.
 */
function publicEnv(): Record<string, string> {
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_PROJECT_URL ||
    process.env.SUPABASE_PROJECT_URL ||
    ""
  ).trim();

  const anonCandidates = [
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_KEY,
    process.env.SUPABASE_KEY,
  ]
    .map((v) => (v || "").trim())
    .filter(Boolean);

  const anonJwt = anonCandidates.find((k) => k.startsWith("eyJ"));
  const anon = anonJwt || anonCandidates[0] || "";

  const out: Record<string, string> = {};
  if (url) out.NEXT_PUBLIC_SUPABASE_URL = url;
  if (anon) out.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon;
  return out;
}

const nextConfig: NextConfig = {
  env: publicEnv(),
  serverExternalPackages: ["ffmpeg-static"],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
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
