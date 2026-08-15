/**
 * Mistral AI chat client (server-side only).
 * Docs: POST https://api.mistral.ai/v1/chat/completions
 * Auth: Authorization: Bearer $MISTRAL_API_KEY
 */

export type MistralMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type MistralChatOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
};

const DEFAULT_MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";

export function isMistralConfigured(): boolean {
  return Boolean(process.env.MISTRAL_API_KEY?.trim());
}

export function getMistralModel(): string {
  return process.env.MISTRAL_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Chat completion via official Mistral HTTP API.
 * Never logs or returns the API key.
 */
export async function mistralChat(
  messages: MistralMessage[],
  opts: MistralChatOptions = {}
): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY is not configured");
  }

  const model = opts.model || getMistralModel();
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 2048,
  };

  if (opts.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const safe = text.slice(0, 400).replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
    if (res.status === 401) throw new Error(`Mistral auth failed (401). Check MISTRAL_API_KEY.`);
    if (res.status === 402) throw new Error(`Mistral billing required (402).`);
    if (res.status === 429) throw new Error(`Mistral rate limited (429). Retry shortly.`);
    throw new Error(`Mistral API error ${res.status}: ${safe || res.statusText}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Mistral returned empty content");
  }
  return content.trim();
}
