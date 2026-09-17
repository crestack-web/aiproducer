import type { NextConfig } from "next";

const STUDIO_LOGO =
  "https://res.cloudinary.com/dzjoqbg2u/image/upload/v1786866729/Untitled_-_August_15_2026_at_17.55.54-2_ipkio0.png";

/** Prefer non-empty values so we never bake "" into the client bundle. */
function publicEnv() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    "";
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    "";
  const out: Record<string, string> = {};
  if (url) out.NEXT_PUBLIC_SUPABASE_URL = url;
  if (anon) out.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon;
  return out;
}

const nextConfig: NextConfig = {
  // Vercel Supabase integration often sets server-only SUPABASE_* vars.
  // Map them into NEXT_PUBLIC_* at build so the browser can auth.
  env: publicEnv(),
  // Avoid bundling native/binary packages into the serverless trace incorrectly.
  serverExternalPackages: ["ffmpeg-static"],
  // Ensure large audio uploads work on Node runtime
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
