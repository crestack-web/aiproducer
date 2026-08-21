/**
 * Server-side: convert phone capture formats (webm/ogg/m4a) to stereo 16-bit WAV
 * for RoEx / timeline alignment. Uses ffmpeg when available on the host.
 */
import { spawn } from "child_process";
import { randomBytes } from "crypto";
import { readFile, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { isWavBuffer } from "@/lib/audio/wav";

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr?.on("data", (d) => {
      err += String(d);
    });
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-400) || `ffmpeg exit ${code}`));
    });
  });
}

export async function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Convert arbitrary audio bytes to stereo 44.1kHz 16-bit PCM WAV.
 * If input is already WAV, returns as-is (caller may still stereo-normalize).
 */
export async function convertBufferToWav(
  input: Buffer,
  pathHint?: string
): Promise<{ buffer: Buffer; converted: boolean; method: string }> {
  if (isWavBuffer(input)) {
    return { buffer: input, converted: false, method: "already_wav" };
  }

  if (!(await ffmpegAvailable())) {
    throw new Error(
      "This take is not WAV and the server cannot convert it (ffmpeg unavailable). " +
        "Re-record so the app saves WAV, or try Produce after a fresh take."
    );
  }

  const hint = (pathHint || "").toLowerCase().split("?")[0];
  let ext = "bin";
  if (hint.endsWith(".webm") || input[0] === 0x1a) ext = "webm";
  else if (hint.endsWith(".ogg") || input.toString("ascii", 0, 4) === "OggS") ext = "ogg";
  else if (hint.endsWith(".m4a") || hint.endsWith(".mp4")) ext = "m4a";
  else if (hint.endsWith(".mp3")) ext = "mp3";
  else ext = "webm"; // MediaRecorder default

  const id = randomBytes(8).toString("hex");
  const inPath = join(tmpdir(), `aiproducer-in-${id}.${ext}`);
  const outPath = join(tmpdir(), `aiproducer-out-${id}.wav`);

  try {
    await writeFile(inPath, input);
    await runFfmpeg([
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
    return { buffer: out, converted: true, method: "ffmpeg" };
  } finally {
    await unlink(inPath).catch(() => undefined);
    await unlink(outPath).catch(() => undefined);
  }
}
