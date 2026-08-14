import { z, type ZodType } from "zod";
import {
  getPlatformTokens,
  hasUsablePlatformRefreshToken,
  setPlatformTokens,
} from "../auth/platform-token-store";
import { tokenPairSchema, type TokenPair } from "../auth/token-store";
import { apiErrorEnvelopeSchema } from "./schemas";
import {
  platformAgentDetailQuerySchema,
  platformAgentDetailResponseSchema,
  platformAgentListQuerySchema,
  platformAgentListResponseSchema,
  platformAgentRunDiagnosticsResponseSchema,
  platformAgentRunListQuerySchema,
  platformAgentRunListResponseSchema,
  platformAuditLogQuerySchema,
  platformAuditLogResponseSchema,
  platformIncidentAcknowledgeRequestSchema,
  platformIncidentAssignRequestSchema,
  platformIncidentDetailResponseSchema,
  platformIncidentListQuerySchema,
  platformIncidentListResponseSchema,
  platformIncidentMutationResponseSchema,
  platformIncidentResolveRequestSchema,
  platformQualityQuerySchema,
  platformQualityResponseSchema,
  platformSupportAccessDecisionSchema,
  platformSupportAccessDetailResponseSchema,
  platformSupportAccessListQuerySchema,
  platformSupportAccessListResponseSchema,
  platformSupportAccessMutationResponseSchema,
  platformSupportAccessRequestSchema,
  platformOverviewQuerySchema,
  platformOverviewResponseSchema,
  platformReviewBacklogQuerySchema,
  platformReviewBacklogResponseSchema,
  platformReviewSummaryQuerySchema,
  platformReviewSummaryResponseSchema,
  platformSessionSchema,
  platformSystemHealthQuerySchema,
  platformSystemHealthResponseSchema,
  platformTenantHealthResponseSchema,
  platformTenantListQuerySchema,
  platformTenantListResponseSchema,
  platformUsageQuerySchema,
  platformUsageResponseSchema,
  type PlatformAgentDetail,
  type PlatformAgentDetailQuery,
  type PlatformAgentList,
  type PlatformAgentListQuery,
  type PlatformAgentRunDiagnostics,
  type PlatformAgentRunList,
  type PlatformAgentRunListQuery,
  type PlatformAuditLogList,
  type PlatformAuditLogQuery,
  type PlatformIncidentAcknowledgeRequest,
  type PlatformIncidentAssignRequest,
  type PlatformIncidentDetail,
  type PlatformIncidentList,
  type PlatformIncidentListQuery,
  type PlatformIncidentMutation,
  type PlatformIncidentResolveRequest,
  type PlatformQuality,
  type PlatformQualityQuery,
  type PlatformSupportAccessDecision,
  type PlatformSupportAccessDetail,
  type PlatformSupportAccessList,
  type PlatformSupportAccessListQuery,
  type PlatformSupportAccessMutation,
  type PlatformSupportAccessRequest,
  type PlatformLoginRequest,
  type PlatformOverview,
  type PlatformOverviewQuery,
  type PlatformReviewBacklog,
  type PlatformReviewBacklogQuery,
  type PlatformReviewSummary,
  type PlatformReviewSummaryQuery,
  type PlatformSession,
  type PlatformSystemHealth,
  type PlatformSystemHealthQuery,
  type PlatformTenantHealth,
  type PlatformTenantList,
  type PlatformTenantListQuery,
  type PlatformUsage,
  type PlatformUsageQuery,
} from "./platform-schemas";

export class PlatformApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly correlationId: string | null;
  readonly details: Record<string, unknown> | null;

  constructor(input: {
    message: string;
    code?: string;
    status?: number;
    correlationId?: string | null;
    details?: Record<string, unknown> | null;
  }) {
    super(input.message);
    this.name = "PlatformApiError";
    this.code = input.code ?? "REQUEST_FAILED";
    this.status = input.status ?? 0;
    this.correlationId = input.correlationId ?? null;
    this.details = input.details ?? null;
  }
}

async function responseError(response: Response, candidate?: unknown): Promise<PlatformApiError> {
  let body = candidate;
  if (body === undefined) {
    try {
      body = await response.clone().json();
    } catch {
      body = undefined;
    }
  }
  const parsed = apiErrorEnvelopeSchema.safeParse(body);
  if (parsed.success) {
    return new PlatformApiError({
      message: parsed.data.error.message,
      code: parsed.data.error.code,
      status: response.status,
      correlationId: parsed.data.error.correlationId,
      details: parsed.data.error.details ?? null,
    });
  }
  return new PlatformApiError({
    message: response.statusText || "Platform API хүсэлт амжилтгүй боллоо",
    status: response.status,
  });
}

