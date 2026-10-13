import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { assertSessionPerm, getMemberRole } from "@/lib/sessions/access";

type Ctx = { params: Promise<{ id: string }> };

const PostSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

/** GET — recent chat messages (members only) */
export async function GET(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await ctx.params;
  const role = await getMemberRole(supabase, sessionId, user.id);
  if (!role) {
    return NextResponse.json({ error: "Not a session member" }, { status: 403 });
  }

  const after = new URL(req.url).searchParams.get("after");
  let q = supabase
    .from("ap_session_messages")
    .select("id, session_id, user_id, kind, body, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (after) {
    q = q.gt("created_at", after);
  }

  const { data, error: qErr } = await q;
  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  const userIds = Array.from(
    new Set((data || []).map((m) => m.user_id).filter(Boolean) as string[])
  );
  let names = new Map<string, string>();
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    names = new Map(
      (profiles || []).map((p) => [p.id as string, (p.display_name as string) || "Collaborator"])
    );
  }

  return NextResponse.json({
    messages: (data || []).map((m) => ({
      ...m,
      display_name: m.user_id ? names.get(m.user_id) || "Collaborator" : null,
    })),
  });
}

/** POST — send chat message */
export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await ctx.params;
  const perm = await assertSessionPerm(supabase, sessionId, user.id, "chat");
  if (!perm.ok) {
    return NextResponse.json({ error: perm.error }, { status: perm.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Message required (max 2000 chars)" }, { status: 400 });
  }

  const { data, error: insErr } = await supabase
    .from("ap_session_messages")
    .insert({
      session_id: sessionId,
      user_id: user.id,
      kind: "user",
      body: parsed.data.body,
    })
    .select("id, session_id, user_id, kind, body, created_at")
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ message: data });
}
