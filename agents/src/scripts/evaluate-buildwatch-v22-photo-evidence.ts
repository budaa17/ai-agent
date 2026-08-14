import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBuildWatchOperationalSimulation } from "../simulation/index.js";
import {
  evaluateBuildWatchPhotoEvidence,
  renderPhotoEvidenceEvaluationMarkdown,
} from "../verification/index.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const agentsRoot = path.resolve(scriptDirectory, "../..");

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const output = path.resolve(
  agentsRoot,
  option("--output") ?? "data/evaluations/buildwatch-v22-photo-evidence-latest.json",
);
const markdownOutput = output.replace(/\.json$/u, ".md");
const report = evaluateBuildWatchPhotoEvidence(buildBuildWatchOperationalSimulation());
await mkdir(path.dirname(output), { recursive: true });
await Promise.all([
  writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(markdownOutput, renderPhotoEvidenceEvaluationMarkdown(report), "utf8"),
]);
console.log(
  `Photo evidence evaluation: ${report.pass ? "PASS" : "FAIL"} (${report.cases.filter((item) => item.pass).length}/${report.caseCount})`,
);
console.log(
  `Duplicate P/R=${(report.metrics.duplicatePrecision * 100).toFixed(2)}%/${(report.metrics.duplicateRecall * 100).toFixed(2)}% acceptance=${(report.metrics.acceptanceAccuracy * 100).toFixed(2)}%`,
);
console.log(`Reports: ${output} | ${markdownOutput}`);
if (!report.pass) {
  process.exitCode = 1;
}
