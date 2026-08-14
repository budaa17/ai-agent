import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateBaselineGenerationV22 } from "../baseline-generation/evaluation.js";

function outputPath(): string {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const index = args.indexOf("--output");
  return path.resolve(
    process.cwd(),
    index >= 0 && args[index + 1]
      ? args[index + 1]
      : "data/evaluations/buildwatch-v22-baseline-generation.json",
  );
}

const report = evaluateBaselineGenerationV22();
const jsonPath = outputPath();
const markdownPath = jsonPath.replace(/\.json$/u, ".md");
const metrics = report.metrics;
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const markdown = `# BuildWatch v2.2 Phase 7 evaluation

- Status: **${report.passed ? "PASS" : "FAIL"}**
- Formula accuracy: ${percent(metrics.formulaAccuracy)}
- Quantity source coverage: ${percent(metrics.quantitySourceCoverage)}
- Material source coverage: ${percent(metrics.materialSourceCoverage)}
- Estimate source coverage: ${percent(metrics.estimateSourceCoverage)}
- Source-less final rows: ${metrics.sourceLessFinalRowCount}
- Unverified-scale final rows: ${metrics.unverifiedScaleFinalRowCount}
- Missing-norm final rows: ${metrics.missingNormFinalRowCount}
- Missing-price final rows: ${metrics.missingPriceFinalRowCount}
- Zero-price final rows: ${metrics.zeroPriceFinalRowCount}
- CPM passed: ${metrics.cpmPassed}
- Baseline mutations: ${metrics.baselineMutationCount}
- Supersession reason passed: ${metrics.supersessionReasonPassed}
- Deterministic replay passed: ${metrics.deterministicReplayPassed}
- Reviewer chain passed: ${metrics.reviewerChainPassed}
- Adversarial cases: ${metrics.adversarialPassCount}/${metrics.adversarialCaseCount}
`;

await mkdir(path.dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownPath, `${markdown.trim()}\n`, "utf8");

console.log(
  `Phase 7 evaluation: ${report.passed ? "PASS" : "FAIL"} | formula=${percent(
    metrics.formulaAccuracy,
  )} sources=${percent(metrics.estimateSourceCoverage)} adversarial=${metrics.adversarialPassCount}/${metrics.adversarialCaseCount}`,
);
console.log(`Reports: ${jsonPath} | ${markdownPath}`);
if (!report.passed) process.exitCode = 1;
