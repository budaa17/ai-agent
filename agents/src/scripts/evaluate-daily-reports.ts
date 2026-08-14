import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { z } from "zod";
import { createChatModel } from "../agent/index.js";
import { buildBuildWatchSimulation } from "../simulation/index.js";
import {
  dailyReportGoldenCases,
  evaluateDailyReportCases,
  extractDailyReportDraft,
  finalizeDailyReportDraft,
  formatDailyReportEvaluationMarkdown,
  resolveA1ModelRuntimeConfig,
} from "../structuring/index.js";

type Arguments = {
  help: boolean;
  live: boolean;
  caseIds?: string[];
  limit?: number;
  output?: string;
  delayMs: number;
  retryAttempts: number;
  modelId?: string;
  recordTelemetryContent: boolean;
};

const HELP_TEXT = `
Usage:
  pnpm.cmd eval:a1:daily -- [options]

Modes:
  default                            Offline reference evaluation (no API cost)
  --live                             Evaluate the configured OpenAI model

Options:
  --cases <id,id>                    Run selected case IDs
  --limit <1-500>                    Limit case count
  --output <path.json>               JSON report path
  --delay-ms <0-60000>               Delay between live calls
  --retry-attempts <0-5>             AI SDK retries per live call
  --model <id>                       Override OpenAI model
  --record-telemetry-content         Record source/output in telemetry
  --help                             Show help
`.trim();

function argumentValue(
  name: string,
  inlineValue: string | undefined,
  argv: string[],
  index: number,
) {
  const value = inlineValue ?? argv[index + 1];

  if (!value || (inlineValue === undefined && value.startsWith("--"))) {
    throw new Error(`${name} requires a value`);
  }

  return {
    value,
    consumed: inlineValue === undefined,
  };
}

function parseArguments(argv: string[]): Arguments {
  const parsed: Arguments = {
    help: false,
    live: false,
    delayMs: 0,
    retryAttempts: 2,
    recordTelemetryContent: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

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

    const separator = token.indexOf("=");
    const name = separator >= 0 ? token.slice(0, separator) : token;
    const inlineValue = separator >= 0 ? token.slice(separator + 1) : undefined;
    const supported = new Set([
      "--cases",
      "--limit",
      "--output",
      "--delay-ms",
      "--retry-attempts",
      "--model",
    ]);

    if (!supported.has(name)) {
      throw new Error(`Unknown A1 daily evaluation argument: ${token}`);
    }

    const argument = argumentValue(name, inlineValue, argv, index);
    index += argument.consumed ? 1 : 0;

    if (name === "--cases") {
      parsed.caseIds = argument.value
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (name === "--limit") {
      parsed.limit = z.coerce.number().int().min(1).max(500).parse(argument.value);
    } else if (name === "--output") {
      parsed.output = argument.value;
    } else if (name === "--delay-ms") {
      parsed.delayMs = z.coerce.number().int().min(0).max(60_000).parse(argument.value);
    } else if (name === "--retry-attempts") {
      parsed.retryAttempts = z.coerce.number().int().min(0).max(5).parse(argument.value);
    } else {
      parsed.modelId = argument.value;
    }
  }

  return parsed;
}

function markdownPathFor(jsonPath: string): string {
  const extension = extname(jsonPath);

  return extension ? `${jsonPath.slice(0, -extension.length)}.md` : `${jsonPath}.md`;
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));

  if (arguments_.help) {
    console.log(HELP_TEXT);
    return;
  }

  const selected = dailyReportGoldenCases
    .filter(
      (goldenCase) => !arguments_.caseIds?.length || arguments_.caseIds.includes(goldenCase.caseId),
    )
    .slice(0, arguments_.limit);

  if (selected.length === 0) {
    throw new Error("No matching daily-report golden cases");
  }

  if (arguments_.caseIds?.length) {
    const selectedIds = new Set(selected.map((goldenCase) => goldenCase.caseId));
    const missing = arguments_.caseIds.filter((caseId) => !selectedIds.has(caseId));

    if (missing.length > 0) {
      throw new Error(`Unknown case IDs: ${missing.join(", ")}`);
    }
  }

  const simulation = buildBuildWatchSimulation();
  const mode = arguments_.live ? "live" : "reference";
  const modelConfig = arguments_.live
    ? resolveA1ModelRuntimeConfig(process.env, {
        help: false,
        modelId: arguments_.modelId,
        recordTelemetryContent: arguments_.recordTelemetryContent,
      })
    : undefined;
  const model = modelConfig === undefined ? undefined : createChatModel(modelConfig);
  const outputPath = resolve(
    process.cwd(),
    arguments_.output ?? `data/evaluations/a1-daily-${mode}-latest.json`,
  );

  console.log(`A1 daily evaluation: mode=${mode} cases=${selected.length}`);

  const report = await evaluateDailyReportCases({
    cases: selected,
    mode,
    delayMs: arguments_.live ? arguments_.delayMs : 0,
    extract: async (goldenCase) => {
      if (model === undefined) {
        return finalizeDailyReportDraft({
          tenantId: simulation.snapshot.tenantId,
          projectId: simulation.snapshot.projectId,
          requestId: `evaluation-${goldenCase.caseId}`,
          sourceText: goldenCase.sourceText,
          referenceDate: goldenCase.referenceDate,
          modelOutput: goldenCase.modelOutput,
          projectSnapshot: simulation.snapshot,
          enforceSnapshotConsistency: false,
        });
      }

      const result = await extractDailyReportDraft({
        model,
        tenantId: simulation.snapshot.tenantId,
        projectId: simulation.snapshot.projectId,
        requestId: `evaluation-${goldenCase.caseId}`,
        sourceText: goldenCase.sourceText,
        referenceDate: goldenCase.referenceDate,
        projectSnapshot: simulation.snapshot,
        enforceSnapshotConsistency: false,
        maxRetries: arguments_.retryAttempts,
        telemetryEnabled: true,
        recordTelemetryContent: arguments_.recordTelemetryContent,
      });

      return result.draft;
    },
    onCaseComplete: (result, completed, total) => {
      console.log(
        `[${completed}/${total}] ${result.caseId}: ${
          result.passed ? "PASS" : (result.error ?? `${result.matchedFields}/${result.totalFields}`)
        }`,
      );
    },
  });
  const artifact = {
    ...report,
    provider: modelConfig?.provider ?? "reference",
    model: modelConfig?.modelId ?? "golden-model-output-v1",
  };
  const markdownPath = markdownPathFor(outputPath);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, formatDailyReportEvaluationMarkdown(report), "utf8");

  console.log(
    `A1 daily pass=${report.exactCaseMatches}/${report.totalCases} (${percentage(
      report.exactCaseAccuracy,
    )}) schema=${percentage(report.schemaSuccessRate)} fields=${percentage(report.fieldAccuracy)}`,
  );
  console.log(
    `Clarification P/R=${percentage(report.clarificationPrecision)}/${percentage(
      report.clarificationRecall,
    )} Brier=${report.meanBrierScore.toFixed(4)}`,
  );
  console.log(`Release gate: ${report.releaseGate.passed ? "PASS" : "FAIL"}`);
  console.log(`Reports: ${outputPath} | ${markdownPath}`);

  if (!report.releaseGate.passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    `A1 daily evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
