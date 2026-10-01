/**
 * Isolated Mureka HTTP client (server-side only).
 * Official API: https://api.mureka.ai  (Bearer MUREKA_API_KEY)
 * Docs: https://platform.mureka.ai/docs/en/quickstart.html
 */

export type MurekaTaskStatus =
  | "preparing"
  | "running"
  | "succeeded"
  | "failed"
  | "timeouted"
  | "cancelled"
  | string;

export type MurekaChoice = {
  index?: number;
  url?: string;
  flac_url?: string;
  wav_url?: string;
  duration?: number;
  [k: string]: unknown;
};

export type MurekaTask = {
  id: string;
  created_at?: number;
  finished_at?: number;
  model?: string;
  status?: MurekaTaskStatus;
  failed_reason?: string;
  trace_id?: string;
  choices?: MurekaChoice[] | MurekaChoice;
  error?: { message?: string };
  [k: string]: unknown;
};

export type MurekaFileUploadResult = {
  id: string;
  [k: string]: unknown;
};

const DEFAULT_BASE = "https://api.mureka.ai";

function apiKey(): string {
  const k = (process.env.MUREKA_API_KEY || "").trim();
  if (!k) throw new Error("MUREKA_API_KEY is not configured");
  return k;
}

function baseUrl(): string {
  return (process.env.MUREKA_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return { raw: text };
  }
}

export async function murekaPost(
  path: string,
  body: Record<string, unknown>,
  opts?: { timeoutMs?: number }
): Promise<{ status: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 60_000);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await parseJson(res);
    return { status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

export async function murekaGet(
  path: string,
  opts?: { timeoutMs?: number }
): Promise<{ status: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const data = await parseJson(res);
    return { status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

/** Upload audio for reference / melody / voice (multipart). */
export async function murekaUploadFile(
  buffer: Buffer,
  filename: string,
  purpose: "reference" | "melody" | "instrumental" | "voice" | "audio",
  opts?: { timeoutMs?: number }
): Promise<MurekaFileUploadResult> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 90_000);
  try {
    const form = new FormData();
    form.append("purpose", purpose);
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: "audio/mpeg" }),
      filename
    );
    const res = await fetch(`${baseUrl()}/v1/files/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        Accept: "application/json",
      },
      body: form,
      signal: controller.signal,
    });
    const data = await parseJson(res);
    if (!res.ok) {
      const msg =
        (data.error as { message?: string } | undefined)?.message ||
        (typeof data.message === "string" ? data.message : `upload failed ${res.status}`);
      throw new Error(String(msg));
    }
    const id = String(data.id || "");
    if (!id) throw new Error("Mureka file upload returned no id");
    return { id, ...data };
  } finally {
    clearTimeout(t);
  }
}

export function asMurekaTask(data: Record<string, unknown>): MurekaTask {
  return {
    id: String(data.id || ""),
    created_at: typeof data.created_at === "number" ? data.created_at : undefined,
    finished_at: typeof data.finished_at === "number" ? data.finished_at : undefined,
    model: typeof data.model === "string" ? data.model : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
    failed_reason: typeof data.failed_reason === "string" ? data.failed_reason : undefined,
    trace_id: typeof data.trace_id === "string" ? data.trace_id : undefined,
    choices: data.choices as MurekaChoice[] | MurekaChoice | undefined,
    error: data.error as { message?: string } | undefined,
    ...data,
  };
}

export function normalizeChoices(choices: MurekaTask["choices"]): MurekaChoice[] {
  if (!choices) return [];
  if (Array.isArray(choices)) return choices;
  return [choices];
}

export function pickAudioUrl(choice: MurekaChoice | undefined): string | null {
  if (!choice) return null;
  const url = choice.url || choice.wav_url || choice.flac_url;
  return typeof url === "string" && url.startsWith("http") ? url : null;
}

export function isTerminalStatus(status: string | undefined): boolean {
  const s = (status || "").toLowerCase();
  return s === "succeeded" || s === "failed" || s === "timeouted" || s === "cancelled";
}

export function isSuccessStatus(status: string | undefined): boolean {
  return (status || "").toLowerCase() === "succeeded";
}

export function isMurekaConfigured(): boolean {
  return Boolean((process.env.MUREKA_API_KEY || "").trim());
}
