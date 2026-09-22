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
  /** Optional explicit take (plugin-style: this audio is the choir source) */
  recording_id: z.string().uuid().optional(),
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
  let recordingIdHint: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(body || {});
    if (parsed.success) {
      if (parsed.data.mode) mode = parsed.data.mode;
      else if (parsed.data.intensity === "light") mode = "choir_light";
      else if (parsed.data.intensity === "full") mode = "choir_full";
      if (parsed.data.recording_id) recordingIdHint = parsed.data.recording_id;
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

  /**
   * Plugin-style source take resolution:
   * One recorded vocal on a track is enough — no need for pre-planned harmony tasks.
   * Prefer explicit recording_id, then any take on this task, then same-section lead.
   */
  type RecRow = {
    id?: string;
    task_id?: string | null;
    audio_path?: string | null;
    original_audio_path?: string | null;
    content_type?: string | null;
    is_selected?: boolean | null;
    metadata?: Record<string, unknown> | null;
    created_at?: string;
  };
  const pickPath = (r: RecRow | null | undefined): string | null => {
    if (!r) return null;
    const a = typeof r.audio_path === "string" ? r.audio_path.trim() : "";
    const o = typeof r.original_audio_path === "string" ? r.original_audio_path.trim() : "";
    return a || o || null;
  };

  const loadRecById = async (rid: string): Promise<RecRow | null> => {
    const { data } = await service
      .from("recordings")
      .select(
        "id, task_id, project_id, audio_path, original_audio_path, content_type, is_selected, metadata, created_at"
      )
      .eq("id", rid)
      .eq("project_id", projectId)
      .maybeSingle();
    return (data as RecRow) || null;
  };

  let rec: RecRow | null = null;

  // 0) Explicit take id from Console (most reliable)
  if (recordingIdHint) {
    rec = await loadRecById(recordingIdHint);
  }

  // 1) Any take on this track/task
  if (!pickPath(rec)) {
    const any = await service
      .from("recordings")
      .select(
        "id, task_id, audio_path, original_audio_path, content_type, is_selected, metadata, created_at"
      )
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(12);
    const rows = (any.data || []) as RecRow[];
    rec =
      rows.find((r) => r.is_selected && pickPath(r)) ||
      rows.find((r) => pickPath(r)) ||
      null;
  }

  // 2) Metadata / reassigned task links on the project
  if (!pickPath(rec) && projectId) {
    const proj = await service
      .from("recordings")
      .select(
        "id, task_id, audio_path, original_audio_path, content_type, is_selected, metadata, created_at"
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = (proj.data || []) as RecRow[];
    rec =
      rows.find((r) => {
        const meta = r.metadata && typeof r.metadata === "object" ? r.metadata : {};
        const metaTask = String(
          (meta as { task_id?: string }).task_id ||
            (meta as { recording_task_id?: string }).recording_task_id ||
            ""
        );
        return (r.task_id === taskId || metaTask === taskId) && Boolean(pickPath(r));
      }) || null;

    // 3) Same musical window (section) — use a sibling lead take if this row is empty
    if (!pickPath(rec)) {
      const winStart = Number(task.start_ms);
      const winEnd = Number(task.end_ms);
      if (Number.isFinite(winStart)) {
        const { data: siblingTasks } = await service
          .from("recording_tasks")
          .select("id, type, start_ms, end_ms, status")
          .eq("project_id", projectId)
          .limit(80);
        const near = (siblingTasks || []).filter((st) => {
          const s = Number(st.start_ms);
          if (!Number.isFinite(s)) return false;
          if (Math.abs(s - winStart) > 400) return false;
          if (Number.isFinite(winEnd) && st.end_ms != null) {
            return Math.abs(Number(st.end_ms) - winEnd) < 800;
          }
          return true;
        });
        const nearIds = new Set(near.map((st) => String(st.id)));
        // Prefer completed lead on same section
        const leadNear = near.find(
          (st) =>
            String(st.type || "").toLowerCase() === "lead" &&
            /complete|done|recorded|ready/i.test(String(st.status || ""))
        );
        const preferIds = leadNear
          ? [String(leadNear.id), ...[...nearIds].filter((x) => x !== String(leadNear.id))]
          : [...nearIds];
        for (const nid of preferIds) {
          if (nid === taskId) continue;
          const hit = rows.find((r) => r.task_id === nid && pickPath(r));
          if (hit) {
            rec = hit;
            break;
          }
        }
      }
    }
  }

  const vocalPath = pickPath(rec);
  if (!vocalPath) {
    return NextResponse.json(
      {
        error: "No vocal take on this track — record or upload first",
        details: {
          taskId,
          recordingIdHint,
          hint: "Stack uses the saved take on this track (or the lead on the same section). Record in Booth until Saved, refresh Console, then Stack again.",
        },
      },
      { status: 400 }
    );
  }

  let url: string;
  try {
    url = await createSignedDownloadUrl(vocalPath, 3600);
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
    lead = await normalizeToInternalPcm(raw, vocalPath);
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
