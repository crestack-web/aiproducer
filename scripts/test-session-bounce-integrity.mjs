/**
 * Structural integrity checks for Export bounce helpers.
 * Does not require browser OfflineAudioContext.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Source-level contract checks (file exists + key symbols)
const bounceSrc = readFileSync(
  new URL("../lib/client/session-bounce.ts", import.meta.url),
  "utf8"
);
assert.match(bounceSrc, /strict/);
assert.match(bounceSrc, /Could not load/);
assert.match(bounceSrc, /never omit|Cannot export|Export failed/i);
assert.match(bounceSrc, /tailPadMs/);
assert.match(bounceSrc, /bounceSessionToWavDetailed/);
assert.match(bounceSrc, /near-silent/);

const cleanSrc = readFileSync(
  new URL("../lib/audio/preview-clean.ts", import.meta.url),
  "utf8"
);
assert.match(cleanSrc, /cleanVocalChannelInPlace/);
assert.match(cleanSrc, /deClickInPlacePreview/);

const policySrc = readFileSync(
  new URL("../lib/audio/cleanup-policy.ts", import.meta.url),
  "utf8"
);
assert.match(policySrc, /CLEANUP_POLICY_VERSION/);

const fpSrc = readFileSync(
  new URL("../lib/ap-engine/jobs/fast-produce.ts", import.meta.url),
  "utf8"
);
assert.match(fpSrc, /artistCleanup/);

console.log("test-session-bounce-integrity: ok");