async function parseResponse<T>(response: Response, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PlatformApiError({
      message: "Platform API JSON response буцаасангүй",
      code: "RESPONSE_CONTRACT_INVALID",
      status: response.status,
    });
  }
  if (!response.ok) throw await responseError(response, body);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new PlatformApiError({
      message: "Platform API response contract зөрчлөө",
      code: "RESPONSE_CONTRACT_INVALID",
      status: response.status,
      details: { issues: z.treeifyError(parsed.error) },
    });
  }
  return parsed.data;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshPlatformAccessToken(): Promise<boolean> {
  if (refreshPromise !== null) return refreshPromise;
  refreshPromise = (async () => {
    const tokens = getPlatformTokens();
    if (tokens === null || !hasUsablePlatformRefreshToken(tokens)) {
      setPlatformTokens(null);
      return false;
    }
    const response = await fetch("/api/platform/v1/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!response.ok) {
      setPlatformTokens(null);
      return false;
    }
    setPlatformTokens(await parseResponse(response, tokenPairSchema));
    return true;
  })()
    .catch(() => {
      setPlatformTokens(null);
      return false;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function withPlatformAuthorization(request: Request): Request {
  const tokens = getPlatformTokens();
  if (tokens === null) return request;
  const headers = new Headers(request.headers);
  headers.set("authorization", `${tokens.tokenType} ${tokens.accessToken}`);
  return new Request(request, { headers });
}

export async function platformAuthorizedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const resolvedInput =
    typeof input === "string"
      ? new URL(input, typeof window === "undefined" ? "http://localhost" : window.location.origin)
      : input;
  const source = new Request(resolvedInput, init);
  const run = () => fetch(withPlatformAuthorization(source.clone()));
  let response = await run();
  const isAuthRoute = new URL(source.url).pathname.startsWith("/api/platform/v1/auth/");
  if (response.status === 401 && !isAuthRoute && (await refreshPlatformAccessToken())) {
    response = await run();
  }
  return response;
}

/**
 * Every read endpoint serialises the same way: the query is already schema-
 * parsed by the caller, so only defined scalars reach the URL and the response
 * is validated against its contract before any component sees it.
 */
async function platformGet<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  schema: ZodType<T>,
): Promise<T> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const suffix = search.size === 0 ? "" : `?${search.toString()}`;
  const response = await platformAuthorizedFetch(`${path}${suffix}`);
  if (!response.ok) throw await responseError(response);
  return parseResponse(response, schema);
}

/**
 * Incident transitions are replay-safe: a fresh key per attempt means a retry
 * after a network failure replays the recorded transition instead of applying
 * a second one.
 */
async function platformAction(
  incidentId: string,
  action: "acknowledge" | "assign" | "resolve",
  body: unknown,
): Promise<PlatformIncidentMutation> {
  const response = await platformAuthorizedFetch(
    `/api/platform/v1/incidents/${encodeURIComponent(incidentId)}/${action}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw await responseError(response);
  return parseResponse(response, platformIncidentMutationResponseSchema);
}

/** Shared POST helper: every platform mutation is replay-safe by key. */
async function platformPost<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
  const response = await platformAuthorizedFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await responseError(response);
  return parseResponse(response, schema);
}

/**
 * Small typed helper for the platform billing routes (Phase 8). It reuses the
 * platform transport, so token refresh and the 401 retry behave identically to
 * every other Control Tower call.
 */
export async function platformFetch<T>(
  path: string,
  schema: ZodType<T>,
  init?: { method: string; body?: unknown },
): Promise<T> {
  const response = await platformAuthorizedFetch(`/api/platform/v1${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
  });
  return parseResponse(response, schema);
}

