import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  evaluatePhase11Performance,
  renderPhase11PerformanceMarkdown,
} from "../performance/index.js";

function outputPath() {
  const index = process.argv.indexOf("--output");
  return resolve(
    index >= 0 ? (process.argv[index + 1] ?? "") : "data/evaluations/phase11-performance.json",
  );
}

async function main() {
  const path = outputPath();
  if (!path.endsWith(".json")) throw new Error("Performance output must be a .json file");
  const report = await evaluatePhase11Performance();
  const markdownPath = path.replace(/\.json$/u, ".md");
  await mkdir(dirname(path), { recursive: true });
  await Promise.all([
    writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderPhase11PerformanceMarkdown(report), "utf8"),
  ]);
  for (const currentCase of report.cases) {
    process.stdout.write(
      `${currentCase.id}: p95=${currentCase.measuredP95Ms}ms target=${currentCase.targetP95Ms}ms ${currentCase.passed ? "PASS" : "FAIL"}\n`,
    );
  }
  process.stdout.write(`Reports: ${path} | ${markdownPath}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Phase 11 performance evaluation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
