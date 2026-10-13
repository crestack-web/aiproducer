import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { acceptInvite } from "@/lib/sessions/service";

const JoinSchema = z.object({
  token: z.string().min(16).max(128),
});

/**
 * POST — accept invite token and join session.
 * Uses service role to look up the invite (user is not a member yet).
 * Membership insert is still tied to the authenticated user id.
 */
export async function POST(req: Request) {
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = JoinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid invite token required" }, { status: 400 });
  }

  let service;
  try {
    service = createServiceClient();
  } catch (e) {
    console.error("join service client", e);
    return NextResponse.json(
      { error: "Server misconfigured for invites" },
      { status: 500 }
    );
  }

  const result = await acceptInvite(service, {
    token: parsed.data.token,
    userId: user.id,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    sessionId: result.sessionId,
    projectId: result.projectId,
    role: result.role,
  });
}