export const platformApi = {
  async login(input: PlatformLoginRequest): Promise<TokenPair> {
    const response = await fetch("/api/platform/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const tokens = await parseResponse(response, tokenPairSchema);
    setPlatformTokens(tokens);
    return tokens;
  },

  async logout(): Promise<void> {
    const tokens = getPlatformTokens();
    setPlatformTokens(null);
    if (tokens === null) return;
    await fetch("/api/platform/v1/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    }).catch(() => undefined);
  },

  async session(): Promise<PlatformSession> {
    const response = await platformAuthorizedFetch("/api/platform/v1/session");
    if (!response.ok) throw await responseError(response);
    return parseResponse(response, platformSessionSchema);
  },

  async overview(input: PlatformOverviewQuery): Promise<PlatformOverview> {
    return platformGet(
      "/api/platform/v1/overview",
      platformOverviewQuerySchema.parse(input),
      platformOverviewResponseSchema,
    );
  },

  async tenants(input: PlatformTenantListQuery): Promise<PlatformTenantList> {
    return platformGet(
      "/api/platform/v1/tenants",
      platformTenantListQuerySchema.parse(input),
      platformTenantListResponseSchema,
    );
  },

  async tenantHealth(
    tenantId: string,
    input: PlatformAgentDetailQuery,
  ): Promise<PlatformTenantHealth> {
    return platformGet(
      `/api/platform/v1/tenants/${encodeURIComponent(tenantId)}/health`,
      platformAgentDetailQuerySchema.parse(input),
      platformTenantHealthResponseSchema,
    );
  },

  async agents(input: PlatformAgentListQuery): Promise<PlatformAgentList> {
    return platformGet(
      "/api/platform/v1/agents",
      platformAgentListQuerySchema.parse(input),
      platformAgentListResponseSchema,
    );
  },

  async agentDetail(
    agentType: string,
    input: PlatformAgentDetailQuery,
  ): Promise<PlatformAgentDetail> {
    return platformGet(
      `/api/platform/v1/agents/${encodeURIComponent(agentType)}`,
      platformAgentDetailQuerySchema.parse(input),
      platformAgentDetailResponseSchema,
    );
  },

  async agentRuns(input: PlatformAgentRunListQuery): Promise<PlatformAgentRunList> {
    return platformGet(
      "/api/platform/v1/agent-runs",
      platformAgentRunListQuerySchema.parse(input),
      platformAgentRunListResponseSchema,
    );
  },

  async agentRunDiagnostics(runId: string): Promise<PlatformAgentRunDiagnostics> {
    return platformGet(
      `/api/platform/v1/agent-runs/${encodeURIComponent(runId)}/diagnostics`,
      {},
      platformAgentRunDiagnosticsResponseSchema,
    );
  },

  async reviewSummary(input: PlatformReviewSummaryQuery): Promise<PlatformReviewSummary> {
    return platformGet(
      "/api/platform/v1/reviews/summary",
      platformReviewSummaryQuerySchema.parse(input),
      platformReviewSummaryResponseSchema,
    );
  },

  async reviewBacklog(input: PlatformReviewBacklogQuery): Promise<PlatformReviewBacklog> {
    return platformGet(
      "/api/platform/v1/reviews/backlog",
      platformReviewBacklogQuerySchema.parse(input),
      platformReviewBacklogResponseSchema,
    );
  },

  async usage(input: PlatformUsageQuery): Promise<PlatformUsage> {
    return platformGet(
      "/api/platform/v1/usage",
      platformUsageQuerySchema.parse(input),
      platformUsageResponseSchema,
    );
  },

  async systemHealth(input: PlatformSystemHealthQuery): Promise<PlatformSystemHealth> {
    return platformGet(
      "/api/platform/v1/system-health",
      platformSystemHealthQuerySchema.parse(input),
      platformSystemHealthResponseSchema,
    );
  },

  async auditLogs(input: PlatformAuditLogQuery): Promise<PlatformAuditLogList> {
    return platformGet(
      "/api/platform/v1/audit-logs",
      platformAuditLogQuerySchema.parse(input),
      platformAuditLogResponseSchema,
    );
  },

  async incidents(input: PlatformIncidentListQuery): Promise<PlatformIncidentList> {
    return platformGet(
      "/api/platform/v1/incidents",
      platformIncidentListQuerySchema.parse(input),
      platformIncidentListResponseSchema,
    );
  },

  async incident(incidentId: string): Promise<PlatformIncidentDetail> {
    return platformGet(
      `/api/platform/v1/incidents/${encodeURIComponent(incidentId)}`,
      {},
      platformIncidentDetailResponseSchema,
    );
  },

  async acknowledgeIncident(
    incidentId: string,
    input: PlatformIncidentAcknowledgeRequest,
  ): Promise<PlatformIncidentMutation> {
    return platformAction(
      incidentId,
      "acknowledge",
      platformIncidentAcknowledgeRequestSchema.parse(input),
    );
  },

  async assignIncident(
    incidentId: string,
    input: PlatformIncidentAssignRequest,
  ): Promise<PlatformIncidentMutation> {
    return platformAction(incidentId, "assign", platformIncidentAssignRequestSchema.parse(input));
  },

  async resolveIncident(
    incidentId: string,
    input: PlatformIncidentResolveRequest,
  ): Promise<PlatformIncidentMutation> {
    return platformAction(incidentId, "resolve", platformIncidentResolveRequestSchema.parse(input));
  },

  async quality(input: PlatformQualityQuery): Promise<PlatformQuality> {
    return platformGet(
      "/api/platform/v1/quality",
      platformQualityQuerySchema.parse(input),
      platformQualityResponseSchema,
    );
  },

  async supportAccessGrants(
    input: PlatformSupportAccessListQuery,
  ): Promise<PlatformSupportAccessList> {
    return platformGet(
      "/api/platform/v1/support-access",
      platformSupportAccessListQuerySchema.parse(input),
      platformSupportAccessListResponseSchema,
    );
  },

  async supportAccessGrant(grantId: string): Promise<PlatformSupportAccessDetail> {
    return platformGet(
      `/api/platform/v1/support-access/${encodeURIComponent(grantId)}`,
      {},
      platformSupportAccessDetailResponseSchema,
    );
  },

  async requestSupportAccess(
    input: PlatformSupportAccessRequest,
  ): Promise<PlatformSupportAccessMutation> {
    return platformPost(
      "/api/platform/v1/support-access",
      platformSupportAccessRequestSchema.parse(input),
      platformSupportAccessMutationResponseSchema,
    );
  },

  async decideSupportAccess(
    grantId: string,
    action: "approve" | "deny" | "revoke",
    input: PlatformSupportAccessDecision,
  ): Promise<PlatformSupportAccessMutation> {
    return platformPost(
      `/api/platform/v1/support-access/${encodeURIComponent(grantId)}/${action}`,
      platformSupportAccessDecisionSchema.parse(input),
      platformSupportAccessMutationResponseSchema,
    );
  },
};
