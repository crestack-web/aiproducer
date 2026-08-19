/**
 * Provider-safe audio assets for RoEx.
 *
 * RoEx rejects many Supabase signed URLs ("File type not accepted") because:
 * - extension is buried after ?token=...
 * - external signed URLs are harder for RoEx to classify than their own readable URLs
 *
 * Strategy: download from our storage server-side → upload via RoEx /upload →
 * use the returned readable_url (clean host/path, no query tokens).
 */

import { createServiceClient } from "@/lib/supabase/server";
import { getStorageBucket, isStoragePath } from "@/lib/storage";
import { ensureStereoWavForRoex, isWavBuffer } from "@/lib/audio/wav";
import type { AudioMixProvider, StemKind } from "@/lib/audio/types";

export type DetectedAudio = {
  format: "wav" | "mp3" | "m4a" | "ogg" | "webm" | "flac" | "unknown";
  contentType: string;
  extension: string;
  bytes: number;
};

/** Detect format from magic bytes first, then filename hint. */
export function detectAudioFormat(buffer: Buffer, pathHint?: string): DetectedAudio {
  const bytes = buffer.length;
  if (bytes >= 12 && isWavBuffer(buffer)) {
    return { format: "wav", contentType: "audio/wav", extension: "wav", bytes };
  }
  // ID3 or MPEG frame sync
  if (
    bytes >= 3 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0))
  ) {
    return { format: "mp3", contentType: "audio/mpeg", extension: "mp3", bytes };
  }
  if (bytes >= 8 && buffer.toString("ascii", 4, 8) === "ftyp") {
    return { format: "m4a", contentType: "audio/mp4", extension: "m4a", bytes };
  }
  if (bytes >= 4 && buffer.toString("ascii", 0, 4) === "OggS") {
    return { format: "ogg", contentType: "audio/ogg", extension: "ogg", bytes };
  }
  if (bytes >= 4 && buffer.toString("ascii", 0, 4) === "fLaC") {
    return { format: "flac", contentType: "audio/flac", extension: "flac", bytes };
  }
  // EBML (webm/matroska)
  if (bytes >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { format: "webm", contentType: "audio/webm", extension: "webm", bytes };
  }

  const hint = (pathHint || "").toLowerCase().split("?")[0];
  if (hint.endsWith(".wav")) return { format: "wav", contentType: "audio/wav", extension: "wav", bytes };
  if (hint.endsWith(".mp3")) return { format: "mp3", contentType: "audio/mpeg", extension: "mp3", bytes };
  if (hint.endsWith(".m4a") || hint.endsWith(".mp4"))
    return { format: "m4a", contentType: "audio/mp4", extension: "m4a", bytes };
  if (hint.endsWith(".ogg")) return { format: "ogg", contentType: "audio/ogg", extension: "ogg", bytes };
  if (hint.endsWith(".flac")) return { format: "flac", contentType: "audio/flac", extension: "flac", bytes };
  if (hint.endsWith(".webm")) return { format: "webm", contentType: "audio/webm", extension: "webm", bytes };

  return { format: "unknown", contentType: "application/octet-stream", extension: "bin", bytes };
}

/** Formats RoEx mixpreview commonly accepts when served from their own readable URLs. */
export const ROEX_PREFERRED_EXTENSIONS = new Set(["wav", "mp3", "flac"]);

