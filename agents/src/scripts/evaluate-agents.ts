import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { ZodError } from "zod";
import {
  analyzeProjectFromDatabase,
  parseAnalyzeCliArguments,
  resolveAnalyzeCliConfig,
} from "../analysis/index.js";
import { answerKeySchema } from "../answer-key.js";
import { prisma } from "../prisma.js";
import { evaluateProjectMetrics, formatProjectMetricsMarkdown } from "../reporting/index.js";

function formatError(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
  }

  return error instanceof Error ? error.message : String(error);
}

function markdownPathFor(path: string) {
  const extension = extname(path);
  return extension ? `${path.slice(0, -extension.length)}.md` : `${path}.md`;
}

async function main() {
  const arguments_ = parseAnalyzeCliArguments(process.argv.slice(2));
  const config = resolveAnalyzeCliConfig(process.env, arguments_);

  if (arguments_.help) {
    console.log(
      "Usage: pnpm.cmd eval:agents -- --project <id-or-code> [--as-of <date>] [--answer-key <path>] [--output <json>]",
    );
    return;
  }

  if (!config.answerKeyPath) {
    throw new Error("Agent metrics require an answer key");
  }

  const [analysis, answerKeySource] = await Promise.all([
    analyzeProjectFromDatabase({
      tenantId: config.tenantId,
      projectRef: config.projectRef,
      asOf: config.asOf,
    }),
    readFile(resolve(process.cwd(), config.answerKeyPath), "utf8"),
  ]);
  const answerKey = answerKeySchema.parse(JSON.parse(answerKeySource));
  const metrics = evaluateProjectMetrics(analysis, answerKey);
  const outputPath = resolve(
    process.cwd(),
    config.outputPath ?? "data/evaluations/agents-latest.json",
  );
  const markdownPath = markdownPathFor(outputPath);

  await mkdir(dirname(outputPath), { recursive: true });
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, formatProjectMetricsMarkdown([metrics]), "utf8"),
  ]);

  console.log(
    `Agent metrics: precision=${(metrics.issueDetection.precision * 100).toFixed(2)}% recall=${(metrics.issueDetection.recall * 100).toFixed(2)}% detectionLag=${metrics.meanDetectionLagDays ?? "N/A"} forecastError=${metrics.forecastErrorDays ?? "N/A"}`,
  );
  console.log(`Reports: ${outputPath} | ${markdownPath}`);
}

void main()
  .catch((error) => {
    console.error(`Agent evaluation failed: ${formatError(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
