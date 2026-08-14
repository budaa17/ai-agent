import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluatePhase8OrchestrationV22 } from "../orchestration/evaluation.js";

function outputPath(): string {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const index = args.indexOf("--output");
  return path.resolve(
    process.cwd(),
    index >= 0 && args[index + 1]
      ? args[index + 1]
      : "data/evaluations/buildwatch-v22-phase8-orchestration.json",
  );
}

const report = await evaluatePhase8OrchestrationV22();
const jsonPath = outputPath();
const markdownPath = jsonPath.replace(/\.json$/u, ".md");
const metrics = report.metrics;
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const markdown = `# BuildWatch v2.2 Phase 8 evaluation

- Status: **${report.passed ? "PASS" : "FAIL"}**
- Tool definitions: ${metrics.toolDefinitionCount}
- Tool coverage: ${percent(metrics.toolCoverage)}
- A0 tool coverage: ${percent(metrics.a0ToolCoverage)}
- A5 tool coverage: ${percent(metrics.a5ToolCoverage)}
- Numeric hallucinations: ${metrics.numericHallucinationCount}
- Unauthorized sources: ${metrics.unauthorizedSourceCount}
- Unauthorized object disclosures: ${metrics.unauthorizedObjectDisclosureCount}
- Tenant-isolation violations: ${metrics.tenantIsolationViolationCount}
- Unsigned artifact leaks: ${metrics.unsignedArtifactLeakCount}
- Catalog-scope leaks: ${metrics.catalogScopeLeakCount}
- Baseline mutations: ${metrics.baselineMutationCount}
- Golden cases: ${metrics.goldenPassCount}/${metrics.goldenCaseCount}
- Adversarial cases: ${metrics.adversarialPassCount}/${metrics.adversarialCaseCount}
- Deterministic replay: ${metrics.deterministicReplayPassed ? "PASS" : "FAIL"}
- LLM-off core: ${metrics.llmOffCorePassed ? "PASS" : "FAIL"}
- Run version persistence: ${metrics.runVersionPersistencePassed ? "PASS" : "FAIL"}

## Cases

${report.cases
  .map(
    (evaluationCase) =>
      `- [${evaluationCase.passed ? "x" : " "}] ${evaluationCase.caseId} (${evaluationCase.category}) — ${evaluationCase.message}`,
  )
  .join("\n")}
`;

await mkdir(path.dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownPath, `${markdown.trim()}\n`, "utf8");
console.log(
  `Phase 8 evaluation: ${report.passed ? "PASS" : "FAIL"} | tools=${percent(metrics.toolCoverage)} golden=${metrics.goldenPassCount}/${metrics.goldenCaseCount} adversarial=${metrics.adversarialPassCount}/${metrics.adversarialCaseCount}`,
);
console.log(
  `Safety: hallucination=${metrics.numericHallucinationCount} unauthorized=${metrics.unauthorizedSourceCount} tenant=${metrics.tenantIsolationViolationCount}`,
);
console.log(`Reports: ${jsonPath} | ${markdownPath}`);
if (!report.passed) process.exitCode = 1;
