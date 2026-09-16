/**
 * Shared client-side take preparation before Produce (Booth + Console).
 * Converts non-WAV selected takes to WAV and re-uploads as additional takes
 * (does NOT delete or overwrite the original recording file).
 *
 * Server production still runs normalizeToInternalPcm on whatever is selected —
 * this step is best-effort for browser MediaRecorder (webm/opus) reliability.
 */
"use client";

import { audioBlobToWavDetailed } from "@/lib/client/export-wav";

export type PrepareTakeTask = {
  id: string;
  status?: string | null;
};

export type PrepareTakesResult = {
  prepared: number;
  skipped: number;
  errors: string[];
};

export async function prepareTakesForProduce(opts: {
  tasks: PrepareTakeTask[];
  onStage?: (stage: string) => void;
}): Promise<PrepareTakesResult> {
  const completed = opts.tasks.filter((t) => {
    const s = (t.status || "").toLowerCase();
    return s === "completed" || s === "complete" || s === "done";
  });

  let prepared = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const task of completed) {
    try {
      const res = await fetch(`/api/recording-tasks/${task.id}/recordings`);
      if (!res.ok) {
        skipped++;
        continue;
      }
      const j = await res.json().catch(() => ({}));
      const list = (Array.isArray(j.recordings) ? j.recordings : []) as {
        id: string;
        is_selected?: boolean | null;
        audio_url?: string | null;
        audio_path?: string | null;
      }[];
      const selected =
        list.find((r) => r.is_selected) || list[list.length - 1] || list[0];
      if (!selected?.audio_url && !selected?.audio_path) {
        skipped++;
        continue;
      }
      const pathHint = (selected.audio_path || selected.audio_url || "").toLowerCase();
      const looksWav = pathHint.includes(".wav") && !pathHint.includes(".webm");
      if (looksWav) {
        skipped++;
        continue;
      }

      const src = selected.audio_url;
      if (!src) {
        skipped++;
        continue;
      }
      const audioRes = await fetch(src);
      if (!audioRes.ok) {
        skipped++;
        continue;
      }
      const rawBlob = await audioRes.blob();
      const head = new Uint8Array(await rawBlob.slice(0, 12).arrayBuffer());
      const isWav =
        head.length >= 12 &&
        String.fromCharCode(head[0], head[1], head[2], head[3]) === "RIFF" &&
        String.fromCharCode(head[8], head[9], head[10], head[11]) === "WAVE";
      if (isWav) {
        skipped++;
        continue;
      }

      opts.onStage?.("preparing takes");
      const wav = await audioBlobToWavDetailed(rawBlob);
      const form = new FormData();
      form.append("file", wav.blob, "take.wav");
      form.append("source", "repair_wav");
      form.append("task_id", task.id);
      const up = await fetch(`/api/recording-tasks/${task.id}/recordings`, {
        method: "POST",
        body: form,
      });
      if (!up.ok) {
        const uj = await up.json().catch(() => ({}));
        errors.push(typeof uj.error === "string" ? uj.error : `prepare failed ${task.id}`);
        skipped++;
        continue;
      }
      const uj = await up.json().catch(() => ({}));
      const newId = uj?.recording?.id as string | undefined;
      if (newId) {
        await fetch(`/api/recording-tasks/${task.id}/recordings/${newId}/select`, {
          method: "POST",
        }).catch(() => undefined);
        prepared++;
      } else {
        skipped++;
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "prepare error");
      skipped++;
    }
  }

  return { prepared, skipped, errors };
}
