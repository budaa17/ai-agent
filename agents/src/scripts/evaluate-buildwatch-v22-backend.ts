import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluatePhase9BackendV22 } from "../backend/evaluation.js";

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

async function main() {
  const report = await evaluatePhase9BackendV22();
  const output = resolve(process.cwd(), "data/evaluations/buildwatch-v22-phase9-backend.json");
  const markdown = output.replace(/\.json$/i, ".md");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(
    markdown,
    [
      "# BuildWatch v2.2 Phase 9 backend evaluation",
      "",
      `- Result: **${report.passed ? "PASS" : "FAIL"}**`,
      `- Cases: **${report.metrics.goldenPassCount}/${report.metrics.goldenCaseCount}**`,
      `- Role coverage: **${percent(report.metrics.roleCoverage)}**`,
      `- Agent adapter coverage: **${percent(report.metrics.agentAdapterCoverage)}**`,
      `- Tenant isolation violations: **${report.metrics.tenantIsolationViolationCount}**`,
      `- Duplicate commands: **${report.metrics.duplicateCommandCount}**`,
      `- Duplicate consumer side effects: **${report.metrics.duplicateConsumerSideEffectCount}**`,
      "",
      "## Cases",
      "",
      ...report.cases.map(
        (item) => `- [${item.passed ? "x" : " "}] ${item.caseId}: ${item.evidence}`,
      ),
      "",
    ].join("\n"),
    "utf8",
  );
  process.stdout.write(
    `Phase 9 evaluation: ${report.passed ? "PASS" : "FAIL"} | cases=${report.metrics.goldenPassCount}/${report.metrics.goldenCaseCount} roles=${percent(report.metrics.roleCoverage)} adapters=${percent(report.metrics.agentAdapterCoverage)}\nSafety: tenant=${report.metrics.tenantIsolationViolationCount} duplicateCommand=${report.metrics.duplicateCommandCount} duplicateConsumer=${report.metrics.duplicateConsumerSideEffectCount}\nReports: ${output} | ${markdown}\n`,
  );
  if (!report.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Phase 9 evaluation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
