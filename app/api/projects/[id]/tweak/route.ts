import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isStoragePath, resolveAudioUrl, getStorageBucket } from "@/lib/storage";
import { decodeWav } from "@/lib/audio/wav";
import { convertBufferToWav } from "@/lib/audio/convert-to-wav";
import { placeOnTimeline } from "@/lib/ap-engine/ingestion/normalize";
import { sumStereo } from "@/lib/ap-engine/mix/balance";
import { applyGainStereo, peakOf } from "@/lib/ap-engine/dsp";
import type { PcmStereo } from "@/lib/ap-engine/types";
import { exportWav } from "@/lib/ap-engine/render/export-wav-mp3";
import {
  interpretTweakPrompt,
  buildSectionAdjustments,
  applyAdjustmentsToMaster,
  parseHistory,
  pushVersion,
  revertTo,
  currentAdjustments,
  runIterationAgent,
  applyTasteLog,
  runCommercialReadiness,
  type SectionHint,
} from "@/lib/ap-engine/tweak";
import { promptToToolCalls, applyToolCalls, applyToolCallsToRegion } from "@/lib/ap-engine/toolkit";


type Body = {
  action?: "tweak" | "revert" | "status" | "commercial";
  prompt?: string;
  playbackMs?: number | null;
  version?: number;
  variationId?: string | null;
  /** Console track scope — structured id, not text inference */
  task_id?: string | null;
  scope?: "song" | "track" | "section" | null;
};

/** Tools that are meaningful on an isolated vocal take (not full-mix context). */
const TAKE_SAFE_TOOLS = new Set([
  "eq",
  "compressor",
  "reverb",
  "delay",
  "saturation",
  "deesser",
  "filter",
  "stereo_width",
]);
// limiter: full-mix loudness tool — peak safety is applied in applyToolCalls instead

async function loadSectionHints(
  service: ReturnType<typeof createServiceClient>,
  projectId: string
): Promise<SectionHint[]> {
  const { data: sections } = await service
    .from("song_sections")
    .select("id, label, type, start_ms, end_ms")
    .eq("project_id", projectId)
    .order("start_ms", { ascending: true });

  if (sections?.length) {
    return sections.map((s) => ({
      id: String(s.id),
      label: String(s.label || s.type || "section"),
      startMs: Number(s.start_ms) || 0,
      endMs: Number(s.end_ms) || (Number(s.start_ms) || 0) + 30000,
    }));
  }

  // Fallback from recording tasks
  const { data: tasks } = await service
    .from("recording_tasks")
    .select("id, type, title, start_ms, end_ms, section_id")
    .eq("project_id", projectId)
    .order("start_ms", { ascending: true });

  const leads = (tasks || []).filter((t) =>
    String(t.type || "").toLowerCase().includes("lead")
  );
  return leads.map((t) => ({
    id: String(t.section_id || t.id),
    label: String(t.title || t.type || "section"),
    startMs: Number(t.start_ms) || 0,
    endMs: Number(t.end_ms) || (Number(t.start_ms) || 0) + 30000,
  }));
}

