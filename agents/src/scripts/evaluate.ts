import "dotenv/config";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { ZodError } from "zod";
import { createChatModel } from "../agent/index.js";
import { prisma } from "../prisma.js";
import {
  A1_GOLDEN_SUITE,
  a1GoldenCaseSchema,
  evaluateA1Cases,
  extractProjectUpdate,
  formatA1EvaluationMarkdown,
  parseA1EvaluationCliArguments,
  projectUpdateExtractionSchema,
  resolveA1ModelRuntimeConfig,
  type A1GoldenCase,
  type ProjectUpdateExtraction,
} from "../structuring/index.js";
import { startLangfuseTelemetry } from "../telemetry/index.js";

const HELP_TEXT = `
Usage:
  pnpm.cmd eval:a1 -- [options]

Options:
  --model <id>                       OpenAI model ID
  --cases <id,id>                    Run only selected golden cases
  --limit <1-100>                    Limit the number of cases
  --delay-ms <0-60000>               Delay between API calls (default: 1000)
  --retry-attempts <1-6>             Attempts per case (default: 1)
  --output <path.json>               JSON report path
  --resume <report[,report]>         Reuse successful outputs; later reports override
  --record-telemetry-content         Send source and output to telemetry
  --help                             Show this help
`.trim();

function formatError(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
  }

  return error instanceof Error ? error.message : String(error);
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
}): A1GoldenCase {
  return a1GoldenCaseSchema.parse({
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

function markdownPathFor(jsonPath: string) {
  const extension = extname(jsonPath);
  return extension ? jsonPath.slice(0, -extension.length) + ".md" : `${jsonPath}.md`;
}

function checkpointPathFor(jsonPath: string) {
  const extension = extname(jsonPath);
  return extension
    ? `${jsonPath.slice(0, -extension.length)}.checkpoint.json`
    : `${jsonPath}.checkpoint.json`;
}

function percentage(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function retryDelayMs(error: unknown, attempt: number) {
  const message = formatError(error);
  const retryAfter = message.match(/retry in\s+([0-9.]+)s/i);

  if (retryAfter?.[1]) {
    return Math.ceil(Number(retryAfter[1]) * 1000) + 1500;
  }

  return Math.min(60_000, 5000 * 2 ** (attempt - 1));
}

function isRetryableExtractionError(error: unknown) {
  const message = formatError(error);

  return (
    /quota|rate.?limit|429|resource_exhausted/i.test(message) ||
    /no output generated/i.test(message)
  );
}

async function extractWithRetry(
  goldenCase: A1GoldenCase,
  extract: () => Promise<ProjectUpdateExtraction>,
  maxAttempts: number,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await extract();
    } catch (error) {
      if (!isRetryableExtractionError(error) || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = retryDelayMs(error, attempt);
      console.log(
        `  ${goldenCase.id}: retry ${attempt}/${maxAttempts - 1} after ${Math.ceil(delayMs / 1000)}s`,
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }

  throw new Error(`Extraction retries exhausted for ${goldenCase.id}`);
}

async function loadResumeOutputs(
  path: string | undefined,
  modelConfig: { provider: string; modelId: string },
  optional = false,
) {
  const outputs = new Map<string, ProjectUpdateExtraction>();

  if (!path) {
    return outputs;
  }

  const resumePath = resolve(process.cwd(), path);
  let source: string;

  try {
    source = await readFile(resumePath, "utf8");
  } catch (error) {
    if (optional && error instanceof Error && "code" in error && error.code === "ENOENT") {
      return outputs;
    }

    throw error;
  }

  const artifact = JSON.parse(source) as {
    provider?: unknown;
    model?: unknown;
    cases?: Array<{
      caseId?: unknown;
      extractionSucceeded?: unknown;
      output?: unknown;
    }>;
  };

  if (artifact.provider !== modelConfig.provider || artifact.model !== modelConfig.modelId) {
    throw new Error(
      `Resume report provider/model does not match ${modelConfig.provider}/${modelConfig.modelId}`,
    );
  }

  for (const result of artifact.cases ?? []) {
    if (result.extractionSucceeded === true && typeof result.caseId === "string") {
      const parsed = projectUpdateExtractionSchema.safeParse(result.output);

      if (parsed.success) {
        outputs.set(result.caseId, parsed.data);
      }
    }
  }

  console.log(`Resume cache: ${outputs.size} successful outputs from ${resumePath}`);
  return outputs;
}

async function writeCheckpoint(
  path: string,
  modelConfig: { provider: string; modelId: string },
  outputs: ReadonlyMap<string, ProjectUpdateExtraction>,
) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        provider: modelConfig.provider,
        model: modelConfig.modelId,
        updatedAt: new Date().toISOString(),
        cases: [...outputs.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([caseId, output]) => ({
            caseId,
            extractionSucceeded: true,
            output,
          })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function main() {
  const arguments_ = parseA1EvaluationCliArguments(process.argv.slice(2));

  if (arguments_.help) {
    console.log(HELP_TEXT);
    return;
  }

  const modelConfig = resolveA1ModelRuntimeConfig(process.env, arguments_);
  const telemetry = startLangfuseTelemetry(process.env);
  const model = createChatModel(modelConfig);
  const outputPath = resolve(process.cwd(), arguments_.output ?? "data/evaluations/a1-latest.json");
  const checkpointPath = checkpointPathFor(outputPath);
  const resumeOutputs = new Map<string, ProjectUpdateExtraction>();
  const resumePaths = arguments_.resume
    ?.split(",")
    .map((path) => path.trim())
    .filter(Boolean);

  for (const resumePath of resumePaths ?? []) {
    const loaded = await loadResumeOutputs(resumePath, modelConfig);

    for (const [caseId, output] of loaded) {
      resumeOutputs.set(caseId, output);
    }
  }
  const checkpointOutputs = await loadResumeOutputs(checkpointPath, modelConfig, true);

  for (const [caseId, output] of checkpointOutputs) {
    resumeOutputs.set(caseId, output);
  }
  const rows = await prisma.evalCase.findMany({
    where: {
      suite: A1_GOLDEN_SUITE,
      enabled: true,
      ...(arguments_.caseIds?.length ? { id: { in: arguments_.caseIds } } : {}),
    },
    orderBy: { id: "asc" },
    ...(arguments_.limit ? { take: arguments_.limit } : {}),
  });
  const cases = rows.map(databaseCaseToGoldenCase);

  if (cases.length === 0) {
    throw new Error(
      "No A1 evaluation cases found. Run pnpm.cmd run db:migrate and pnpm.cmd run seed.",
    );
  }

  console.log(
    `A1 evaluation | provider=${modelConfig.provider} | model=${modelConfig.modelId} | cases=${cases.length}`,
  );

  try {
    const report = await evaluateA1Cases({
      cases,
      delayMs: arguments_.delayMs ?? 1000,
      extract: async (goldenCase) => {
        const resumed = resumeOutputs.get(goldenCase.id);

        if (resumed) {
          return resumed;
        }

        return extractWithRetry(
          goldenCase,
          async () => {
            const result = await extractProjectUpdate({
              model,
              sourceText: goldenCase.inputText,
              referenceDate: goldenCase.referenceDate,
              caseId: goldenCase.id,
              maxRetries: 0,
              recordTelemetryContent: arguments_.recordTelemetryContent,
            });

            return result.update;
          },
          arguments_.retryAttempts ?? 1,
        );
      },
      onCaseComplete: async (result, completed, total) => {
        if (result.extractionSucceeded && result.output) {
          resumeOutputs.set(result.caseId, result.output);
          await writeCheckpoint(checkpointPath, modelConfig, resumeOutputs);
        }

        const status = result.extractionSucceeded
          ? `${result.matchedFields}/${result.totalFields}`
          : `ERROR: ${result.error}`;
        console.log(`[${completed}/${total}] ${result.caseId}: ${status}`);
      },
    });
    const markdownPath = markdownPathFor(outputPath);
    const artifact = {
      provider: modelConfig.provider,
      model: modelConfig.modelId,
      ...report,
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await Promise.all([
      writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8"),
      writeFile(
        markdownPath,
        formatA1EvaluationMarkdown(report, {
          provider: modelConfig.provider,
          model: modelConfig.modelId,
        }),
        "utf8",
      ),
    ]);

    console.log("");
    console.log(
      `Schema success: ${report.successfulExtractions}/${report.totalCases} (${percentage(report.extractionSuccessRate)})`,
    );
    console.log(
      `Exact cases: ${report.exactCaseMatches}/${report.totalCases} (${percentage(report.exactCaseAccuracy)})`,
    );
    console.log(
      `Field accuracy: ${report.matchedFields}/${report.totalFields} (${percentage(report.fieldAccuracy)})`,
    );
    console.log(`Reports: ${outputPath} | ${markdownPath}`);

    if (report.successfulExtractions < report.totalCases) {
      process.exitCode = 1;
    } else {
      await rm(checkpointPath, { force: true });
    }
  } finally {
    await prisma.$disconnect();
    await telemetry.shutdown();
  }
}

void main().catch(async (error) => {
  console.error(`A1 evaluation failed: ${formatError(error)}`);
  process.exitCode = 1;
  await prisma.$disconnect();
});
