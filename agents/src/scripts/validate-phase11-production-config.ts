import { config as loadEnvironment } from "dotenv";
import { resolve } from "node:path";
import { resolveBillingConfig } from "../backend/billing-config.js";
import { resolvePhase9BackendConfig } from "../backend/config.js";
import { agentModelPricingConfigured, resolveAgentRuntimeBudgetConfig } from "../runtime/guard.js";
import { resolveLangfuseConfig } from "../telemetry/langfuse.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value || /(?:change_me|replace_me)/iu.test(value)) {
    throw new Error(`${name} is required and must not be a placeholder`);
  }
  return value;
}

async function main() {
  const path = resolve(argument("--env") ?? ".env.production");
  const parsed = loadEnvironment({ path, override: false });
  if (parsed.error) throw parsed.error;
  const environment = { ...process.env, ...parsed.parsed };
  environment.NODE_ENV = "production";
  environment.PHASE9_PUBLIC_BASE_URL = required(environment, "BUILDWATCH_PUBLIC_BASE_URL");
  environment.PHASE9_API_HOST = "0.0.0.0";
  environment.PHASE9_API_PORT = "4180";
  environment.PHASE9_JWT_SECRET = required(environment, "PHASE9_JWT_SECRET");
  environment.PHASE9_CURSOR_SECRET = required(environment, "PHASE9_CURSOR_SECRET");
  environment.PHASE9_ARTIFACT_SIGNING_SECRET = required(
    environment,
    "PHASE9_ARTIFACT_SIGNING_SECRET",
  );
  environment.PHASE9_EMAIL_VERIFICATION_SECRET = required(
    environment,
    "PHASE9_EMAIL_VERIFICATION_SECRET",
  );
  environment.PHASE11_METRICS_TOKEN = required(environment, "PHASE11_METRICS_TOKEN");
  environment.PHASE11_TRUST_PROXY_HOPS = "1";
  environment.PHASE11_REQUIRE_EXTERNAL_MALWARE_SCAN = "true";
  environment.CLAMAV_HOST = "clamav";
  environment.RABBITMQ_URL = required(environment, "RABBITMQ_URL");
  required(environment, "SMTP_HOST");
  required(environment, "SMTP_FROM");
  const backend = resolvePhase9BackendConfig(environment);

  const release = required(environment, "APP_RELEASE");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(release)) {
    throw new Error("APP_RELEASE must be a safe immutable release identifier");
  }
  if (environment.PRODUCTION_DATABASE?.toLowerCase() !== "true") {
    throw new Error("PRODUCTION_DATABASE=true acknowledgement is required");
  }
  const databaseUrl = new URL(required(environment, "BUILDWATCH_DATABASE_URL"));
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error("BUILDWATCH_DATABASE_URL must use PostgreSQL");
  }
  if (["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname)) {
    throw new Error("Production database URL must target the deployment database service");
  }
  const rabbitMqUrl = new URL(required(environment, "RABBITMQ_URL"));
  if (!["amqp:", "amqps:"].includes(rabbitMqUrl.protocol)) {
    throw new Error("RABBITMQ_URL must use AMQP");
  }
  if (decodeURIComponent(rabbitMqUrl.username).toLowerCase() === "guest") {
    throw new Error("Production RabbitMQ must not use the guest account");
  }
  const backupSigningKey = required(environment, "PHASE11_BACKUP_SIGNING_KEY");
  const metricsToken = required(environment, "PHASE11_METRICS_TOKEN");
  if (Buffer.byteLength(backupSigningKey, "utf8") < 32) {
    throw new Error("PHASE11_BACKUP_SIGNING_KEY must contain at least 32 bytes");
  }
  const signingSecrets = [
    backend.jwtSecret,
    backend.cursorSecret,
    backend.artifactSigningSecret,
    backend.emailVerificationSecret,
    metricsToken,
    backupSigningKey,
  ];
  if (new Set(signingSecrets).size !== signingSecrets.length) {
    throw new Error("API, metrics, and backup signing secrets must all be independent");
  }
  if (required(environment, "OPENAI_API_KEY").length < 20) {
    throw new Error("OPENAI_API_KEY appears invalid");
  }
  const budget = resolveAgentRuntimeBudgetConfig(environment);
  if (!agentModelPricingConfigured(budget)) {
    throw new Error("Current non-zero OpenAI input/output prices are required");
  }
  const langfuse = resolveLangfuseConfig(environment);

  // Billing is validated here rather than only at boot so that a release is
  // blocked before it can take a real payment against a sandbox store, or ship
  // without the domestic invoice fallback (roadmap §8.2, §24.2).
  const billing = resolveBillingConfig(environment);
  if (billing.provider === "STRIPE" && billing.stripe !== null) {
    if (billing.stripe.webhookSecret === null) {
      throw new Error("STRIPE_WEBHOOK_SECRET is required in production");
    }
    if (billing.stripe.webhookSecret === billing.stripe.secretKey) {
      throw new Error("The Stripe webhook secret must differ from the Stripe secret key");
    }
    if (signingSecrets.includes(billing.stripe.webhookSecret)) {
      throw new Error("The Stripe webhook secret must be independent of API signing secrets");
    }
    for (const name of [
      "STRIPE_STARTER_MONTH_PRICE_ID",
      "STRIPE_STARTER_YEAR_PRICE_ID",
      "STRIPE_BUSINESS_MONTH_PRICE_ID",
      "STRIPE_BUSINESS_YEAR_PRICE_ID",
    ]) {
      const priceId = required(environment, name);
      if (!/^price_[A-Za-z0-9]+$/u.test(priceId)) {
        throw new Error(`${name} must be a Stripe Price id`);
      }
    }
  }
  if (billing.provider === "LEMON_SQUEEZY" && billing.lemonSqueezy !== null) {
    if (billing.lemonSqueezy.webhookSecret === billing.lemonSqueezy.apiKey) {
      throw new Error("The billing webhook secret must differ from the provider API key");
    }
    if (signingSecrets.includes(billing.lemonSqueezy.webhookSecret)) {
      throw new Error("The billing webhook secret must be independent of the API signing secrets");
    }
  }
  const billingReturnOrigins = new Set(
    billing.returnUrlAllowlist.map((entry) => new URL(entry).origin),
  );
  if (!billingReturnOrigins.has(new URL(backend.publicBaseUrl).origin)) {
    throw new Error("The billing return URL allowlist must include the public base URL origin");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "PASS",
        release,
        publicBaseUrl: backend.publicBaseUrl,
        databaseHost: databaseUrl.hostname,
        rabbitMqHost: rabbitMqUrl.hostname,
        clamAvHost: backend.clamAvHost,
        sentryConfigured: Boolean(environment.SENTRY_DSN?.trim()),
        langfuseConfigured: langfuse !== null,
        contentLoggingEnabled: false,
        deploymentStage: billing.deploymentStage,
        billingProvider: billing.provider,
        billingEnvironment: billing.environment,
        manualInvoiceEnabled: billing.manualInvoiceEnabled,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Phase 11 production config failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
