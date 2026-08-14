import { OpenTelemetry } from "@ai-sdk/otel";
import { api, NodeSDK } from "@opentelemetry/sdk-node";
import { registerTelemetry } from "ai";
import { LangfuseExporter } from "langfuse-vercel";
import { z } from "zod";

const langfuseConfigSchema = z
  .object({
    publicKey: z.string().trim().min(1),
    secretKey: z.string().trim().min(1),
    baseUrl: z.string().url().default("https://cloud.langfuse.com"),
  })
  .strict();

export interface TelemetryHandle {
  enabled: boolean;
  runWithTrace<T>(name: string, callback: (traceId: string | undefined) => Promise<T>): Promise<T>;
  shutdown(): Promise<void>;
}

export class LangfuseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LangfuseConfigurationError";
  }
}

function optionalEnvironmentValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function resolveLangfuseConfig(environment: NodeJS.ProcessEnv = process.env) {
  const publicKey = optionalEnvironmentValue(environment.LANGFUSE_PUBLIC_KEY);
  const secretKey = optionalEnvironmentValue(environment.LANGFUSE_SECRET_KEY);

  if (!publicKey && !secretKey) {
    return null;
  }

  if (!publicKey || !secretKey) {
    throw new LangfuseConfigurationError(
      "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be configured together",
    );
  }

  return langfuseConfigSchema.parse({
    publicKey,
    secretKey,
    baseUrl:
      optionalEnvironmentValue(environment.LANGFUSE_BASE_URL) ??
      optionalEnvironmentValue(environment.LANGFUSE_BASEURL) ??
      "https://cloud.langfuse.com",
  });
}

export function startLangfuseTelemetry(
  environment: NodeJS.ProcessEnv = process.env,
): TelemetryHandle {
  const config = resolveLangfuseConfig(environment);

  if (!config) {
    return {
      enabled: false,
      runWithTrace: (_name, callback) => callback(undefined),
      shutdown: async () => undefined,
    };
  }

  const exporter = new LangfuseExporter(config);
  const sdk = new NodeSDK({
    serviceName: "diplom-agents",
    traceExporter: exporter,
  });

  sdk.start();
  registerTelemetry(
    new OpenTelemetry({
      usage: true,
      providerMetadata: true,
    }),
  );

  return {
    enabled: true,
    runWithTrace: (name, callback) =>
      api.trace.getTracer("diplom-agents").startActiveSpan(name, async (span) => {
        const traceId = span.spanContext().traceId;

        try {
          const result = await callback(traceId);
          span.setStatus({ code: api.SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.recordException(error instanceof Error ? error : String(error));
          span.setStatus({
            code: api.SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      }),
    shutdown: () => sdk.shutdown(),
  };
}
