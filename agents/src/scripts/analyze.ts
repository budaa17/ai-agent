import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ZodError } from "zod";
import {
  analyzeProjectFromDatabase,
  evaluateIssuesAgainstAnswerKey,
  parseAnalyzeCliArguments,
  resolveAnalyzeCliConfig,
  type AnswerKeyEvaluation,
  type ProjectAnalysisResult,
} from "../analysis/index.js";
import { answerKeySchema } from "../answer-key.js";
import { prisma } from "../prisma.js";

const HELP_TEXT = `
Usage:
  pnpm.cmd analyze -- --project <id-or-code> [options]

Options:
  --tenant <id>            Tenant ID (default: tenant-demo)
  --project <id-or-code>   Project ID or code (default: project-atlas)
  --as-of <ISO-or-date>    Analysis cutoff (default: 2026-03-01)
  --output <path>          JSON artifact path
  --answer-key <path>      Answer-key JSON path
  --no-answer-key          Skip answer-key comparison
  --help                   Show this help

This command uses PostgreSQL, TypeScript rules, and CPM only. It does not call an LLM.
`.trim();

function formatError(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
  }

  return error instanceof Error ? error.message : String(error);
}

function defaultOutputPath(result: ProjectAnalysisResult) {
  return `data/analysis/${result.projectId}-${result.asOf.slice(0, 10)}.json`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function printSummary(
  result: ProjectAnalysisResult,
  evaluation: AnswerKeyEvaluation | undefined,
  outputPath: string,
) {
  const taskCodes = new Map(result.cpm.tasks.map((task) => [task.workItemId, task.code]));
  const criticalPath = result.cpm.criticalPaths[0]!.map(
    (workItemId) => taskCodes.get(workItemId) ?? workItemId,
  ).join(" -> ");

  console.log(`Analysis complete: ${result.projectCode} (${result.projectId})`);
  console.log(`asOf=${result.asOf}`);
  console.log(`CPM: duration=${result.cpm.projectDurationDays} days, critical=${criticalPath}`);
  console.log(`Issues: ${result.summary.issueCount}`);

  for (const issue of result.issues) {
    const taskCode = taskCodes.get(issue.workItemId) ?? issue.workItemId;
    console.log(`- [${issue.severity}] ${issue.type} ${taskCode}: ${issue.summary}`);
  }

  if (evaluation) {
    console.log(
      `Answer-key: precision=${formatPercent(evaluation.precision)} recall=${formatPercent(evaluation.recall)} F1=${formatPercent(evaluation.f1)}`,
    );
  }

  console.log(`Saved: ${outputPath}`);
}

async function loadAnswerKeyEvaluation(path: string | undefined, result: ProjectAnalysisResult) {
  if (!path) {
    return undefined;
  }

  const absolutePath = resolve(process.cwd(), path);
  const answerKey = answerKeySchema.parse(JSON.parse(await readFile(absolutePath, "utf8")));

  if (answerKey.asOf !== result.asOf) {
    throw new Error(
      `Answer-key asOf ${answerKey.asOf} does not match analysis asOf ${result.asOf}. Use --no-answer-key or matching dates.`,
    );
  }

  return evaluateIssuesAgainstAnswerKey(result.issues, answerKey, {
    tenantId: result.tenantId,
    projectId: result.projectId,
  });
}

async function main() {
  const arguments_ = parseAnalyzeCliArguments(process.argv.slice(2));

  if (arguments_.help) {
    console.log(HELP_TEXT);
    return;
  }

  const config = resolveAnalyzeCliConfig(process.env, arguments_);

  try {
    const result = await analyzeProjectFromDatabase({
      tenantId: config.tenantId,
      projectRef: config.projectRef,
      asOf: config.asOf,
    });
    const answerKeyEvaluation = await loadAnswerKeyEvaluation(config.answerKeyPath, result);
    const outputPath = resolve(process.cwd(), config.outputPath ?? defaultOutputPath(result));
    const artifact = {
      ...result,
      answerKeyEvaluation,
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    printSummary(result, answerKeyEvaluation, outputPath);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(`Analyze failed: ${formatError(error)}`);
  process.exitCode = 1;
});
