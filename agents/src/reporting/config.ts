import { z } from "zod";
import { resolveModelRuntimeConfig, type ModelRuntimeArguments } from "../agent/config.js";
import {
  DEFAULT_ANALYSIS_ANSWER_KEY_PATH,
  DEFAULT_ANALYSIS_AS_OF,
  DEFAULT_ANALYSIS_PROJECT_REF,
  DEFAULT_ANALYSIS_TENANT_ID,
} from "../analysis/config.js";

export interface ReportCliArguments extends ModelRuntimeArguments {
  help: boolean;
  tenantId?: string;
  projectRef?: string;
  asOf?: string;
  answerKeyPath?: string;
  recommendationsPath?: string;
  agentRunId?: string;
  analysisOnly?: boolean;
  narrativeMode?: "deterministic" | "llm";
  judge?: boolean;
  editedDraftPath?: string;
  outputDir?: string;
  noPdf?: boolean;
  recordTelemetryContent?: boolean;
}

const reportRuntimeConfigSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    projectRef: z.string().trim().min(1),
    asOf: z.string().datetime(),
    answerKeyPath: z.string().trim().min(1),
    recommendationsPath: z.string().trim().min(1).optional(),
    agentRunId: z.string().trim().min(1).optional(),
    analysisOnly: z.boolean(),
    narrativeMode: z.enum(["deterministic", "llm"]),
    judge: z.boolean(),
    editedDraftPath: z.string().trim().min(1).optional(),
    outputDir: z.string().trim().min(1).optional(),
    noPdf: z.boolean(),
    recordTelemetryContent: z.boolean(),
  })
  .strict();

function requireArgumentValue(
  name: string,
  inlineValue: string | undefined,
  argv: string[],
  index: number,
) {
  const value = inlineValue ?? argv[index + 1];

  if (!value || (!inlineValue && value.startsWith("--"))) {
    throw new Error(`${name} requires a value`);
  }

  return {
    value,
    consumedNext: inlineValue === undefined,
  };
}

function normalizeAsOf(value: string) {
  return z
    .string()
    .datetime()
    .parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
}

function environmentBoolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function parseReportCliArguments(argv: string[]): ReportCliArguments {
  const parsed: ReportCliArguments = { help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--") {
      continue;
    }

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }

    if (token === "--analysis-only") {
      parsed.analysisOnly = true;
      continue;
    }

    if (token === "--judge") {
      parsed.judge = true;
      continue;
    }

    if (token === "--no-pdf") {
      parsed.noPdf = true;
      continue;
    }

    if (token === "--record-telemetry-content") {
      parsed.recordTelemetryContent = true;
      continue;
    }

    const separatorIndex = token.indexOf("=");
    const name = separatorIndex >= 0 ? token.slice(0, separatorIndex) : token;
    const inlineValue = separatorIndex >= 0 ? token.slice(separatorIndex + 1) : undefined;
    const supported = [
      "--tenant",
      "--project",
      "--as-of",
      "--answer-key",
      "--recommendations",
      "--agent-run",
      "--narrative",
      "--edited-draft",
      "--output-dir",
      "--model",
    ];

    if (!supported.includes(name)) {
      throw new Error(`Unknown report argument: ${token}`);
    }

    const argument = requireArgumentValue(name, inlineValue, argv, index);
    index += argument.consumedNext ? 1 : 0;

    if (name === "--tenant") {
      parsed.tenantId = argument.value;
    } else if (name === "--project") {
      parsed.projectRef = argument.value;
    } else if (name === "--as-of") {
      parsed.asOf = argument.value;
    } else if (name === "--answer-key") {
      parsed.answerKeyPath = argument.value;
    } else if (name === "--recommendations") {
      parsed.recommendationsPath = argument.value;
    } else if (name === "--agent-run") {
      parsed.agentRunId = argument.value;
    } else if (name === "--narrative") {
      parsed.narrativeMode = z.enum(["deterministic", "llm"]).parse(argument.value);
    } else if (name === "--edited-draft") {
      parsed.editedDraftPath = argument.value;
    } else if (name === "--output-dir") {
      parsed.outputDir = argument.value;
    } else {
      parsed.modelId = argument.value;
    }
  }

  const recommendationInputs = [
    parsed.analysisOnly,
    Boolean(parsed.recommendationsPath),
    Boolean(parsed.agentRunId),
  ].filter(Boolean).length;

  if (recommendationInputs > 1) {
    throw new Error("Use only one of --analysis-only, --recommendations, or --agent-run");
  }

  return parsed;
}

export function resolveReportRuntimeConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: ReportCliArguments,
) {
  return reportRuntimeConfigSchema.parse({
    tenantId: arguments_.tenantId ?? environment.A3_TENANT_ID?.trim() ?? DEFAULT_ANALYSIS_TENANT_ID,
    projectRef:
      arguments_.projectRef ?? environment.A3_PROJECT?.trim() ?? DEFAULT_ANALYSIS_PROJECT_REF,
    asOf: normalizeAsOf(arguments_.asOf ?? environment.A3_AS_OF?.trim() ?? DEFAULT_ANALYSIS_AS_OF),
    answerKeyPath:
      arguments_.answerKeyPath ??
      environment.A3_ANSWER_KEY?.trim() ??
      DEFAULT_ANALYSIS_ANSWER_KEY_PATH,
    recommendationsPath: arguments_.recommendationsPath,
    agentRunId: arguments_.agentRunId,
    analysisOnly: arguments_.analysisOnly ?? false,
    narrativeMode:
      arguments_.narrativeMode ??
      (environment.A3_NARRATIVE_MODE?.trim().toLowerCase() || "deterministic"),
    judge: arguments_.judge ?? false,
    editedDraftPath: arguments_.editedDraftPath,
    outputDir: arguments_.outputDir,
    noPdf: arguments_.noPdf ?? false,
    recordTelemetryContent:
      arguments_.recordTelemetryContent ?? environmentBoolean(environment.LANGFUSE_RECORD_CONTENT),
  });
}

export function resolveA3ModelRuntimeConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: ReportCliArguments,
) {
  const modelConfig = resolveModelRuntimeConfig(environment, arguments_);

  if (arguments_.modelId) {
    return modelConfig;
  }

  return {
    ...modelConfig,
    modelId:
      environment.A3_OPENAI_MODEL?.trim() ||
      environment.A2_OPENAI_MODEL?.trim() ||
      modelConfig.modelId,
  };
}
