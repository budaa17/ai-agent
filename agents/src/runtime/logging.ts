import { createHash } from "node:crypto";
import * as Sentry from "@sentry/node";
import { z } from "zod";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const secretKeyPattern =
  /(?:api[-_]?key|secret|password|authorization|cookie|access[-_]?token|refresh[-_]?token|private[-_]?key)/iu;
const contentKeyPattern =
  /(?:raw[-_]?text|source[-_]?text|prompt|image|file[-_]?bytes|document[-_]?body)/iu;
const bearerPattern = /\b(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/-]+=*)\b/gu;
const inlineSecretPattern =
  /(\b(?:api[-_]?key|secret|password|authorization|cookie|access[-_]?token|refresh[-_]?token)\s*[:=]\s*)([^\s,;]+)/giu;

function redactString(value: string) {
  return value
    .replace(bearerPattern, "[REDACTED_SECRET]")
    .replace(inlineSecretPattern, "$1[REDACTED_SECRET]");
}

export function redactAgentLogValue(
  value: unknown,
  options: {
    recordContent?: boolean;
    depth?: number;
  } = {},
): unknown {
  const depth = options.depth ?? 0;

  if (depth > 8) {
    return "[MAX_DEPTH]";
  }

  if (typeof value === "string") {
    return redactString(value).slice(0, 4_000);
  }

  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) =>
      redactAgentLogValue(item, {
        ...options,
        depth: depth + 1,
      }),
    );
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      output[key] = secretKeyPattern.test(key)
        ? "[REDACTED_SECRET]"
        : !options.recordContent && contentKeyPattern.test(key)
          ? "[CONTENT_LOGGING_DISABLED]"
          : redactAgentLogValue(item, {
              ...options,
              depth: depth + 1,
            });
    }

    return output;
  }

  return String(value);
}

export function hashAuthorizedScope(input: {
  principalId: string;
  tenantId: string;
  projectIds: readonly string[];
  permissions: readonly string[];
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        principalId: input.principalId,
        tenantId: input.tenantId,
        projectIds: [...input.projectIds].sort(),
        permissions: [...input.permissions].sort(),
      }),
    )
    .digest("hex");
}

export type StructuredLogSink = (line: string, level: z.infer<typeof logLevelSchema>) => void;

export function createAgentLogger(options: {
  service: string;
  sink?: StructuredLogSink;
  now?: () => string;
  recordContent?: false;
}) {
  const sink =
    options.sink ??
    ((line: string, level: z.infer<typeof logLevelSchema>) => {
      if (level === "error") {
        console.error(line);
      } else if (level === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    });
  const now = options.now ?? (() => new Date().toISOString());
  const write = (
    level: z.infer<typeof logLevelSchema>,
    event: string,
    fields: Record<string, unknown> = {},
  ) => {
    const payload = {
      timestamp: now(),
      level,
      service: options.service,
      event,
      ...(redactAgentLogValue(fields, {
        recordContent: false,
      }) as Record<string, unknown>),
    };
    sink(JSON.stringify(payload), level);
  };

  return {
    debug: (event: string, fields?: Record<string, unknown>) => write("debug", event, fields),
    info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
    warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
    error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
  };
}

export interface AgentErrorReporter {
  enabled: boolean;
  captureException(error: unknown, context?: Record<string, unknown>): string | undefined;
  flush(timeoutMs?: number): Promise<boolean>;
}

export function startSentryErrorReporter(
  environment: NodeJS.ProcessEnv = process.env,
): AgentErrorReporter {
  const dsn = environment.SENTRY_DSN?.trim();

  if (!dsn) {
    return {
      enabled: false,
      captureException: () => undefined,
      flush: async () => true,
    };
  }

  Sentry.init({
    dsn,
    environment: environment.SENTRY_ENVIRONMENT?.trim() ?? environment.NODE_ENV ?? "development",
    release: environment.APP_RELEASE?.trim(),
    sendDefaultPii: false,
    maxBreadcrumbs: 50,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      return redactAgentLogValue(event, {
        recordContent: false,
      }) as typeof event;
    },
  });

  return {
    enabled: true,
    captureException(error, context = {}) {
      return Sentry.captureException(error, {
        contexts: {
          agent: redactAgentLogValue(context, {
            recordContent: false,
          }) as Record<string, unknown>,
        },
      });
    },
    flush: (timeoutMs = 2_000) => Sentry.flush(timeoutMs),
  };
}

export class AgentOperationalMetrics {
  readonly #counters = new Map<string, number>();
  readonly #observations = new Map<string, number[]>();

  increment(name: string, value = 1) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("Metric counter increments must be nonnegative");
    }

    this.#counters.set(name, (this.#counters.get(name) ?? 0) + value);
  }

  observe(name: string, value: number) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("Metric observations must be nonnegative");
    }

    const values = this.#observations.get(name) ?? [];
    values.push(value);
    this.#observations.set(name, values.slice(-10_000));
  }

  snapshot() {
    return {
      counters: Object.fromEntries([...this.#counters.entries()].sort()),
      observations: Object.fromEntries(
        [...this.#observations.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, values]) => ({
            name,
            value: {
              count: values.length,
              average:
                values.length === 0
                  ? 0
                  : values.reduce((sum, value) => sum + value, 0) / values.length,
              max: values.length === 0 ? 0 : Math.max(...values),
            },
          }))
          .map(({ name, value }) => [name, value]),
      ),
    };
  }
}
