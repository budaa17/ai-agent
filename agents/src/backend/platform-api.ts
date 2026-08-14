import express, { type NextFunction, type Request, type Response } from "express";
import { Phase9ApiError } from "./contracts.js";
import type { Phase9AuthService, Phase9RequestMetadata } from "./auth-service.js";
import type { PlatformAuthService } from "./platform-auth-service.js";
import { requirePlatformPermission } from "./platform-authorization.js";
import type { PlatformBillingService } from "./platform-billing-service.js";
import {
  platformAccessOverrideSchema,
  platformManualPaymentConfirmationSchema,
} from "./platform-billing-contracts.js";
import type { PlatformAuthenticatedPrincipal, PlatformPermission } from "./platform-contracts.js";
import type { PlatformDrilldownService } from "./platform-drilldown-service.js";
import type { PlatformIncidentService } from "./platform-incident-service.js";
import type { PlatformOverviewService } from "./platform-overview-service.js";
import type { PlatformQualityService } from "./platform-quality-service.js";
import type { PlatformSupportAccessService } from "./platform-support-access-service.js";

type PlatformAuthenticatedRequest = Request & {
  phase9CorrelationId?: string;
  platformPrincipal?: PlatformAuthenticatedPrincipal;
};

export interface PlatformApiServices {
  platformAuth?: PlatformAuthService;
  platformOverview?: PlatformOverviewService;
  platformDrilldown?: PlatformDrilldownService;
  platformIncidents?: PlatformIncidentService;
  platformQuality?: PlatformQualityService;
  platformSupportAccess?: PlatformSupportAccessService;
  platformBilling?: PlatformBillingService;
  tenantAuth: Phase9AuthService;
}

function billingService(services: PlatformApiServices): PlatformBillingService {
  if (services.platformBilling === undefined) {
    throw new Phase9ApiError("INTERNAL_ERROR", 503, "Platform billing is not available");
  }
  return services.platformBilling;
}

function service(services: PlatformApiServices): PlatformAuthService {
  if (services.platformAuth === undefined) {
    throw new Phase9ApiError("INTERNAL_ERROR", 503, "Platform authentication is not available");
  }
  return services.platformAuth;
}

function overviewService(services: PlatformApiServices): PlatformOverviewService {
  if (services.platformOverview === undefined) {
    throw new Phase9ApiError("INTERNAL_ERROR", 503, "Platform overview is not available");
  }
  return services.platformOverview;
}

function drilldownService(services: PlatformApiServices): PlatformDrilldownService {
  if (services.platformDrilldown === undefined) {
    throw new Phase9ApiError("INTERNAL_ERROR", 503, "Platform drill-down is not available");
  }
  return services.platformDrilldown;
}

function incidentService(services: PlatformApiServices): PlatformIncidentService {
  if (services.platformIncidents === undefined) {
    throw new Phase9ApiError("INTERNAL_ERROR", 503, "Platform incidents are not available");
  }
  return services.platformIncidents;
}

function qualityService(services: PlatformApiServices): PlatformQualityService {
  if (services.platformQuality === undefined) {
    throw new Phase9ApiError("INTERNAL_ERROR", 503, "Platform quality is not available");
  }
  return services.platformQuality;
}

function supportAccessService(services: PlatformApiServices): PlatformSupportAccessService {
  if (services.platformSupportAccess === undefined) {
    throw new Phase9ApiError("INTERNAL_ERROR", 503, "Platform support access is not available");
  }
  return services.platformSupportAccess;
}

/** Critical platform mutations are replay-safe, so the header is mandatory. */
function idempotencyKey(request: PlatformAuthenticatedRequest): string {
  const value = request.header("idempotency-key")?.trim();
  if (value === undefined || value.length < 8 || value.length > 200) {
    throw new Phase9ApiError(
      "IDEMPOTENCY_KEY_REQUIRED",
      400,
      "Idempotency-Key header is required and must be 8 to 200 characters",
    );
  }
  return value;
}

function metadata(request: PlatformAuthenticatedRequest): Phase9RequestMetadata {
  return {
    correlationId: request.phase9CorrelationId ?? "platform-request",
    userAgent: request.header("user-agent") ?? undefined,
    ipAddress: request.ip,
    deviceName: request.header("x-device-name") ?? undefined,
  };
}

function principal(request: PlatformAuthenticatedRequest): PlatformAuthenticatedPrincipal {
  if (request.platformPrincipal === undefined) {
    throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Authentication required");
  }
  return request.platformPrincipal;
}

