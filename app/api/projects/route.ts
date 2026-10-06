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
  const withBeat = new Set<string>();
  const beatSourceByProject = new Map<string, string>();
  type MasterRow = {
    job_id: string;
    version: number;
    audio_path: string;
    completed_at: string | null;
    engine_version: string | null;
  };
  const mastersByProject = new Map<string, MasterRow[]>();
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
    // Completed produce jobs with a master path count even if songs/audio_versions insert failed
    const { data: doneJobs } = await supabase
      .from("jobs")
      .select("project_id, status, output_data")
      .eq("type", "PRODUCE_SONG")
      .in("status", ["complete", "completed"])
      .in("project_id", ids);
    for (const j of doneJobs || []) {
      const pid = j.project_id as string | null;
      if (!pid) continue;
      const out =
        j.output_data && typeof j.output_data === "object"
          ? (j.output_data as Record<string, unknown>)
          : {};
      const path =
        (typeof out.master_storage_path === "string" && out.master_storage_path) ||
        (typeof out.master_path === "string" && out.master_path) ||
        (typeof out.masterPath === "string" && out.masterPath) ||
        "";
      if (path) mastered.add(pid);
    }

    // Per-produce masters for Library Songs (versioned rows)
    {
      const { data: allDone } = await supabase
        .from("jobs")
        .select("id, project_id, status, output_data, completed_at, created_at")
        .eq("type", "PRODUCE_SONG")
        .in("status", ["complete", "completed"])
        .in("project_id", ids)
        .order("created_at", { ascending: true });
      const byProj = new Map<string, typeof allDone>();
      for (const j of allDone || []) {
        const pid = j.project_id as string;
        if (!pid) continue;
        const list = byProj.get(pid) || [];
        list.push(j);
        byProj.set(pid, list);
      }
      for (const [pid, list] of byProj) {
        const rows: MasterRow[] = [];
        let ver = 0;
        for (const j of list || []) {
          const out =
            j.output_data && typeof j.output_data === "object"
              ? (j.output_data as Record<string, unknown>)
              : {};
          const path =
            (typeof out.master_storage_path === "string" && out.master_storage_path) ||
            (typeof out.master_path === "string" && out.master_path) ||
            (typeof out.masterPath === "string" && out.masterPath) ||
            "";
          if (!path) continue;
          ver += 1;
          rows.push({
            job_id: String(j.id),
            version: ver,
            audio_path: path,
            completed_at: (j.completed_at as string) || (j.created_at as string) || null,
            engine_version:
              (typeof out.engineVersion === "string" && out.engineVersion) ||
              (typeof out.engine_version === "string" && out.engine_version) ||
              null,
          });
        }
        if (rows.length) {
          mastersByProject.set(pid, rows);
          mastered.add(pid);
        }
      }
    }
    const { data: beats } = await supabase
      .from("beats")
      .select("project_id, source, metadata, created_at")
      .in("project_id", ids)
      .order("created_at", { ascending: false });
    for (const b of beats || []) {
      const pid = b.project_id as string | null;
      if (!pid) continue;
      withBeat.add(pid);
      if (beatSourceByProject.has(pid)) continue;
      const meta = (b.metadata && typeof b.metadata === "object" ? b.metadata : {}) as {
        source?: string;
        provider?: string;
      };
      const raw =
        (typeof b.source === "string" && b.source) ||
        (typeof meta.source === "string" && meta.source) ||
        (meta.provider ? "ai" : "") ||
        "";
      const normalized =
        raw === "upload" || raw === "custom"
          ? "upload"
          : raw === "ai" ||
              raw === "elevenlabs" ||
              raw === "replicate" ||
              raw === "mock" ||
              Boolean(meta.provider)
            ? "ai"
            : raw || "unknown";
      beatSourceByProject.set(pid, normalized);
    }
  }

  const enriched = projects.map((p: { id: string; status?: string }) => {
    const masters = mastersByProject.get(p.id) || [];
    const hasMaster = mastered.has(p.id) || masters.length > 0;
    const hasBeat = withBeat.has(p.id);
    const status =
      hasMaster && p.status !== "complete" && p.status !== "completed"
        ? "complete"
        : p.status;
    const beat_source = beatSourceByProject.get(p.id) || (hasBeat ? "unknown" : null);
    return {
      ...p,
      status,
      has_master: hasMaster,
      has_beat: hasBeat,
      beat_source,
      masters,
      master_count: masters.length,
    };
  });

  return NextResponse.json({ projects: enriched });
}
