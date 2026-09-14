import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isStoragePath, resolveAudioUrl, getStorageBucket } from "@/lib/storage";
import { decodeWav } from "@/lib/audio/wav";
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
};

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
    .in("kind", ["master", "mix", "preview_mix"])
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
  if (!masterLoad) {
    return NextResponse.json(
      { error: "No master audio found to tweak. Produce the song first." },
      { status: 404 }
    );
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

  await service.from("audio_versions").insert({
    project_id: projectId,
    kind: "master",
    version: nextVer,
    audio_path: outPath,
    metadata: {
      source: "prompt_tweak",
      tweak_version: history.currentVersion,
      summary: history.versions[history.currentVersion - 1]?.summary || "original",
    },
  });

  meta.tweak_history = history;
  meta.tweak_latest_path = outPath;
  await service
    .from("projects")
    .update({ metadata: meta, status: "complete" })
    .eq("id", projectId);

  const masterUrl = await resolveAudioUrl(outPath, 3600);
  const commercial = runCommercialReadiness(rendered);

  // Done signal (taste + commercial)
  let doneSignal: string | null = null;
  if (commercial.passed && history.currentVersion >= 2) {
    doneSignal =
      "This one’s tracking well and looks clean for export — keep exploring if you want, or download when you’re ready.";
  }

  return NextResponse.json({
    ok: true,
    interpret,
    summary:
      history.currentVersion > 0
        ? history.versions[history.currentVersion - 1]?.summary
        : "Reverted to original master",
    currentVersion: history.currentVersion,
    versions: history.versions.map((v) => ({
      version: v.version,
      prompt: v.prompt,
      summary: v.summary,
      at: v.at,
    })),
    master_url: masterUrl,
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
