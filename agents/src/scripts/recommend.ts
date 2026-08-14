import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ZodError } from "zod";
import { createChatModel } from "../agent/index.js";
import { prisma } from "../prisma.js";
import {
  RecommendationGroundingError,
  parseRecommendationCliArguments,
  resolveRecommendationRuntimeConfig,
  runRecommendationAgent,
} from "../recommendations/index.js";
import { startLangfuseTelemetry } from "../telemetry/index.js";
import { createProductionAgentRuntimeGuard } from "../runtime/index.js";

const HELP_TEXT = `
Usage:
  pnpm.cmd recommend -- --project <id-or-code> [options]

Options:
  --tenant <id>                     Tenant ID (default: tenant-demo)
  --project <id-or-code>            Project ID or code (default: project-atlas)
  --as-of <ISO-or-date>             Analysis cutoff (default: 2026-03-01)
  --model <id>                      OpenAI model ID
  --max-steps <2-15>                Research tool-loop limit
  --output <path>                   JSON artifact path
  --record-telemetry-content        Send prompts and outputs to telemetry
  --help                            Show this help

This A2 command runs tool research, structured generation, deterministic grounding, and DB persistence.
`.trim();

function formatError(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
  }

  if (error instanceof RecommendationGroundingError) {
    return [
      error.message,
      ...error.validation.issues.map((issue) => `${issue.path}: ${issue.message}`),
    ].join("\n");
  }

  return error instanceof Error ? error.message : String(error);
}

function defaultOutputPath(projectId: string, asOf: string) {
  return `data/recommendations/${projectId}-${asOf.slice(0, 10)}.json`;
}

async function main() {
  const arguments_ = parseRecommendationCliArguments(process.argv.slice(2));

  if (arguments_.help) {
    console.log(HELP_TEXT);
    return;
  }

  const config = resolveRecommendationRuntimeConfig(process.env, arguments_);
  const telemetry = startLangfuseTelemetry(process.env);
  const model = createChatModel(config);
  const runtimeGuard = createProductionAgentRuntimeGuard(process.env, prisma);

  try {
    const result = await telemetry.runWithTrace("a2-grounded-recommendation", (traceId) =>
      runRecommendationAgent({
        tenantId: config.tenantId,
        projectRef: config.projectRef,
        asOf: config.asOf,
        model,
        maxSteps: config.maxSteps,
        langfuseTraceId: traceId,
        recordTelemetryContent: config.recordTelemetryContent,
        runtimeGuard,
      }),
    );
    const outputPath = resolve(
      process.cwd(),
      config.outputPath ?? defaultOutputPath(result.report.projectId, result.report.asOf),
    );
    const artifact = {
      runId: result.runId,
      requestId: result.requestId,
      langfuseTraceId: result.langfuseTraceId ?? null,
      provider: result.provider,
      modelId: result.modelId,
      research: result.research,
      structure: result.structure,
      validation: result.validation,
      report: result.report,
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    console.log(`A2 complete: ${result.report.projectCode} (${result.report.projectId})`);
    console.log(
      `runId=${result.runId} tools=${result.research.toolCallCount} posture=${result.report.riskBrief.posture} observations=${result.report.riskBrief.observations.length} recommendations=${result.report.recommendations.length}`,
    );
    console.log(`grounding=passed sources=${result.validation.checkedSourceCount}`);
    console.log(`langfuseTraceId=${result.langfuseTraceId ?? "not-enabled"}`);

    for (const recommendation of result.report.recommendations) {
      console.log(
        `- [${recommendation.priority}] ${recommendation.workItemName}: ${recommendation.title}`,
      );
    }

    console.log(`Saved: ${outputPath}`);
  } finally {
    await prisma.$disconnect();
    await telemetry.shutdown();
  }
}

void main().catch((error) => {
  console.error(`Recommend failed: ${formatError(error)}`);
  process.exitCode = 1;
});
