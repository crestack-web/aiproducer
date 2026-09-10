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
import { convertBufferToWav } from "@/lib/audio/convert-to-wav";
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
  const hint = (pathHint || "").toLowerCase().split("?")[0];

  if (bytes >= 12 && isWavBuffer(buffer)) {
    return { format: "wav", contentType: "audio/wav", extension: "wav", bytes };
  }

  // Path extension is authoritative for common upload names (beats often *.mp3)
  if (hint.endsWith(".mp3") || hint.endsWith(".mpga") || hint.endsWith(".mpeg")) {
    return { format: "mp3", contentType: "audio/mpeg", extension: "mp3", bytes };
  }
  if (hint.endsWith(".flac")) {
    return { format: "flac", contentType: "audio/flac", extension: "flac", bytes };
  }
  if (hint.endsWith(".m4a") || hint.endsWith(".mp4")) {
    return { format: "m4a", contentType: "audio/mp4", extension: "m4a", bytes };
  }
  if (hint.endsWith(".wav")) {
    return { format: "wav", contentType: "audio/wav", extension: "wav", bytes };
  }
  if (hint.endsWith(".webm")) {
    return { format: "webm", contentType: "audio/webm", extension: "webm", bytes };
  }
  if (hint.endsWith(".ogg")) {
    return { format: "ogg", contentType: "audio/ogg", extension: "ogg", bytes };
  }

  // Container magic before MP3 frame scan (avoid false positives inside m4a/etc.)
  if (bytes >= 8 && buffer.toString("ascii", 4, 8) === "ftyp") {
    return { format: "m4a", contentType: "audio/mp4", extension: "m4a", bytes };
  }
  if (bytes >= 4 && buffer.toString("ascii", 0, 4) === "OggS") {
    return { format: "ogg", contentType: "audio/ogg", extension: "ogg", bytes };
  }
  if (bytes >= 4 && buffer.toString("ascii", 0, 4) === "fLaC") {
    return { format: "flac", contentType: "audio/flac", extension: "flac", bytes };
  }
  if (bytes >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { format: "webm", contentType: "audio/webm", extension: "webm", bytes };
  }

  // ID3 or MPEG frame sync (scan a short window for junk-prefixed MP3s)
  const isMpegSync = (i: number) =>
    i + 1 < bytes && buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0;
  if (bytes >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    return { format: "mp3", contentType: "audio/mpeg", extension: "mp3", bytes };
  }
  if (isMpegSync(0)) {
    return { format: "mp3", contentType: "audio/mpeg", extension: "mp3", bytes };
  }
  const scanLimit = Math.min(bytes - 1, 8192);
  for (let i = 1; i < scanLimit; i++) {
    if (isMpegSync(i)) {
      return { format: "mp3", contentType: "audio/mpeg", extension: "mp3", bytes };
    }
  }

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
  let detected = detectAudioFormat(buffer, storagePath);
  const pathLower = (storagePath || "").toLowerCase();

  // Path / name hints when magic bytes are ambiguous
  if (detected.format === "unknown") {
    if (pathLower.includes(".mp3") || pathLower.includes("mpeg")) {
      detected = { ...detected, format: "mp3", contentType: "audio/mpeg", extension: "mp3" };
    } else if (pathLower.includes(".flac")) {
      detected = { ...detected, format: "flac", contentType: "audio/flac", extension: "flac" };
    } else if (pathLower.includes(".wav")) {
      detected = { ...detected, format: "wav", contentType: "audio/wav", extension: "wav" };
    } else if (pathLower.includes(".webm")) {
      detected = { ...detected, format: "webm", contentType: "audio/webm", extension: "webm" };
    } else if (pathLower.includes(".m4a") || pathLower.includes(".mp4")) {
      detected = { ...detected, format: "m4a", contentType: "audio/mp4", extension: "m4a" };
    }
  }

  if (detected.bytes < 100) {
    throw new Error(
      `${kind === "INSTRUMENTAL" ? "Instrumental" : "Vocal"} audio is empty or too small. Your recordings are safe.`
    );
  }

  // RoEx Automix / mixpreview: WAV only (stereo, 44.1/48 kHz, 16- or 24-bit).
  // MP3 is for mastering only — always convert stems to stereo WAV before upload.
  let uploadBuffer = buffer;
  const alreadyWav = detected.format === "wav" || isWavBuffer(buffer);

  if (!alreadyWav) {
    try {
      const conv = await convertBufferToWav(buffer, storagePath);
      uploadBuffer = conv.buffer;
      console.info(
        "[produce]",
        JSON.stringify({
          event: "roex_format_converted",
          kind,
          from: detected.format,
          method: conv.method,
          outBytes: uploadBuffer.length,
        })
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `${kind} (${detected.format}) could not be converted to WAV for the mixer (${msg}). ` +
          (kind === "INSTRUMENTAL"
            ? "Re-upload the beat as WAV (44.1/48 kHz stereo). Your vocal takes are safe."
            : "Re-record the section so it saves as WAV. Your other takes are safe.")
      );
    }
  }

  try {
    uploadBuffer = ensureStereoWavForRoex(uploadBuffer);
  } catch (e) {
    console.warn("[produce] stereo WAV convert failed", kind, e);
    if (!isWavBuffer(uploadBuffer)) {
      throw new Error(
        `${kind} could not be prepared as stereo WAV for the mixer. ` +
          (kind === "INSTRUMENTAL"
            ? "Re-upload the beat as WAV. Your vocal takes are safe."
            : "Re-record the section as WAV. Your other takes are safe.")
      );
    }
  }

  const uploadFormat: DetectedAudio["format"] = "wav";
  const uploadContentType = "audio/wav";
  const uploadExt = "wav";

  console.info(
    "[produce]",
    JSON.stringify({
      event: "roex_wav_stereo_prepared",
      kind,
      from: detected.format,
      inBytes: buffer.length,
      outBytes: uploadBuffer.length,
    })
  );

  // Clean filename — RoEx rejects odd characters and non-.wav for mixing
  const safeName = `${kind.toLowerCase()}_${jobId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}.wav`;
  let readableUrl: string;
  try {
    const up = await provider.uploadStem(uploadBuffer, safeName, uploadContentType);
    readableUrl = up.readableUrl;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // One more stereo re-encode + rename attempt
    try {
      uploadBuffer = ensureStereoWavForRoex(uploadBuffer);
      const retryName = `track_${jobId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}.wav`;
      const up2 = await provider.uploadStem(uploadBuffer, retryName, "audio/wav");
      readableUrl = up2.readableUrl;
      console.info(
        "[produce]",
        JSON.stringify({ event: "roex_upload_retry_ok", kind, bytes: uploadBuffer.length })
      );
    } catch (e2) {
      const msg2 = e2 instanceof Error ? e2.message : String(e2);
      throw new Error(
        `The mixer rejected the ${kind} audio file (format not accepted). ` +
          `Tried stereo WAV ${uploadBuffer.length} bytes. ${msg}; retry: ${msg2}`
      );
    }
  }

  if (!readableUrl || !readableUrl.startsWith("http")) {
    throw new Error(`Could not prepare a readable URL for ${kind}`);
  }

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
    detected: {
      format: uploadFormat,
      contentType: uploadContentType,
      extension: uploadExt,
      bytes: uploadBuffer.length,
    },
    role: kind === "INSTRUMENTAL" ? "instrumental" : "vocal",
  };
}

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
        throw new Error(`Vocal stem ${kind} is not timeline-aligned — cannot mix`);
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
      if (det.format === "unknown" && kind !== "INSTRUMENTAL") {
        throw new Error(
          `Vocal format is not compatible with the mixer. Re-record the section so it saves as WAV. Your other takes are safe.`
        );
      }
      // Instrumental unknown is OK — prepareRoexTrack will convert or passthrough as MP3
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
  if (m.includes("instrumental") && (m.includes("missing") || m.includes("not found"))) {
    return "Instrumental/beat is missing. Add a beat before Produce. Your vocal takes are still saved.";
  }
  if (
    m.includes("beat/instrumental") ||
    m.includes("prepared as wav") ||
    m.includes("no working ffmpeg") ||
    (m.includes("instrumental") && (m.includes("wav") || m.includes("convert") || m.includes("prepared")))
  ) {
    return (
      "The beat could not be converted to stereo WAV for the mixer. " +
      "Re-upload the beat as a WAV file (44.1 or 48 kHz, stereo), then Produce again. " +
      "Your vocal takes are safe."
    );
  }
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
  if (
    m.includes("file type not accepted") ||
    m.includes("not accepted") ||
    m.includes("format rejected") ||
    m.includes("rejected") && m.includes("wav")
  ) {
    return (
      "The mixer rejected an audio file (it needs stereo WAV). " +
      "Vocals recorded in the app are usually fine — if the beat is MP3, re-upload it as WAV, or try Produce again so we can convert it. " +
      "Your vocal takes are safe."
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
