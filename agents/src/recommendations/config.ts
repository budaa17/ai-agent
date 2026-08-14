import { z } from "zod";
import { resolveModelRuntimeConfig, type ModelRuntimeArguments } from "../agent/config.js";
import { chatProviderSchema } from "../agent/model.js";
import {
  DEFAULT_ANALYSIS_AS_OF,
  DEFAULT_ANALYSIS_PROJECT_REF,
  DEFAULT_ANALYSIS_TENANT_ID,
} from "../analysis/config.js";

export interface RecommendationCliArguments extends ModelRuntimeArguments {
  help: boolean;
  tenantId?: string;
  projectRef?: string;
  asOf?: string;
  outputPath?: string;
  maxSteps?: number;
  recordTelemetryContent?: boolean;
}

const recommendationRuntimeConfigSchema = z
  .object({
    provider: chatProviderSchema,
    apiKey: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
    tenantId: z.string().trim().min(1),
    projectRef: z.string().trim().min(1),
    asOf: z.string().datetime(),
    outputPath: z.string().trim().min(1).optional(),
    maxSteps: z.number().int().min(2).max(15),
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

export function parseRecommendationCliArguments(argv: string[]): RecommendationCliArguments {
  const parsed: RecommendationCliArguments = { help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--") {
      continue;
    }

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }

    if (token === "--record-telemetry-content") {
      parsed.recordTelemetryContent = true;
      continue;
    }

    const separatorIndex = token.indexOf("=");
    const name = separatorIndex >= 0 ? token.slice(0, separatorIndex) : token;
    const inlineValue = separatorIndex >= 0 ? token.slice(separatorIndex + 1) : undefined;
    const supported = ["--tenant", "--project", "--as-of", "--model", "--max-steps", "--output"];

    if (!supported.includes(name)) {
      throw new Error(`Unknown recommend argument: ${token}`);
    }

    const argument = requireArgumentValue(name, inlineValue, argv, index);
    index += argument.consumedNext ? 1 : 0;

    if (name === "--tenant") {
      parsed.tenantId = argument.value;
    } else if (name === "--project") {
      parsed.projectRef = argument.value;
    } else if (name === "--as-of") {
      parsed.asOf = argument.value;
    } else if (name === "--model") {
      parsed.modelId = argument.value;
    } else if (name === "--max-steps") {
      parsed.maxSteps = z.coerce.number().int().min(2).max(15).parse(argument.value);
    } else {
      parsed.outputPath = argument.value;
    }
  }

  return parsed;
}

export function resolveRecommendationRuntimeConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: RecommendationCliArguments,
) {
  const modelConfig = resolveModelRuntimeConfig(environment, arguments_);
  const modelId = arguments_.modelId
    ? modelConfig.modelId
    : environment.A2_OPENAI_MODEL?.trim() || modelConfig.modelId;

  return recommendationRuntimeConfigSchema.parse({
    ...modelConfig,
    modelId,
    tenantId: arguments_.tenantId ?? environment.A2_TENANT_ID?.trim() ?? DEFAULT_ANALYSIS_TENANT_ID,
    projectRef:
      arguments_.projectRef ?? environment.A2_PROJECT?.trim() ?? DEFAULT_ANALYSIS_PROJECT_REF,
    asOf: normalizeAsOf(arguments_.asOf ?? environment.A2_AS_OF?.trim() ?? DEFAULT_ANALYSIS_AS_OF),
    outputPath: arguments_.outputPath,
    maxSteps: arguments_.maxSteps ?? Number(environment.A2_MAX_STEPS?.trim() || "8"),
    recordTelemetryContent:
      arguments_.recordTelemetryContent ?? environmentBoolean(environment.LANGFUSE_RECORD_CONTENT),
  });
}
