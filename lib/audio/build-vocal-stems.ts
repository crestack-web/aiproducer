import type { ArrangementPlacement, PipelineMode, StemKind } from "@/lib/audio/types";
import type { TakeRow } from "@/lib/audio/produce-job";
import { logProduce } from "@/lib/audio/produce-job";
import { isStoragePath } from "@/lib/storage";
import {
  buildAndStoreTimelineAlignedStem,
  buildAndStoreCompositeAlignedStem,
} from "@/lib/audio/render-aligned-stem";

/**
 * Build timeline-aligned vocal stem rows for Produce.
 * Composites every section take of the same role onto one full-song stem
 * (so verse+chorus+bridge leads all mix, not only the first).
 */
export async function buildVocalStemRows(opts: {
  mode: PipelineMode;
  userId: string;
  projectId: string;
  jobId: string;
  takes: TakeRow[];
  placements: ArrangementPlacement[];
  songDurationMs: number;
}): Promise<Record<string, unknown>[]> {
  const { mode, userId, projectId, jobId, takes, placements, songDurationMs } = opts;

  const byKind = new Map<StemKind, ArrangementPlacement[]>();
  for (const p of placements) {
    if (!byKind.has(p.stem_kind)) byKind.set(p.stem_kind, []);
    byKind.get(p.stem_kind)!.push(p);
  }

  const kindEntries = [...byKind.entries()];
  const alignedResults = await Promise.all(
    kindEntries.map(async ([kind, list], index) => {
      const placementSources: {
        recordingId: string;
        sourcePath: string;
        timelineStartMs: number;
        timelineEndMs?: number | null;
      }[] = [];
      for (const pl of list) {
        const rec = takes.find((t) => t.id === pl.recording_id);
        const sourcePath = rec?.processed_path || rec?.audio_path;
        if (!sourcePath || !isStoragePath(sourcePath)) {
          throw new Error(`Vocal take ${pl.recording_id} has no storage path for alignment`);
        }
        if (typeof pl.start_ms !== "number" || pl.start_ms < 0) {
          throw new Error(`Invalid timeline start for recording ${pl.recording_id}`);
        }
        placementSources.push({
          recordingId: pl.recording_id,
          sourcePath,
          timelineStartMs: pl.start_ms,
          timelineEndMs: pl.end_ms,
        });
      }

      const first = placementSources[0];
      if (!first) {
        throw new Error(`No placements for stem kind ${kind}`);
      }

      if (mode === "mock") {
        return {
          project_id: projectId,
          kind,
          audio_path: first.sourcePath,
          duration_ms: songDurationMs,
          order_index: index + 1,
          source_recording_ids: placementSources.map((l) => l.recordingId),
          metadata: {
            placements: list,
            mock_render: true,
            timeline_aligned: true,
            full_song_pad: "mock",
            song_duration_ms: songDurationMs,
            timeline_start_ms: first.timelineStartMs,
            composite_count: placementSources.length,
          },
        };
      }

      let alignedPath: string;
      let alignmentStatus: string;
      let actualVocalMs: number;
      let timelineStartMs: number;
      let durationMs: number;

      if (placementSources.length === 1) {
        const aligned = await buildAndStoreTimelineAlignedStem({
          userId,
          projectId,
          jobId,
          recordingId: first.recordingId,
          sourcePath: first.sourcePath,
          timelineStartMs: first.timelineStartMs,
          timelineEndMs: first.timelineEndMs,
          songDurationMs,
        });
        if (!aligned.timelineAligned) {
          throw new Error(`Could not timeline-align vocal ${first.recordingId}`);
        }
        alignedPath = aligned.storagePath;
        alignmentStatus = aligned.alignmentStatus;
        actualVocalMs = aligned.actualVocalMs;
        timelineStartMs = aligned.timelineStartMs;
        durationMs = aligned.durationMs;
      } else {
        const composite = await buildAndStoreCompositeAlignedStem({
          userId,
          projectId,
          jobId,
          kind: String(kind),
          songDurationMs,
          placements: placementSources,
        });
        if (!composite.timelineAligned) {
          throw new Error(`Could not composite-align ${kind} stems`);
        }
        alignedPath = composite.storagePath;
        alignmentStatus = composite.alignmentStatus;
        actualVocalMs = composite.actualVocalMs;
        timelineStartMs = composite.timelineStartMs;
        durationMs = composite.durationMs;
        logProduce({
          event: "stem_composite_aligned",
          jobId,
          projectId,
          kind,
          recording_ids: composite.recordingIds,
          source_count: composite.sourceCount,
          path: composite.storagePath,
        });
      }

      logProduce({
        event: "stem_aligned",
        jobId,
        projectId,
        kind,
        recording_id: first.recordingId,
        recording_ids: placementSources.map((p) => p.recordingId),
        source_count: placementSources.length,
        path: alignedPath,
        alignment_status: alignmentStatus,
        duration_ms: durationMs,
      });

      return {
        project_id: projectId,
        kind,
        audio_path: alignedPath,
        duration_ms: durationMs,
        order_index: index + 1,
        source_recording_ids: placementSources.map((l) => l.recordingId),
        metadata: {
          placements: list,
          mock_render: false,
          timeline_aligned: true,
          full_song_pad: "pcm_wav",
          alignment_status: alignmentStatus,
          song_duration_ms: songDurationMs,
          actual_vocal_ms: actualVocalMs,
          timeline_start_ms: timelineStartMs,
          composite_count: placementSources.length,
          source_paths: placementSources.map((p) => p.sourcePath),
        },
      };
    })
  );

  return alignedResults;
}
