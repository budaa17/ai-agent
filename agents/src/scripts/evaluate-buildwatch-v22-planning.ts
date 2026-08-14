import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateA5Planning, renderA5PlanningEvaluationMarkdown } from "../planning/index.js";
import { buildBuildWatchOperationalSimulation } from "../simulation/index.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const agentsRoot = path.resolve(scriptDirectory, "../..");

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const output = path.resolve(
  agentsRoot,
  option("--output") ?? "data/evaluations/buildwatch-v22-planning-latest.json",
);
const markdownOutput = output.replace(/\.json$/u, ".md");
const simulation = buildBuildWatchOperationalSimulation();
const report = evaluateA5Planning(simulation);
await mkdir(path.dirname(output), { recursive: true });
await Promise.all([
  writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(markdownOutput, renderA5PlanningEvaluationMarkdown(report), "utf8"),
]);
console.log(
  `A5 planning evaluation: ${report.pass ? "PASS" : "FAIL"} (${report.cases.filter((item) => item.pass).length}/${report.cases.length})`,
);
console.log(
  `Eligible P/R=${(report.metrics.eligiblePrecision * 100).toFixed(2)}%/${(report.metrics.eligibleRecall * 100).toFixed(2)}% conflict P/R=${(report.metrics.conflictPrecision * 100).toFixed(2)}%/${(report.metrics.conflictRecall * 100).toFixed(2)}%`,
);
console.log(`Reports: ${output} | ${markdownOutput}`);
if (!report.pass) {
  process.exitCode = 1;
}
