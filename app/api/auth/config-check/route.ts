import { NextResponse } from "next/server";
import { getSupabaseEnvDiagnostics } from "@/lib/supabase/env";

/** GET /api/auth/config-check — presence only, no secrets. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    supabase: getSupabaseEnvDiagnostics(),
  });
}
