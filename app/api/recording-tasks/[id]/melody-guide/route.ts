import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createSignedDownloadUrl,
  getStorageBucket,
  isStoragePath,
  uploadBuffer,
} from "@/lib/storage";
import {
  buildMelodyGuideScript,
  hasElevenLabsTts,
  synthesizeSpeech,
} from "@/lib/providers/elevenlabs-tts";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/recording-tasks/:id/melody-guide
 * Returns a spoken producer guide for this section (cached on the task).
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { id: taskId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: task, error: tErr } = await supabase
    .from("recording_tasks")
    .select("*, projects!inner(id, user_id, genre, mood, title), song_sections(label, type)")
    .eq("id", taskId)
    .maybeSingle();

  // Fallback if join shape differs
  let row = task as Record<string, unknown> | null;
  if (tErr || !row) {
    const { data: simple } = await supabase
      .from("recording_tasks")
      .select("*")
      .eq("id", taskId)
      .maybeSingle();
    if (!simple) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    const { data: project } = await supabase
      .from("projects")
      .select("id, user_id, genre, mood, title")
      .eq("id", simple.project_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!project) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    row = { ...simple, projects: project, song_sections: null };
  }

  const project = (row.projects || {}) as {
    id?: string;
    user_id?: string;
    genre?: string | null;
    mood?: string | null;
  };
  if (project.user_id && project.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Ownership via project_id if join didn't embed user
  if (!project.user_id) {
    const { data: p } = await supabase
      .from("projects")
      .select("id, user_id, genre, mood")
      .eq("id", row.project_id as string)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
    Object.assign(project, p);
  }

  const meta = (row.metadata || {}) as {
    section_label?: string;
  };
  const section = (row.song_sections || {}) as { label?: string; type?: string };

  const script = buildMelodyGuideScript({
    title: (row.title as string) || null,
    instruction: (row.instruction as string) || null,
    reason: (row.reason as string) || null,
    sectionLabel: section.label || meta.section_label || null,
    type: (row.type as string) || null,
    genre: project.genre,
    mood: project.mood,
  });

  // Return cached guide if present
  const existingPath = row.guide_audio_path as string | null | undefined;
  if (existingPath && isStoragePath(existingPath)) {
    try {
      const audio_url = await createSignedDownloadUrl(existingPath, 3600);
      return NextResponse.json({
        audio_url,
        script,
        cached: true,
        start_ms: row.start_ms ?? 0,
        end_ms: row.end_ms ?? null,
      });
    } catch {
      /* regenerate */
    }
  }

  if (!hasElevenLabsTts()) {
    return NextResponse.json({
      audio_url: null,
      script,
      cached: false,
      fallback: "speech_synthesis",
      start_ms: row.start_ms ?? 0,
      end_ms: row.end_ms ?? null,
      message: "TTS not configured — client can use speech synthesis.",
    });
  }

  try {
    const { buffer, contentType } = await synthesizeSpeech(script);
    const path = `users/${user.id}/projects/${project.id}/guides/${taskId}.mp3`;
    await uploadBuffer(path, buffer, contentType);

    const service = createServiceClient();
    await service
      .from("recording_tasks")
      .update({
        guide_audio_path: path,
        metadata: {
          ...(meta || {}),
          melody_guide: {
            path,
            generated_at: new Date().toISOString(),
            provider: "elevenlabs_tts",
          },
        },
      })
      .eq("id", taskId);

    const audio_url = await createSignedDownloadUrl(path, 3600);
    return NextResponse.json({
      audio_url,
      script,
      cached: false,
      start_ms: row.start_ms ?? 0,
      end_ms: row.end_ms ?? null,
    });
  } catch (e) {
    console.error("melody-guide", e);
    return NextResponse.json({
      audio_url: null,
      script,
      cached: false,
      fallback: "speech_synthesis",
      start_ms: row.start_ms ?? 0,
      end_ms: row.end_ms ?? null,
      error: e instanceof Error ? e.message : "Guide generation failed",
    });
  }
}
