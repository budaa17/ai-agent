import { randomUUID } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z, ZodError } from "zod";
import {
  Phase9ApiError,
  phase9CursorQuerySchema,
  phase9ErrorEnvelopeSchema,
  phase9IdentifierSchema,
  type Phase9AuthenticatedPrincipal,
} from "./contracts.js";
import type { Phase9AuthService } from "./auth-service.js";
import type { Phase9ArtifactService } from "./artifact-service.js";
import type { Phase9ApprovedCommandService } from "./command-service.js";
import { buildWatchPhase9OpenApi } from "./openapi.js";
import type { Phase9ProjectService } from "./project-service.js";
import type { Phase9ReviewService } from "./review-service.js";
import type { Phase9RulesService } from "./rules-service.js";
import type { Phase9FileAssetRecord } from "./store.js";
import type { Phase10FrontendService } from "./phase10-service.js";
import { phase11ArtifactMediaTypes } from "./phase11-artifact-security.js";
import {
  Phase11FixedWindowRateLimiter,
  applyPhase11SecurityHeaders,
  phase11RequestFamily,
  phase11TelemetryTag,
  phase11TokenMatches,
  renderPhase11PrometheusMetrics,
  setPhase11RateLimitHeaders,
} from "./phase11-security.js";
import type { AgentErrorReporter, AgentOperationalMetrics } from "../runtime/logging.js";
import type { PlatformAuthService } from "./platform-auth-service.js";
import { createPlatformApiRouter } from "./platform-api.js";
import type { PlatformDrilldownService } from "./platform-drilldown-service.js";
import type { PlatformIncidentService } from "./platform-incident-service.js";
import type { PlatformOverviewService } from "./platform-overview-service.js";
import type { PlatformQualityService } from "./platform-quality-service.js";
import type { PlatformSupportAccessService } from "./platform-support-access-service.js";
import type { PlatformBillingService } from "./platform-billing-service.js";
import type { TenantAccessDecision, TenantAccessPolicy } from "./tenant-access-policy.js";
import { billingProviderKindSchema } from "./billing-contracts.js";
import type { BillingFeatureKey } from "./billing-contracts.js";
import { BillingProviderError } from "./billing-provider.js";
import type { BillingWebhookService } from "./billing-webhook-service.js";
import type { CompanySignupService } from "./billing-signup-service.js";
import type { PrismaTenantUsageReader, TenantBillingService } from "./tenant-billing-service.js";
import { requireTenantPermission } from "./authorization.js";
import { classifyTenantAccessOperation, requestPathWithoutQuery } from "./tenant-access-routes.js";

type AuthenticatedRequest = Request & {
  phase9Principal?: Phase9AuthenticatedPrincipal;
  phase9CorrelationId?: string;
  phase9AccessDecision?: TenantAccessDecision;
};

export interface Phase9ObjectStore {
  read(asset: Phase9FileAssetRecord): Promise<{
    contentType: string;
    contentLength: number;
    body: Buffer;
  }>;
}

export interface Phase9ApiServices {
  auth: Phase9AuthService;
  platformAuth?: PlatformAuthService;
  platformOverview?: PlatformOverviewService;
  platformDrilldown?: PlatformDrilldownService;
  platformIncidents?: PlatformIncidentService;
  platformQuality?: PlatformQualityService;
  platformSupportAccess?: PlatformSupportAccessService;
  platformBilling?: PlatformBillingService;
  /**
   * Subscription access gate. Optional only so that focused tests can build a
   * bare API; `createPhase9Api` refuses to start in production without it, so a
   * deployed instance can never run ungated.
   */
  tenantAccess?: TenantAccessPolicy;
  /** Verified provider webhooks. Absent means the endpoint answers 404. */
  billingWebhooks?: BillingWebhookService;
  billingSignups?: CompanySignupService;
  publicPlans?: { listPublicPlans(): Promise<unknown> };
  tenantBilling?: TenantBillingService;
  /** Live counters the plan limits are measured against (Phase 9). */
  tenantUsage?: PrismaTenantUsageReader;
  /** Maps an invitation token to its tenant so the seat limit can be checked. */
  invitationLookup?: (token: string) => Promise<string | null>;
  projects: Phase9ProjectService;
  commands: Phase9ApprovedCommandService;
  reviews: Phase9ReviewService;
  artifacts: Phase9ArtifactService;
  objectStore: Phase9ObjectStore;
  frontend?: Phase10FrontendService;
  rules?: Phase9RulesService;
  readiness?: () => Promise<boolean>;
  operationalGauges?: () => Promise<Record<string, number>>;
}

