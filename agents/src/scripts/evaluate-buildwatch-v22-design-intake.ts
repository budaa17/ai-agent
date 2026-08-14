import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateDesignIntakeV22 } from "../design-intake/evaluation.js";
import { persistPlatformEvaluationRun } from "../evaluation/platform-evaluation-history.js";
import { prisma } from "../prisma.js";

function outputPath(): string {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const index = args.indexOf("--output");
  return path.resolve(
    process.cwd(),
    index >= 0 && args[index + 1]
      ? args[index + 1]
      : "data/evaluations/buildwatch-v22-design-intake.json",
  );
}

const startedAt = new Date();
const report = await evaluateDesignIntakeV22();
const completedAt = new Date();
const jsonPath = outputPath();
const markdownPath = jsonPath.replace(/\.json$/u, ".md");
const metrics = report.metrics;
const markdown = `# BuildWatch v2.2 Phase 6 evaluation

- Status: **${report.passed ? "PASS" : "FAIL"}**
- Element precision: ${(metrics.elementPrecision * 100).toFixed(2)}%
- Element recall: ${(metrics.elementRecall * 100).toFixed(2)}%
- Unverified metric dimensions: ${metrics.unverifiedMetricDimensionCount}
- Source-less accepted elements: ${metrics.sourceLessAcceptedElementCount}
- Revision conflict routed to review: ${metrics.revisionConflictRoutedToReview}
- Rotated page detected: ${metrics.rotatedPageDetected}
- Mixed scale routed to review: ${metrics.mixedScaleRoutedToReview}
- Missing-scale metric dimensions: ${metrics.missingScaleMetricDimensionCount}
- Rejected-scale metric dimensions: ${metrics.rejectedScaleMetricDimensionCount}
`;

await mkdir(path.dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownPath, `${markdown.trim()}\n`, "utf8");
await persistPlatformEvaluationRun(prisma, {
  suiteKey: report.evaluationType,
  suiteVersion: String(report.schemaVersion),
  agentType: "A0_DESIGN_INTAKE",
  agentRelease: "deterministic+buildwatch-v22-a0-package-intake-v1",
  promptVersion: "deterministic",
  toolBundleVersion: "buildwatch-v22-a0-package-intake-v1",
  provider: "deterministic",
  modelId: "buildwatch-v22-a0-package-intake-v1",
  caseCount: 1,
  passedCount: report.passed ? 1 : 0,
  failedCount: report.passed ? 0 : 1,
  skippedCount: 0,
  startedAt,
  completedAt,
  sourceRef: "pnpm eval:design-intake:v22",
});

console.log(
  `Phase 6 evaluation: ${report.passed ? "PASS" : "FAIL"} | precision=${(
    metrics.elementPrecision * 100
  ).toFixed(2)}% recall=${(metrics.elementRecall * 100).toFixed(2)}%`,
);
console.log(`Reports: ${jsonPath} | ${markdownPath}`);

if (!report.passed) {
  process.exitCode = 1;
}

await prisma.$disconnect();
