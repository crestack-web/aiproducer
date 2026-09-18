import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl, uploadBuffer, recordingPath } from "@/lib/storage";
import { encodeWavStereoFromMono } from "@/lib/audio/wav";
import { normalizeToInternalPcm } from "@/lib/ap-engine/ingestion/normalize";
import { generateStack, type StackMode } from "@/lib/ap-engine/fullness";

type Ctx = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  /** Preferred: double | choir_light | choir_full | chorus_lift */
  mode: z.enum(["double", "choir_light", "choir_full", "chorus_lift"]).optional(),
  /** @deprecated — maps to choir_light / choir_full */
  intensity: z.enum(["light", "full"]).optional(),
});

/**
 * POST /api/recording-tasks/:id/choir
 * Build a choir from this vocal take (artist's voice only) and
 * attach new plan layers with the generated WAVs.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: taskId } = await ctx.params;
  let mode: StackMode = "choir_full";
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(body || {});
    if (parsed.success) {
      if (parsed.data.mode) mode = parsed.data.mode;
      else if (parsed.data.intensity === "light") mode = "choir_light";
      else if (parsed.data.intensity === "full") mode = "choir_full";
    }
  } catch {
    /* default choir_full */
  }

  const service = createServiceClient();
  // Schema-resilient: older DBs lack section_type / section_label columns.
  // Selecting missing columns makes PostgREST fail the whole query → false "Task not found".
  let task: Record<string, unknown> | null = null;
  {
    const full = await service
      .from("recording_tasks")
      .select(
        "id, project_id, type, title, start_ms, end_ms, status, metadata, section_type, section_label"
      )
      .eq("id", taskId)
      .maybeSingle();
    if (full.data) {
      task = full.data as Record<string, unknown>;
    } else if (full.error) {
      console.warn("[choir] full select failed, retrying slim", full.error.message);
      const slim = await service
        .from("recording_tasks")
        .select("id, project_id, type, title, start_ms, end_ms, status, metadata")
        .eq("id", taskId)
        .maybeSingle();
      if (slim.error) {
        console.error("[choir] task lookup", slim.error.message, { taskId });
      }
      task = (slim.data as Record<string, unknown> | null) || null;
    }
  }

  if (!task?.id) {
    // Last resort: resolve via recording that points at this task_id
    const { data: viaRec } = await service
      .from("recordings")
      .select("task_id, project_id")
      .eq("task_id", taskId)
      .limit(1)
      .maybeSingle();
    if (viaRec?.task_id) {
      const slim = await service
        .from("recording_tasks")
        .select("id, project_id, type, title, start_ms, end_ms, status, metadata")
        .eq("id", viaRec.task_id)
        .maybeSingle();
      task = (slim.data as Record<string, unknown> | null) || null;
    }
  }

  if (!task?.id) {
    return NextResponse.json(
      {
        error: "Task not found",
        details: { taskId, hint: "Refresh Console and pick a recorded vocal track." },
      },
      { status: 404 }
    );
  }

  if (mode === "chorus_lift") {
    const meta =
      task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
        ? (task.metadata as Record<string, unknown>)
        : {};
    const sectionBlob = [
      task.section_type,
      task.section_label,
      meta.section_type,
      meta.section_label,
      meta.section,
      meta.sectionLabel,
      task.title,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const looksChorus =
      /chorus|hook|drop|refrain/.test(sectionBlob) ||
      String(task.type || "").toLowerCase() === "lead";
    // Soft gate: still allow on lead even if label missing; warn via message
    if (!looksChorus && !/chorus|hook/.test(sectionBlob)) {
      // Prefer not blocking artists — apply light stack and tag
      mode = "choir_light";
    }
  }

  const projectId = String(task.project_id || "");
  const { data: project } = await service
    .from("projects")
    .select("id, user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Prefer selected take, then newest with audio
  let rec: { id?: string; audio_path?: string | null; content_type?: string | null } | null =
    null;
  {
    const sel = await service
      .from("recordings")
      .select("id, audio_path, content_type, is_selected, created_at")
      .eq("task_id", taskId)
      .eq("is_selected", true)
      .not("audio_path", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sel.data?.audio_path) {
      rec = sel.data;
    } else {
      // is_selected column may not exist — ignore error and fall through
      const any = await service
        .from("recordings")
        .select("id, audio_path, content_type")
        .eq("task_id", taskId)
        .not("audio_path", "is", null)
        .order("created_at", { ascending: false })
        .limit(5);
      const rows = any.data || [];
      rec = rows.find((r) => r.audio_path) || null;
    }
  }
  if (!rec?.audio_path) {
    return NextResponse.json(
      { error: "No vocal take on this track — record or upload first" },
      { status: 400 }
    );
  }

  let url: string;
  try {
    url = await createSignedDownloadUrl(rec.audio_path, 3600);
  } catch (e) {
    console.error("[choir] signed url", e);
    return NextResponse.json({ error: "Could not load vocal take" }, { status: 500 });
  }

  const audioRes = await fetch(url);
  if (!audioRes.ok) {
    return NextResponse.json({ error: "Could not download vocal take" }, { status: 500 });
  }
  const raw = Buffer.from(await audioRes.arrayBuffer());

  let lead;
  try {
    lead = await normalizeToInternalPcm(raw, rec.audio_path);
  } catch (e) {
    console.error("[choir] decode", e);
    return NextResponse.json({ error: "Could not decode vocal audio" }, { status: 500 });
  }

  const leadPcm = lead.pcm;

  const voices = generateStack({
    lead: leadPcm,
    mode,
    startMs: Number(task.start_ms) || 0,
  });

  if (!voices.length) {
    return NextResponse.json({ error: "Choir generator produced no voices" }, { status: 500 });
  }

  const created: { id: string; type: string; title: string }[] = [];
  const startMs = Number(task.start_ms) || 0;
  const endMs = Number(task.end_ms) || startMs + 8000;

  for (const v of voices) {
    const title = v.label;
    const type = v.role === "double" ? "double" : v.role;

    const row: Record<string, unknown> = {
      project_id: task.project_id,
      type,
      title,
      instruction: `AP choir layer generated from ${(task.title as string) || "lead"} — still your voice.`,
      status: "pending",
      required: false,
      recommendation: "optional",
      selected_in_plan: true,
      active: false,
      start_ms: startMs,
      end_ms: endMs,
      priority: 0,
      metadata: {
        choir_source_task_id: taskId,
        choir_role: v.role,
        stack_mode: mode,
        generated_by: "ap_choir",
      },
    };

    let newTask: Record<string, unknown> | null = null;
    {
      const res = await service.from("recording_tasks").insert(row).select("*").single();
      newTask = res.data as Record<string, unknown> | null;
      if (res.error) {
        const slim = {
          project_id: task.project_id,
          type,
          title,
          instruction: row.instruction,
          status: "pending",
          required: false,
          start_ms: startMs,
          end_ms: endMs,
        };
        const res2 = await service.from("recording_tasks").insert(slim).select("*").single();
        newTask = res2.data as Record<string, unknown> | null;
        if (res2.error) {
          console.error("[choir] task insert", res2.error);
          continue;
        }
      }
    }
    if (!newTask?.id) continue;

    // Mix L/R to mono-ish for encode helper: average
    const n = Math.min(v.pcm.left.length, v.pcm.right.length);
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // pan: -1..1 → weights
      const pan = Math.max(-1, Math.min(1, v.pan));
      const lW = pan <= 0 ? 1 : 1 - pan;
      const rW = pan >= 0 ? 1 : 1 + pan;
      mono[i] = (v.pcm.left[i] * lW + v.pcm.right[i] * rW) * 0.5;
    }
    const wav = encodeWavStereoFromMono(mono, v.pcm.sampleRate);

    const storagePath = recordingPath(
      user.id,
      task.project_id as string,
      String(newTask.id),
      1,
      "wav"
    );
    try {
      await uploadBuffer(storagePath, wav, "audio/wav");
    } catch (e) {
      console.error("[choir] upload", e);
      continue;
    }

    const { error: recErr } = await service.from("recordings").insert({
      task_id: newTask.id,
      project_id: task.project_id,
      audio_path: storagePath,
      status: "ready",
      content_type: "audio/wav",
      metadata: { generated_by: "ap_choir", choir_role: v.role },
    });
    if (recErr) {
      console.error("[choir] recording insert", recErr);
      continue;
    }

    await service
      .from("recording_tasks")
      .update({ status: "completed" })
      .eq("id", newTask.id);

    created.push({
      id: newTask.id as string,
      type: type as string,
      title,
    });
  }

  if (!created.length) {
    return NextResponse.json({ error: "Could not save choir layers" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    source_task_id: taskId,
    mode,
    layers: created,
    message:
      mode === "double"
        ? `AP added ${created.length} double layers from your take.`
        : mode === "chorus_lift"
          ? `AP lifted this section with ${created.length} stack layers.`
          : `AP built a ${created.length}-voice choir (${mode}) from your take.`,
  });
}
