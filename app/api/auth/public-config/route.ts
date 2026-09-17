import { NextResponse } from "next/server";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/env";

/**
 * Public Supabase config for the browser when NEXT_PUBLIC_* is not set.
 * URL + anon/publishable are designed to be public (RLS enforces access).
 * Never returns the service role key.
 */
export async function GET() {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    return NextResponse.json(
      { error: "Supabase public config is not configured on the server" },
      { status: 503 }
    );
  }
  return NextResponse.json(
    { url, anonKey },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    }
  );
}
