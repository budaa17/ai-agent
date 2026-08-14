import { z } from "zod";
import { billingProviderKindSchema } from "./billing-contracts.js";
import { BillingProviderError } from "./billing-provider.js";

/**
 * Billing environment configuration (landing-page-roadmap.md §24.2, §29).
 *
 * Two failure modes drive the strictness here. Running live traffic against a
 * sandbox key silently accepts fake payments; running sandbox tests against a
 * live key charges real cards. Both are refused at startup rather than
 * discovered later in a reconciliation report.
 */

const secretSchema = z.string().trim().min(24).max(4_096);

export const billingEnvironmentSchema = z.enum(["sandbox", "live"]);

export type BillingEnvironment = z.infer<typeof billingEnvironmentSchema>;

export const lemonSqueezyConfigSchema = z
  .object({
    apiKey: secretSchema,
    storeId: z.string().trim().min(1).max(64),
    webhookSecret: secretSchema,
    apiBaseUrl: z.string().url().default("https://api.lemonsqueezy.com"),
  })
  .strict();

export const stripeConfigSchema = z
  .object({
    secretKey: z
      .string()
      .trim()
      .regex(/^sk_(?:test|live)_[A-Za-z0-9_]+$/u),
    webhookSecret: z
      .string()
      .trim()
      .regex(/^whsec_[A-Za-z0-9_]+$/u)
      .nullable(),
    portalConfigurationId: z
      .string()
      .trim()
      .regex(/^bpc_[A-Za-z0-9]+$/u)
      .nullable(),
    automaticTaxEnabled: z.boolean(),
  })
  .strict();

export const billingConfigSchema = z
  .object({
    nodeEnv: z.enum(["development", "test", "production"]),
    /**
     * `NODE_ENV=production` keeps the optimized, fail-closed server runtime in
     * both staging and production. This separate boundary decides whether the
     * billing rail must be sandbox or live, so a public demo never needs to
     * weaken the rest of the production guards.
     */
    deploymentStage: z.enum(["development", "staging", "production"]).default("development"),
    provider: billingProviderKindSchema,
    environment: billingEnvironmentSchema,
    stripe: stripeConfigSchema.nullable().default(null),
    lemonSqueezy: lemonSqueezyConfigSchema.nullable(),
    manualInvoiceEnabled: z.boolean(),
    /** Origins a provider is allowed to send the buyer back to. */
    returnUrlAllowlist: z.array(z.string().url()).min(1),
    requestTimeoutMs: z.number().int().min(1_000).max(60_000),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.nodeEnv === "production" && config.deploymentStage === "development") {
      context.addIssue({
        code: "custom",
        path: ["deploymentStage"],
        message: "Production Node runtime requires an explicit staging or production stage",
      });
    }
    if (config.nodeEnv !== "production" && config.deploymentStage !== "development") {
      context.addIssue({
        code: "custom",
        path: ["deploymentStage"],
        message: "Staging and production deployment stages require NODE_ENV=production",
      });
    }
    if (config.provider === "STRIPE" && config.stripe === null) {
      context.addIssue({
        code: "custom",
        path: ["stripe"],
        message: "STRIPE_SECRET_KEY is required",
      });
    }
    if (config.stripe !== null) {
      const liveKey = config.stripe.secretKey.startsWith("sk_live_");
      if (config.environment === "live" && !liveKey) {
        context.addIssue({
          code: "custom",
          path: ["stripe", "secretKey"],
          message: "Live billing requires a Stripe live key",
        });
      }
      if (config.environment === "sandbox" && liveKey) {
        context.addIssue({
          code: "custom",
          path: ["stripe", "secretKey"],
          message: "Sandbox billing cannot use a Stripe live key",
        });
      }
    }
    if (config.provider === "LEMON_SQUEEZY" && config.lemonSqueezy === null) {
      context.addIssue({
        code: "custom",
        path: ["lemonSqueezy"],
        message: "LEMON_SQUEEZY_API_KEY, _STORE_ID and _WEBHOOK_SECRET are required",
      });
    }
    if (config.provider === "PADDLE") {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: "Paddle is not implemented yet; it is a post-MVP provider",
      });
    }
    if (config.nodeEnv !== "production") return;

    if (config.provider !== "STRIPE") {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: "Production self-service billing is Stripe-only",
      });
    }
    if (config.provider === "STRIPE" && config.stripe?.webhookSecret === null) {
      context.addIssue({
        code: "custom",
        path: ["stripe", "webhookSecret"],
        message: "Production Stripe billing requires STRIPE_WEBHOOK_SECRET",
      });
    }

    if (config.deploymentStage === "production" && config.environment !== "live") {
      context.addIssue({
        code: "custom",
        path: ["environment"],
        message: "Production must run against the live billing environment, not a sandbox",
      });
    }
    if (config.deploymentStage === "staging" && config.environment !== "sandbox") {
      context.addIssue({
        code: "custom",
        path: ["environment"],
        message: "Staging must run against the sandbox billing environment, not live payments",
      });
    }
    const insecure = config.returnUrlAllowlist.filter(
      (entry) => new URL(entry).protocol !== "https:",
    );
    if (insecure.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["returnUrlAllowlist"],
        message: "Production return URLs must use HTTPS",
      });
    }
  });

export type BillingConfig = z.infer<typeof billingConfigSchema>;
export type LemonSqueezyConfig = z.infer<typeof lemonSqueezyConfigSchema>;
export type StripeConfig = z.infer<typeof stripeConfigSchema>;

