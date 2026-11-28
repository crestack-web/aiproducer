import { NextResponse } from "next/server";
import { fulfillWhopPayment, whopGetPayment, whopKey } from "@/lib/whop";

/**
 * Whop webhook (payment.succeeded). Set in Whop dashboard → Developer → Webhooks:
 *   https://www.apstudio.site/api/whop/webhook
 * The body is only a hint: we read the payment back from Whop with our API key before unlocking.
 */
export async function POST(req: Request) {
  if (!whopKey()) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as
    | { type?: string; action?: string; data?: { id?: string } }
    | null;
  const type = body?.type || body?.action || "";
  const id = body?.data?.id;
  if (!type.startsWith("payment.") || typeof id !== "string" || !/^pay_[A-Za-z0-9]+$/.test(id)) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  try {
    const payment = await whopGetPayment(id);
    const r = await fulfillWhopPayment(payment);
    return NextResponse.json({ ok: true, applied: r.ok });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
