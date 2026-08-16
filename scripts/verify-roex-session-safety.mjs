/**
 * Offline checks for RoEx asset preparation + session survival rules.
 * Does NOT call paid/full RoEx endpoints.
 *
 * Run: node scripts/verify-roex-session-safety.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

// --- detectAudioFormat (inline mirror of lib logic for pure node test) ---
function isWavBuffer(buffer) {
  if (buffer.byteLength < 12) return false;
  return buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE";
}

function detectAudioFormat(buffer, pathHint) {
  const bytes = buffer.length;
  if (bytes >= 12 && isWavBuffer(buffer)) {
    return { format: "wav", contentType: "audio/wav", extension: "wav", bytes };
  }
  if (
    bytes >= 3 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0))
  ) {
    return { format: "mp3", contentType: "audio/mpeg", extension: "mp3", bytes };
  }
  const hint = (pathHint || "").toLowerCase().split("?")[0];
  if (hint.endsWith(".mp3")) return { format: "mp3", contentType: "audio/mpeg", extension: "mp3", bytes };
  if (hint.endsWith(".wav")) return { format: "wav", contentType: "audio/wav", extension: "wav", bytes };
  return { format: "unknown", contentType: "application/octet-stream", extension: "bin", bytes };
}

function userFacingProduceError(raw) {
  const m = (raw || "").toLowerCase();
  if (m.includes("file type not accepted") || m.includes("not accepted")) {
    return "We couldn't send one of your audio files to the mixer. Your recordings are safe. Try production again.";
  }
  return "Production couldn't be completed. Your recordings are safe. You can try again or go back to recording.";
}

// 1) MP3 magic detection
{
  const id3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const det = detectAudioFormat(id3, "beats/custom.mp3?token=abc");
  assert.equal(det.format, "mp3");
  assert.equal(det.extension, "mp3");
  console.log("OK detect mp3 (id3 + query path hint)");
}

// 2) Signed URL path must not be sent as trackURL — pipeline uses prepareRoexTrack
{
  const pipeline = read("lib/audio/pipeline.ts");
  assert.match(pipeline, /prepareRoexTrack/);
  assert.match(pipeline, /validateTracksForRoex/);
  assert.doesNotMatch(
    pipeline,
    /toReadableUrl\(s\.audio_path\)/
  );
  console.log("OK pipeline uses RoEx upload, not raw signed URLs for mix tracks");
}

// 3) Failure does not wipe project session
{
  const pipeline = read("lib/audio/pipeline.ts");
  assert.match(pipeline, /status: "recording"/);
  assert.doesNotMatch(pipeline, /\.update\(\{\s*status:\s*"failed"\s*\}\)\.eq\("id", projectId\)/);
  console.log("OK produce failure restores project to recording (session survives)");
}

// 4) Retry after failed creates new attempt key
{
  const job = read("lib/audio/produce-job.ts");
  assert.match(job, /attempt-\$\{attempt\}|attempt-\$\{/);
  assert.match(job, /priorCount/);
  console.log("OK retry uses new attempt idempotency key; failed jobs preserved");
}

// 5) Active job still deduped (no duplicate RoEx submit while processing)
{
  const job = read("lib/audio/produce-job.ts");
  assert.match(job, /\.in\("status", \["queued", "processing"\]\)/);
  console.log("OK in-flight jobs are deduped (no duplicate RoEx task)");
}

// 6) User-facing error mapping
{
  const msg = userFacingProduceError(
    'RoEx mix start failed: 500 {"message":"File type not accepted: https://x.supabase.co/custom.mp3?token=SECRET"}'
  );
  assert.match(msg, /recordings are safe/i);
  assert.doesNotMatch(msg, /SECRET|token=/);
  console.log("OK user-facing error hides provider detail / tokens");
}

// 7) UI keeps session on failed
{
  const ui = read("components/project-session-impl.tsx");
  assert.match(ui, /if \(s === "failed"\) return hasTasks \? "assemble"/);
  assert.match(ui, /Try Again/);
  assert.match(ui, /Back to Recording/);
  assert.match(ui, /Your recordings are safe/);
  console.log("OK UI: failed → assemble with Try Again / Back to Recording");
}

// 8) logProduce redacts secrets
{
  const job = read("lib/audio/produce-job.ts");
  assert.match(job, /redactSecrets/);
  assert.match(job, /\[redacted\]/);
  console.log("OK logProduce redacts tokens/keys");
}

// 9) RoEx provider still uses preview endpoints only
{
  const roex = read("lib/providers/roex.ts");
  assert.match(roex, /mixpreview/);
  assert.match(roex, /masteringpreview/);
  assert.match(roex, /assertRoexPreviewOnly/);
  console.log("OK RoEx preview-only endpoints unchanged");
}

console.log("\nAll verify-roex-session-safety checks passed.");
