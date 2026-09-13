import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { paystackSecret } from "@/lib/paystack";
import crypto from "crypto";

/**
 * Paystack webhook — charge.success unlocks the project.
 * Set webhook URL in Paystack dashboard: /api/paystack/webhook
 */
export async function POST(req: Request) {
  const secret = paystackSecret();
  if (!secret) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature") || "";
  const hash = crypto.createHmac("sha512", secret).update(raw).digest("hex");
  if (hash !== signature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(raw) as {
    event?: string;
    data?: {
      reference?: string;
      status?: string;
      metadata?: Record<string, unknown>;
      paid_at?: string;
    };
  };

  if (event.event !== "charge.success" || event.data?.status !== "success") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const metaIn = event.data?.metadata || {};
  const projectId = String(metaIn.project_id || "");
  if (!projectId) {
    return NextResponse.json({ ok: true, no_project: true });
  }

  const plan = String(metaIn.plan || "session");
  const interval = String(metaIn.interval || "month");
  const service = createServiceClient();
  const { data: project } = await service
    .from("projects")
    .select("id, metadata")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ ok: true, missing: true });
  }

  const meta = { ...((project.metadata || {}) as Record<string, unknown>) };
  meta.download_unlocked = true;
  meta.download_unlocked_at = new Date().toISOString();
  meta.download_plan = plan;
  meta.paystack_reference = event.data?.reference;
  meta.paystack_paid_at = event.data?.paid_at || new Date().toISOString();
  if (plan === "creator" || plan === "pro") {
    meta.subscription_plan = plan;
    meta.subscription_interval = interval;
  }
  delete meta.paystack_pending;

  await service.from("projects").update({ metadata: meta }).eq("id", projectId);

  return NextResponse.json({ ok: true });
}
