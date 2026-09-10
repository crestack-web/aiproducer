import { encodeStereoWav } from "../dsp";
import type { PcmStereo } from "../types";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { spawn } from "child_process";
import { resolveFfmpegBin } from "@/lib/audio/convert-to-wav";

export function exportWav(pcm: PcmStereo): Buffer {
  return encodeStereoWav(pcm);
}

export async function exportMp3(pcm: PcmStereo): Promise<Buffer | null> {
  const bin = await resolveFfmpegBin();
  if (!bin) return null;
  const wav = exportWav(pcm);
  const id = randomBytes(6).toString("hex");
  const inPath = join(tmpdir(), `ap-out-${id}.wav`);
  const outPath = join(tmpdir(), `ap-out-${id}.mp3`);
  try {
    await writeFile(inPath, wav);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bin, ["-y", "-i", inPath, "-codec:a", "libmp3lame", "-b:a", "320k", outPath], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let err = "";
      proc.stderr?.on("data", (d) => {
        err += String(d);
      });
      proc.on("error", reject);
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-300) || `ffmpeg ${code}`))));
    });
    const { readFile } = await import("fs/promises");
    return await readFile(outPath);
  } catch {
    return null;
  } finally {
    await unlink(inPath).catch(() => undefined);
    await unlink(outPath).catch(() => undefined);
  }
}
