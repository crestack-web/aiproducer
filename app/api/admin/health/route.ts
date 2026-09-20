import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { getProduceExecutionMode } from "@/lib/produce/execution-mode";
import { getSupabaseEnvDiagnostics } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

/** Non-secret health flags for the admin dashboard. */
export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const supabase = getSupabaseEnvDiagnostics();
  return NextResponse.json({
    ok: true,
    adminEmail: gate.email,
    email: {
      resendConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
      from:
        process.env.RESEND_FROM_EMAIL?.trim() ||
        process.env.EMAIL_FROM?.trim() ||
        "AP Studio <onboarding@resend.dev>",
      verificationVia: "resend",
    },
    produce: {
      execution: getProduceExecutionMode(),
      fullQuality: process.env.PRODUCE_FULL_QUALITY === "1",
    },
    supabase,
  });
}
