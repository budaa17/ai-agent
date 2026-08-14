import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildPhase8GoldenFixture,
  runA0Orchestration,
  runA5Orchestration,
} from "../orchestration/index.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const outputIndex = args.indexOf("--output");
const output = path.resolve(
  process.cwd(),
  outputIndex >= 0 && args[outputIndex + 1]
    ? args[outputIndex + 1]
    : "data/buildwatch-v22/phase8-agent-orchestration-bundle.json",
);
const fixture = buildPhase8GoldenFixture();
const a0 = await runA0Orchestration(fixture.a0Request, fixture.context, fixture.gateway);
const a5 = await runA5Orchestration(fixture.a5Request, fixture.context, fixture.gateway);
const bundle = {
  schemaVersion: 1,
  bundleType: "PHASE8_A0_A5_ORCHESTRATION",
  generatedAt: "2026-08-03T03:00:00.000Z",
  llmRequired: false,
  a0,
  a5,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
console.log(
  `Phase 8 orchestration: A0=${a0.run.status} tools=${a0.run.toolCalls.length}/11 reviews=${a0.reviewQueue.length}`,
);
console.log(
  `A5=${a5.run.status} tools=${a5.run.toolCalls.length}/15 reviews=${a5.reviewQueue.length} recovery=${a5.recoveryScenarios.length}`,
);
console.log(
  `Safeguards: hallucination=${a0.safeguards.numericHallucinationCount + a5.safeguards.numericHallucinationCount} unauthorized=${a0.safeguards.unauthorizedSourceCount + a5.safeguards.unauthorizedSourceCount} baselineMutation=${a0.safeguards.baselineMutationCount + a5.safeguards.baselineMutationCount}`,
);
console.log(`Output: ${output}`);
