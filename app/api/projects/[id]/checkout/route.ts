import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { PLANS, type PlanId, type BillingInterval } from "@/lib/plans";

type Body = { plan?: string; interval?: string };

/**
 * Start unlock / subscription checkout after the produce aha moment.
 * - session: unlock this project for download (metadata flag; Stripe when configured)
 * - creator | pro: subscription checkout when STRIPE_SECRET_KEY + price ids set
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await ctx.params;
  const { user, supabase } = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const plan = (body.plan || "session") as PlanId;
  const interval = (body.interval === "year" ? "year" : "month") as BillingInterval;

  if (!PLANS.some((p) => p.id === plan)) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: project, error } = await service
    .from("projects")
    .select("id, user_id, title, metadata")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (project.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const meta = { ...((project.metadata || {}) as Record<string, unknown>) };

  // Already unlocked
  if (meta.download_unlocked === true || meta.subscription_plan) {
    return NextResponse.json({ unlocked: true, already: true });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  const priceSession = process.env.STRIPE_PRICE_SESSION?.trim();
  const priceCreator =
    interval === "year"
      ? process.env.STRIPE_PRICE_CREATOR_YEAR?.trim()
      : process.env.STRIPE_PRICE_CREATOR_MONTH?.trim();
  const pricePro =
    interval === "year"
      ? process.env.STRIPE_PRICE_PRO_YEAR?.trim()
      : process.env.STRIPE_PRICE_PRO_MONTH?.trim();

  const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "";

  if (stripeKey) {
    const priceId =
      plan === "session" ? priceSession : plan === "creator" ? priceCreator : pricePro;

    if (priceId) {
      try {
        const params = new URLSearchParams();
        params.set("mode", plan === "session" ? "payment" : "subscription");
        params.set("success_url", `${origin}/app/projects/${projectId}?unlocked=1`);
        params.set("cancel_url", `${origin}/app/projects/${projectId}?paywall=1`);
        params.set("client_reference_id", projectId);
        params.set("metadata[project_id]", projectId);
        params.set("metadata[plan]", plan);
        params.set("metadata[user_id]", user.id);
        params.set("line_items[0][price]", priceId);
        params.set("line_items[0][quantity]", "1");

        const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${stripeKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        });
        const session = (await stripeRes.json()) as { id?: string; url?: string; error?: { message?: string } };
        if (!stripeRes.ok || !session.url) {
          return NextResponse.json(
            { error: session.error?.message || "Stripe checkout failed" },
            { status: 502 }
          );
        }
        return NextResponse.json({ checkoutUrl: session.url, sessionId: session.id });
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Stripe error" },
          { status: 502 }
        );
      }
    }
  }

  // Dev / pre-Stripe: allow session unlock so download flow can be tested
  if (plan === "session" && process.env.AP_ALLOW_DEV_UNLOCK === "1") {
    meta.download_unlocked = true;
    meta.download_unlocked_at = new Date().toISOString();
    meta.download_plan = "session";
    await service.from("projects").update({ metadata: meta }).eq("id", projectId);
    return NextResponse.json({ unlocked: true, dev: true });
  }

  return NextResponse.json(
    {
      error:
        "Checkout is not configured yet. Add STRIPE_SECRET_KEY and STRIPE_PRICE_* env vars, or set AP_ALLOW_DEV_UNLOCK=1 for session test unlocks.",
      message: "Checkout is not configured yet.",
    },
    { status: 503 }
  );
}
