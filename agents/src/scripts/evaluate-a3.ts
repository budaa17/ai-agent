import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { answerKeySchema } from "../answer-key.js";
import { persistPlatformEvaluationRun } from "../evaluation/platform-evaluation-history.js";
import { prisma } from "../prisma.js";
import {
  A3_GOLDEN_SUITE,
  a3GoldenCaseSchema,
  collectA3ReportEvidenceCore,
  composeProjectReport,
  createA3DocumentBundle,
  createAnalysisOnlyRecommendationReport,
  createDeterministicReportNarrative,
  evaluateA3Cases,
  formatA3EvaluationMarkdown,
  type A3GoldenCase,
} from "../reporting/index.js";

const HELP_TEXT = `
Usage:
  pnpm.cmd eval:a3 -- [options]

Options:
  --cases <id,id>                   Evaluate selected golden cases
  --answer-key <path>               Answer-key JSON path
  --output <path.json>              JSON report path
  --help                            Show this help

The A3 golden evaluator is deterministic and does not use an AI API.
`.trim();

interface Arguments {
  help: boolean;
  caseIds?: string[];
  answerKeyPath?: string;
  output?: string;
}

function parseArguments(argv: string[]) {
  const parsed: Arguments = { help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--") {
      continue;
    }

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }

    index += 1;

    if (token === "--cases") {
      parsed.caseIds = value
        .split(",")
        .map((caseId) => caseId.trim())
        .filter(Boolean);
    } else if (token === "--answer-key") {
      parsed.answerKeyPath = value;
    } else if (token === "--output") {
      parsed.output = value;
    } else {
      throw new Error(`Unknown A3 evaluation argument: ${token}`);
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
}): A3GoldenCase {
  return a3GoldenCaseSchema.parse({
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
      suite: A3_GOLDEN_SUITE,
      enabled: true,
      ...(arguments_.caseIds?.length ? { id: { in: arguments_.caseIds } } : {}),
    },
    orderBy: { id: "asc" },
  });
  const cases = rows.map(databaseCaseToGoldenCase);

  if (cases.length === 0) {
    throw new Error("No A3 evaluation cases found. Run pnpm.cmd run seed:a3-eval.");
  }

  const answerKeyPath =
    arguments_.answerKeyPath ?? process.env.A3_ANSWER_KEY?.trim() ?? "data/answer-key.json";
  const answerKey = answerKeySchema.parse(
    JSON.parse(await readFile(resolve(process.cwd(), answerKeyPath), "utf8")),
  );
  const outputPath = resolve(process.cwd(), arguments_.output ?? "data/evaluations/a3-latest.json");
  const startedAt = new Date();
  const report = await evaluateA3Cases({
    cases,
    generate: async (goldenCase) => {
      const evidence = await collectA3ReportEvidenceCore(
        {
          tenantId: goldenCase.expected.tenantId,
          projectIds: [goldenCase.expected.projectId],
        },
        {
          projectRef: goldenCase.expected.projectId,
          asOf: goldenCase.expected.asOf,
        },
      );
      const recommendations = createAnalysisOnlyRecommendationReport(
        evidence.data,
        evidence.analysis,
      );
      const projectReport = composeProjectReport({
        data: evidence.data,
        analysis: evidence.analysis,
        recommendations,
        narrative: createDeterministicReportNarrative(false),
        answerKey,
        narrativeMode: "DETERMINISTIC",
        recommendationSource: "ANALYSIS_ONLY",
        generatedAt: `${goldenCase.referenceDate}T01:00:00.000Z`,
      });

      return {
        report: projectReport,
        bundle: createA3DocumentBundle(projectReport, {
          requestId: goldenCase.id,
        }),
        draftStatuses: ["PENDING_APPROVAL", "PENDING_APPROVAL", "PENDING_APPROVAL"],
      };
    },
    onCaseComplete: (result, completed, total) => {
      console.log(
        `[${completed}/${total}] ${result.caseId}: ${result.passed ? "PASS" : (result.error ?? "FAIL")}`,
      );
    },
  });
  const markdownPath = markdownPathFor(outputPath);

  await mkdir(dirname(outputPath), { recursive: true });
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, formatA3EvaluationMarkdown(report), "utf8"),
  ]);
  await persistPlatformEvaluationRun(prisma, {
    suiteKey: report.suite,
    suiteVersion: "1",
    agentType: "A3_DOCUMENT",
    agentRelease: "a3-document-v2+a3-evidence-tools-v2",
    promptVersion: "a3-document-v2",
    toolBundleVersion: "a3-evidence-tools-v2",
    provider: "deterministic",
    modelId: "handlebars-v1",
    caseCount: report.totalCases,
    passedCount: report.passedCases,
    failedCount: report.totalCases - report.passedCases,
    skippedCount: 0,
    startedAt,
    completedAt: new Date(report.generatedAt),
    sourceRef: "pnpm eval:a3",
  });

  console.log(
    `A3 pass=${report.passedCases}/${report.totalCases} (${percentage(report.passRate)}) fieldAccuracy=${percentage(report.fieldAccuracy)}`,
  );
  console.log(`Reports: ${outputPath} | ${markdownPath}`);

  if (report.passedCases < report.totalCases) {
    process.exitCode = 1;
  }
}

void main()
  .catch((error) => {
    console.error(
      `A3 evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
