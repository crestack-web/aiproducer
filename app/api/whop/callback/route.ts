import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fulfillWhopPayment, whopFindPaidPayment, whopGetPayment, type WhopPayment } from "@/lib/whop";

/** Whop sends the buyer here after checkout. We re-read the payment from Whop before unlocking. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = process.env.NEXT_PUBLIC_APP_URL || `${url.protocol}//${url.host}`;
  const projectId = url.searchParams.get("project_id") || "";
  const paymentId = url.searchParams.get("payment_id") || url.searchParams.get("receipt_id") || "";
  const failDest = projectId ? `${origin}/app/studio/${projectId}?paywall=1&pay=failed` : `${origin}/app?pay=failed`;

  let payment: WhopPayment | null = null;
  try {
    if (paymentId) {
      payment = await whopGetPayment(paymentId);
    } else if (projectId) {
      const { data: project } = await createServiceClient()
        .from("projects").select("metadata").eq("id", projectId).maybeSingle();
      const pending = ((project?.metadata || {}) as Record<string, unknown>).whop_pending as
        | { variant_id?: string } | undefined;
      if (pending?.variant_id) payment = await whopFindPaidPayment(pending.variant_id);
    }
  } catch {
    return NextResponse.redirect(failDest);
  }
  if (!payment) {
    // Payment may still be settling; the webhook will unlock it.
    return NextResponse.redirect(projectId ? `${origin}/app/studio/${projectId}?pay=pending` : `${origin}/app?pay=pending`);
  }

  const r = await fulfillWhopPayment(payment, { projectId });
  if (!r.ok || !r.projectId) return NextResponse.redirect(failDest);
  return NextResponse.redirect(
    r.beat
      ? `${origin}/app/studio/${r.projectId}?beat_unlocked=1&pay=success`
      : `${origin}/app/studio/${r.projectId}?unlocked=1&pay=success`
  );
}
