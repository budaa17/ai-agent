import { z } from "zod";
import { resolveModelRuntimeConfig } from "../agent/config.js";
import { isoDateSchema } from "./schema.js";

export const DEFAULT_A1_OPENAI_MODEL = "gpt-5.6-luna";
export const DEFAULT_A1_TENANT_REF = "tenant-demo";

export interface A1ModelCliArguments {
  help: boolean;
  modelId?: string;
  recordTelemetryContent?: boolean;
}

export interface StructureCliArguments extends A1ModelCliArguments {
  text?: string;
  file?: string;
  image?: string;
  referenceDate?: string;
  tenantRef?: string;
  projectRef?: string;
  persist?: boolean;
}

export interface A1EvaluationCliArguments extends A1ModelCliArguments {
  caseIds?: string[];
  limit?: number;
  output?: string;
  resume?: string;
  delayMs?: number;
  retryAttempts?: number;
}

export function resolveA1ModelRuntimeConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: A1ModelCliArguments,
) {
  const baseConfig = resolveModelRuntimeConfig(environment, arguments_);

  if (arguments_.modelId) {
    return baseConfig;
  }

  return {
    ...baseConfig,
    modelId: environment.A1_OPENAI_MODEL?.trim() || DEFAULT_A1_OPENAI_MODEL,
  };
}

function environmentBoolean(value: string | undefined, fallback: boolean) {
  if (!value?.trim()) {
    return fallback;
  }

  return value.trim().toLowerCase() === "true";
}

export function resolveA1StructureRuntimeConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: StructureCliArguments,
) {
  return {
    ...resolveA1ModelRuntimeConfig(environment, arguments_),
    tenantRef: arguments_.tenantRef ?? environment.A1_TENANT_ID?.trim() ?? DEFAULT_A1_TENANT_REF,
    projectRef: arguments_.projectRef ?? (environment.A1_PROJECT?.trim() || undefined) ?? undefined,
    persist: arguments_.persist ?? environmentBoolean(environment.A1_PERSIST, true),
  };
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

function splitOption(token: string) {
  const separatorIndex = token.indexOf("=");

  return {
    name: separatorIndex >= 0 ? token.slice(0, separatorIndex) : token,
    inlineValue: separatorIndex >= 0 ? token.slice(separatorIndex + 1) : undefined,
  };
}

function applySharedOption(parsed: A1ModelCliArguments, name: string, value: string) {
  if (name === "--model") {
    parsed.modelId = value;
    return true;
  }

  return false;
}

export function parseStructureCliArguments(argv: string[]): StructureCliArguments {
  const parsed: StructureCliArguments = { help: false };

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

    if (token === "--no-persist") {
      parsed.persist = false;
      continue;
    }

    if (token === "--persist") {
      parsed.persist = true;
      continue;
    }

    const { name, inlineValue } = splitOption(token);
    const supported = [
      "--model",
      "--text",
      "--file",
      "--image",
      "--reference-date",
      "--tenant",
      "--project",
    ];

    if (!supported.includes(name)) {
      throw new Error(`Unknown structure argument: ${token}`);
    }

    const argument = requireArgumentValue(name, inlineValue, argv, index);
    index += argument.consumedNext ? 1 : 0;

    if (applySharedOption(parsed, name, argument.value)) {
      continue;
    }

    if (name === "--text") {
      parsed.text = argument.value;
    } else if (name === "--file") {
      parsed.file = argument.value;
    } else if (name === "--image") {
      parsed.image = argument.value;
    } else if (name === "--tenant") {
      parsed.tenantRef = argument.value;
    } else if (name === "--project") {
      parsed.projectRef = argument.value;
    } else {
      parsed.referenceDate = isoDateSchema.parse(argument.value);
    }
  }

  if (parsed.text && parsed.file) {
    throw new Error("Use either --text or --file, not both");
  }

  return parsed;
}

export function parseA1EvaluationCliArguments(argv: string[]): A1EvaluationCliArguments {
  const parsed: A1EvaluationCliArguments = { help: false };

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

    const { name, inlineValue } = splitOption(token);
    const supported = [
      "--model",
      "--cases",
      "--limit",
      "--output",
      "--resume",
      "--delay-ms",
      "--retry-attempts",
    ];

    if (!supported.includes(name)) {
      throw new Error(`Unknown A1 evaluation argument: ${token}`);
    }

    const argument = requireArgumentValue(name, inlineValue, argv, index);
    index += argument.consumedNext ? 1 : 0;

    if (applySharedOption(parsed, name, argument.value)) {
      continue;
    }

    if (name === "--cases") {
      parsed.caseIds = argument.value
        .split(",")
        .map((caseId) => caseId.trim())
        .filter(Boolean);
    } else if (name === "--limit") {
      parsed.limit = z.coerce.number().int().min(1).max(100).parse(argument.value);
    } else if (name === "--delay-ms") {
      parsed.delayMs = z.coerce.number().int().min(0).max(60_000).parse(argument.value);
    } else if (name === "--retry-attempts") {
      parsed.retryAttempts = z.coerce.number().int().min(1).max(6).parse(argument.value);
    } else if (name === "--output") {
      parsed.output = argument.value;
    } else {
      parsed.resume = argument.value;
    }
  }

  return parsed;
}
