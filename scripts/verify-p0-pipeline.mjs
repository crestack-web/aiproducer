/**
 * Lightweight static verification of P0 production-pipeline invariants.
 * Run: node scripts/verify-p0-pipeline.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
function read(rel) {
  return readFileSync(resolve(root, rel), "utf8");
}

const fails = [];
function assert(cond, msg) {
  if (!cond) fails.push(msg);
  else console.log("OK:", msg);
}

const pipeline = read("lib/audio/pipeline.ts");
const roex = read("lib/providers/roex.ts");
const storage = read("lib/storage.ts");
const produce = read("app/api/projects/[id]/produce/route.ts");
const env = read("lib/env.ts");
const envEx = read(".env.example");

// Permanent storage
assert(storage.includes("productionMixPath"), "storage has productionMixPath");
assert(storage.includes("productionMasterPath"), "storage has productionMasterPath");
assert(storage.includes("persistRemoteAudioToStorage"), "storage has persistRemoteAudioToStorage");
assert(pipeline.includes("persistRemoteAudioToStorage"), "pipeline persists remote audio");
assert(pipeline.includes("productionMixPath"), "pipeline uses productionMixPath");
assert(pipeline.includes("productionMasterPath"), "pipeline uses productionMasterPath");
assert(pipeline.includes("mix_storage_path"), "pipeline tracks mix_storage_path");
assert(pipeline.includes("master_storage_path"), "pipeline tracks master_storage_path");
assert(!/audio_path:\s*mixPath/.test(pipeline) || pipeline.includes("storagePath"), "audio_path uses storage path");

// Resume / idempotency
assert(pipeline.includes("mix_provider_task_id"), "pipeline stores mix_provider_task_id");
assert(pipeline.includes("master_provider_task_id"), "pipeline stores master_provider_task_id");
assert(pipeline.includes("mix_resume_existing"), "pipeline resumes existing mix task");
assert(pipeline.includes("master_resume_existing"), "pipeline resumes existing master task");
assert(pipeline.includes("if (out.mix_provider_task_id)"), "mix submit checks existing task id");
assert(pipeline.includes("if (out.master_provider_task_id)"), "master submit checks existing task id");

// Async produce
assert(produce.includes("status: result.deduped") || produce.includes("{ status:"), "produce returns status");
assert(produce.includes("202"), "produce returns HTTP 202");
assert(produce.includes("void tickProduceJob") || produce.includes("tickProduceJob"), "produce does not block on full lifecycle");
assert(produce.includes("maxWorkMs"), "tick uses maxWorkMs budget");
assert(pipeline.includes("maxWorkMs"), "pipeline accepts maxWorkMs");

// Ownership
assert(produce.includes('.eq("user_id", user.id)'), "produce route filters by user_id");
assert(pipeline.includes("Project not found or not owned by user"), "enqueue checks ownership");

// RoEx safety
assert(env.includes("getRoexEnv"), "env has getRoexEnv");
assert(env.includes("ROEX_FULL_PRODUCTION_DISABLED_IN_TEST") || env.includes("assertRoexPreviewOnly"), "env blocks full in test");
assert(roex.includes("mixpreview"), "roex uses mixpreview");
assert(roex.includes("masteringpreview"), "roex uses masteringpreview");
assert(roex.includes("retrievepreviewmix"), "roex uses retrievepreviewmix");
assert(roex.includes("retrievepreviewmaster"), "roex uses retrievepreviewmaster");
assert(roex.includes("ROEX_FULL_PRODUCTION_DISABLED_IN_TEST"), "roex rejects full in test");
assert(envEx.includes("ROEX_ENV=test"), "env.example sets ROEX_ENV=test");
assert(envEx.includes("ROEX_ALLOW_FULL=false"), "env.example sets ROEX_ALLOW_FULL=false");
assert(envEx.includes("MUSIC_GENERATION_MODE=mock"), "env.example mocks music generation");

if (fails.length) {
  console.error("\nFAILED:");
  for (const f of fails) console.error(" -", f);
  process.exit(1);
}
console.log("\nAll P0 static checks passed.\n");
