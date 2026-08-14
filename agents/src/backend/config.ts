import { z } from "zod";
import { isIP } from "node:net";

const secretSchema = z.string().min(32).max(4_096);

function environmentBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim().length === 0) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export const phase9BackendConfigSchema = z
  .object({
    nodeEnv: z.enum(["development", "test", "production"]),
    host: z.string().refine((value) => isIP(value) !== 0, "Host must be an IP address"),
    port: z.number().int().min(1).max(65_535),
    publicBaseUrl: z.string().url(),
    jwtSecret: secretSchema,
    cursorSecret: secretSchema,
    artifactSigningSecret: secretSchema,
    emailVerificationSecret: secretSchema,
    artifactRoot: z.string().trim().min(1).max(2_000),
    artifactStorageProvider: z.enum(["local", "supabase"]),
    supabaseUrl: z.string().url().nullable(),
    supabaseServiceRoleKey: z.string().trim().min(16).max(4_096).nullable(),
    supabaseStorageBucket: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u)
      .nullable(),
    corsOrigins: z.array(z.string().url()).max(20),
    rabbitMqUrl: z.string().url().nullable(),
    trustProxyHops: z.number().int().min(0).max(3),
    apiRateLimitWindowMs: z.number().int().min(1_000).max(3_600_000),
    apiRateLimitMaxRequests: z.number().int().min(1).max(100_000),
    authRateLimitMaxRequests: z.number().int().min(1).max(10_000),
    requestTimeoutMs: z.number().int().min(1_000).max(300_000),
    headersTimeoutMs: z.number().int().min(1_000).max(300_000),
    keepAliveTimeoutMs: z.number().int().min(1_000).max(120_000),
    maxArtifactBytes: z
      .number()
      .int()
      .min(1_024)
      .max(100 * 1024 * 1024),
    metricsToken: secretSchema.nullable(),
    clamAvHost: z.string().trim().min(1).max(253).nullable(),
    clamAvPort: z.number().int().min(1).max(65_535),
    clamAvTimeoutMs: z.number().int().min(1_000).max(120_000),
    requireExternalMalwareScan: z.boolean(),
    /** Production release gate for platform (super admin) sign-in. */
    requirePlatformMfa: z.boolean(),
  })
  .strict()
  .superRefine((config, context) => {
    if (
      config.nodeEnv === "production" &&
      new Set([
        config.jwtSecret,
        config.cursorSecret,
        config.artifactSigningSecret,
        config.emailVerificationSecret,
      ]).size !== 4
    ) {
      context.addIssue({
        code: "custom",
        message: "Production signing secrets must be independent",
        path: ["jwtSecret"],
      });
    }

    if (config.headersTimeoutMs < config.requestTimeoutMs) {
      context.addIssue({
        code: "custom",
        message: "Headers timeout must be greater than or equal to request timeout",
        path: ["headersTimeoutMs"],
      });
    }

    if (
      config.artifactStorageProvider === "supabase" &&
      (config.supabaseUrl === null ||
        config.supabaseServiceRoleKey === null ||
        config.supabaseStorageBucket === null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Supabase artifact storage requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET",
        path: ["artifactStorageProvider"],
      });
    }

    if (config.nodeEnv === "production") {
      if (new URL(config.publicBaseUrl).protocol !== "https:") {
        context.addIssue({
          code: "custom",
          message: "Production public base URL must use HTTPS",
          path: ["publicBaseUrl"],
        });
      }
      if (config.metricsToken === null) {
        context.addIssue({
          code: "custom",
          message: "Production metrics endpoint requires PHASE11_METRICS_TOKEN",
          path: ["metricsToken"],
        });
      }
      if (config.rabbitMqUrl === null) {
        context.addIssue({
          code: "custom",
          message: "Production outbox delivery requires RABBITMQ_URL",
          path: ["rabbitMqUrl"],
        });
      }
      if (config.requireExternalMalwareScan && config.clamAvHost === null) {
        context.addIssue({
          code: "custom",
          message: "Production artifact intake requires a ClamAV host",
          path: ["clamAvHost"],
        });
      }
    }
  });