async function loadMasterBuffer(
  service: ReturnType<typeof createServiceClient>,
  projectId: string
): Promise<{ buffer: Buffer; path: string } | null> {
  const candidates: string[] = [];

  // 1) audio_versions master / mix (newest first)
  const { data: versions } = await service
    .from("audio_versions")
    .select("audio_path, kind, version")
    .eq("project_id", projectId)
    .in("kind", ["working_mix", "master", "mix", "preview_mix", "tweak"])
    .order("version", { ascending: false })
    .limit(5);
  for (const v of versions || []) {
    if (v?.audio_path && isStoragePath(v.audio_path) && !String(v.audio_path).startsWith("mock://")) {
      candidates.push(String(v.audio_path));
    }
  }

  // 2) songs table
  const { data: songs } = await service
    .from("songs")
    .select("audio_path, master_path, storage_path, metadata")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(3);
  for (const song of songs || []) {
    for (const key of ["master_path", "audio_path", "storage_path"] as const) {
      const path = (song as Record<string, unknown>)[key];
      if (typeof path === "string" && isStoragePath(path) && !path.startsWith("mock://")) {
        candidates.push(path);
      }
    }
    const meta = (song as { metadata?: Record<string, unknown> })?.metadata;
    if (meta && typeof meta.master_storage_path === "string") {
      candidates.push(meta.master_storage_path);
    }
  }

  // 3) complete produce jobs output_data
  const { data: jobs } = await service
    .from("jobs")
    .select("output_data, status, created_at")
    .eq("project_id", projectId)
    .in("status", ["complete", "completed", "done"])
    .order("created_at", { ascending: false })
    .limit(5);
  for (const job of jobs || []) {
    const od = (job.output_data || {}) as Record<string, unknown>;
    for (const key of ["master_storage_path", "master_path", "audio_path", "mix_storage_path"]) {
      const path = od[key];
      if (typeof path === "string" && isStoragePath(path) && !path.startsWith("mock://")) {
        candidates.push(path);
      }
    }
  }

  // 4) project metadata
  const { data: project } = await service
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const pmeta = (project?.metadata || {}) as Record<string, unknown>;
  for (const key of ["tweak_latest_path", "tweak_original_master_path", "master_storage_path", "master_path"]) {
    const path = pmeta[key];
    if (typeof path === "string" && isStoragePath(path) && !path.startsWith("mock://")) {
      candidates.push(path);
    }
  }

  // Deduplicate preserving order
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  for (const path of unique) {
    try {
      const signed = await resolveAudioUrl(path, 180);
      if (!signed) continue;
      const res = await fetch(signed);
      if (!res.ok) continue;
      const ab = await res.arrayBuffer();
      if (ab.byteLength < 1000) continue;
      return { buffer: Buffer.from(ab), path };
    } catch {
      /* try next */
    }
  }

  return null;
}


/**
 * Lightweight Console working mix — beat + placed selected takes only.
 * Skips restoration, Producer Mind fullness, pitch/time, and mastering.
 * Used so song-wide prompts work before a full Produce.
 */
