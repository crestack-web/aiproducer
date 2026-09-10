import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";

const CreateProjectSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  genre: z.string().max(60).optional(),
  mood: z.string().max(60).optional(),
  tempo: z.number().int().min(40).max(200).optional(),
  prompt: z.string().max(2000).optional(),
});

/** POST /api/projects — create a project */
export async function POST(req: Request) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error: dbError } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      title: parsed.data.title ?? "Untitled",
      genre: parsed.data.genre ?? null,
      mood: parsed.data.mood ?? null,
      tempo: parsed.data.tempo ?? null,
      prompt: parsed.data.prompt ?? null,
      status: "draft",
    })
    .select()
    .single();

  if (dbError) {
    console.error("create project", dbError);
    return NextResponse.json({ error: "Could not create project" }, { status: 500 });
  }

  return NextResponse.json({ project: data }, { status: 201 });
}

/** GET /api/projects — list current user's projects */
export async function GET() {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error: dbError } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (dbError) {
    console.error("list projects", dbError);
    return NextResponse.json({ error: "Could not list projects" }, { status: 500 });
  }

  const projects = data ?? [];
  const ids = projects.map((p: { id: string }) => p.id);
  const mastered = new Set<string>();
  if (ids.length) {
    const { data: songs } = await supabase
      .from("songs")
      .select("project_id")
      .in("project_id", ids);
    for (const s of songs || []) {
      if (s.project_id) mastered.add(s.project_id as string);
    }
    const { data: versions } = await supabase
      .from("audio_versions")
      .select("project_id")
      .eq("kind", "master")
      .in("project_id", ids);
    for (const v of versions || []) {
      if (v.project_id) mastered.add(v.project_id as string);
    }
  }

  const enriched = projects.map((p: { id: string; status?: string }) => {
    const hasMaster = mastered.has(p.id);
    const status =
      hasMaster && p.status !== "complete" && p.status !== "completed"
        ? "complete"
        : p.status;
    return { ...p, status, has_master: hasMaster };
  });

  return NextResponse.json({ projects: enriched });
}
