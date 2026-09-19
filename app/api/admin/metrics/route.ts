import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { collectAdminMetrics } from "@/lib/admin/metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/admin/metrics — admin-only dashboard data */
export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  try {
    const metrics = await collectAdminMetrics();
    return NextResponse.json({ ok: true, metrics, admin: gate.email });
  } catch (e) {
    console.error("[admin/metrics]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load metrics" },
      { status: 500 }
    );
  }
}
