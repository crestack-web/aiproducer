import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

/**
 * GET /api/music/health
 * Authenticated diagnostic: key presence + ElevenLabs /v1/user + optional short music probe.
 * Query: ?probe=1 to attempt a 4s instrumental (uses real credits).
 */
export async function GET(req: Request) {
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw =
    process.env.ELEVENLABS_API_KEY?.trim() ||
    process.env.ELEVEN_API_KEY?.trim() ||
    process.env.XI_API_KEY?.trim() ||
    "";
  let key = raw;
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }

  const base = (process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/$/, "");
  const model =
    process.env.ELEVENLABS_MUSIC_MODEL?.trim() ||
    process.env.ELEVEN_MUSIC_MODEL?.trim() ||
    "music_v1";

  const out: Record<string, unknown> = {
    keyConfigured: key.length > 0,
    keyLength: key.length,
    keyLast4: key.length >= 4 ? key.slice(-4) : null,
    modelDefault: model,
    base,
    providerEnv: process.env.MUSIC_GENERATION_PROVIDER || "(auto)",
    note:
      "AP Studio subscription is separate from ElevenLabs. Music API must be enabled on the ElevenLabs account that owns this API key.",
  };

  if (!key) {
    out.userCheck = { ok: false, error: "No ELEVENLABS_API_KEY in this deployment env" };
    return NextResponse.json(out, { status: 200 });
  }

  try {
    const userRes = await fetch(`${base}/v1/user`, {
      headers: { "xi-api-key": key },
    });
    const userText = await userRes.text();
    out.userCheck = {
      ok: userRes.ok,
      status: userRes.status,
      bodyPreview: userText.slice(0, 200),
    };
  } catch (e) {
    out.userCheck = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const url = new URL(req.url);
  if (url.searchParams.get("probe") === "1") {
    try {
      const musicRes = await fetch(`${base}/v1/music?output_format=mp3_44100_128`, {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg, application/json",
        },
        body: JSON.stringify({
          prompt: "Short instrumental groove, drums and bass only, no vocals",
          music_length_ms: 4000,
          force_instrumental: true,
          model_id: model,
        }),
      });
      const ct = musicRes.headers.get("content-type") || "";
      let bodyPreview = "";
      if (!musicRes.ok || ct.includes("json")) {
        bodyPreview = (await musicRes.text()).slice(0, 300);
      } else {
        const buf = Buffer.from(await musicRes.arrayBuffer());
        bodyPreview = `audio bytes=${buf.length}`;
      }
      out.musicProbe = {
        ok: musicRes.ok,
        status: musicRes.status,
        contentType: ct,
        bodyPreview,
      };
    } catch (e) {
      out.musicProbe = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json(out);
}
