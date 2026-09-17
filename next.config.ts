import type { NextConfig } from "next";

const STUDIO_LOGO =
  "https://res.cloudinary.com/dzjoqbg2u/image/upload/v1786866729/Untitled_-_August_15_2026_at_17.55.54-2_ipkio0.png";

/**
 * Do not map secrets into NEXT_PUBLIC_* here.
 * Supabase URL + anon are injected for the browser via app/layout.tsx (window.__AP_SUPABASE__).
 * Set private vars on Vercel: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 */
const nextConfig: NextConfig = {
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
