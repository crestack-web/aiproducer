import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createTryItSession, getTryItQuota, isTryItEnabled } from "@/lib/try-it/service";

/** POST /api/try-it/session — start isolated Try It session */
export async function POST() {
  const { user, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTryItEnabled()) {
    return NextResponse.json({ error: "Try It is not enabled" }, { status: 503 });
  }
  try {
    const session = await createTryItSession(user.id);
    const quota = await getTryItQuota(user.id);
    return NextResponse.json({
      id: session.id,
      status: session.status,
      expires_at: session.expires_at,
      scope: session.scope,
      quota,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not start Try It" },
      { status: 500 }
    );
  }
}
