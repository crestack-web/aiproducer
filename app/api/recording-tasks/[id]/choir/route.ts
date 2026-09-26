import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl, uploadBuffer, recordingPath } from "@/lib/storage";
import { encodeWavStereoFromMono } from "@/lib/audio/wav";
import { normalizeToInternalPcm } from "@/lib/ap-engine/ingestion/normalize";
import { generateStack, type StackMode } from "@/lib/ap-engine/fullness";
import { resolvePlacementStartMs } from "@/lib/audio/session-timeline";

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
  let mode: StackMode = "choir_light";
  let recordingIdHint: string | null = null;
  /** Client-decoded WAV (browser can decode webm; Vercel often cannot) */
  let clientWav: Buffer | null = null;
  try {
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const modeRaw = form.get("mode");
      const intensityRaw = form.get("intensity");
      const rid = form.get("recording_id");
      if (typeof modeRaw === "string" && ["double", "choir_light", "choir_full", "chorus_lift"].includes(modeRaw)) {
        mode = modeRaw as StackMode;
      } else if (intensityRaw === "light") mode = "choir_light";
      else if (intensityRaw === "full") mode = "choir_full";
      if (typeof rid === "string" && rid.length > 8) recordingIdHint = rid;
      const file = form.get("file");
      if (file && typeof file === "object" && "arrayBuffer" in file) {
        const ab = await (file as File).arrayBuffer();
        if (ab.byteLength > 44) clientWav = Buffer.from(ab);
      }
    } else {
      const body = await req.json().catch(() => ({}));
      const parsed = BodySchema.safeParse(body || {});
      if (parsed.success) {
        if (parsed.data.mode) mode = parsed.data.mode;
        else if (parsed.data.intensity === "light") mode = "choir_light";
        else if (parsed.data.intensity === "full") mode = "choir_full";
        if (parsed.data.recording_id) recordingIdHint = parsed.data.recording_id;
      }
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
   * Plugin-style source take: one saved vocal is enough.
   * Load project recordings with schema-resilient selects (missing columns
   * must not empty the result set — that caused false "No vocal take").
   */
  type RecRow = {
    id?: string;
    task_id?: string | null;
    project_id?: string | null;
    audio_path?: string | null;
    original_audio_path?: string | null;
    content_type?: string | null;
    is_selected?: boolean | null;
    metadata?: Record<string, unknown> | null;
    created_at?: string;
    take_number?: number | null;
    duration_ms?: number | null;
    timeline_start_ms?: number | null;
    timeline_end_ms?: number | null;
    recording_offset_ms?: number | null;
  };

  const pickPath = (r: RecRow | null | undefined): string | null => {
    if (!r) return null;
    const a = typeof r.audio_path === "string" ? r.audio_path.trim() : "";
    const o = typeof r.original_audio_path === "string" ? r.original_audio_path.trim() : "";
    return a || o || null;
  };

  const selects = [
    "id, task_id, project_id, audio_path, original_audio_path, content_type, is_selected, metadata, created_at, take_number, duration_ms, timeline_start_ms, timeline_end_ms, recording_offset_ms",
    "id, task_id, project_id, audio_path, original_audio_path, content_type, is_selected, metadata, created_at, take_number, duration_ms, timeline_start_ms, recording_offset_ms",
    "id, task_id, project_id, audio_path, content_type, is_selected, metadata, created_at, take_number, duration_ms",
    "id, task_id, project_id, audio_path, is_selected, metadata, created_at, take_number",
    "id, task_id, project_id, audio_path, is_selected, metadata, created_at",
    "id, task_id, audio_path, is_selected, created_at",
    "id, task_id, audio_path, created_at",
  ];

  let projectRecs: RecRow[] = [];
  let loadDiag: string[] = [];

  for (const cols of selects) {
    const { data, error } = await service
      .from("recordings")
      .select(cols)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(80);
    if (!error && data) {
      projectRecs = data as RecRow[];
      loadDiag.push(`by_project=${projectRecs.length} cols=${cols.split(",").length}`);
      break;
    }
    if (error) loadDiag.push(`by_project fail: ${error.message}`);
  }

  // Fallback: by this task_id only (project_id may be null on older rows)
  if (projectRecs.length === 0) {
    for (const cols of selects) {
      const { data, error } = await service
        .from("recordings")
        .select(cols)
        .eq("task_id", taskId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (!error && data) {
        projectRecs = data as RecRow[];
        loadDiag.push(`by_task=${projectRecs.length}`);
        break;
      }
      if (error) loadDiag.push(`by_task fail: ${error.message}`);
    }
  }

  // Fallback: all task ids for this project
  if (projectRecs.length === 0) {
    const { data: tasks } = await service
      .from("recording_tasks")
      .select("id")
      .eq("project_id", projectId)
      .limit(100);
    const ids = (tasks || []).map((x) => String(x.id));
    if (ids.length) {
      for (const cols of selects) {
        const { data, error } = await service
          .from("recordings")
          .select(cols)
          .in("task_id", ids)
          .order("created_at", { ascending: false })
          .limit(80);
        if (!error && data) {
          projectRecs = data as RecRow[];
          loadDiag.push(`by_task_ids=${projectRecs.length}`);
          break;
        }
        if (error) loadDiag.push(`by_task_ids fail: ${error.message}`);
      }
    }
  }

  let rec: RecRow | null = null;

  // 0) Explicit recording_id from Console
  if (recordingIdHint) {
    rec =
      projectRecs.find((r) => r.id === recordingIdHint && pickPath(r)) ||
      null;
    if (!rec) {
      for (const cols of selects) {
        const { data } = await service
          .from("recordings")
          .select(cols)
          .eq("id", recordingIdHint)
          .maybeSingle();
        if (data && pickPath(data as RecRow)) {
          rec = data as RecRow;
          break;
        }
      }
    }
  }

  // 1) Takes on this track
  if (!pickPath(rec)) {
    const onTask = projectRecs.filter((r) => r.task_id === taskId && pickPath(r));
    rec =
      onTask.find((r) => r.is_selected) ||
      onTask[0] ||
      null;
  }

  // 2) Metadata link
  if (!pickPath(rec)) {
    rec =
      projectRecs.find((r) => {
        const meta = r.metadata && typeof r.metadata === "object" ? r.metadata : {};
        const metaTask = String(
          (meta as { task_id?: string }).task_id ||
            (meta as { recording_task_id?: string }).recording_task_id ||
            ""
        );
        return metaTask === taskId && Boolean(pickPath(r));
      }) || null;
  }

  // 3) Same section window — sibling lead with audio
  if (!pickPath(rec)) {
    const winStart = Number(task.start_ms);
    if (Number.isFinite(winStart)) {
      const { data: siblingTasks } = await service
        .from("recording_tasks")
        .select("id, type, start_ms, end_ms, status")
        .eq("project_id", projectId)
        .limit(100);
      const near = (siblingTasks || []).filter((st) => {
        const s = Number(st.start_ms);
        return Number.isFinite(s) && Math.abs(s - winStart) <= 500;
      });
      const ordered = [
        ...near.filter((st) => String(st.type || "").toLowerCase() === "lead"),
        ...near.filter((st) => String(st.type || "").toLowerCase() !== "lead"),
      ];
      for (const st of ordered) {
        if (String(st.id) === taskId) continue;
        const hit = projectRecs.find((r) => r.task_id === st.id && pickPath(r));
        if (hit) {
          rec = hit;
          loadDiag.push(`sibling_task=${st.id}`);
          break;
        }
      }
    }
  }

  // 4) Last resort: any playable take on the project (plugin: use whatever vocal exists)
  if (!pickPath(rec)) {
    const anyPlayable = projectRecs.find((r) => pickPath(r));
    if (anyPlayable) {
      rec = anyPlayable;
      loadDiag.push(`fallback_any_project_take=${anyPlayable.id}`);
    }
  }

  const vocalPath = pickPath(rec);

  // Prefer client-provided WAV (decoded in browser from webm/opus). Fall back to R2 + server decode.
  let raw: Buffer | null = clientWav && clientWav.length > 44 ? clientWav : null;
  let pathHint = clientWav ? "client-lead.wav" : vocalPath || "take.bin";

  if (!raw) {
    if (!vocalPath) {
      return NextResponse.json(
        {
          error: "No vocal take on this track — record or upload first",
          details: {
            taskId,
            recordingIdHint,
            projectId,
            recordings_found: projectRecs.length,
            task_ids_with_audio: [
              ...new Set(
                projectRecs.filter((r) => pickPath(r)).map((r) => r.task_id).filter(Boolean)
              ),
            ].slice(0, 12),
            loadDiag,
            hint: "If Produce worked on this song, takes exist — refresh Console and Stack the track that shows a waveform.",
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
      return NextResponse.json(
        {
          error: "Could not load vocal take from storage",
          details: { path: vocalPath, recording_id: rec?.id },
        },
        { status: 500 }
      );
    }

    const audioRes = await fetch(url);
    if (!audioRes.ok) {
      return NextResponse.json(
        {
          error: "Could not download vocal take",
          details: { status: audioRes.status, path: vocalPath },
        },
        { status: 500 }
      );
    }
    raw = Buffer.from(await audioRes.arrayBuffer());
    pathHint = vocalPath;
  }

  let lead;
  try {
    lead = await normalizeToInternalPcm(raw, pathHint);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[choir] decode", msg);
    return NextResponse.json(
      {
        error: "Could not decode vocal audio",
        details: {
          reason: msg,
          pathHint,
          bytes: raw?.length ?? 0,
          usedClientWav: Boolean(clientWav),
          hint:
            /ffmpeg|WAV/i.test(msg)
              ? "This take needs browser decode — hard-refresh Console and try Stack again (client sends WAV)."
              : msg,
        },
      },
      { status: 500 }
    );
  }

  const leadPcm = lead.pcm;

  // Place choir on the SAME timeline window as the source vocal (not intro / 0).
  const srcMeta =
    rec?.metadata && typeof rec.metadata === "object" && !Array.isArray(rec.metadata)
      ? (rec.metadata as Record<string, unknown>)
      : {};
  const offsetFromMeta =
    typeof srcMeta.recording_offset_ms === "number"
      ? (srcMeta.recording_offset_ms as number)
      : null;
  const placementFromMeta =
    typeof srcMeta.placement_start_ms === "number"
      ? (srcMeta.placement_start_ms as number)
      : null;
  const sourcePlaceStart = resolvePlacementStartMs({
    sectionStartMs:
      typeof task.start_ms === "number"
        ? (task.start_ms as number)
        : typeof rec?.timeline_start_ms === "number"
          ? rec.timeline_start_ms
          : null,
    recordingOffsetMs:
      typeof rec?.recording_offset_ms === "number"
        ? rec.recording_offset_ms
        : offsetFromMeta,
    timelineStartMs:
      typeof rec?.timeline_start_ms === "number" ? rec.timeline_start_ms : null,
    placementStartMs: placementFromMeta,
  });
  const sourceDurationMs =
    typeof rec?.duration_ms === "number" && rec.duration_ms > 0
      ? Math.round(rec.duration_ms)
      : lead.durationMs || Math.round((leadPcm.left.length / (leadPcm.sampleRate || 44100)) * 1000);
  const sourcePlaceEnd =
    typeof rec?.timeline_end_ms === "number" && rec.timeline_end_ms > sourcePlaceStart
      ? Math.round(rec.timeline_end_ms)
      : typeof task.end_ms === "number" && (task.end_ms as number) > sourcePlaceStart
        ? Math.round(task.end_ms as number)
        : sourcePlaceStart + sourceDurationMs;

  // Must match source vocal placement — never default to 0/intro when source is later.
  const startMs = sourcePlaceStart;
  const endMs =
    sourcePlaceEnd > startMs
      ? sourcePlaceEnd
      : startMs + Math.max(sourceDurationMs, 1000);

  let voices: ReturnType<typeof generateStack> = [];
  try {
    voices = generateStack({
      lead: leadPcm,
      mode,
      startMs: sourcePlaceStart,
    });
  } catch (genErr) {
    console.error("[choir] generateStack failed", genErr);
    return NextResponse.json(
      {
        error: "Could not build choir",
        detail: genErr instanceof Error ? genErr.message : String(genErr),
      },
      { status: 500 }
    );
  }

  if (!voices.length) {

    return NextResponse.json(
      {
        error: "Could not generate choir voices",
        details: { mode, reason: "Choir generator produced no voices" },
      },
      { status: 500 }
    );
  }

  const created: { id: string; type: string; title: string }[] = [];
  const saveErrors: string[] = [];

  const mapTaskType = (role: string): string => {
    const r = (role || "").toLowerCase();
    if (r.includes("double")) return "double";
    if (r.includes("adlib") || r.includes("ad-lib")) return "adlib";
    if (r.includes("harmony") || r.includes("choir")) return "harmony";
    return "harmony";
  };

  async function insertTask(base: Record<string, unknown>): Promise<{ id: string } | null> {
    const attempts: Record<string, unknown>[] = [
      base,
      {
        project_id: base.project_id,
        type: base.type,
        title: base.title,
        instruction: base.instruction,
        status: "pending",
        required: false,
        start_ms: base.start_ms,
        end_ms: base.end_ms,
        metadata: base.metadata,
      },
      {
        project_id: base.project_id,
        type: base.type,
        instruction: base.instruction || "",
        status: "pending",
        required: false,
        start_ms: base.start_ms,
        end_ms: base.end_ms,
      },
      {
        project_id: base.project_id,
        type: base.type,
        instruction: String(base.instruction || "AP choir layer"),
        status: "pending",
      },
    ];
    for (const attempt of attempts) {
      const { data, error } = await service
        .from("recording_tasks")
        .insert(attempt)
        .select("id")
        .single();
      if (!error && data?.id) return { id: String(data.id) };
      if (error) {
        // strip unknown column and retry once more inline
        const msg = error.message || "";
        const m = msg.match(/'([^']+)' column/i) || msg.match(/column "([^"]+)"/i);
        if (m?.[1] && m[1] in attempt) {
          const copy = { ...attempt };
          delete copy[m[1]];
          const retry = await service.from("recording_tasks").insert(copy).select("id").single();
          if (!retry.error && retry.data?.id) return { id: String(retry.data.id) };
          saveErrors.push(`task:${retry.error?.message || msg}`);
        } else {
          saveErrors.push(`task:${msg}`);
        }
      }
    }
    return null;
  }

  async function insertRecording(row: Record<string, unknown>): Promise<boolean> {
    const attempts: Record<string, unknown>[] = [
      { ...row, take_number: 1, is_selected: true },
      { ...row, take_number: 1 },
      {
        task_id: row.task_id,
        project_id: row.project_id,
        audio_path: row.audio_path,
        status: "ready",
        take_number: 1,
        duration_ms: row.duration_ms,
        timeline_start_ms: row.timeline_start_ms,
        timeline_end_ms: row.timeline_end_ms,
        recording_offset_ms: row.recording_offset_ms,
        metadata: row.metadata,
      },
      {
        task_id: row.task_id,
        project_id: row.project_id,
        audio_path: row.audio_path,
        status: "ready",
        take_number: 1,
        duration_ms: row.duration_ms,
        metadata: row.metadata,
      },
      {
        task_id: row.task_id,
        project_id: row.project_id,
        audio_path: row.audio_path,
        status: "uploaded",
        take_number: 1,
      },
    ];
    for (const attempt of attempts) {
      const { error } = await service.from("recordings").insert(attempt);
      if (!error) return true;
      const msg = error.message || "";
      const m = msg.match(/'([^']+)' column/i) || msg.match(/column "([^"]+)"/i);
      if (m?.[1] && m[1] in attempt) {
        const copy = { ...attempt };
        delete copy[m[1]];
        const { error: e2 } = await service.from("recordings").insert(copy);
        if (!e2) return true;
        saveErrors.push(`rec:${e2.message}`);
      } else {
        saveErrors.push(`rec:${msg}`);
      }
    }
    return false;
  }

  for (const v of voices) {
    const title = v.label || "Choir layer";
    const type = mapTaskType(v.role);

    const taskRow: Record<string, unknown> = {
      project_id: task.project_id,
      type,
      title,
      instruction: `AP choir layer generated from ${(task.title as string) || "lead"} — still your voice.`,
      status: "pending",
      required: false,
      recommendation: "optional",
      selected_in_plan: true,
      active: true,
      start_ms: startMs,
      end_ms: endMs,
      priority: 0,
      metadata: {
        choir_source_task_id: taskId,
        choir_source_recording_id: rec?.id ?? null,
        choir_role: v.role,
        stack_mode: mode,
        generated_by: "ap_choir",
        placement_start_ms: startMs,
        section_label:
          (task.section_label as string) ||
          (task.section_type as string) ||
          (srcMeta.section_label as string) ||
          null,
      },
    };
    if (task.section_id) taskRow.section_id = task.section_id;

    const newTask = await insertTask(taskRow);
    if (!newTask?.id) {
      saveErrors.push(`no_task_id for ${title}`);
      continue;
    }

    const n = Math.min(v.pcm.left.length, v.pcm.right.length);
    if (n < 256) {
      saveErrors.push(`empty_pcm ${title} n=${n}`);
      continue;
    }
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) {
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
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[choir] upload", msg);
      saveErrors.push(`upload:${msg}`);
      continue;
    }

    const durationMs = Math.round((n / (v.pcm.sampleRate || 44100)) * 1000);
    const okRec = await insertRecording({
      task_id: newTask.id,
      project_id: task.project_id,
      audio_path: storagePath,
      status: "ready",
      content_type: "audio/wav",
      duration_ms: durationMs,
      timeline_start_ms: startMs,
      timeline_end_ms: endMs,
      recording_offset_ms: 0,
      is_selected: true,
      metadata: {
        generated_by: "ap_choir",
        choir_role: v.role,
        stack_mode: mode,
        placement_start_ms: startMs,
        choir_source_task_id: taskId,
        choir_source_recording_id: rec?.id ?? null,
      },
    });
    if (!okRec) {
      saveErrors.push(`recording_insert_failed ${title}`);
      continue;
    }

    await service
      .from("recording_tasks")
      .update({ status: "completed" })
      .eq("id", newTask.id);

    created.push({
      id: newTask.id,
      type,
      title,
    });
  }

  if (!created.length) {
    return NextResponse.json(
      {
        error: "Could not save choir layers",
        details: {
          voices: voices.length,
          saveErrors: saveErrors.slice(0, 12),
          hint: "Task or recording insert failed — see saveErrors (schema or R2 upload).",
        },
      },
      { status: 500 }
    );
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