async function buildWorkingMix(
  service: ReturnType<typeof createServiceClient>,
  projectId: string
): Promise<{ buffer: Buffer; path: string; layerCount: number; log: string[] } | null> {
  const log: string[] = [];
  const { data: beat } = await service
    .from("beats")
    .select("audio_path, duration_ms")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!beat?.audio_path) {
    log.push("working_mix: no beat");
    return null;
  }

  async function loadPcm(path: string): Promise<PcmStereo | null> {
    try {
      const { data: blob, error } = await service.storage.from(getStorageBucket()).download(path);
      if (error || !blob) return null;
      const raw = Buffer.from(await blob.arrayBuffer());
      const wav = (await convertBufferToWav(raw, path)).buffer;
      const decoded = decodeWav(wav);
      const ch = decoded.channels || 1;
      const samples = decoded.samples;
      const sr = decoded.sampleRate;
      const frames = Math.floor(samples.length / Math.max(1, ch));
      if (ch >= 2) {
        const left = new Float32Array(frames);
        const right = new Float32Array(frames);
        for (let i = 0; i < frames; i++) {
          left[i] = samples[i * ch] || 0;
          right[i] = samples[i * ch + 1] || 0;
        }
        return { left, right, sampleRate: sr };
      }
      return { left: samples, right: new Float32Array(samples), sampleRate: sr };
    } catch (e) {
      log.push(`load fail ${path}: ${e instanceof Error ? e.message : "err"}`);
      return null;
    }
  }

  const beatPcm = await loadPcm(String(beat.audio_path));
  if (!beatPcm) return null;
  log.push("working_mix:beat");

  const { data: tasks } = await service
    .from("recording_tasks")
    .select("id, type, start_ms, end_ms, status")
    .eq("project_id", projectId);

  let mix: PcmStereo = {
    left: new Float32Array(beatPcm.left),
    right: new Float32Array(beatPcm.right),
    sampleRate: beatPcm.sampleRate,
  };
  // slightly reduce beat under vocals
  applyGainStereo(mix, 0.85);

  let layerCount = 0;
  for (const task of tasks || []) {
    const st = String(task.status || "").toLowerCase();
    if (st === "skipped" || st === "cancelled") continue;
    const { data: recs } = await service
      .from("recordings")
      .select("audio_path, is_selected, take_number")
      .eq("task_id", task.id)
      .order("take_number", { ascending: false });
    const rec =
      (recs || []).find((r) => r.is_selected && r.audio_path) ||
      (recs || []).find((r) => r.audio_path) ||
      null;
    if (!rec?.audio_path) continue;
    const takePcm = await loadPcm(String(rec.audio_path));
    if (!takePcm) continue;
    const startMs = Number(task.start_ms) || 0;
    const placed = placeOnTimeline(takePcm, mix, startMs);
    mix = sumStereo(placed.vocal, mix);
    layerCount += 1;
    log.push(`working_mix:layer task=${task.id} type=${task.type || "?"} @${startMs}ms`);
  }

  if (layerCount === 0) {
    log.push("working_mix: beat only (no takes yet)");
  }

  const peak = Math.max(peakOf(mix.left), peakOf(mix.right));
  if (peak > 0.89) applyGainStereo(mix, 0.89 / peak);

  const wavOut = exportWav(mix);
  const outPath = `projects/${projectId}/masters/working-mix-${Date.now()}.wav`;
  const { error: upErr } = await service.storage
    .from(getStorageBucket())
    .upload(outPath, wavOut, { contentType: "audio/wav", upsert: true });
  if (upErr) {
    log.push(`upload failed: ${upErr.message}`);
    return null;
  }

  try {
    await service.from("audio_versions").insert({
      project_id: projectId,
      kind: "working_mix",
      audio_path: outPath,
      version: Date.now() % 100000,
      metadata: { source: "console_working_mix", layerCount, log: log.slice(0, 20) },
    });
  } catch {
    /* schema may differ */
  }

  return { buffer: wavOut, path: outPath, layerCount, log };
}


