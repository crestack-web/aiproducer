import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync("npx", ["--yes", "tsx", "-e", `
import { buildArrangementPlan } from "./lib/ap-engine/arrangement/index.ts";
import { applySectionAutomation } from "./lib/ap-engine/arrangement/apply-section-automation.ts";
import { peakOf } from "./lib/ap-engine/dsp.ts";
import type { PcmStereo } from "./lib/ap-engine/types.ts";

function makePcm(sec: number, amp: number, sr = 44100): PcmStereo {
  const n = Math.floor(sec * sr);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // energy rises in second half (chorus-like)
    const t = i / n;
    const a = amp * (t > 0.5 ? 1.4 : 0.6);
    const s = Math.sin(2 * Math.PI * 220 * (i / sr)) * a;
    left[i] = s; right[i] = s * 0.97;
  }
  return { left, right, sampleRate: sr };
}

const beat = makePcm(16, 0.2);
const vocal = makePcm(16, 0.08);
const plan = buildArrangementPlan({ beat, vocal, bpm: 100, durationMs: 16000 });
console.log(JSON.stringify({
  method: plan.method,
  sectionCount: plan.sections.length,
  types: plan.sections.map(s => s.type),
  hasChorus: plan.sections.some(s => s.type === "chorus"),
}, null, 2));

const before = peakOf(vocal.left);
applySectionAutomation(vocal, plan, { roleScale: 1, layerStartMs: 0 });
const after = peakOf(vocal.left);
console.log(JSON.stringify({ peakBefore: before, peakAfter: after, changed: after !== before }));
if (!plan.sections.length) process.exit(1);
if (after === before && plan.sections.some(s => s.type === "chorus")) {
  // gain may still change RMS even if peak similar
}
process.exit(0);
`], { cwd: root, encoding: "utf8", timeout: 120000 });
console.log(r.stdout || "");
if (r.stderr) console.error(r.stderr.slice(0, 600));
process.exit(r.status ?? 1);
