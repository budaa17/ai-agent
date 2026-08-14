import { z } from "zod";

export const DEFAULT_ANALYSIS_TENANT_ID = "tenant-demo";
export const DEFAULT_ANALYSIS_PROJECT_REF = "project-atlas";
export const DEFAULT_ANALYSIS_AS_OF = "2026-03-01T00:00:00.000Z";
export const DEFAULT_ANALYSIS_ANSWER_KEY_PATH = "data/answer-key.json";

export interface AnalyzeCliArguments {
  help: boolean;
  tenantId?: string;
  projectRef?: string;
  asOf?: string;
  outputPath?: string;
  answerKeyPath?: string;
  useAnswerKey: boolean;
}

export interface AnalyzeCliConfig {
  tenantId: string;
  projectRef: string;
  asOf: string;
  outputPath?: string;
  answerKeyPath?: string;
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

function normalizeAsOf(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;

  return z.string().datetime().parse(normalized);
}

export function parseAnalyzeCliArguments(argv: string[]): AnalyzeCliArguments {
  const parsed: AnalyzeCliArguments = {
    help: false,
    useAnswerKey: true,
  };
  let hasAnswerKeyOption = false;
  let hasNoAnswerKeyOption = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--") {
      continue;
    }

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }

    if (token === "--no-answer-key") {
      parsed.useAnswerKey = false;
      hasNoAnswerKeyOption = true;
      continue;
    }

    const { name, inlineValue } = splitOption(token);
    const supported = ["--tenant", "--project", "--as-of", "--output", "--answer-key"];

    if (!supported.includes(name)) {
      throw new Error(`Unknown analyze argument: ${token}`);
    }

    const argument = requireArgumentValue(name, inlineValue, argv, index);
    index += argument.consumedNext ? 1 : 0;

    if (name === "--tenant") {
      parsed.tenantId = argument.value;
    } else if (name === "--project") {
      parsed.projectRef = argument.value;
    } else if (name === "--as-of") {
      parsed.asOf = argument.value;
    } else if (name === "--output") {
      parsed.outputPath = argument.value;
    } else {
      parsed.answerKeyPath = argument.value;
      parsed.useAnswerKey = true;
      hasAnswerKeyOption = true;
    }
  }

  if (hasAnswerKeyOption && hasNoAnswerKeyOption) {
    throw new Error("Use either --answer-key or --no-answer-key, not both");
  }

  return parsed;
}

export function resolveAnalyzeCliConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: AnalyzeCliArguments,
): AnalyzeCliConfig {
  const tenantId =
    arguments_.tenantId ?? environment.ANALYSIS_TENANT_ID?.trim() ?? DEFAULT_ANALYSIS_TENANT_ID;
  const projectRef =
    arguments_.projectRef ?? environment.ANALYSIS_PROJECT?.trim() ?? DEFAULT_ANALYSIS_PROJECT_REF;
  const asOf = normalizeAsOf(
    arguments_.asOf ?? environment.ANALYSIS_AS_OF?.trim() ?? DEFAULT_ANALYSIS_AS_OF,
  );

  return {
    tenantId: z.string().trim().min(1).parse(tenantId),
    projectRef: z.string().trim().min(1).parse(projectRef),
    asOf,
    outputPath: arguments_.outputPath,
    answerKeyPath: arguments_.useAnswerKey
      ? (arguments_.answerKeyPath ??
        environment.ANALYSIS_ANSWER_KEY?.trim() ??
        DEFAULT_ANALYSIS_ANSWER_KEY_PATH)
      : undefined,
  };
}
