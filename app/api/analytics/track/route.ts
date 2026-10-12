import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const ALLOWED_EVENTS = new Set([
  "welcome_view",
  "welcome_cta",
  "app_view",
  "app_nav",
  "booth_open",
  "console_open",
  "produce_start",
  "onboarding_step",
  "onboarding_complete",
]);

/**
 * POST /api/analytics/track
 * Body: { event, path?, sessionId?, meta? }
 * Anonymous welcome visits + signed-in app usage.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      event?: string;
      path?: string;
      sessionId?: string;
      meta?: Record<string, unknown>;
    };
    const event = String(body.event || "").trim().toLowerCase();
    if (!event || !ALLOWED_EVENTS.has(event)) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }

    let userId: string | null = null;
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } catch {
      userId = null;
    }

    const service = createServiceClient();
    const { error } = await service.from("product_events").insert({
      event,
      path: body.path ? String(body.path).slice(0, 500) : null,
      user_id: userId,
      session_id: body.sessionId ? String(body.sessionId).slice(0, 80) : null,
      meta: body.meta && typeof body.meta === "object" ? body.meta : {},
    });

    if (error) {
      // Table may not exist yet — soft-fail so UI never breaks
      console.warn("[analytics/track]", error.message);
      return NextResponse.json({ ok: false, skipped: true }, { status: 200 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[analytics/track]", e);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