export type Phase9BackendConfig = z.infer<typeof phase9BackendConfigSchema>;

export function resolvePhase9BackendConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Phase9BackendConfig {
  const nonBlank = (value: string | undefined) => {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  };
  const sharedDevelopmentSecret = nonBlank(environment.PHASE9_DEVELOPMENT_SECRET);
  const nodeEnv = environment.NODE_ENV ?? "development";
  const isRender = environment.RENDER === "true";
  const host = nonBlank(environment.PHASE9_API_HOST) ?? (isRender ? "0.0.0.0" : "127.0.0.1");
  const port = Number(
    nonBlank(environment.PHASE9_API_PORT) ?? nonBlank(environment.PORT) ?? "4180",
  );
  const corsOrigins = (environment.PHASE9_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return phase9BackendConfigSchema.parse({
    nodeEnv,
    host,
    port,
    publicBaseUrl:
      nonBlank(environment.PHASE9_PUBLIC_BASE_URL) ??
      nonBlank(environment.RENDER_EXTERNAL_URL) ??
      `http://${host}:${port}`,
    jwtSecret: nonBlank(environment.PHASE9_JWT_SECRET) ?? sharedDevelopmentSecret,
    cursorSecret: nonBlank(environment.PHASE9_CURSOR_SECRET) ?? sharedDevelopmentSecret,
    artifactSigningSecret:
      nonBlank(environment.PHASE9_ARTIFACT_SIGNING_SECRET) ?? sharedDevelopmentSecret,
    emailVerificationSecret:
      nonBlank(environment.PHASE9_EMAIL_VERIFICATION_SECRET) ?? sharedDevelopmentSecret,
    artifactRoot: nonBlank(environment.PHASE9_ARTIFACT_ROOT) ?? "data/artifacts",
    artifactStorageProvider: nonBlank(environment.PHASE9_ARTIFACT_STORAGE_PROVIDER) ?? "local",
    supabaseUrl: nonBlank(environment.SUPABASE_URL) ?? null,
    supabaseServiceRoleKey: nonBlank(environment.SUPABASE_SERVICE_ROLE_KEY) ?? null,
    supabaseStorageBucket: nonBlank(environment.SUPABASE_STORAGE_BUCKET) ?? null,
    corsOrigins,
    rabbitMqUrl: nonBlank(environment.RABBITMQ_URL) ?? null,
    trustProxyHops: Number(environment.PHASE11_TRUST_PROXY_HOPS ?? "0"),
    apiRateLimitWindowMs: Number(environment.PHASE11_RATE_LIMIT_WINDOW_MS ?? "60000"),
    apiRateLimitMaxRequests: Number(environment.PHASE11_API_RATE_LIMIT_MAX ?? "300"),
    authRateLimitMaxRequests: Number(environment.PHASE11_AUTH_RATE_LIMIT_MAX ?? "20"),
    requestTimeoutMs: Number(environment.PHASE11_REQUEST_TIMEOUT_MS ?? "60000"),
    headersTimeoutMs: Number(environment.PHASE11_HEADERS_TIMEOUT_MS ?? "65000"),
    keepAliveTimeoutMs: Number(environment.PHASE11_KEEP_ALIVE_TIMEOUT_MS ?? "5000"),
    maxArtifactBytes: Number(environment.PHASE11_MAX_ARTIFACT_BYTES ?? String(100 * 1024 * 1024)),
    metricsToken: nonBlank(environment.PHASE11_METRICS_TOKEN) ?? null,
    clamAvHost: nonBlank(environment.CLAMAV_HOST) ?? null,
    clamAvPort: Number(environment.CLAMAV_PORT ?? "3310"),
    clamAvTimeoutMs: Number(environment.CLAMAV_TIMEOUT_MS ?? "30000"),
    requireExternalMalwareScan: environmentBoolean(
      environment.PHASE11_REQUIRE_EXTERNAL_MALWARE_SCAN,
      nodeEnv === "production",
    ),
    requirePlatformMfa: environmentBoolean(
      environment.PLATFORM_REQUIRE_MFA,
      nodeEnv === "production",
    ),
  });
}
