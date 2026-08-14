import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { z } from "zod";
import {
  A4_GOLDEN_SUITE,
  a4GoldenCaseSchema,
  buildA4SourceCatalog,
  createChatModel,
  evaluateA4Cases,
  formatA4EvaluationMarkdown,
  resolveModelRuntimeConfig,
  runProjectChat,
  type A4GoldenCase,
  type A4RequiredSource,
  type A4ToolName,
  type A4ToolEvidence,
} from "../agent/index.js";
import { prisma } from "../prisma.js";
import { startLangfuseTelemetry } from "../telemetry/index.js";
import { getCostLedgerCore } from "../tools/cost-ledger.js";
import { getDependenciesCore } from "../tools/dependencies.js";
import { getProgressHistoryCore } from "../tools/progress-history.js";
import { getWorkItemsCore } from "../tools/work-items.js";

const HELP_TEXT = `
Usage:
  pnpm.cmd eval:a4 -- [options]

Options:
  --live                            Generate fresh A4 answers with OpenAI
  --cases <id,id>                   Evaluate selected golden cases
  --model <id>                      OpenAI model ID for --live
  --output <path.json>              JSON report path
  --record-telemetry-content        Send prompts and outputs to telemetry
  --help                            Show this help

Default mode is deterministic and does not use an AI API.
--live sends the golden questions and authorized tool results to OpenAI.
`.trim();

interface Arguments {
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
  const parsed: Arguments = { help: false, live: false };

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
      throw new Error(`Unknown A4 evaluation argument: ${argument.name}`);
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
}): A4GoldenCase {
  return a4GoldenCaseSchema.parse({
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

function sameSourceValue(
  source: A4RequiredSource,
  candidate: {
    toolName: string;
    sourceId: string;
    field: string;
    value: unknown;
  },
) {
  return (
    source.toolName === candidate.toolName &&
    source.sourceId === candidate.sourceId &&
    source.field === candidate.field &&
    JSON.stringify(source.value) === JSON.stringify(candidate.value)
  );
}

async function executeDeterministicTool(
  goldenCase: A4GoldenCase,
  toolName: A4ToolName,
): Promise<A4ToolEvidence> {
  const context = {
    tenantId: goldenCase.expected.tenantId,
    projectIds: goldenCase.expected.projectIds,
  };

  if (toolName === "lookupWorkItems") {
    return {
      toolName,
      output: await getWorkItemsCore(context, { limit: 200 }),
    };
  }

  if (toolName === "lookupDependencies") {
    return {
      toolName,
      output: await getDependenciesCore(context, { limit: 300 }),
    };
  }

  if (toolName === "lookupProgressHistory") {
    return {
      toolName,
      output: await getProgressHistoryCore(context, {
        limit: 1_000,
      }),
    };
  }

  return {
    toolName,
    output: await getCostLedgerCore(context, { limit: 200 }),
  };
}

async function createDeterministicAnswer(goldenCase: A4GoldenCase) {
  const toolNames = [...new Set(goldenCase.expected.requiredToolNames)];
  const toolResults = await Promise.all(
    toolNames.map((toolName) => executeDeterministicTool(goldenCase, toolName)),
  );
  const catalog = buildA4SourceCatalog(toolResults);
  const facts = goldenCase.expected.requiredSources.map((source) => {
    const fact = catalog.find((candidate) => sameSourceValue(source, candidate));

    if (!fact) {
      throw new Error(
        `Golden source is absent from DB evidence: ${source.toolName}:${source.sourceId}:${source.field}=${JSON.stringify(source.value)}`,
      );
    }

    return fact;
  });
  const text = `Шалгасан баримт: ${facts
    .map((fact) => `${fact.sourceId}.${fact.field}=${String(fact.value)}`)
    .join("; ")}.`;

  return {
    answer: {
      schemaVersion: 1 as const,
      language: "mn" as const,
      status: goldenCase.expected.answerStatus,
      claims: [
        {
          text,
          sources: goldenCase.expected.requiredSources.map(
            ({ value: _value, ...source }) => source,
          ),
        },
      ],
    },
    toolResults,
  };
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));

  if (arguments_.help) {
    console.log(HELP_TEXT);
    return;
  }

  const rows = await prisma.evalCase.findMany({
    where: {
      suite: A4_GOLDEN_SUITE,
      enabled: true,
      ...(arguments_.caseIds?.length ? { id: { in: arguments_.caseIds } } : {}),
    },
    orderBy: { id: "asc" },
  });
  const cases = rows.map(databaseCaseToGoldenCase);

  if (cases.length === 0) {
    throw new Error("No A4 evaluation cases found. Run pnpm.cmd run seed:a4-eval.");
  }

  const modelConfig = arguments_.live
    ? resolveModelRuntimeConfig(process.env, {
        modelId: arguments_.modelId,
      })
    : null;
  const model = modelConfig ? createChatModel(modelConfig) : null;
  const telemetry = arguments_.live ? startLangfuseTelemetry(process.env) : null;
  const outputPath = resolve(process.cwd(), arguments_.output ?? "data/evaluations/a4-latest.json");

  console.log(
    `A4 evaluation: mode=${arguments_.live ? "live" : "deterministic"} cases=${cases.length}`,
  );

  try {
    const report = await evaluateA4Cases({
      cases,
      answer: async (goldenCase) => {
        if (!arguments_.live) {
          return createDeterministicAnswer(goldenCase);
        }

        const result = await telemetry!.runWithTrace("a4-golden-evaluation", () =>
          runProjectChat({
            context: {
              tenantId: goldenCase.expected.tenantId,
              projectIds: goldenCase.expected.projectIds,
            },
            messages: [
              {
                role: "user",
                content: goldenCase.inputText,
              },
            ],
            model: model!,
            requestId: `eval-${goldenCase.id}`,
            toolSelection: "deterministic",
            telemetryEnabled: true,
            recordTelemetryContent: arguments_.recordTelemetryContent,
          }),
        );

        return {
          answer: result.answer,
          toolResults: result.toolResults,
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
      mode: arguments_.live ? "live" : "deterministic",
      provider: modelConfig?.provider ?? null,
      model: modelConfig?.modelId ?? null,
      ...report,
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await Promise.all([
      writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8"),
      writeFile(markdownPath, formatA4EvaluationMarkdown(report), "utf8"),
    ]);

    console.log(
      `A4 pass=${report.passedCases}/${report.totalCases} (${percentage(report.passRate)}) grounding=${percentage(report.groundingRate)} fieldAccuracy=${percentage(report.fieldAccuracy)}`,
    );
    console.log(
      `Tool P/R=${percentage(report.tools.precision)}/${percentage(report.tools.recall)} source P/R=${percentage(report.sources.precision)}/${percentage(report.sources.recall)}`,
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
      `A4 evaluation failed: ${error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