function asyncRoute(
  handler: (request: PlatformAuthenticatedRequest, response: Response) => Promise<void>,
) {
  return (request: PlatformAuthenticatedRequest, response: Response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}

/**
 * Platform routes live in a separate router and are mounted before tenant
 * `/v1` authentication. A valid tenant bearer is recognized only so the
 * boundary can return an explicit 403; it is never converted to a platform
 * principal.
 */
export function createPlatformApiRouter(services: PlatformApiServices) {
  const router = express.Router();

  router.post(
    "/auth/login",
    asyncRoute(async (request, response) => {
      response.json(await service(services).login(request.body, metadata(request)));
    }),
  );
  router.post(
    "/auth/refresh",
    asyncRoute(async (request, response) => {
      response.json(await service(services).refresh(request.body, metadata(request)));
    }),
  );
  router.post(
    "/auth/logout",
    asyncRoute(async (request, response) => {
      await service(services).logout(request.body, metadata(request));
      response.status(204).end();
    }),
  );

  router.use((request: PlatformAuthenticatedRequest, _response, next) => {
    const authorization = request.header("authorization");
    if (authorization === undefined || !authorization.startsWith("Bearer ")) {
      next(new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Authentication required"));
      return;
    }
    const token = authorization.slice("Bearer ".length);
    service(services)
      .authenticateAccess(token)
      .then((authenticated) => {
        request.platformPrincipal = authenticated;
        next();
      })
      .catch(async (platformError: unknown) => {
        try {
          await services.tenantAuth.authenticateAccess(token);
          next(new Phase9ApiError("AUTH_FORBIDDEN", 403, "Access denied"));
        } catch {
          next(platformError);
        }
      });
  });

  router.get(
    "/session",
    asyncRoute(async (request, response) => {
      response.json(await service(services).session(principal(request)));
    }),
  );

  router.get(
    "/overview",
    asyncRoute(async (request, response) => {
      const authenticated = principal(request);
      requirePlatformPermission(authenticated, "PLATFORM_OVERVIEW_READ");
      response.json(await overviewService(services).overview(request.query));
    }),
  );

  /**
   * Phase 5 drill-down. Each route re-checks its own permission: reaching the
   * router only proves the caller is a platform principal, never that the role
   * may read this section.
   */
  const readRoute = (
    path: string,
    permission: PlatformPermission,
    handler: (
      drilldown: PlatformDrilldownService,
      request: PlatformAuthenticatedRequest,
    ) => Promise<unknown>,
  ) => {
    router.get(
      path,
      asyncRoute(async (request, response) => {
        requirePlatformPermission(principal(request), permission);
        response.json(await handler(drilldownService(services), request));
      }),
    );
  };

  readRoute("/tenants", "PLATFORM_TENANT_HEALTH_READ", (drilldown, request) =>
    drilldown.tenants(request.query),
  );
  readRoute("/tenants/:tenantId/health", "PLATFORM_TENANT_HEALTH_READ", (drilldown, request) =>
    drilldown.tenantHealth(request.params.tenantId, request.query),
  );
  readRoute("/agents", "PLATFORM_AGENT_HEALTH_READ", (drilldown, request) =>
    drilldown.agents(request.query),
  );
  readRoute("/agents/:agentType", "PLATFORM_AGENT_HEALTH_READ", (drilldown, request) =>
    drilldown.agentDetail(request.params.agentType, request.query),
  );
  readRoute("/agent-runs", "PLATFORM_AGENT_HEALTH_READ", (drilldown, request) =>
    drilldown.agentRuns(request.query),
  );
  readRoute(
    "/agent-runs/:runId/diagnostics",
    "PLATFORM_AGENT_RUN_DIAGNOSTICS_READ",
    (drilldown, request) => drilldown.agentRunDiagnostics(request.params.runId),
  );
  readRoute("/reviews/summary", "PLATFORM_REVIEW_MONITOR_READ", (drilldown, request) =>
    drilldown.reviewSummary(request.query),
  );
  readRoute("/reviews/backlog", "PLATFORM_REVIEW_MONITOR_READ", (drilldown, request) =>
    drilldown.reviewBacklog(request.query),
  );
  readRoute("/usage", "PLATFORM_USAGE_READ", (drilldown, request) =>
    drilldown.usage(request.query),
  );
  readRoute("/system-health", "PLATFORM_SYSTEM_HEALTH_READ", (drilldown, request) =>
    drilldown.systemHealth(request.query),
  );
  readRoute("/audit-logs", "PLATFORM_AUDIT_READ", (drilldown, request) =>
    drilldown.auditLogs(request.query),
  );

  /**
   * Phase 6 incidents. Reads need only overview permission; every mutation
   * re-checks `PLATFORM_INCIDENT_MANAGE` inside the service so a denied attempt
   * is audited rather than silently dropped at the router.
   */
  router.get(
    "/incidents",
    asyncRoute(async (request, response) => {
      response.json(await incidentService(services).list(principal(request), request.query));
    }),
  );
  router.get(
    "/incidents/:incidentId",
    asyncRoute(async (request, response) => {
      response.json(
        await incidentService(services).detail(principal(request), request.params.incidentId),
      );
    }),
  );

  const actionRoute = (
    path: string,
    handler: (
      incidents: PlatformIncidentService,
      request: PlatformAuthenticatedRequest,
    ) => Promise<unknown>,
  ) => {
    router.post(
      path,
      asyncRoute(async (request, response) => {
        response.json(await handler(incidentService(services), request));
      }),
    );
  };

  actionRoute("/incidents/:incidentId/acknowledge", (incidents, request) =>
    incidents.acknowledge(principal(request), request.params.incidentId, request.body, {
      correlationId: request.phase9CorrelationId ?? "platform-incident-action",
      idempotencyKey: idempotencyKey(request),
    }),
  );
  actionRoute("/incidents/:incidentId/assign", (incidents, request) =>
    incidents.assign(principal(request), request.params.incidentId, request.body, {
      correlationId: request.phase9CorrelationId ?? "platform-incident-action",
      idempotencyKey: idempotencyKey(request),
    }),
  );
  actionRoute("/incidents/:incidentId/resolve", (incidents, request) =>
    incidents.resolve(principal(request), request.params.incidentId, request.body, {
      correlationId: request.phase9CorrelationId ?? "platform-incident-action",
      idempotencyKey: idempotencyKey(request),
    }),
  );

  /* -------------------------- Phase 8: AI quality ------------------------ */

  router.get(
    "/quality",
    asyncRoute(async (request, response) => {
      requirePlatformPermission(principal(request), "PLATFORM_REVIEW_MONITOR_READ");
      response.json(await qualityService(services).quality(request.query));
    }),
  );

  /* -------------------------- Phase 8: billing --------------------------- */

  router.get(
    "/billing/overview",
    asyncRoute(async (request, response) => {
      requirePlatformPermission(principal(request), "PLATFORM_BILLING_READ");
      response.json(await billingService(services).overview());
    }),
  );
  router.get(
    "/billing/subscriptions",
    asyncRoute(async (request, response) => {
      requirePlatformPermission(principal(request), "PLATFORM_BILLING_READ");
      const status = request.query.status;
      response.json({
        subscriptions: await billingService(services).subscriptions({
          status: typeof status === "string" ? status : undefined,
        }),
      });
    }),
  );
  router.get(
    "/billing/invoices",
    asyncRoute(async (request, response) => {
      requirePlatformPermission(principal(request), "PLATFORM_BILLING_READ");
      const tenantId = request.query.tenantId;
      response.json({
        invoices: await billingService(services).invoices({
          tenantId: typeof tenantId === "string" ? tenantId : undefined,
        }),
      });
    }),
  );
  router.get(
    "/billing/webhooks",
    asyncRoute(async (request, response) => {
      requirePlatformPermission(principal(request), "PLATFORM_BILLING_READ");
      response.json({ events: await billingService(services).webhookHealth() });
    }),
  );

  router.post(
    "/billing/manual-invoices/:subscriptionId/confirm",
    asyncRoute(async (request, response) => {
      const actor = principal(request);
      requirePlatformPermission(actor, "PLATFORM_BILLING_MANAGE");
      const body = platformManualPaymentConfirmationSchema.parse(request.body);
      response.status(201).json(
        await billingService(services).confirmManualPayment({
          actor,
          subscriptionId: String(request.params.subscriptionId ?? ""),
          paymentReference: body.paymentReference,
          periodEnd: new Date(body.periodEnd),
          amountMinor: BigInt(body.amountMinor),
          taxMinor: BigInt(body.taxMinor),
          currency: body.currency,
          reason: body.reason,
        }),
      );
    }),
  );
  router.post(
    "/billing/tenants/:tenantId/override",
    asyncRoute(async (request, response) => {
      const actor = principal(request);
      requirePlatformPermission(actor, "PLATFORM_BILLING_MANAGE");
      const body = platformAccessOverrideSchema.parse(request.body);
      response.status(201).json(
        await billingService(services).grantAccessOverride({
          actor,
          tenantId: String(request.params.tenantId ?? ""),
          expiresAt: new Date(body.expiresAt),
          reason: body.reason,
        }),
      );
    }),
  );

  /* ---------------------- Phase 8: support access ------------------------ */

  router.get(
    "/support-access",
    asyncRoute(async (request, response) => {
      response.json(await supportAccessService(services).list(principal(request), request.query));
    }),
  );
  router.get(
    "/support-access/:grantId",
    asyncRoute(async (request, response) => {
      response.json(
        await supportAccessService(services).detail(principal(request), request.params.grantId),
      );
    }),
  );

  const supportAction = (
    path: string,
    handler: (
      support: PlatformSupportAccessService,
      request: PlatformAuthenticatedRequest,
      metadata: { correlationId: string; idempotencyKey: string },
    ) => Promise<unknown>,
  ) => {
    router.post(
      path,
      asyncRoute(async (request, response) => {
        response.json(
          await handler(supportAccessService(services), request, {
            correlationId: request.phase9CorrelationId ?? "platform-support-access",
            idempotencyKey: idempotencyKey(request),
          }),
        );
      }),
    );
  };

  supportAction("/support-access", (support, request, metadata) =>
    support.request(principal(request), request.body, metadata),
  );
  supportAction("/support-access/:grantId/approve", (support, request, metadata) =>
    support.approve(principal(request), request.params.grantId, request.body, metadata),
  );
  supportAction("/support-access/:grantId/deny", (support, request, metadata) =>
    support.deny(principal(request), request.params.grantId, request.body, metadata),
  );
  supportAction("/support-access/:grantId/revoke", (support, request, metadata) =>
    support.revoke(principal(request), request.params.grantId, request.body, metadata),
  );

  return router;
}
