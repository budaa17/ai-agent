import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateOperationalForecast,
  renderOperationalForecastEvaluationMarkdown,
} from "../forecasting/index.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const agentsRoot = path.resolve(scriptDirectory, "../..");

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const output = path.resolve(
  agentsRoot,
  option("--output") ?? "data/evaluations/buildwatch-v22-operational-forecast-latest.json",
);
const markdownOutput = output.replace(/\.json$/u, ".md");
const report = evaluateOperationalForecast();

await mkdir(path.dirname(output), { recursive: true });
await Promise.all([
  writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(markdownOutput, renderOperationalForecastEvaluationMarkdown(report), "utf8"),
]);

console.log(
  `Operational forecast evaluation: ${report.pass ? "PASS" : "FAIL"} (${report.cases.filter((item) => item.pass).length}/${report.caseCount})`,
);
console.log(
  `Finish MAE=${report.metrics.finishMaeWorkingDays.toFixed(2)}d critical recall=${(report.metrics.criticalDelayRecall * 100).toFixed(2)}% early warning=${report.metrics.averageEarlyWarningWorkingDays.toFixed(2)}d false alerts=${(report.metrics.falseAlertRate * 100).toFixed(2)}%`,
);
console.log(
  `Sources=${(report.metrics.sourceCoverage * 100).toFixed(2)}% deterministic=${(report.metrics.deterministicReplayRate * 100).toFixed(2)}% recovery=${(report.metrics.recoveryCoverage * 100).toFixed(2)}% baseline mutations=${report.metrics.baselineMutationCount}`,
);
console.log(`Reports: ${output} | ${markdownOutput}`);
if (!report.pass) {
  process.exitCode = 1;
}