export async function downloadStorageOrUrl(pathOrUrl: string): Promise<Buffer> {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    const res = await fetch(pathOrUrl);
    if (!res.ok) throw new Error(`Could not download audio asset (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error("Downloaded audio asset is empty or too small");
    return buf;
  }
  if (!isStoragePath(pathOrUrl)) {
    throw new Error(`Invalid storage path for provider asset: ${pathOrUrl.slice(0, 80)}`);
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(getStorageBucket()).download(pathOrUrl);
  if (error || !data) {
    throw new Error(`Could not download from storage: ${error?.message || pathOrUrl}`);
  }
  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length < 100) throw new Error(`Storage audio too small (${buf.length} bytes)`);
  return buf;
}

export type PreparedTrack = {
  kind: StemKind;
  storagePath: string;
  providerUrl: string;
  detected: DetectedAudio;
  role: string;
};

/**
 * Prepare one track for RoEx: download → detect format → upload via RoEx → readable URL.
 * Never logs tokens or signed query strings.
 */
export async function prepareRoexTrack(opts: {
  provider: AudioMixProvider;
  storagePath: string;
  kind: StemKind;
  jobId: string;
  projectId: string;
}): Promise<PreparedTrack> {
  const { provider, storagePath, kind, jobId, projectId } = opts;
  const buffer = await downloadStorageOrUrl(storagePath);
  const detected = detectAudioFormat(buffer, storagePath);

  if (detected.format === "unknown" || detected.bytes < 100) {
    throw new Error(
      `${kind === "INSTRUMENTAL" ? "Instrumental" : "Vocal"} format is not compatible with RoEx. ` +
        `Detected unknown/empty audio for ${kind}. Preparing a compatible audio asset is required.`
    );
  }

  if (detected.format === "webm" || detected.format === "ogg" || detected.format === "m4a") {
    throw new Error(
      `${kind} format (${detected.format}) is not compatible with RoEx mix. ` +
        `RoEx requires stereo WAV. Re-record this part so it saves as WAV. Your recordings are safe.`
    );
  }

  // RoEx mix requires stereo WAV (44.1/48k, 16-bit). Our timeline stems are mono — dual to L/R.
  let uploadBuffer = buffer;
  let uploadFormat = detected.format;
  let uploadContentType = detected.contentType;
  let uploadExt = detected.extension;

  if (detected.format === "wav" || isWavBuffer(buffer)) {
    try {
      uploadBuffer = ensureStereoWavForRoex(buffer);
      uploadFormat = "wav";
      uploadContentType = "audio/wav";
      uploadExt = "wav";
      console.info(
        "[produce]",
        JSON.stringify({
          event: "roex_wav_stereo_prepared",
          kind,
          inBytes: buffer.length,
          outBytes: uploadBuffer.length,
        })
      );
    } catch (e) {
      console.warn("[produce] stereo WAV convert failed", kind, e);
      // still try original
    }
  } else if (detected.format === "mp3") {
    // Tonn API accepts MP3; Automix product prefers WAV — keep mp3 for instrumental beats
    uploadContentType = "audio/mpeg";
    uploadExt = "mp3";
  } else if (detected.format === "flac") {
    uploadContentType = "audio/flac";
    uploadExt = "flac";
  }

  const safeName = `${kind.toLowerCase()}_${jobId.slice(0, 8)}.${uploadExt}`;
  let readableUrl: string;
  try {
    const up = await provider.uploadStem(uploadBuffer, safeName, uploadContentType);
    readableUrl = up.readableUrl;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `RoEx upload failed for ${kind} (${uploadFormat}, ${uploadBuffer.length} bytes): ${msg}`
    );
  }

  if (!readableUrl || !readableUrl.startsWith("http")) {
    throw new Error(`RoEx did not return a readable URL for ${kind}`);
  }

  // Safe metadata only — no tokens
  console.info(
    "[produce]",
    JSON.stringify({
      event: "roex_asset_prepared",
      projectId,
      jobId,
      kind,
      format: uploadFormat,
      bytes: uploadBuffer.length,
      filename: safeName,
      // host only, no query
      provider_host: (() => {
        try {
          return new URL(readableUrl).host;
        } catch {
          return "invalid";
        }
      })(),
    })
  );

  return {
    kind,
    storagePath,
    providerUrl: readableUrl,
    detected,
    role: kind === "INSTRUMENTAL" ? "instrumental" : "vocal",
  };
}

/**
 * Validate every stem before contacting RoEx mix API.
 * Throws a user-facing message if invalid; logs safe metadata only.
 */
export async function validateTracksForRoex(
  stems: { audio_path: string; kind: string; metadata?: Record<string, unknown> | null }[]
): Promise<void> {
  for (const s of stems) {
    const kind = s.kind;
    if (!s.audio_path || !isStoragePath(s.audio_path)) {
      throw new Error(
        `${kind === "INSTRUMENTAL" ? "Instrumental" : "Vocal"} source is missing from storage. Your recordings are safe.`
      );
    }
    if (kind !== "INSTRUMENTAL") {
      const meta = (s.metadata || {}) as Record<string, unknown>;
      if (meta.timeline_aligned !== true) {
        throw new Error(`Vocal stem ${kind} is not timeline-aligned — refusing RoEx mix`);
      }
    }
    // Existence / downloadability check without logging path tokens
    try {
      const buf = await downloadStorageOrUrl(s.audio_path);
      const det = detectAudioFormat(buf, s.audio_path);
      console.info(
        "[produce]",
        JSON.stringify({
          event: "track_validated",
          kind,
          format: det.format,
          bytes: det.bytes,
          role: kind === "INSTRUMENTAL" ? "instrumental" : "vocal",
        })
      );
      if (det.format === "unknown") {
        throw new Error(
          `${kind === "INSTRUMENTAL" ? "Instrumental" : "Vocal"} format is not compatible with RoEx. ` +
            `Preparing a compatible audio asset.`
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("compatible")) throw e;
      throw new Error(
        `Could not read ${kind} audio from storage. Your recordings are safe. Try production again.`
      );
    }
  }
}

/** Map provider errors to user-facing copy; keep detail in logs. */
export function userFacingProduceError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (
    m.includes("not wav") ||
    m.includes("is not wav") ||
    m.includes("webm") ||
    m.includes("re-record") ||
    (m.includes("format") && (m.includes("compatible") || m.includes("unknown")))
  ) {
    return (
      "One or more takes are still in a phone format the mixer can't use. " +
      "Open those sections, record again (they save as WAV), then Produce. Your earlier takes stay saved."
    );
  }
  if (m.includes("file type not accepted") || m.includes("not accepted")) {
    return (
      "We couldn't send one of your audio files to the mixer (format rejected). " +
      "Your recordings are safe. Try Produce again; if it keeps failing, re-record the affected section so it saves as WAV."
    );
  }
  if (m.includes("compatible") || m.includes("format")) {
    return raw.includes("Your recordings")
      ? raw
      : `${raw} Your recordings are safe.`;
  }
  if (m.includes("no recordings") || m.includes("no saved vocal")) {
    return raw;
  }
  if (m.includes("instrumental") && m.includes("missing")) {
    return "Instrumental/beat is missing. Add a beat before Produce. Your vocal takes are still saved.";
  }
  if (m.includes("roex upload failed") || m.includes("upload url failed") || m.includes("signed put failed")) {
    return "We couldn't send one of your audio files to the mixer. Your recordings are safe. Try production again.";
  }
  return "Production couldn't be completed. Your recordings are safe. You can try again or go back to recording.";
}
