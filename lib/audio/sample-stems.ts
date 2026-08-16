/**
 * Project samples/loops → timeline-aligned stems for produce.
 * Independent of vocal recording_tasks membership.
 */
import type { StemKind } from "@/lib/audio/types";
import { isStoragePath } from "@/lib/storage";
import { buildAndStoreTimelineAlignedStem } from "@/lib/audio/render-aligned-stem";
import { logProduce } from "@/lib/audio/produce-job";

export type SampleRow = {
  id: string;
  kind: string;
  title?: string | null;
  audio_path: string | null;
  duration_ms?: number | null;
  start_ms?: number | null;
  end_ms?: number | null;
  include_in_produce?: boolean | null;
  gain_db?: number | null;
  metadata?: Record<string, unknown> | null;
};

export function sampleKindToStemKind(kind: string): StemKind {
  switch (kind) {
    case "vocal_sample":
      return "BACKGROUND";
    case "loop":
    case "one_shot":
    case "other":
      return "OTHER";
    default:
      return "OTHER";
  }
}

function sampleStartMs(s: SampleRow): number {
  if (typeof s.start_ms === "number" && Number.isFinite(s.start_ms)) {
    return Math.max(0, Math.round(s.start_ms));
  }
  const meta = s.metadata || {};
  if (typeof meta.start_ms === "number" && Number.isFinite(meta.start_ms as number)) {
    return Math.max(0, Math.round(meta.start_ms as number));
  }
  return 0;
}

function sampleEndMs(s: SampleRow, start: number): number {
  if (typeof s.end_ms === "number" && Number.isFinite(s.end_ms) && s.end_ms > start) {
    return Math.round(s.end_ms);
  }
  const meta = s.metadata || {};
  if (typeof meta.end_ms === "number" && (meta.end_ms as number) > start) {
    return Math.round(meta.end_ms as number);
  }
  const dur = typeof s.duration_ms === "number" ? s.duration_ms : 0;
  return start + Math.max(dur, 1000);
}

export function shouldIncludeSampleInProduce(s: SampleRow): boolean {
  if (s.kind === "reference") return false;
  if (s.include_in_produce === false) return false;
  const meta = s.metadata || {};
  if (meta.include_in_produce === false) return false;
  return Boolean(s.audio_path && isStoragePath(s.audio_path));
}

/** Append sample/loop stems to stemRows (mutates array). */
export async function appendSampleStems(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  projectId: string;
  jobId: string;
  songDurationMs: number;
  mode: "mock" | "roex";
  stemRows: Record<string, unknown>[];
  orderStart: number;
}): Promise<number> {
  const { data: samples } = await opts.supabase
    .from("samples")
    .select(
      "id, kind, title, audio_path, duration_ms, start_ms, end_ms, include_in_produce, gain_db, metadata"
    )
    .eq("project_id", opts.projectId);

  const list = ((samples || []) as SampleRow[]).filter(shouldIncludeSampleInProduce);
  let order = opts.orderStart;

  for (const s of list) {
    const sourcePath = s.audio_path!;
    const start = sampleStartMs(s);
    const end = Math.min(sampleEndMs(s, start), opts.songDurationMs);
    const kind = sampleKindToStemKind(s.kind);

    if (opts.mode === "mock") {
      opts.stemRows.push({
        project_id: opts.projectId,
        kind,
        audio_path: sourcePath,
        duration_ms: opts.songDurationMs,
        order_index: order++,
        source_recording_ids: [],
        metadata: {
          sample_id: s.id,
          sample_kind: s.kind,
          title: s.title,
          placements: [
            {
              recording_id: s.id,
              task_id: s.id,
              stem_kind: kind,
              start_ms: start,
              end_ms: end,
              gain_db: s.gain_db || 0,
            },
          ],
          mock_render: true,
          timeline_aligned: true,
          full_song_pad: "mock",
          song_duration_ms: opts.songDurationMs,
          timeline_start_ms: start,
          timeline_end_ms: end,
        },
      });
      continue;
    }

    const aligned = await buildAndStoreTimelineAlignedStem({
      userId: opts.userId,
      projectId: opts.projectId,
      jobId: opts.jobId,
      recordingId: s.id,
      sourcePath,
      timelineStartMs: start,
      timelineEndMs: end,
      songDurationMs: opts.songDurationMs,
    });

    if (!aligned.timelineAligned) {
      logProduce({
        event: "sample_align_failed",
        jobId: opts.jobId,
        projectId: opts.projectId,
        sample_id: s.id,
      });
      continue;
    }

    opts.stemRows.push({
      project_id: opts.projectId,
      kind,
      audio_path: aligned.storagePath,
      duration_ms: aligned.durationMs,
      order_index: order++,
      source_recording_ids: [],
      metadata: {
        sample_id: s.id,
        sample_kind: s.kind,
        title: s.title,
        placements: [
          {
            recording_id: s.id,
            task_id: s.id,
            stem_kind: kind,
            start_ms: start,
            end_ms: end,
            gain_db: s.gain_db || 0,
          },
        ],
        mock_render: false,
        timeline_aligned: true,
        full_song_pad: "pcm_wav",
        alignment_status: aligned.alignmentStatus,
        song_duration_ms: opts.songDurationMs,
        timeline_start_ms: aligned.timelineStartMs,
        source_path: sourcePath,
      },
    });

    logProduce({
      event: "sample_stem_aligned",
      jobId: opts.jobId,
      projectId: opts.projectId,
      sample_id: s.id,
      path: aligned.storagePath,
      start_ms: start,
      end_ms: end,
    });
  }

  return order;
}
