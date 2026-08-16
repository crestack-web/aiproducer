/**
 * Download recording from storage → timeline-align → upload full-song stem.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { getStorageBucket, uploadBuffer } from "@/lib/storage";
import { renderTimelineAlignedStem, type AlignmentStatus } from "@/lib/audio/timeline-stem";
import { isWavBuffer } from "@/lib/audio/wav";

export function alignedStemPath(
  userId: string,
  projectId: string,
  jobId: string,
  recordingId: string
) {
  return `users/${userId}/projects/${projectId}/production/${jobId}/stems/${recordingId}_aligned.wav`;
}

export async function downloadStorageBytes(path: string): Promise<Buffer> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(getStorageBucket()).download(path);
  if (error || !data) throw new Error(`Could not download stem source: ${error?.message || path}`);
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

export type AlignedStemResult = {
  storagePath: string;
  alignmentStatus: AlignmentStatus;
  timelineAligned: true;
  durationMs: number;
  actualVocalMs: number;
  timelineStartMs: number;
};

export async function buildAndStoreTimelineAlignedStem(opts: {
  userId: string;
  projectId: string;
  jobId: string;
  recordingId: string;
  sourcePath: string;
  timelineStartMs: number;
  timelineEndMs?: number | null;
  songDurationMs: number;
}): Promise<AlignedStemResult> {
  const source = await downloadStorageBytes(opts.sourcePath);
  if (!isWavBuffer(source)) {
    throw new Error(
      `Recording ${opts.recordingId} is not WAV (${opts.sourcePath}). Re-record/upload this take so it is stored as WAV before Produce.`
    );
  }

  const rendered = renderTimelineAlignedStem({
    sourceBuffer: source,
    timelineStartMs: opts.timelineStartMs,
    timelineEndMs: opts.timelineEndMs,
    songDurationMs: opts.songDurationMs,
  });

  if (rendered.alignmentStatus === "OUT_OF_BOUNDS") {
    throw new Error(
      `Vocal for recording ${opts.recordingId} is OUT_OF_BOUNDS on the song timeline ` +
        `(start ${opts.timelineStartMs}ms, vocal ${rendered.actualVocalMs}ms, song ${opts.songDurationMs}ms). Fix placement before Produce.`
    );
  }

  const dest = alignedStemPath(opts.userId, opts.projectId, opts.jobId, opts.recordingId);
  await uploadBuffer(dest, rendered.wavBuffer, "audio/wav");

  return {
    storagePath: dest,
    alignmentStatus: rendered.alignmentStatus,
    timelineAligned: true,
    durationMs: rendered.durationMs,
    actualVocalMs: rendered.actualVocalMs,
    timelineStartMs: rendered.timelineStartMs,
  };
}
