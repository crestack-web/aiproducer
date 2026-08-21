/**
 * Server-side: convert phone capture formats to stereo 16-bit WAV for RoEx.
 * Resolves ffmpeg from: FFMPEG_PATH → ffmpeg-static → PATH → /usr/bin/ffmpeg.
 */
import { spawn } from "child_process";
import { randomBytes } from "crypto";
import { access } from "fs/promises";
import { readFile, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { isWavBuffer } from "@/lib/audio/wav";

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr?.on("data", (d) => {
      err += String(d);
    });
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-500) || `ffmpeg exit ${code}`));
    });
  });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Resolve an ffmpeg binary path, or null if none. */
export async function resolveFfmpegBin(): Promise<string | null> {
  if (process.env.FFMPEG_PATH && (await pathExists(process.env.FFMPEG_PATH))) {
    return process.env.FFMPEG_PATH;
  }
  try {
    // Optional dependency — present when npm install ffmpeg-static succeeds
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require("ffmpeg-static") as string | null;
    if (staticPath && (await pathExists(staticPath))) return staticPath;
  } catch {
    /* not installed */
  }
  for (const candidate of ["ffmpeg", "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) {
    try {
      await runFfmpeg(candidate, ["-version"]);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function ffmpegAvailable(): Promise<boolean> {
  return Boolean(await resolveFfmpegBin());
}

/**
 * Convert arbitrary audio bytes to stereo 44.1kHz 16-bit PCM WAV.
 * If input is already WAV, returns as-is.
 */
export async function convertBufferToWav(
  input: Buffer,
  pathHint?: string
): Promise<{ buffer: Buffer; converted: boolean; method: string }> {
  if (isWavBuffer(input)) {
    return { buffer: input, converted: false, method: "already_wav" };
  }

  const bin = await resolveFfmpegBin();
  if (!bin) {
    throw new Error(
      "This take is not WAV and the server cannot convert it (no ffmpeg). " +
        "Re-record the section so the app saves WAV, then Produce again."
    );
  }

  const hint = (pathHint || "").toLowerCase().split("?")[0];
  let ext = "webm";
  if (hint.endsWith(".webm") || (input.length >= 4 && input[0] === 0x1a)) ext = "webm";
  else if (hint.endsWith(".ogg") || input.toString("ascii", 0, 4) === "OggS") ext = "ogg";
  else if (hint.endsWith(".m4a") || hint.endsWith(".mp4")) ext = "m4a";
  else if (hint.endsWith(".mp3")) ext = "mp3";
  else if (hint.endsWith(".flac")) ext = "flac";

  const id = randomBytes(8).toString("hex");
  const inPath = join(tmpdir(), `aiproducer-in-${id}.${ext}`);
  const outPath = join(tmpdir(), `aiproducer-out-${id}.wav`);

  try {
    await writeFile(inPath, input);
    await runFfmpeg(bin, [
      "-y",
      "-i",
      inPath,
      "-ac",
      "2",
      "-ar",
      "44100",
      "-c:a",
      "pcm_s16le",
      outPath,
    ]);
    const out = await readFile(outPath);
    if (!isWavBuffer(out) || out.length < 100) {
      throw new Error("ffmpeg produced invalid WAV");
    }
    return { buffer: out, converted: true, method: `ffmpeg:${bin}` };
  } finally {
    await unlink(inPath).catch(() => undefined);
    await unlink(outPath).catch(() => undefined);
  }
}
