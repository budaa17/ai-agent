import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { AgentRunStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { createChatModel } from "../agent/index.js";
import { analyzeProjectData, loadProjectAnalysisData } from "../analysis/index.js";
import { prisma } from "../prisma.js";
import {
  A2_GOLDEN_SUITE,
  a2GoldenCaseSchema,
  evaluateA2Cases,
  formatA2EvaluationMarkdown,
  parseRecommendationReport,
  resolveRecommendationRuntimeConfig,
  runRecommendationAgent,
  type A2GoldenCase,
} from "../recommendations/index.js";
import { startLangfuseTelemetry } from "../telemetry/index.js";

const HELP_TEXT = `
Usage:
  pnpm.cmd eval:a2 -- [options]

Options:
  --live                            Generate fresh A2 outputs with OpenAI
  --cases <id,id>                   Evaluate selected golden cases
  --model <id>                      OpenAI model ID for --live
  --output <path.json>              JSON report path
  --record-telemetry-content        Send prompts and outputs to telemetry
  --help                            Show this help

Without --live, the evaluator uses the latest completed A2 AgentRun for each case.
`.trim();

interface A2EvaluationArguments {
  help: boolean;
  live: boolean;
  caseIds?: string[];
  modelId?: string;
  output?: string;
  recordTelemetryContent?: boolean;
}

function argumentValue(token: string, argv: string[], index: number) {
  const separator = token.indexOf("=");
  const name = separator >= 0 ? token.slice(0, separator) : token;
  const inline = separator >= 0 ? token.slice(separator + 1) : undefined;
  const value = inline ?? argv[index + 1];

  if (!value || (!inline && value.startsWith("--"))) {
    throw new Error(`${name} requires a value`);
  }

  return {
    name,
    value,
    consumedNext: inline === undefined,
  };
}

function parseArguments(argv: string[]) {
  const parsed: A2EvaluationArguments = {
    help: false,
    live: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--") {
      continue;
    }

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }

    if (token === "--live") {
      parsed.live = true;
      continue;
    }

    if (token === "--record-telemetry-content") {
      parsed.recordTelemetryContent = true;
      continue;
    }

    const argument = argumentValue(token, argv, index);
    index += argument.consumedNext ? 1 : 0;

    if (argument.name === "--cases") {
      parsed.caseIds = argument.value
        .split(",")
        .map((caseId) => caseId.trim())
        .filter(Boolean);
    } else if (argument.name === "--model") {
      parsed.modelId = argument.value;
    } else if (argument.name === "--output") {
      parsed.output = argument.value;
    } else {
      throw new Error(`Unknown A2 evaluation argument: ${argument.name}`);
    }
  }

  return parsed;
}

function databaseCaseToGoldenCase(row: {
  id: string;
  suite: string;
  locale: string;
  inputText: string;
  referenceDate: Date;
  expectedOutput: unknown;
  scoredFields: string[];
  tags: string[];
}): A2GoldenCase {
  return a2GoldenCaseSchema.parse({
    id: row.id,
    suite: row.suite,
    locale: row.locale,
    inputText: row.inputText,
    referenceDate: row.referenceDate.toISOString().slice(0, 10),
    expected: row.expectedOutput,
    scoredFields: row.scoredFields,
    tags: row.tags,
  });
}

function markdownPathFor(path: string) {
  const extension = extname(path);

  return extension ? `${path.slice(0, -extension.length)}.md` : `${path}.md`;
}

