import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { paystackVerify } from "@/lib/paystack";

/**
 * Paystack redirects here after payment.
 * Verify the transaction, unlock the project, redirect to the session.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const reference = url.searchParams.get("reference") || url.searchParams.get("trxref");
  const projectIdParam = url.searchParams.get("project_id");

  const origin = process.env.NEXT_PUBLIC_APP_URL || `${url.protocol}//${url.host}`;

  if (!reference) {
    return NextResponse.redirect(`${origin}/app?pay=missing_ref`);
  }

  let verified;
  try {
    verified = await paystackVerify(reference);
  } catch {
    return NextResponse.redirect(`${origin}/app?pay=verify_failed`);
  }

  if (verified.status !== "success") {
    const pid =
      projectIdParam ||
      String((verified.metadata as { project_id?: string })?.project_id || "");
    const dest = pid
      ? `${origin}/app/studio/${pid}?paywall=1&pay=failed`
      : `${origin}/app?pay=failed`;
    return NextResponse.redirect(dest);
  }

  const metaIn = verified.metadata || {};
  const projectId =
    projectIdParam ||
    String(metaIn.project_id || metaIn.projectId || "");

  if (!projectId) {
    return NextResponse.redirect(`${origin}/app?pay=no_project`);
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
    return NextResponse.redirect(`${origin}/app?pay=project_missing`);
  }

  const meta = { ...((project.metadata || {}) as Record<string, unknown>) };
  meta.download_unlocked = true;
  meta.download_unlocked_at = new Date().toISOString();
  meta.download_plan = plan;
  meta.paystack_reference = reference;
  meta.paystack_paid_at = verified.paid_at || new Date().toISOString();
  if (plan === "creator" || plan === "pro") {
    meta.subscription_plan = plan;
    meta.subscription_interval = interval;
  }
  delete meta.paystack_pending;

  await service.from("projects").update({ metadata: meta }).eq("id", projectId);

  // App project URL — session UI is under /app with project id in path used by the product
  return NextResponse.redirect(
    `${origin}/app/studio/${projectId}?unlocked=1&pay=success`
  );
}
