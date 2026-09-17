import { NextResponse } from "next/server";
import {
  applyR2BrowserCors,
  getR2BrowserCors,
  r2BrowserCorsOrigins,
} from "@/lib/storage";

/**
 * GET/POST /api/admin/r2-cors
 * Apply or inspect R2 bucket CORS for browser presigned uploads.
 *
 * Auth: Authorization: Bearer <R2_CORS_APPLY_TOKEN>
 *   or  x-r2-cors-token: <R2_CORS_APPLY_TOKEN>
 * Fallback tokens (if R2_CORS_APPLY_TOKEN unset): CRON_SECRET, or SUPABASE_SERVICE_ROLE_KEY
 *
 * POST — apply CORS (PUT/GET/HEAD + Content-Type / * headers for apstudio.site)
 * GET  — show intended origins + current rules
 */
function authorized(req: Request): boolean {
  const expected =
    process.env.R2_CORS_APPLY_TOKEN?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!expected) return false;
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const header = req.headers.get("x-r2-cors-token")?.trim() || "";
  return bearer === expected || header === expected;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const current = await getR2BrowserCors();
    return NextResponse.json({
      ok: true,
      intendedOrigins: r2BrowserCorsOrigins(),
      current,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "CORS read failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const applied = await applyR2BrowserCors();
    const current = await getR2BrowserCors();
    return NextResponse.json({
      ok: true,
      message: "R2 CORS updated for browser PUT/GET (beat upload)",
      applied,
      current,
    });
  } catch (e) {
    console.error("[r2-cors]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "CORS apply failed" },
      { status: 500 }
    );
  }
}
