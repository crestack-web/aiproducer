/**
 * HTTP client for the isolated Reference Mastering (Matchering) microservice.
 * Never imports Matchering — GPL stays in services/reference-master only.
 */
import { encodeStereoWav } from "../dsp";
import type { PcmStereo } from "../types";
import { normalizeToInternalPcm } from "../ingestion/normalize";
import {
  isReferenceMasterEnabled,
  pickReferenceForGenre,
  referenceMasterBaseUrl,
  type ReferencePick,
} from "./reference-library";
import { createSignedDownloadUrl, isStoragePath, uploadBuffer } from "@/lib/storage";
import { truePeakLimit } from "./loudness";

export type ReferenceMatchResult = {
  ok: boolean;
  pcm?: PcmStereo;
  pick?: ReferencePick;
  jobId?: string;
  note: string;
  error?: string;
};

async function resolveReferenceBytes(pick: ReferencePick): Promise<Buffer> {
  const ref = pick.referenceKeyOrUrl;
  if (/^https?:\/\//i.test(ref)) {
    const res = await fetch(ref, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`reference download ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  // Object key in R2 — signed GET
  if (isStoragePath(ref) || ref.startsWith("ap-system/") || ref.startsWith("users/")) {
    const url = await createSignedDownloadUrl(ref, 3600);
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`reference signed download ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error(`unsupported reference path: ${ref.slice(0, 80)}`);
}

async function pollResult(
  base: string,
  jobId: string,
  timeoutMs: number
): Promise<Buffer> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await fetch(`${base}/master/${jobId}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!st.ok) throw new Error(`status ${st.status}`);
    const j = (await st.json()) as { status?: string; error?: string; result_ready?: boolean };
    if (j.status === "failed") throw new Error(j.error || "matchering failed");
    if (j.status === "done" || j.result_ready) {
      const res = await fetch(`${base}/master/${jobId}/result`, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`result ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`matchering timeout after ${Math.round(timeoutMs / 1000)}s`);
}

/**
 * Match target PCM to a genre commercial reference via the isolated service.
 * On any failure returns ok:false — caller keeps rule-based master.
 */
export async function matchToGenreReference(
  target: PcmStereo,
  genre: string | null | undefined,
  opts?: { timeoutMs?: number; ceilingDb?: number }
): Promise<ReferenceMatchResult> {
  if (!isReferenceMasterEnabled()) {
    return { ok: false, note: "reference_master_disabled" };
  }
  const base = referenceMasterBaseUrl();
  if (!base) {
    return { ok: false, note: "reference_master_no_url" };
  }

  const pick = pickReferenceForGenre(genre);
  const timeoutMs = opts?.timeoutMs ?? Number(process.env.REF_MASTER_TIMEOUT_MS || 180_000);
  const ceiling = opts?.ceilingDb ?? -1.0;

  try {
    const targetWav = encodeStereoWav(target);
    let referenceWav: Buffer;
    try {
      referenceWav = await resolveReferenceBytes(pick);
    } catch (e) {
      return {
        ok: false,
        pick,
        note: "reference_asset_missing",
        error: e instanceof Error ? e.message : String(e),
      };
    }

    const form = new FormData();
    const targetBytes = new Uint8Array(targetWav);
    const referenceBytes = new Uint8Array(referenceWav);
    form.append("target_file", new Blob([targetBytes], { type: "audio/wav" }), "target.wav");
    form.append(
      "reference_file",
      new Blob([referenceBytes], { type: "audio/wav" }),
      "reference.wav"
    );

    const post = await fetch(`${base.replace(/\/$/, "")}/master`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!post.ok) {
      const text = await post.text().catch(() => "");
      throw new Error(`POST /master ${post.status}: ${text.slice(0, 200)}`);
    }
    const posted = (await post.json()) as { job_id?: string; status?: string };
    const jobId = posted.job_id;
    if (!jobId) throw new Error("no job_id from reference master");

    const matchedWav = await pollResult(base.replace(/\/$/, ""), jobId, timeoutMs);
    const norm = await normalizeToInternalPcm(matchedWav, "ref-match.wav");
    const pcm = norm.pcm;
    // Safety net: true-peak ≤ -1 dBTP after Matchering
    truePeakLimit(pcm, ceiling, 0.25);

    return {
      ok: true,
      pcm,
      pick,
      jobId,
      note: `Matched tonal balance and loudness to ${pick.label} (${pick.genreKey})`,
    };
  } catch (e) {
    return {
      ok: false,
      pick,
      note: "reference_master_fallback",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Optional: upload target to R2 and pass signed URL (for large files / debugging).
 */
export async function uploadTempMasterTarget(
  userId: string,
  projectId: string,
  jobId: string,
  wav: Buffer
): Promise<string> {
  const key = `users/${userId}/projects/${projectId}/production/${jobId}/ref-target.wav`;
  await uploadBuffer(key, wav, "audio/wav");
  return createSignedDownloadUrl(key, 3600);
}