export interface Phase9ApiLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export interface Phase9ApiOptions {
  nodeEnv?: "development" | "test" | "production";
  trustProxyHops?: number;
  rateLimitWindowMs?: number;
  apiRateLimitMaxRequests?: number;
  authRateLimitMaxRequests?: number;
  maxArtifactBytes?: number;
  metricsToken?: string | null;
  logger?: Phase9ApiLogger;
  errorReporter?: AgentErrorReporter;
  metrics?: AgentOperationalMetrics;
}

function frontendService(services: Phase9ApiServices): Phase10FrontendService {
  if (services.frontend === undefined) {
    throw new Phase9ApiError("INTERNAL_ERROR", 503, "Frontend workspace service is not available");
  }
  return services.frontend;
}

/**
 * Enforces a countable plan limit before the resource is created
 * (landing-page-roadmap.md §6.2, Phase 9).
 *
 * The usage figure is read fresh rather than cached, and a figure that cannot be
 * read is passed through as `null` so the policy refuses instead of treating
 * unknown usage as zero.
 *
 * Known limitation: this is a check-then-create, so two simultaneous requests
 * can both pass a limit that has one slot left. Closing that needs a serialised
 * reservation and is tracked as remaining Phase 9 work.
 */
async function enforcePlanLimit(
  services: Phase9ApiServices,
  tenantId: string,
  featureKey: BillingFeatureKey,
  delta: number | bigint = 1,
): Promise<void> {
  const policy = services.tenantAccess;
  const usage = services.tenantUsage;
  if (policy === undefined || usage === undefined) return;
  await policy.requireLimit(tenantId, featureKey, await usage.count(tenantId, featureKey), delta);
}

/**
 * Resolves which workspace an invitation token belongs to, without revealing
 * whether the token is valid: an unknown token simply yields `null` and the
 * normal acceptance path produces the usual generic failure.
 */
async function invitationTenantId(
  services: Phase9ApiServices,
  body: unknown,
): Promise<string | null> {
  const token = (body as { invitationToken?: unknown } | undefined)?.invitationToken;
  if (typeof token !== "string" || token.length === 0) return null;
  return services.invitationLookup?.(token) ?? null;
}

function tenantBilling(services: Phase9ApiServices): TenantBillingService {
  if (services.tenantBilling === undefined) {
    throw new Phase9ApiError("INTERNAL_ERROR", 503, "Billing service is not available");
  }
  return services.tenantBilling;
}

function signupService(services: Phase9ApiServices): CompanySignupService {
  if (services.billingSignups === undefined) {
    throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Resource not found");
  }
  return services.billingSignups;
}

function rulesService(services: Phase9ApiServices): Phase9RulesService {
  if (services.rules === undefined) {
    throw new Phase9ApiError("INTERNAL_ERROR", 503, "Rules service is not available");
  }
  return services.rules;
}

function correlationId(request: AuthenticatedRequest): string {
  return request.phase9CorrelationId ?? randomUUID();
}

function principal(request: AuthenticatedRequest): Phase9AuthenticatedPrincipal {
  if (request.phase9Principal === undefined) {
    throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Authentication required");
  }
  return request.phase9Principal;
}

function stringParameter(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) {
    throw new Phase9ApiError("VALIDATION_FAILED", 400, `Invalid ${name}`);
  }
  return value;
}

function artifactOriginalFileName(request: Request): string {
  const encoded = request.header("x-file-name");
  if (typeof encoded !== "string" || encoded.length === 0 || encoded.length > 4_096) {
    throw new Phase9ApiError("VALIDATION_FAILED", 400, "Invalid x-file-name");
  }
  const encoding = request.header("x-file-name-encoding");
  if (encoding === undefined) return stringParameter(encoded, "x-file-name");
  if (encoding !== "percent") {
    throw new Phase9ApiError("VALIDATION_FAILED", 400, "Invalid x-file-name-encoding");
  }
  try {
    return stringParameter(decodeURIComponent(encoded), "x-file-name");
  } catch {
    throw new Phase9ApiError("VALIDATION_FAILED", 400, "Invalid encoded x-file-name");
  }
}

function idempotencyKey(request: Request): string {
  const value = request.header("idempotency-key");
  if (value === undefined) {
    throw new Phase9ApiError("IDEMPOTENCY_KEY_REQUIRED", 400, "Idempotency-Key header is required");
  }
  return value;
}

function requestMetadata(request: AuthenticatedRequest) {
  return {
    correlationId: correlationId(request),
    userAgent: request.header("user-agent") ?? undefined,
    ipAddress: request.ip,
    deviceName: request.header("x-device-name") ?? undefined,
  };
}