export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await ctx.params;
  const { user, error: authErr } = await requireUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: project } = await service
    .from("projects")
    .select("id, user_id, metadata")
    .eq("id", projectId)
    .maybeSingle();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = (project.metadata || {}) as Record<string, unknown>;
  const history = parseHistory(meta.tweak_history);
  return NextResponse.json({
    history,
    currentVersion: history.currentVersion,
    versions: history.versions.map((v) => ({
      version: v.version,
      at: v.at,
      prompt: v.prompt,
      summary: v.summary,
    })),
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await ctx.params;
  const { user, error: authErr } = await requireUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const action = body.action || "tweak";

  const service = createServiceClient();
  const { data: project } = await service
    .from("projects")
    .select("id, user_id, metadata, title")
    .eq("id", projectId)
    .maybeSingle();
  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = { ...((project.metadata || {}) as Record<string, unknown>) };
  let history = parseHistory(meta.tweak_history);

  if (action === "status") {
    return NextResponse.json({ history, currentVersion: history.currentVersion });
  }

  if (action === "revert") {
    const target = typeof body.version === "number" ? body.version : history.currentVersion - 1;
    const next = revertTo(history, Math.max(0, target));
    if (!next) {
      return NextResponse.json({ error: "Cannot revert" }, { status: 400 });
    }
    history = next;
    // Re-apply from original master + adjustments at that version
  }

  const sections = await loadSectionHints(service, projectId);
  let interpret = null as ReturnType<typeof interpretTweakPrompt> | null;
  let adjustments = currentAdjustments(history);
  let toolkitDecision: ReturnType<typeof promptToToolCalls> | null = null;


  if (action === "tweak") {
    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });
    }

    // —— Console track-scoped tweak: operate on this task's take only (not master) ——
    // Scope enforced by task_id; does not run Producer Mind / master history.
    const taskId = body.task_id ? String(body.task_id).trim() : "";
    if (taskId && body.scope !== "song") {
      const { data: task } = await service
        .from("recording_tasks")
        .select("id, project_id, type, title, status")
        .eq("id", taskId)
        .eq("project_id", projectId)
        .maybeSingle();
      if (!task) {
        return NextResponse.json({ error: "Track not found" }, { status: 404 });
      }

      const { data: recs } = await service
        .from("recordings")
        .select("id, audio_path, original_audio_path, is_selected, take_number")
        .eq("task_id", taskId)
        .order("take_number", { ascending: false });

      const rec =
        (recs || []).find((r) => r.is_selected) ||
        (recs || []).find((r) => r.audio_path) ||
        null;
      if (!rec?.audio_path) {
        return NextResponse.json(
          { error: "No recorded take on this track yet — record or upload audio first." },
          { status: 400 }
        );
      }

      const pathCandidates = [rec.audio_path, rec.original_audio_path].filter(
        (p): p is string => Boolean(p)
      );
      let fileBuf: Buffer | null = null;
      let usedPath: string | null = null;
      for (const p of pathCandidates) {
        try {
          const { data: blob, error: dlErr } = await service.storage
            .from(getStorageBucket())
            .download(p);
          if (dlErr || !blob) continue;
          fileBuf = Buffer.from(await blob.arrayBuffer());
          usedPath = p;
          break;
        } catch {
          continue;
        }
      }
      if (!fileBuf || !usedPath) {
        return NextResponse.json({ error: "Could not load take audio" }, { status: 500 });
      }

      let wavBuf: Buffer;
      try {
        const ensured = await convertBufferToWav(fileBuf, usedPath);
        wavBuf = ensured.buffer;
      } catch (e) {
        return NextResponse.json(
          {
            error:
              e instanceof Error
                ? e.message
                : "Could not decode take (need WAV or server ffmpeg)",
          },
          { status: 415 }
        );
      }

      let pcmStereo: PcmStereo;
      try {
        const decoded = decodeWav(wavBuf);
        const ch = decoded.channels || 1;
        const samples = decoded.samples;
        const sr = decoded.sampleRate;
        const frames = Math.floor(samples.length / ch);
        if (ch >= 2) {
          const left = new Float32Array(frames);
          const right = new Float32Array(frames);
          for (let i = 0; i < frames; i++) {
            left[i] = samples[i * ch] || 0;
            right[i] = samples[i * ch + 1] || 0;
          }
          pcmStereo = { left, right, sampleRate: sr };
        } else {
          pcmStereo = { left: samples, right: new Float32Array(samples), sampleRate: sr };
        }
      } catch {
        return NextResponse.json({ error: "Invalid take WAV" }, { status: 415 });
      }

      // Strip [track:…] prefix for matching — scope is task_id
      const cleanPrompt = prompt.replace(/^\[track:[^\]]*\]\s*/i, "").trim() || prompt;

      const toolkitDecision = promptToToolCalls({
        request: cleanPrompt,
        sections: [],
        playbackMs: null,
      });

      // Force song-scope tool calls on the isolated buffer; drop mix-only limiter
      const rawCalls = (toolkitDecision.tool_calls || []).map((c) => ({
        ...c,
        scope: "song" as const,
        target: "song",
      }));
      const skipped = rawCalls.filter((c) => !TAKE_SAFE_TOOLS.has(c.tool)).map((c) => c.tool);
      const calls = rawCalls.filter((c) => TAKE_SAFE_TOOLS.has(c.tool));

      if (!calls.length) {
        return NextResponse.json({
          ok: false,
          needsClarification: true,
          scope: "track",
          task_id: taskId,
          message:
            skipped.length
              ? `That request maps to mix-only tools (${skipped.join(", ")}). Try warmth, brightness, space, or compression on this vocal.`
              : "Could not map that request to a vocal-take edit. Try e.g. “add warmth” or “brighten this up”.",
          toolkit: toolkitDecision,
        });
      }

      const { pcm: rendered, applied } = applyToolCalls(pcmStereo, calls);
      const wavOut = exportWav(rendered);
      const outPath = `projects/${projectId}/takes/${taskId}/tweak-${Date.now()}.wav`;

      const { error: upErr } = await service.storage
        .from(getStorageBucket())
        .upload(outPath, wavOut, { contentType: "audio/wav", upsert: true });
      if (upErr) {
        return NextResponse.json({ error: upErr.message || "Upload failed" }, { status: 500 });
      }

      // New selected take for this task only — other tracks untouched
      const nextTake =
        Math.max(0, ...(recs || []).map((r) => Number(r.take_number) || 0)) + 1;
      await service
        .from("recordings")
        .update({ is_selected: false })
        .eq("task_id", taskId);

      const insertRow: Record<string, unknown> = {
        task_id: taskId,
        project_id: projectId,
        audio_path: outPath,
        take_number: nextTake,
        is_selected: true,
        metadata: {
          source: "console_track_tweak",
          parent_recording_id: rec.id,
          prompt: cleanPrompt,
          tools: applied.map((a) => a.tool),
        },
      };
      const { error: insErr } = await service.from("recordings").insert(insertRow);
      if (insErr) {
        // Fallback: point existing selected row at new path
        await service
          .from("recordings")
          .update({ audio_path: outPath, is_selected: true })
          .eq("id", rec.id);
      }

      await service
        .from("recording_tasks")
        .update({ status: "completed" })
        .eq("id", taskId);

      const plain =
        applied.map((a) => a.reasoning || a.tool).filter(Boolean).join("; ") ||
        toolkitDecision.plain_summary ||
        "Updated this track";

      return NextResponse.json({
        ok: true,
        scope: "track",
        task_id: taskId,
        plain,
        applied: applied.map((a) => ({ tool: a.tool, reasoning: a.reasoning })),
        skipped_tools: skipped,
        take_path: outPath,
      });
    }

    // Load artist taste profile
    const { data: profileRow } = await service
      .from("profiles")
      .select("id, metadata")
      .eq("id", user.id)
      .maybeSingle();
    const profileMeta = { ...(((profileRow?.metadata || {}) as Record<string, unknown>)) };
    const tasteRaw = profileMeta.taste_profile;

    const agent = runIterationAgent({
      request: prompt,
      sections,
      playbackMs: body.playbackMs ?? null,
      tasteRaw,
      variationId: body.variationId ?? null,
      settledScore: history.currentVersion,
    });

    if (agent.useVariations && agent.variations) {
      return NextResponse.json({
        ok: false,
        needsVariationPick: true,
        plain: agent.plain,
        variations: agent.variations.map((v) => ({
          id: v.id,
          label: v.label,
          plain: v.plain,
        })),
        loopNote: agent.loopNote,
        tasteHints: agent.tasteHints,
      });
    }

    interpret = agent.interpret;

    // Always try toolkit parametric tools as well (EQ, reverb type, etc.)
    toolkitDecision = promptToToolCalls({
      request: prompt,
      sections,
      playbackMs: body.playbackMs ?? null,
    });

    const hasFieldEdits =
      Boolean(interpret && !interpret.confirmation_needed && interpret.interpreted_edits.length);
    const hasToolCalls = Boolean(toolkitDecision?.tool_calls?.length);

    // Only ask for clarification when *neither* path can act
    if (!hasFieldEdits && !hasToolCalls) {
      return NextResponse.json({
        ok: false,
        interpret,
        needsClarification: true,
        loopNote: agent.loopNote,
        toolkit: toolkitDecision,
      });
    }

    // Field-level adjustments (loudness / presence / reverb scale)
    if (hasFieldEdits && interpret) {
      adjustments = buildSectionAdjustments(
        sections,
        interpret.interpreted_edits,
        currentAdjustments(history)
      );
    } else {
      // Toolkit-only: keep previous cumulative adjustments, still version history
      adjustments = currentAdjustments(history);
    }

    const summaryParts: string[] = [];
    if (hasFieldEdits && interpret?.plain_summary) summaryParts.push(interpret.plain_summary);
    if (hasToolCalls && toolkitDecision?.plain_summary) summaryParts.push(toolkitDecision.plain_summary);
    const summary = summaryParts.join(" ") || "Applied mix changes.";

    history = pushVersion(history, {
      prompt,
      edits: interpret?.interpreted_edits || [],
      summary,
      sectionAdjustments: adjustments,
    });

    if (hasFieldEdits && interpret) {
      const newSession = !meta.tweak_taste_session;
      const nextTaste = applyTasteLog(tasteRaw, interpret, newSession);
      profileMeta.taste_profile = nextTaste;
      meta.tweak_taste_session = true;
      await service.from("profiles").update({ metadata: profileMeta }).eq("id", user.id);
    }
  } else if (action === "revert") {
    adjustments = currentAdjustments(history);
  }

  // Load baseline master (prefer untweaked original stored path)
  const originalPath =
    (meta.tweak_original_master_path as string) ||
    null;
  let masterLoad = await loadMasterBuffer(service, projectId);
  let workingMixLog: string[] = [];
  let usedWorkingMix = false;
  if (!masterLoad) {
    const built = await buildWorkingMix(service, projectId);
    if (!built) {
      return NextResponse.json(
        {
          error:
            "Nothing on the timeline to mix yet — add a beat and at least one take, then try again.",
        },
        { status: 404 }
      );
    }
    masterLoad = { buffer: built.buffer, path: built.path };
    workingMixLog = built.log;
    usedWorkingMix = true;
    meta.tweak_latest_path = built.path;
    // Working mix is the baseline for this prompt (not a full Produce master)
    meta.tweak_original_master_path = built.path;
  }

  // On first tweak, remember original path
  if (!meta.tweak_original_master_path) {
    meta.tweak_original_master_path = masterLoad.path;
  }

  // Always start from original bytes when possible
  const basePath = (meta.tweak_original_master_path as string) || masterLoad.path;
  if (basePath !== masterLoad.path) {
    const signed = await resolveAudioUrl(basePath, 120);
    if (signed) {
      const res = await fetch(signed);
      if (res.ok) {
        masterLoad = { buffer: Buffer.from(await res.arrayBuffer()), path: basePath };
      }
    }
  }

  let pcmStereo: PcmStereo;
  try {
    const decoded = decodeWav(masterLoad.buffer);
    const ch = decoded.channels || 1;
    const samples = decoded.samples;
    const sr = decoded.sampleRate;
    if (ch >= 2) {
      const frames = Math.floor(samples.length / ch);
      const left = new Float32Array(frames);
      const right = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        left[i] = samples[i * ch] || 0;
        right[i] = samples[i * ch + 1] || 0;
      }
      pcmStereo = { left, right, sampleRate: sr };
    } else {
      pcmStereo = { left: samples, right: new Float32Array(samples), sampleRate: sr };
    }
  } catch {
    return NextResponse.json(
      {
        error:
          "Master must be WAV for fast tweaks right now. Re-produce the song as WAV.",
      },
      { status: 415 }
    );
  }

  // Version 0 = original; only apply if currentVersion > 0
  let rendered: PcmStereo =
    history.currentVersion > 0
      ? applyAdjustmentsToMaster(pcmStereo, adjustments)
      : pcmStereo;

  // Producer toolkit parametric tools (reverb type/decay, EQ, delay, etc.)
  toolkitDecision =
    action === "tweak" && body.prompt
      ? promptToToolCalls({
          request: String(body.prompt),
          sections,
          playbackMs: body.playbackMs ?? null,
        })
      : null;

  if (toolkitDecision && toolkitDecision.tool_calls.length) {
    const bySection = new Map<string, typeof sections>();
    // Group calls by target
    const songCalls = toolkitDecision.tool_calls.filter((c) => c.scope === "song" || c.target === "song");
    const sectionCalls = toolkitDecision.tool_calls.filter((c) => c.scope === "section" && c.target && c.target !== "song");

    if (songCalls.length) {
      const r = applyToolCalls(rendered, songCalls);
      rendered = r.pcm;
    }
    for (const sec of sections) {
      const calls = sectionCalls.filter((c) => c.target === sec.id);
      if (!calls.length) continue;
      rendered = applyToolCallsToRegion(rendered, calls, sec.startMs, sec.endMs);
    }
  }


  const wavOut = exportWav(rendered);
  const outPath = `projects/${projectId}/masters/tweak-v${history.currentVersion}-${Date.now()}.wav`;

  const { error: upErr } = await service.storage
    .from(getStorageBucket())
    .upload(outPath, wavOut, { contentType: "audio/wav", upsert: true });

  if (upErr) {
    // try without bucket prefix issues
    return NextResponse.json({ error: upErr.message || "Upload failed" }, { status: 500 });
  }

  // Bump audio_versions
  const { data: lastVer } = await service
    .from("audio_versions")
    .select("version")
    .eq("project_id", projectId)
    .eq("kind", "master")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVer = (lastVer?.version || 0) + 1;

  const versionKind = usedWorkingMix ? "working_mix" : "master";
  await service.from("audio_versions").insert({
    project_id: projectId,
    kind: versionKind,
    version: nextVer,
    audio_path: outPath,
    metadata: {
      source: usedWorkingMix ? "console_working_mix_tweak" : "prompt_tweak",
      tweak_version: history.currentVersion,
      summary: history.versions[history.currentVersion - 1]?.summary || "original",
      working_mix_log: usedWorkingMix ? workingMixLog.slice(0, 24) : undefined,
    },
  });

  meta.tweak_history = history;
  meta.tweak_latest_path = outPath;
  // Do not force project status to complete — full Produce remains a separate deliberate action
  await service
    .from("projects")
    .update({ metadata: meta })
    .eq("id", projectId);

  const masterUrl = await resolveAudioUrl(outPath, 3600);
  const commercial = runCommercialReadiness(rendered);

  // Done signal (taste + commercial)
  let doneSignal: string | null = null;
  if (commercial.passed && history.currentVersion >= 2) {
    doneSignal =
      "This one’s tracking well and looks clean for export — keep exploring if you want, or download when you’re ready.";
  }

  const summaryText =
    history.currentVersion > 0
      ? history.versions[history.currentVersion - 1]?.summary
      : "Reverted to original master";

  const plainParts: string[] = [];
  if (usedWorkingMix) {
    plainParts.push(
      `mind: built a working mix from the timeline (${workingMixLog.filter((l) => l.startsWith("working_mix:layer")).length} vocal layers + beat) — not a full Produce`
    );
  }
  if (summaryText) plainParts.push(`mind: ${summaryText}`);
  if (toolkitDecision?.plain_summary) plainParts.push(`restore: ${toolkitDecision.plain_summary}`);
  if (toolkitDecision?.tool_calls?.length) {
    plainParts.push(
      `mind: tools → ${toolkitDecision.tool_calls.map((c) => `${c.tool}${c.target && c.target !== "song" ? `@${c.target}` : ""}`).join(", ")}`
    );
  }

  return NextResponse.json({
    ok: true,
    scope: "song",
    interpret,
    summary: summaryText,
    plain: plainParts.join(" · ") || summaryText,
    currentVersion: history.currentVersion,
    versions: history.versions.map((v) => ({
      version: v.version,
      prompt: v.prompt,
      summary: v.summary,
      at: v.at,
    })),
    master_url: masterUrl,
    working_mix: usedWorkingMix,
    working_mix_log: usedWorkingMix ? workingMixLog.slice(0, 24) : undefined,
    safety: "True-peak held near -1 dBTP",
    commercial,
    doneSignal,
    toolkit: toolkitDecision
      ? {
          tool_calls: toolkitDecision.tool_calls,
          plain_summary: toolkitDecision.plain_summary,
          capped: toolkitDecision.capped,
        }
      : null,
  });
}
