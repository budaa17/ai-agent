import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBuildWatchOperationalSimulation } from "../simulation/index.js";
import {
  evaluateBuildWatchProgressVerification,
  renderProgressVerificationEvaluationMarkdown,
} from "../verification/index.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const agentsRoot = path.resolve(scriptDirectory, "../..");

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const output = path.resolve(
  agentsRoot,
  option("--output") ?? "data/evaluations/buildwatch-v22-progress-verification-latest.json",
);
const markdownOutput = output.replace(/\.json$/u, ".md");
const report = evaluateBuildWatchProgressVerification(buildBuildWatchOperationalSimulation());

await mkdir(path.dirname(output), { recursive: true });
await Promise.all([
  writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(markdownOutput, renderProgressVerificationEvaluationMarkdown(report), "utf8"),
]);

console.log(
  `Progress verification evaluation: ${report.pass ? "PASS" : "FAIL"} (${report.cases.filter((item) => item.pass).length}/${report.caseCount})`,
);
console.log(
  `Classification=${(report.metrics.classificationAccuracy * 100).toFixed(2)}% false-completed=${(report.metrics.falseCompletedRate * 100).toFixed(2)}% duplicate P/R=${(report.metrics.duplicatePrecision * 100).toFixed(2)}%/${(report.metrics.duplicateRecall * 100).toFixed(2)}%`,
);
console.log(
  `No-guess=${(report.metrics.unverifiableNoGuessRate * 100).toFixed(2)}% deterministic=${(report.metrics.deterministicReplayRate * 100).toFixed(2)}% apply=${report.metrics.approvedApplyProjectionPass ? "PASS" : "FAIL"}`,
);
console.log(`Reports: ${output} | ${markdownOutput}`);
if (!report.pass) {
  process.exitCode = 1;
}