function asyncRoute(handler: (request: AuthenticatedRequest, response: Response) => Promise<void>) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}

export function createPhase9Api(services: Phase9ApiServices, options: Phase9ApiOptions = {}) {
  const app = express();
  const production = options.nodeEnv === "production";
  if (production && services.tenantAccess === undefined) {
    throw new Error(
      "Refusing to start: the tenant subscription access policy is required in production. " +
        "Without it every authenticated tenant would bypass the billing gate.",
    );
  }
  const rateLimitWindowMs = options.rateLimitWindowMs ?? 60_000;
  const apiRateLimiter = new Phase11FixedWindowRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: options.apiRateLimitMaxRequests ?? 10_000,
  });
  const authRateLimiter = new Phase11FixedWindowRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: options.authRateLimitMaxRequests ?? 1_000,
  });
  app.disable("x-powered-by");
  app.set("trust proxy", (options.trustProxyHops ?? 0) === 0 ? false : options.trustProxyHops);
  app.use((request: AuthenticatedRequest, response, next) => {
    const startedAt = performance.now();
    const supplied = request.header("x-request-id");
    request.phase9CorrelationId =
      supplied !== undefined && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(supplied)
        ? supplied
        : randomUUID();
    response.setHeader("x-request-id", request.phase9CorrelationId);
    applyPhase11SecurityHeaders(response, production);
    response.once("finish", () => {
      const durationMs = Math.max(0, performance.now() - startedAt);
      const family = phase11RequestFamily(request.path);
      options.metrics?.increment("http_requests_total");
      options.metrics?.increment(`http_${Math.floor(response.statusCode / 100)}xx_total`);
      options.metrics?.increment(`http_family_${family}_total`);
      options.metrics?.observe("http_request_duration_ms", durationMs);
      options.logger?.info("http_request_completed", {
        correlationId: request.phase9CorrelationId,
        method: request.method,
        requestFamily: family,
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(3)),
        tenantTag: phase11TelemetryTag(request.phase9Principal?.tenantId),
        projectTag: phase11TelemetryTag(/\/v1\/projects\/([^/?]+)/u.exec(request.originalUrl)?.[1]),
      });
    });
    next();
  });
  app.use(["/v1", "/platform/v1"], (request: AuthenticatedRequest, response, next) => {
    const family = phase11RequestFamily(request.originalUrl);
    const key = `${request.ip ?? "unknown"}:${family}`;
    const apiDecision = apiRateLimiter.consume(key);
    setPhase11RateLimitHeaders(response, apiDecision);
    if (!apiDecision.allowed) {
      next(
        new Phase9ApiError("API_RATE_LIMITED", 429, "Request rate limit exceeded", {
          retryAfterSeconds: apiDecision.retryAfterSeconds,
        }),
      );
      return;
    }
    if (family === "auth") {
      const authDecision = authRateLimiter.consume(request.ip ?? "unknown");
      setPhase11RateLimitHeaders(response, authDecision);
      if (!authDecision.allowed) {
        next(
          new Phase9ApiError("AUTH_RATE_LIMITED", 429, "Authentication rate limit exceeded", {
            retryAfterSeconds: authDecision.retryAfterSeconds,
          }),
        );
        return;
      }
    }
    next();
  });
  // Public signup and code verification are authentication-adjacent endpoints.
  // Give them the stricter per-address budget instead of the broad API limit.
  app.use("/public/v1/company-signups", (request: AuthenticatedRequest, response, next) => {
    if (request.method !== "POST") {
      next();
      return;
    }
    const decision = authRateLimiter.consume(request.ip ?? "unknown");
    setPhase11RateLimitHeaders(response, decision);
    if (!decision.allowed) {
      next(
        new Phase9ApiError("AUTH_RATE_LIMITED", 429, "Too many signup verification requests", {
          retryAfterSeconds: decision.retryAfterSeconds,
        }),
      );
      return;
    }
    next();
  });
  app.use(["/v1", "/platform/v1"], (request, _response, next) => {
    if (
      ["POST", "PUT", "PATCH"].includes(request.method) &&
      !/^\/v1\/projects\/[^/]+\/artifacts\/?(?:\?.*)?$/u.test(request.originalUrl) &&
      !request.is("application/json")
    ) {
      next(
        new Phase9ApiError(
          "VALIDATION_FAILED",
          415,
          "Request content type must be application/json",
        ),
      );
      return;
    }
    next();
  });
  // The provider signs the exact bytes it sent, so this route must see the raw
  // body. Re-serialising parsed JSON changes key order and breaks every
  // signature, hence its registration ahead of the JSON parser (§24.1).
  app.post(
    "/webhooks/billing/:provider",
    express.raw({ type: "*/*", limit: "1mb" }),
    asyncRoute(async (request, response) => {
      const webhooks = services.billingWebhooks;
      if (webhooks === undefined) {
        throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Resource not found");
      }
      const kind = billingProviderKindSchema.safeParse(request.params.provider);
      if (!kind.success) {
        throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Resource not found");
      }
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        headers[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
      }
      try {
        const result = await webhooks.receive(
          kind.data,
          Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
          headers,
          correlationId(request),
        );
        // Always 2xx once the signature holds, so the provider stops retrying a
        // message we have durably recorded. Failures are worked off from the
        // inbox, not from the provider's retry schedule.
        response.status(202).json({ status: result.outcome });
      } catch (error) {
        if (error instanceof BillingProviderError) {
          options.metrics?.increment("billing_webhook_invalid_total");
          // Deliberately uninformative: a caller probing the endpoint learns
          // nothing about why verification failed.
          response.status(error.code === "SIGNATURE_INVALID" ? 401 : 400).end();
          return;
        }
        throw error;
      }
    }),
  );

  app.use(express.json({ limit: "2mb", strict: true }));

  // --- Public marketing and signup API (§23.1) ------------------------------

  app.get(
    "/public/v1/plans",
    asyncRoute(async (_request, response) => {
      const catalog = services.publicPlans;
      if (catalog === undefined) {
        throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Resource not found");
      }
      response.json(await catalog.listPublicPlans());
    }),
  );

  app.post(
    "/public/v1/company-signups",
    asyncRoute(async (request, response) => {
      response.status(201).json(await signupService(services).createIntent(request.body));
    }),
  );
  app.post(
    "/public/v1/company-signups/:id/verify-email",
    asyncRoute(async (request, response) => {
      const code = stringParameter((request.body as { code?: unknown })?.code, "code");
      response.json(
        await signupService(services).verifyEmail(stringParameter(request.params.id, "id"), code),
      );
    }),
  );
  app.post(
    "/public/v1/company-signups/:id/resend-verification-code",
    asyncRoute(async (request, response) => {
      response.json(
        await signupService(services).resendVerificationCode(
          stringParameter(request.params.id, "id"),
        ),
      );
    }),
  );
  app.post(
    "/public/v1/company-signups/:id/checkout",
    asyncRoute(async (request, response) => {
      response.json(
        await signupService(services).createCheckout(
          stringParameter(request.params.id, "id"),
          correlationId(request),
        ),
      );
    }),
  );
  app.post(
    "/public/v1/company-signups/account-setup",
    asyncRoute(async (request, response) => {
      response.json(
        await signupService(services).completeAccountSetup(request.body, correlationId(request)),
      );
    }),
  );
  app.get(
    "/public/v1/company-signups/:id/status",
    asyncRoute(async (request, response) => {
      response.json(await signupService(services).status(stringParameter(request.params.id, "id")));
    }),
  );

  app.use(
    "/platform/v1",
    createPlatformApiRouter({
      platformAuth: services.platformAuth,
      platformOverview: services.platformOverview,
      platformDrilldown: services.platformDrilldown,
      platformIncidents: services.platformIncidents,
      platformQuality: services.platformQuality,
      platformSupportAccess: services.platformSupportAccess,
      platformBilling: services.platformBilling,
      tenantAuth: services.auth,
    }),
  );

  app.get("/health/live", (_request, response) => {
    response.json({ status: "live", version: "buildwatch-v22-phase9" });
  });
  app.get(
    "/health/ready",
    asyncRoute(async (_request, response) => {
      const ready = (await services.readiness?.()) ?? true;
      response.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready" });
    }),
  );
  app.get("/openapi.json", (_request, response) => {
    response.json(buildWatchPhase9OpenApi);
  });
  app.get(
    "/internal/metrics",
    asyncRoute(async (request, response) => {
      if (options.metricsToken === null || options.metricsToken === undefined) {
        throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Resource not found");
      }
      const authorization = request.header("authorization");
      const supplied = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;
      if (!phase11TokenMatches(supplied, options.metricsToken)) {
        throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Authentication required");
      }
      const gauges = (await services.operationalGauges?.()) ?? {};
      response
        .type("text/plain; version=0.0.4; charset=utf-8")
        .send(
          renderPhase11PrometheusMetrics(
            options.metrics?.snapshot() ?? { counters: {}, observations: {} },
            gauges,
          ),
        );
    }),
  );

  app.post(
    "/v1/auth/login",
    asyncRoute(async (request, response) => {
      response.json(await services.auth.login(request.body, requestMetadata(request)));
    }),
  );
  app.post(
    "/v1/auth/login/tenant",
    asyncRoute(async (request, response) => {
      response.json(
        await services.auth.completeTenantSelection(request.body, requestMetadata(request)),
      );
    }),
  );
  app.post(
    "/v1/auth/refresh",
    asyncRoute(async (request, response) => {
      response.json(await services.auth.refresh(request.body, requestMetadata(request)));
    }),
  );
  app.post(
    "/v1/auth/logout",
    asyncRoute(async (request, response) => {
      await services.auth.logout(request.body, requestMetadata(request));
      response.status(204).end();
    }),
  );
  app.post(
    "/v1/invitations/accept",
    asyncRoute(async (request, response) => {
      // Sending an invitation does not create a user; accepting one does. Without
      // a check here, a workspace could issue ten invitations at its seat limit
      // and end up ten seats over it.
      const tenantId = await invitationTenantId(services, request.body);
      if (tenantId !== null) {
        await enforcePlanLimit(services, tenantId, "USER_ACTIVE_MAX");
      }
      response
        .status(201)
        .json(await services.auth.acceptInvitation(request.body, requestMetadata(request)));
    }),
  );
  app.get(
    "/v1/artifacts/:artifactId/content",
    asyncRoute(async (request, response) => {
      const asset = await services.artifacts.resolveSignedUrl(
        stringParameter(request.params.artifactId, "artifactId"),
        {
          tid: typeof request.query.tid === "string" ? request.query.tid : undefined,
          pid: typeof request.query.pid === "string" ? request.query.pid : undefined,
          uid: typeof request.query.uid === "string" ? request.query.uid : undefined,
          exp: typeof request.query.exp === "string" ? request.query.exp : undefined,
          nonce: typeof request.query.nonce === "string" ? request.query.nonce : undefined,
          sig: typeof request.query.sig === "string" ? request.query.sig : undefined,
        },
      );
      const object = await services.objectStore.read(asset);
      response.setHeader("content-type", object.contentType);
      response.setHeader("content-length", String(object.contentLength));
      response.setHeader(
        "content-disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(asset.originalFileName)}`,
      );
      response.send(object.body);
    }),
  );

  app.use("/v1", (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
    const authorization = request.header("authorization");
    if (authorization === undefined || !authorization.startsWith("Bearer ")) {
      next(new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Authentication required"));
      return;
    }
    const token = authorization.slice("Bearer ".length);
    services.auth
      .authenticateAccess(token)
      .then((authenticated) => {
        request.phase9Principal = authenticated;
        next();
      })
      .catch(async (tenantError: unknown) => {
        if (services.platformAuth !== undefined) {
          try {
            await services.platformAuth.authenticateAccess(token);
            next(new Phase9ApiError("AUTH_FORBIDDEN", 403, "Access denied"));
            return;
          } catch {
            // Keep the tenant verifier's stable 401 for an unrecognized token.
          }
        }
        next(tenantError);
      });
  });

  // Subscription access gate (landing-page-roadmap.md §19). It runs after
  // authentication and before every business route, so a client that hides a
  // button, edits local state or calls the API directly hits the same boundary.
  app.use("/v1", (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    const policy = services.tenantAccess;
    const authenticated = request.phase9Principal;
    if (policy === undefined || authenticated === undefined) {
      next();
      return;
    }
    const path = requestPathWithoutQuery(request.originalUrl);
    const operation = classifyTenantAccessOperation(request.method, path);
    policy
      .getDecision(authenticated.tenantId, operation)
      .then((decision) => {
        if (!decision.allowed) {
          options.metrics?.increment("http_tenant_access_denied_total");
          next(policy.toError(decision));
          return;
        }
        request.phase9AccessDecision = decision;
        if (decision.warning !== null) {
          // The Company Admin still has full access during grace; the header lets
          // the console raise a persistent banner without another round trip.
          response.setHeader("x-buildwatch-billing-state", decision.warning.kind);
          if (decision.warning.graceEndsAt !== null) {
            response.setHeader(
              "x-buildwatch-billing-grace-ends-at",
              decision.warning.graceEndsAt.toISOString(),
            );
          }
        }
        next();
      })
      .catch(next);
  });

  // --- Tenant billing (§23.2) ----------------------------------------------
  // These routes sit inside the billing allowlist, so they keep working while
  // the workspace itself is gated. Role is still checked: billing is a Company
  // Admin concern, not a project one.
  app.get(
    "/v1/billing/subscription",
    asyncRoute(async (request, response) => {
      const actor = principal(request);
      requireTenantPermission(actor, "TENANT_BILLING_READ");
      response.json(await tenantBilling(services).subscription(actor.tenantId));
    }),
  );
  app.get(
    "/v1/billing/entitlements",
    asyncRoute(async (request, response) => {
      const actor = principal(request);
      requireTenantPermission(actor, "TENANT_BILLING_READ");
      response.json(await tenantBilling(services).entitlements(actor.tenantId));
    }),
  );
  app.get(
    "/v1/billing/usage",
    asyncRoute(async (request, response) => {
      const actor = principal(request);
      requireTenantPermission(actor, "TENANT_BILLING_READ");
      response.json(await tenantBilling(services).usage(actor.tenantId));
    }),
  );
  app.get(
    "/v1/billing/invoices",
    asyncRoute(async (request, response) => {
      const actor = principal(request);
      requireTenantPermission(actor, "TENANT_BILLING_READ");
      response.json({ invoices: await tenantBilling(services).invoices(actor.tenantId) });
    }),
  );
  app.post(
    "/v1/billing/portal",
    asyncRoute(async (request, response) => {
      const actor = principal(request);
      requireTenantPermission(actor, "TENANT_BILLING_MANAGE");
      response.json(await tenantBilling(services).portal(actor.tenantId, correlationId(request)));
    }),
  );
  app.post(
    "/v1/billing/cancel",
    asyncRoute(async (request, response) => {
      const actor = principal(request);
      requireTenantPermission(actor, "TENANT_BILLING_MANAGE");
      const reason = (request.body as { reason?: unknown } | undefined)?.reason;
      response.json(
        await tenantBilling(services).cancel(
          actor.tenantId,
          actor.userId,
          correlationId(request),
          typeof reason === "string" ? reason.slice(0, 500) : null,
        ),
      );
    }),
  );

  app.post(
    "/v1/invitations",
    asyncRoute(async (request, response) => {
      const actor = principal(request);
      await enforcePlanLimit(services, actor.tenantId, "USER_ACTIVE_MAX");
      response
        .status(201)
        .json(await services.auth.invite(actor, request.body, requestMetadata(request)));
    }),
  );
  app.get(
    "/v1/session",
    asyncRoute(async (request, response) => {
      response.json(await services.auth.session(principal(request)));
    }),
  );
  app.post(
    "/v1/projects",
    asyncRoute(async (request, response) => {
      const actor = principal(request);
      // The project limit is reserved inside the creation transaction instead of
      // here, so a concurrent create cannot pass the same check (Phase 9).
      response
        .status(201)
        .json(
          await frontendService(services).createProject(
            actor,
            idempotencyKey(request),
            request.body,
            correlationId(request),
          ),
        );
    }),
  );
  app.get(
    "/v1/projects",
    asyncRoute(async (request, response) => {
      const query = phase9CursorQuerySchema.parse(request.query);
      response.json(await services.projects.listProjects(principal(request), query));
    }),
  );
  app.get(
    "/v1/rules",
    asyncRoute(async (request, response) => {
      response.json(await rulesService(services).list(principal(request)));
    }),
  );
  app.get(
    "/v1/rules/:ruleId/versions",
    asyncRoute(async (request, response) => {
      response.json(
        await rulesService(services).listVersions(
          principal(request),
          stringParameter(request.params.ruleId, "ruleId"),
        ),
      );
    }),
  );
  app.put(
    "/v1/rules/:ruleId/draft",
    asyncRoute(async (request, response) => {
      response
        .status(201)
        .json(
          await rulesService(services).saveDraft(
            principal(request),
            stringParameter(request.params.ruleId, "ruleId"),
            request.body,
          ),
        );
    }),
  );
  app.post(
    "/v1/rules/:ruleId/publish",
    asyncRoute(async (request, response) => {
      const body = z.object({ versionId: phase9IdentifierSchema }).parse(request.body);
      response.json(
        await rulesService(services).publish(
          principal(request),
          stringParameter(request.params.ruleId, "ruleId"),
          body.versionId,
        ),
      );
    }),
  );
  app.get(
    "/v1/projects/:projectId/workspace",
    asyncRoute(async (request, response) => {
      response.json(
        await frontendService(services).workspace(
          principal(request),
          stringParameter(request.params.projectId, "projectId"),
        ),
      );
    }),
  );
  app.post(
    "/v1/projects/:projectId/daily-report-drafts",
    asyncRoute(async (request, response) => {
      response
        .status(201)
        .json(
          await frontendService(services).submitDailyReport(
            principal(request),
            stringParameter(request.params.projectId, "projectId"),
            idempotencyKey(request),
            request.body,
            correlationId(request),
          ),
        );
    }),
  );
  app.get(
    "/v1/projects/:projectId/inventory",
    asyncRoute(async (request, response) => {
      response.json(
        await frontendService(services).inventory(
          principal(request),
          stringParameter(request.params.projectId, "projectId"),
        ),
      );
    }),
  );
  app.post(
    "/v1/projects/:projectId/inventory/movements",
    asyncRoute(async (request, response) => {
      response
        .status(201)
        .json(
          await frontendService(services).createStockMovement(
            principal(request),
            stringParameter(request.params.projectId, "projectId"),
            idempotencyKey(request),
            request.body,
          ),
        );
    }),
  );
  app.post(
    "/v1/projects/:projectId/artifacts",
    (request, _response, next) => {
      const mediaType = request.header("content-type")?.split(";", 1)[0]?.trim();
      if (
        mediaType === undefined ||
        !phase11ArtifactMediaTypes.includes(mediaType as (typeof phase11ArtifactMediaTypes)[number])
      ) {
        next(new Phase9ApiError("ARTIFACT_REJECTED", 415, "Unsupported artifact media type"));
        return;
      }
      next();
    },
    express.raw({
      type: () => true,
      limit: options.maxArtifactBytes ?? 100 * 1024 * 1024,
    }),
    asyncRoute(async (request, response) => {
      if (!Buffer.isBuffer(request.body)) {
        throw new Phase9ApiError("VALIDATION_FAILED", 400, "Artifact request body must be binary");
      }
      const uploader = principal(request);
      // Charged against the plan before the bytes are stored, using this file's
      // own size as the delta rather than a flat one.
      await enforcePlanLimit(
        services,
        uploader.tenantId,
        "STORAGE_BYTES_MAX",
        BigInt(request.body.byteLength),
      );
      response.status(201).json(
        await frontendService(services).uploadArtifact(
          uploader,
          stringParameter(request.params.projectId, "projectId"),
          idempotencyKey(request),
          {
            body: request.body,
            originalFileName: artifactOriginalFileName(request),
            mediaType: request.header("content-type")?.split(";", 1)[0] ?? "",
            suppliedSha256: request.header("x-content-sha256"),
          },
          correlationId(request),
        ),
      );
    }),
  );
  app.post(
    "/v1/projects/:projectId/a0-intakes",
    asyncRoute(async (request, response) => {
      await enforcePlanLimit(services, principal(request).tenantId, "AI_MONTHLY_RUNS_INCLUDED");
      response
        .status(201)
        .json(
          await frontendService(services).processA0Intake(
            principal(request),
            stringParameter(request.params.projectId, "projectId"),
            idempotencyKey(request),
            request.body,
            correlationId(request),
          ),
        );
    }),
  );
  app.post(
    "/v1/projects/:projectId/a1-intakes",
    asyncRoute(async (request, response) => {
      await enforcePlanLimit(services, principal(request).tenantId, "AI_MONTHLY_RUNS_INCLUDED");
      response
        .status(201)
        .json(
          await frontendService(services).processA1Intake(
            principal(request),
            stringParameter(request.params.projectId, "projectId"),
            request.body,
          ),
        );
    }),
  );
  app.patch(
    "/v1/projects/:projectId/a1-drafts/:draftId",
    asyncRoute(async (request, response) => {
      response.json(
        await frontendService(services).correctA1Draft(
          principal(request),
          stringParameter(request.params.projectId, "projectId"),
          stringParameter(request.params.draftId, "draftId"),
          idempotencyKey(request),
          request.body,
          correlationId(request),
        ),
      );
    }),
  );
  app.post(
    "/v1/projects/:projectId/a3-documents",
    asyncRoute(async (request, response) => {
      await enforcePlanLimit(services, principal(request).tenantId, "AI_MONTHLY_RUNS_INCLUDED");
      response
        .status(201)
        .json(
          await frontendService(services).generateA3Documents(
            principal(request),
            stringParameter(request.params.projectId, "projectId"),
            request.body,
          ),
        );
    }),
  );
  app.post(
    "/v1/projects/:projectId/chat",
    asyncRoute(async (request, response) => {
      await enforcePlanLimit(services, principal(request).tenantId, "AI_MONTHLY_RUNS_INCLUDED");
      response.json(
        await frontendService(services).answerA4(
          principal(request),
          stringParameter(request.params.projectId, "projectId"),
          request.body,
        ),
      );
    }),
  );
  app.get(
    "/v1/projects/:projectId",
    asyncRoute(async (request, response) => {
      const result = await services.projects.requireProject(
        principal(request),
        stringParameter(request.params.projectId, "projectId"),
        "PROJECT_READ",
      );
      response.json({ ...result.project, role: result.role });
    }),
  );
  app.post(
    "/v1/projects/:projectId/reviews/:reviewTaskId/decisions",
    asyncRoute(async (request, response) => {
      response.json(
        await services.reviews.decide(
          principal(request),
          stringParameter(request.params.projectId, "projectId"),
          stringParameter(request.params.reviewTaskId, "reviewTaskId"),
          idempotencyKey(request),
          request.body,
          correlationId(request),
        ),
      );
    }),
  );
  app.post(
    "/v1/projects/:projectId/approved-commands",
    asyncRoute(async (request, response) => {
      response
        .status(201)
        .json(
          await services.commands.apply(
            principal(request),
            stringParameter(request.params.projectId, "projectId"),
            idempotencyKey(request),
            request.body,
            correlationId(request),
          ),
        );
    }),
  );
  app.get(
    "/v1/projects/:projectId/versions/compare",
    asyncRoute(async (request, response) => {
      response.json(
        await services.projects.compareVersions(
          principal(request),
          stringParameter(request.params.projectId, "projectId"),
          stringParameter(request.query.leftId, "leftId"),
          stringParameter(request.query.rightId, "rightId"),
        ),
      );
    }),
  );
  app.get(
    "/v1/projects/:projectId/forecast/latest",
    asyncRoute(async (request, response) => {
      const asOf =
        typeof request.query.asOf === "string" ? new Date(request.query.asOf) : new Date();
      if (Number.isNaN(asOf.getTime())) {
        throw new Phase9ApiError("VALIDATION_FAILED", 400, "Invalid asOf");
      }
      const forecast = await services.projects.latestForecast(
        principal(request),
        stringParameter(request.params.projectId, "projectId"),
        asOf.toISOString(),
      );
      if (forecast === null) {
        response.status(204).end();
        return;
      }
      response.json(forecast);
    }),
  );
  app.get(
    "/v1/projects/:projectId/audit",
    asyncRoute(async (request, response) => {
      const limit = phase9CursorQuerySchema.parse({ limit: request.query.limit }).limit;
      response.json({
        data: await services.projects.listAudit(
          principal(request),
          stringParameter(request.params.projectId, "projectId"),
          limit,
        ),
      });
    }),
  );
  app.post(
    "/v1/projects/:projectId/artifacts/:artifactId/signed-url",
    asyncRoute(async (request, response) => {
      response.json(
        await services.artifacts.issueSignedUrl(
          principal(request),
          stringParameter(request.params.projectId, "projectId"),
          stringParameter(request.params.artifactId, "artifactId"),
          request.body,
          correlationId(request),
        ),
      );
    }),
  );

  app.use((_request, _response, next) => {
    next(new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Resource not found"));
  });

  const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
    const correlation = correlationId(request as AuthenticatedRequest);
    const bodyParserError = error as {
      type?: string;
      status?: number;
    };
    const normalized =
      error instanceof Phase9ApiError
        ? error
        : error instanceof ZodError
          ? new Phase9ApiError("VALIDATION_FAILED", 400, "Request validation failed", {
              issues: error.issues.map((issue) => ({
                path: issue.path.join("."),
                code: issue.code,
              })),
            })
          : bodyParserError.type === "entity.too.large" || bodyParserError.status === 413
            ? new Phase9ApiError(
                "VALIDATION_FAILED",
                413,
                "Request body exceeds the configured limit",
              )
            : bodyParserError.type === "entity.parse.failed" ||
                (error instanceof SyntaxError && bodyParserError.status === 400)
              ? new Phase9ApiError("VALIDATION_FAILED", 400, "Request body is malformed")
              : new Phase9ApiError("INTERNAL_ERROR", 500, "Internal server error");
    if (normalized.status >= 500) {
      options.metrics?.increment("http_internal_errors_total");
      options.errorReporter?.captureException(error, {
        correlationId: correlation,
        requestFamily: phase11RequestFamily(request.path),
      });
      options.logger?.error("http_request_failed", {
        correlationId: correlation,
        requestFamily: phase11RequestFamily(request.path),
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    } else if (normalized.status >= 400) {
      options.metrics?.increment("http_client_errors_total");
      options.logger?.warn("http_request_rejected", {
        correlationId: correlation,
        requestFamily: phase11RequestFamily(request.path),
        errorCode: normalized.code,
        statusCode: normalized.status,
      });
    }
    const envelope = phase9ErrorEnvelopeSchema.parse({
      error: {
        code: normalized.code,
        message: normalized.message,
        correlationId: correlation,
        ...(normalized.details === undefined ? {} : { details: normalized.details }),
      },
    });
    response.status(normalized.status).json(envelope);
  };
  app.use(errorHandler);
  return app;
}
