import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runPhase7GoldenPipeline } from "../baseline-generation/pipeline.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const outputIndex = args.indexOf("--output");
const output = path.resolve(
  process.cwd(),
  outputIndex >= 0 && args[outputIndex + 1]
    ? args[outputIndex + 1]
    : "data/buildwatch-v22/phase7-baseline-bundle.json",
);
const pipeline = runPhase7GoldenPipeline();
const bundle = {
  schemaVersion: 1,
  bundleType: "PHASE7_APPROVED_BASELINE",
  generatedAt: pipeline.baselineCommand.approvedVersion.metadata.approvedAt,
  quantityCommand: pipeline.quantityCommand,
  materialRequirements: pipeline.materialResult,
  estimateCommand: pipeline.estimateCommand,
  approvedSchedule: pipeline.approvedSchedule,
  baselineCommand: pipeline.baselineCommand,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
console.log(
  `Phase 7 baseline: quantity=${pipeline.quantityCommand.approvedVersion.content.items.length} material=${pipeline.materialResult.lines.length} estimate=${pipeline.estimateCommand.approvedVersion.content.lines.length} activities=${pipeline.approvedSchedule.content.activities.length}`,
);
console.log(
  `Total=${pipeline.estimateCommand.approvedVersion.content.totalMnt.value} MNT finish=${pipeline.baselineCommand.approvedVersion.content.plannedFinish}`,
);
console.log(`Output: ${output}`);
