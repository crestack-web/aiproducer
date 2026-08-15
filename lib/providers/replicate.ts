const BASE = "https://api.replicate.com/v1";

const MUSICGEN_VERSION =
  process.env.REPLICATE_MUSICGEN_VERSION ||
  "671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb";

function apiToken(): string {
  const t = process.env.REPLICATE_API_TOKEN;
  if (!t) throw new Error("REPLICATE_API_TOKEN is not configured");
  return t;
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${apiToken()}`,
    "Content-Type": "application/json",
  };
}

export type ReplicateBeatInput = {
  genre?: string;
  mood?: string;
  tempo?: number;
  prompt?: string;
  durationSec?: number;
};

export type ReplicateBeatResult = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  provider: "replicate_musicgen";
  model: string;
  prompt: string;
  durationMs: number;
  predictionId: string;
  outputUrl: string;
};

function buildPrompt(input: ReplicateBeatInput): string {
  if (input.prompt?.trim()) {
    const p = input.prompt.trim();
    if (/no vocals|instrumental/i.test(p)) return p;
    return `${p}, instrumental only, no vocals, no singing`;
  }
  const genre = input.genre || "R&B";
  const mood = input.mood || "Emotional";
  const tempo = input.tempo || 90;
  return [
    `${mood} modern ${genre} instrumental beat`,
    "smooth drums, warm bass, soft keys",
    "polished production",
    "no vocals, no singing, instrumental only",
    `${tempo} BPM`,
    "radio-ready vocal bed",
  ].join(", ");
}

async function createPrediction(input: Record<string, unknown>) {
  const res = await fetch(`${BASE}/predictions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ version: MUSICGEN_VERSION, input }),
  });
  const json = (await res.json()) as {
    id?: string;
    status?: string;
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(`Replicate create failed (${res.status}): ${json.detail || json.error || res.statusText}`);
  }
  if (!json.id) throw new Error("Replicate response missing prediction id");
  return { id: json.id, status: json.status || "starting" };
}

async function getPrediction(id: string) {
  const res = await fetch(`${BASE}/predictions/${id}`, { headers: headers() });
  if (!res.ok) throw new Error(`Replicate poll failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as {
    status: string;
    error?: string | null;
    output?: string | string[] | null;
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function generateBeatWithReplicate(
  input: ReplicateBeatInput
): Promise<ReplicateBeatResult> {
  const prompt = buildPrompt(input);
  const duration = Math.min(Math.max(input.durationSec ?? 30, 5), 30);

  const created = await createPrediction({
    prompt,
    duration,
    model_version: process.env.REPLICATE_MUSICGEN_MODEL || "stereo-large",
    output_format: "mp3",
    normalization_strategy: "peak",
  });

  let status = created.status;
  let output: string | string[] | null | undefined;
  let error: string | null | undefined;

  for (let i = 0; i < 60; i++) {
    await sleep(i < 5 ? 2000 : 3000);
    const p = await getPrediction(created.id);
    status = p.status;
    output = p.output;
    error = p.error;
    if (status === "succeeded" || status === "failed" || status === "canceled") break;
  }

  if (status !== "succeeded") {
    throw new Error(`Replicate MusicGen ${status}: ${error || "generation did not complete"}`);
  }

  const url = Array.isArray(output) ? output[0] : output;
  if (!url || typeof url !== "string") {
    throw new Error("Replicate succeeded but returned no audio URL");
  }

  const audioRes = await fetch(url);
  if (!audioRes.ok) throw new Error(`Failed to download Replicate audio: ${audioRes.status}`);
  const buffer = Buffer.from(await audioRes.arrayBuffer());
  if (buffer.length < 1000) throw new Error("Replicate audio file too small");

  const contentType = audioRes.headers.get("content-type") || "audio/mpeg";
  const extension = contentType.includes("wav") ? "wav" : "mp3";

  return {
    buffer,
    contentType,
    extension,
    provider: "replicate_musicgen",
    model: `meta/musicgen:${MUSICGEN_VERSION.slice(0, 12)}`,
    prompt,
    durationMs: duration * 1000,
    predictionId: created.id,
    outputUrl: url,
  };
}

export function hasReplicateToken(): boolean {
  return Boolean(process.env.REPLICATE_API_TOKEN);
}