function percentage(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));

  if (arguments_.help) {
    console.log(HELP_TEXT);
    return;
  }

  const rows = await prisma.evalCase.findMany({
    where: {
      suite: A2_GOLDEN_SUITE,
      enabled: true,
      ...(arguments_.caseIds?.length ? { id: { in: arguments_.caseIds } } : {}),
    },
    orderBy: { id: "asc" },
  });
  const cases = rows.map(databaseCaseToGoldenCase);

  if (cases.length === 0) {
    throw new Error("No A2 evaluation cases found. Run pnpm.cmd run seed:a2-eval.");
  }

  const modelConfig = arguments_.live
    ? resolveRecommendationRuntimeConfig(process.env, {
        help: false,
        modelId: arguments_.modelId,
        recordTelemetryContent: arguments_.recordTelemetryContent,
      })
    : null;
  const model = modelConfig ? createChatModel(modelConfig) : null;
  const telemetry = arguments_.live ? startLangfuseTelemetry(process.env) : null;
  const outputPath = resolve(process.cwd(), arguments_.output ?? "data/evaluations/a2-latest.json");

  console.log(`A2 evaluation: mode=${arguments_.live ? "live" : "latest"} cases=${cases.length}`);

  try {
    const report = await evaluateA2Cases({
      cases,
      observe: async (goldenCase) => {
        const data = await loadProjectAnalysisData({
          tenantId: goldenCase.expected.tenantId,
          projectRef: goldenCase.expected.projectId,
          asOf: goldenCase.expected.asOf,
        });
        const analysis = analyzeProjectData(data);

        if (arguments_.live) {
          const result = await telemetry!.runWithTrace("a2-golden-evaluation", (traceId) =>
            runRecommendationAgent({
              tenantId: goldenCase.expected.tenantId,
              projectRef: goldenCase.expected.projectId,
              asOf: goldenCase.expected.asOf,
              requestId: `eval-${goldenCase.id}-${randomUUID()}`,
              trigger: "MANUAL",
              model: model!,
              toolSelection: "deterministic",
              maxSteps: modelConfig!.maxSteps,
              langfuseTraceId: traceId,
              recordTelemetryContent: modelConfig!.recordTelemetryContent,
            }),
          );

          return { data, analysis, report: result.report };
        }

        const run = await prisma.agentRun.findFirst({
          where: {
            tenantId: goldenCase.expected.tenantId,
            projectId: goldenCase.expected.projectId,
            agentType: "A2_RECOMMENDATION",
            status: AgentRunStatus.COMPLETED,
            asOf: new Date(goldenCase.expected.asOf),
            output: { not: Prisma.DbNull },
          },
          orderBy: { startedAt: "desc" },
        });

        if (!run?.output) {
          throw new Error(`No completed A2 run for ${goldenCase.expected.projectId}`);
        }

        return {
          data,
          analysis,
          report: parseRecommendationReport(run.output, goldenCase.expected.riskPosture),
        };
      },
      onCaseComplete: (result, completed, total) => {
        console.log(
          `[${completed}/${total}] ${result.caseId}: ${result.passed ? "PASS" : (result.error ?? "FAIL")}`,
        );
      },
    });
    const markdownPath = markdownPathFor(outputPath);
    const artifact = {
      mode: arguments_.live ? "live" : "latest",
      provider: modelConfig?.provider ?? null,
      model: modelConfig?.modelId ?? null,
      ...report,
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await Promise.all([
      writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8"),
      writeFile(markdownPath, formatA2EvaluationMarkdown(report), "utf8"),
    ]);

    console.log(
      `A2 pass=${report.passedCases}/${report.totalCases} (${percentage(report.passRate)}) grounding=${percentage(report.groundingRate)} fieldAccuracy=${percentage(report.fieldAccuracy)}`,
    );
    console.log(
      `Observation P/R=${percentage(report.observationKinds.precision)}/${percentage(report.observationKinds.recall)} recommendation P/R=${percentage(report.recommendationImpacts.precision)}/${percentage(report.recommendationImpacts.recall)}`,
    );
    console.log(`Reports: ${outputPath} | ${markdownPath}`);

    if (report.passedCases < report.totalCases) {
      process.exitCode = 1;
    }
  } finally {
    await telemetry?.shutdown();
  }
}

void main()
  .catch((error) => {
    console.error(
      `A2 evaluation failed: ${error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
