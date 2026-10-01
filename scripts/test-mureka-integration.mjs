/**
 * Offline checks for Mureka integration wiring (no live API calls).
 * node scripts/test-mureka-integration.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function assert(c, m) {
  if (!c) {
    console.error("FAIL:", m);
    process.exitCode = 1;
  } else console.log("ok:", m);
}

const files = [
  "lib/music-generation/mureka-client.ts",
  "lib/music-generation/mureka-provider.ts",
  "lib/music-generation/producer-spec.ts",
  "app/api/projects/[id]/build-around-vocal/route.ts",
  "app/api/projects/[id]/add-instrument/route.ts",
];
for (const f of files) {
  assert(fs.existsSync(path.join(root, f)), `exists ${f}`);
}

const types = fs.readFileSync(path.join(root, "lib/music-generation/types.ts"), "utf8");
assert(types.includes('"mureka"'), "MusicProviderName includes mureka");
assert(types.includes("around_vocal"), "job kind around_vocal");
assert(types.includes("add_instrument"), "job kind add_instrument");

const service = fs.readFileSync(path.join(root, "lib/music-generation/service.ts"), "utf8");
assert(service.includes("MurekaMusicProvider"), "service imports Mureka");
assert(service.includes('name === "mureka"'), "getMusicProvider routes mureka");

const provider = fs.readFileSync(path.join(root, "lib/music-generation/mureka-provider.ts"), "utf8");
assert(provider.includes("submitPrediction"), "submitPrediction");
assert(provider.includes("pollPrediction"), "pollPrediction");
assert(provider.includes("/v1/instrumental/generate"), "instrumental endpoint");
assert(provider.includes("buildInstrumentalPrompt"), "uses producer spec");
assert(!provider.includes("NEXT_PUBLIC_MUREKA"), "no public key");

const client = fs.readFileSync(path.join(root, "lib/music-generation/mureka-client.ts"), "utf8");
assert(client.includes("MUREKA_API_KEY"), "client uses server env key");
assert(client.includes("api.mureka.ai"), "default base URL");

const spec = fs.readFileSync(path.join(root, "lib/music-generation/producer-spec.ts"), "utf8");
assert(spec.includes("vocal pockets") || spec.includes("Vocal pockets"), "vocal space language");
assert(spec.includes("Artist-ready commercial instrumental"), "commercial instrumental bias");

const quota = fs.readFileSync(path.join(root, "lib/music-generation/beat-quota.ts"), "utf8");
assert(quota.includes("function estimatedMusicCostUsdPerSec"), "cost per-sec helper restored");

const eleven = fs.readFileSync(path.join(root, "lib/music-generation/elevenlabs-provider.ts"), "utf8");
assert(eleven.includes("ElevenLabsMusicProvider"), "ElevenLabs provider intact");

if (!process.exitCode) console.log("\nAll Mureka integration checks passed");