function nonBlank(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function optionalConfiguredSecret(value: string | undefined): string | undefined {
  const normalized = nonBlank(value);
  return normalized === undefined || /^(?:whsec_)?\.\.\.$/u.test(normalized)
    ? undefined
    : normalized;
}

function environmentBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim().length === 0) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function resolveBillingConfig(environment: NodeJS.ProcessEnv = process.env): BillingConfig {
  const nodeEnv = (environment.NODE_ENV ?? "development") as BillingConfig["nodeEnv"];
  const apiKey = nonBlank(environment.LEMON_SQUEEZY_API_KEY);
  const storeId = nonBlank(environment.LEMON_SQUEEZY_STORE_ID);
  const webhookSecret = nonBlank(environment.LEMON_SQUEEZY_WEBHOOK_SECRET);
  const stripeSecretKey = nonBlank(environment.STRIPE_SECRET_KEY);
  const stripeWebhookSecret = optionalConfiguredSecret(environment.STRIPE_WEBHOOK_SECRET);
  const allowlist = nonBlank(environment.BILLING_RETURN_URL_ALLOWLIST)
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const hasLemonSqueezyCredentials =
    apiKey !== undefined && storeId !== undefined && webhookSecret !== undefined;

  return billingConfigSchema.parse({
    nodeEnv,
    deploymentStage:
      nonBlank(environment.BUILDWATCH_DEPLOYMENT_STAGE) ??
      (nodeEnv === "production" ? "production" : "development"),
    /**
     * Production always defaults to the card provider, so a deployment missing
     * its credentials fails loudly at startup. A developer machine with no
     * billing secrets falls back to the domestic invoice channel, which needs
     * none, instead of refusing to boot.
     */
    provider:
      nonBlank(environment.BILLING_PROVIDER) ??
      (stripeSecretKey !== undefined
        ? "STRIPE"
        : hasLemonSqueezyCredentials
          ? "LEMON_SQUEEZY"
          : nodeEnv === "production"
            ? "STRIPE"
            : "MANUAL_INVOICE"),
    environment:
      nonBlank(environment.BILLING_ENVIRONMENT) ?? (nodeEnv === "production" ? "live" : "sandbox"),
    lemonSqueezy:
      apiKey !== undefined && storeId !== undefined && webhookSecret !== undefined
        ? {
            apiKey,
            storeId,
            webhookSecret,
            apiBaseUrl: nonBlank(environment.LEMON_SQUEEZY_API_BASE_URL) ?? undefined,
          }
        : null,
    stripe:
      stripeSecretKey !== undefined
        ? {
            secretKey: stripeSecretKey,
            webhookSecret: stripeWebhookSecret ?? null,
            portalConfigurationId: nonBlank(environment.STRIPE_PORTAL_CONFIGURATION_ID) ?? null,
            automaticTaxEnabled: environmentBoolean(
              environment.STRIPE_AUTOMATIC_TAX_ENABLED,
              false,
            ),
          }
        : null,
    manualInvoiceEnabled: environmentBoolean(environment.BILLING_MANUAL_INVOICE_ENABLED, false),
    returnUrlAllowlist: allowlist ?? [
      nonBlank(environment.PHASE9_PUBLIC_BASE_URL) ?? "http://127.0.0.1:4173",
    ],
    requestTimeoutMs: Number(environment.BILLING_REQUEST_TIMEOUT_MS ?? "15000"),
  });
}

/**
 * Validates a checkout return URL against the allowlist.
 *
 * Providers echo this value back into a browser redirect, so an unchecked value
 * is an open redirect with a trusted domain in front of it (§24.2). Matching is
 * on the exact origin plus a path prefix; credentials, traversal and non-HTTP
 * schemes are refused outright.
 */
export function assertAllowedReturnUrl(candidate: string, allowlist: readonly string[]): string {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new BillingProviderError("PAYLOAD_INVALID", "Return URL is not a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BillingProviderError("PAYLOAD_INVALID", "Return URL scheme is not allowed");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new BillingProviderError("PAYLOAD_INVALID", "Return URL must not carry credentials");
  }
  if (parsed.pathname.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new BillingProviderError("PAYLOAD_INVALID", "Return URL must not traverse");
  }

  const allowed = allowlist.some((entry) => {
    let base: URL;
    try {
      base = new URL(entry);
    } catch {
      return false;
    }
    if (base.origin !== parsed.origin) return false;
    const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    return (
      basePath === "/" || parsed.pathname === base.pathname || parsed.pathname.startsWith(basePath)
    );
  });

  if (!allowed) {
    throw new BillingProviderError("PAYLOAD_INVALID", "Return URL is not in the allowlist");
  }
  return parsed.toString();
}

/**
 * Public browser origin used by Checkout redirects and customer email links.
 * It is intentionally separate from the API listener/public base URL: in local
 * development the browser is served by Vite on :4173 while the API listens on
 * :4180. Falling back to the first allowlisted URL keeps both values aligned.
 */
export function resolveBillingPublicAppBaseUrl(
  config: Pick<BillingConfig, "returnUrlAllowlist">,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const candidate =
    nonBlank(environment.BUILDWATCH_PUBLIC_BASE_URL) ?? config.returnUrlAllowlist[0];
  if (candidate === undefined) {
    throw new BillingProviderError("NOT_CONFIGURED", "Billing public app URL is unavailable");
  }
  const parsed = new URL(assertAllowedReturnUrl(candidate, config.returnUrlAllowlist));
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new BillingProviderError(
      "PAYLOAD_INVALID",
      "Billing public app URL must not contain query or fragment",
    );
  }
  return parsed.toString().replace(/\/+$/u, "");
}
