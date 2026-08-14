import { z } from "zod";
import { DEFAULT_OPENAI_MODEL, chatProviderSchema } from "./model.js";

const chatRuntimeConfigSchema = z
  .object({
    provider: chatProviderSchema,
    apiKey: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
    tenantId: z.string().trim().min(1),
    projectIds: z.array(z.string().trim().min(1)).min(1).max(100),
    maxSteps: z.number().int().min(1).max(15),
    recordTelemetryContent: z.boolean(),
  })
  .strict();

export interface ChatCliArguments {
  help: boolean;
  tenantId?: string;
  projectIds?: string[];
  modelId?: string;
  maxSteps?: number;
  recordTelemetryContent?: boolean;
}

export interface ModelRuntimeArguments {
  modelId?: string;
}

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

export function parseChatCliArguments(argv: string[]): ChatCliArguments {
  const parsed: ChatCliArguments = { help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

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

    if (
      name !== "--tenant" &&
      name !== "--projects" &&
      name !== "--model" &&
      name !== "--max-steps"
    ) {
      throw new Error(`Unknown chat argument: ${token}`);
    }

    const argument = requireArgumentValue(name, inlineValue, argv, index);
    index += argument.consumedNext ? 1 : 0;

    if (name === "--tenant") {
      parsed.tenantId = argument.value;
    } else if (name === "--projects") {
      parsed.projectIds = argument.value
        .split(",")
        .map((projectId) => projectId.trim())
        .filter(Boolean);
    } else if (name === "--model") {
      parsed.modelId = argument.value;
    } else {
      parsed.maxSteps = Number(argument.value);
    }
  }

  return parsed;
}

function environmentBoolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function resolveModelRuntimeConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: ModelRuntimeArguments,
) {
  const openAIApiKey = environment.OPENAI_API_KEY?.trim();

  if (!openAIApiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  return {
    provider: chatProviderSchema.parse("openai"),
    apiKey: openAIApiKey,
    modelId: arguments_.modelId ?? environment.OPENAI_MODEL?.trim() ?? DEFAULT_OPENAI_MODEL,
  };
}

export function resolveChatRuntimeConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: ChatCliArguments,
) {
  const modelConfig = resolveModelRuntimeConfig(environment, arguments_);
  const environmentProjectIds = environment.CHAT_PROJECT_IDS?.split(",")
    .map((projectId) => projectId.trim())
    .filter(Boolean);
  const parsed = chatRuntimeConfigSchema.parse({
    ...modelConfig,
    tenantId: arguments_.tenantId ?? environment.CHAT_TENANT_ID ?? "tenant-demo",
    projectIds:
      arguments_.projectIds ??
      (environmentProjectIds?.length ? environmentProjectIds : ["project-atlas"]),
    maxSteps: arguments_.maxSteps ?? Number(environment.CHAT_MAX_STEPS?.trim() || "15"),
    recordTelemetryContent:
      arguments_.recordTelemetryContent ?? environmentBoolean(environment.LANGFUSE_RECORD_CONTENT),
  });

  return {
    ...parsed,
    projectIds: [...new Set(parsed.projectIds)],
  };
}
