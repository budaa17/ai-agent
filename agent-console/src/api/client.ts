import createClient from "openapi-fetch";
import { z, type ZodType } from "zod";
import {
  getTokens,
  hasUsableRefreshToken,
  setTokens,
  tokenPairSchema,
  type TokenPair,
} from "../auth/token-store";
import type { components, paths } from "./generated";
import {
  a0IntakeResultSchema,
  a4AnswerSchema,
  apiErrorEnvelopeSchema,
  a1IntakeResultSchema,
  artifactResultSchema,
  authenticatedResultSchema,
  dailyReportResultSchema,
  forecastSnapshotSchema,
  inventorySchema,
  loginResultSchema,
  projectPageSchema,
  projectSummarySchema,
  sessionSchema,
  versionComparisonSchema,
  workspaceSchema,
  type LoginResult,
} from "./schemas";

export type LoginRequest = components["schemas"]["LoginRequest"];
export type TenantSelectionRequest = components["schemas"]["TenantSelectionRequest"];
export type ProjectCreateRequest = components["schemas"]["ProjectCreateRequest"];
export type DailyReportDraftRequest = components["schemas"]["DailyReportDraftRequest"];
export type InvitationRequest = components["schemas"]["InvitationRequest"];
export type AcceptInvitationRequest = components["schemas"]["AcceptInvitationRequest"];
export type ReviewDecisionRequest = components["schemas"]["ReviewDecisionRequest"];
export type JdmRuleGraph = components["schemas"]["JdmRuleGraph"];
export type RuleCatalogVersion = components["schemas"]["RuleCatalogVersion"];
export type RuleId = components["schemas"]["RuleId"];
export type A0ArtifactRole =
  | "MATERIAL_PRICE_CATALOG"
  | "MATERIAL_NORMS"
  | "BOQ_WORK_ITEMS"
  | "WBS_DEPENDENCIES"
  | "DRAWING_REFERENCE";

export class BuildWatchApiError extends Error {
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
    this.name = "BuildWatchApiError";
    this.code = input.code ?? "REQUEST_FAILED";
    this.status = input.status ?? 0;
    this.correlationId = input.correlationId ?? null;
    this.details = input.details ?? null;
  }
}

/**
 * Browser Headers only accepts ByteString values. Percent-encoding keeps an
 * original Unicode file name ASCII-safe while the explicit companion header
 * lets older clients continue sending plain ASCII names.
 */
export function encodeArtifactFileNameHeader(fileName: string): string {
  return encodeURIComponent(fileName);
}

export const MAX_ARTIFACT_UPLOAD_BYTES = 100 * 1024 * 1024;

export function artifactUploadSizeError(sizeBytes: number): string | null {
  if (sizeBytes < 1) return "Хоосон файл оруулах боломжгүй.";
  if (sizeBytes <= MAX_ARTIFACT_UPLOAD_BYTES) return null;
  const actualMiB = (sizeBytes / (1024 * 1024)).toFixed(1);
  return `Файлын хэмжээ ${actualMiB} MiB байна. Нэг файл 100 MiB-ээс ихгүй байх ёстой.`;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise !== null) return refreshPromise;
  refreshPromise = (async () => {
    const tokens = getTokens();
    if (tokens === null || !hasUsableRefreshToken(tokens)) {
      setTokens(null);
      return false;
    }
    const response = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!response.ok) {
      setTokens(null);
      return false;
    }
    setTokens(tokenPairSchema.parse(await response.json()));
    return true;
  })()
    .catch(() => {
      setTokens(null);
      return false;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function withAuthorization(request: Request): Request {
  const tokens = getTokens();
  if (tokens === null) return request;
  const headers = new Headers(request.headers);
  headers.set("authorization", `${tokens.tokenType} ${tokens.accessToken}`);
  return new Request(request, { headers });
}

export async function authorizedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const source = new Request(input, init);
  const run = () => fetch(withAuthorization(source.clone()));
  let response = await run();
  const isAuthRoute = new URL(source.url, window.location.origin).pathname.startsWith(
    "/api/v1/auth/",
  );
  if (response.status === 401 && !isAuthRoute && (await refreshAccessToken())) {
    response = await run();
  }
  return response;
}

const openApiClient = createClient<paths>({ baseUrl: "/api", fetch: authorizedFetch });

async function responseError(response: Response, fallback?: unknown): Promise<BuildWatchApiError> {
  let candidate = fallback;
  if (candidate === undefined) {
    try {
      candidate = await response.clone().json();
    } catch {
      candidate = undefined;
    }
  }
  const parsed = apiErrorEnvelopeSchema.safeParse(candidate);
  if (parsed.success) {
    return new BuildWatchApiError({
      message: parsed.data.error.message,
      code: parsed.data.error.code,
      status: response.status,
      correlationId: parsed.data.error.correlationId,
      details: parsed.data.error.details ?? null,
    });
  }
  return new BuildWatchApiError({
    message: response.statusText || "BuildWatch API хүсэлт амжилтгүй боллоо",
    status: response.status,
  });
}

async function parseOpenApiResult<T>(
  result: { data?: unknown; error?: unknown; response: Response },
  schema: ZodType<T>,
): Promise<T> {
  if (!result.response.ok || result.data === undefined) {
    throw await responseError(result.response, result.error);
  }
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    throw new BuildWatchApiError({
      message: "API response contract зөрчлөө",
      code: "RESPONSE_CONTRACT_INVALID",
      status: result.response.status,
      details: { issues: z.treeifyError(parsed.error) },
    });
  }
  return parsed.data;
}

/** Drops the discriminator so only the token pair reaches storage. */
function storeAuthenticated(result: { status: "AUTHENTICATED" } & TokenPair): TokenPair {
  const { status: _status, ...tokens } = result;
  setTokens(tokens);
  return tokens;
}

export const buildWatchApi = {
  async login(input: LoginRequest): Promise<LoginResult> {
    const result = await openApiClient.POST("/v1/auth/login", { body: input });
    const parsed = await parseOpenApiResult(result, loginResultSchema);
    if (parsed.status === "AUTHENTICATED") storeAuthenticated(parsed);
    return parsed;
  },
  async completeTenantSelection(input: TenantSelectionRequest) {
    const result = await openApiClient.POST("/v1/auth/login/tenant", { body: input });
    return storeAuthenticated(await parseOpenApiResult(result, authenticatedResultSchema));
  },
  async logout(): Promise<void> {
    const tokens = getTokens();
    setTokens(null);
    if (tokens === null) return;
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    }).catch(() => undefined);
  },
  async session() {
    return parseOpenApiResult(await openApiClient.GET("/v1/session"), sessionSchema);
  },
  async projects(limit = 100) {
    return parseOpenApiResult(
      await openApiClient.GET("/v1/projects", { params: { query: { limit } } }),
      projectPageSchema,
    );
  },
  async createProject(input: ProjectCreateRequest, idempotencyKey: string) {
    const result = await openApiClient.POST("/v1/projects", {
      params: { header: { "Idempotency-Key": idempotencyKey } },
      body: input,
    });
    if (!result.response.ok || result.data === undefined)
      throw await responseError(result.response, result.error);
    return result.data;
  },
  async workspace(projectId: string) {
    return parseOpenApiResult(
      await openApiClient.GET("/v1/projects/{projectId}/workspace", {
        params: { path: { projectId } },
      }),
      workspaceSchema,
    );
  },
  async submitDailyReport(
    projectId: string,
    input: DailyReportDraftRequest,
    idempotencyKey: string,
  ) {
    return parseOpenApiResult(
      await openApiClient.POST("/v1/projects/{projectId}/daily-report-drafts", {
        params: { path: { projectId }, header: { "Idempotency-Key": idempotencyKey } },
        body: input,
      }),
      dailyReportResultSchema,
    );
  },
  async uploadArtifact(
    projectId: string,
    file: Blob,
    fileName: string,
    idempotencyKey: string,
    sha256?: string,
  ) {
    const sizeError = artifactUploadSizeError(file.size);
    if (sizeError !== null) {
      throw new BuildWatchApiError({
        code: "ARTIFACT_TOO_LARGE",
        status: 413,
        message: sizeError,
      });
    }
    const extension = fileName.split(".").pop()?.toLowerCase();
    const mediaType =
      file.type || (extension === "dwg" ? "application/acad" : "application/octet-stream");
    const headers = new Headers({
      "content-type": mediaType,
      "Idempotency-Key": idempotencyKey,
      "x-file-name": encodeArtifactFileNameHeader(fileName),
      "x-file-name-encoding": "percent",
    });
    if (sha256 !== undefined) headers.set("x-content-sha256", sha256);
    const response = await authorizedFetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/artifacts`,
      {
        method: "POST",
        headers,
        body: file,
      },
    );
    if (!response.ok) throw await responseError(response);
    return artifactResultSchema.parse(await response.json());
  },
  async processA0Intake(
    projectId: string,
    input: {
      schemaVersion: 1;
      requestId: string;
      revisionCode: string;
      effectiveDate: string;
      artifacts: { artifactId: string; role: A0ArtifactRole }[];
    },
    idempotencyKey: string,
  ) {
    return parseOpenApiResult(
      await openApiClient.POST("/v1/projects/{projectId}/a0-intakes", {
        params: { path: { projectId }, header: { "Idempotency-Key": idempotencyKey } },
        body: input,
      }),
      a0IntakeResultSchema,
    );
  },
  async processA1Intake(
    projectId: string,
    input: {
      requestId: string;
      referenceDate: string;
      sourceText: string | null;
      imageArtifactId: string | null;
    },
  ) {
    const response = await authorizedFetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/a1-intakes`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) throw await responseError(response);
    return a1IntakeResultSchema.parse(await response.json());
  },
  async correctA1Draft(
    projectId: string,
    draftId: string,
    input: {
      expectedRowVersion: number;
      structuredData: Record<string, unknown>;
      reason: string;
    },
    idempotencyKey: string,
  ) {
    const response = await authorizedFetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/a1-drafts/${encodeURIComponent(draftId)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) throw await responseError(response);
    return a1IntakeResultSchema.parse(await response.json());
  },
  async generateA3Documents(
    projectId: string,
    input: { requestId: string; asOf: string; includePdf: boolean },
  ) {
    const response = await authorizedFetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/a3-documents`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) throw await responseError(response);
    return (await response.json()) as {
      schemaVersion: 1;
      runId: string | null;
      draftIds: string[];
      reused: boolean;
      pdfPath: string | null;
    };
  },
  async ask(projectId: string, question: string) {
    return parseOpenApiResult(
      await openApiClient.POST("/v1/projects/{projectId}/chat", {
        params: { path: { projectId } },
        body: { question },
      }),
      a4AnswerSchema,
    );
  },
  async decideReview(
    projectId: string,
    reviewTaskId: string,
    input: ReviewDecisionRequest,
    idempotencyKey: string,
  ) {
    const result = await openApiClient.POST(
      "/v1/projects/{projectId}/reviews/{reviewTaskId}/decisions",
      {
        params: {
          path: { projectId, reviewTaskId },
          header: { "Idempotency-Key": idempotencyKey },
        },
        body: input,
      },
    );
    if (!result.response.ok || result.data === undefined)
      throw await responseError(result.response, result.error);
    return result.data;
  },
  async invite(input: InvitationRequest) {
    const result = await openApiClient.POST("/v1/invitations", { body: input });
    if (!result.response.ok || result.data === undefined)
      throw await responseError(result.response, result.error);
    return result.data;
  },
  async acceptInvitation(input: AcceptInvitationRequest) {
    const result = await openApiClient.POST("/v1/invitations/accept", { body: input });
    if (!result.response.ok || result.data === undefined)
      throw await responseError(result.response, result.error);
    return result.data;
  },
  async listRules() {
    const result = await openApiClient.GET("/v1/rules");
    if (!result.response.ok || result.data === undefined)
      throw await responseError(result.response, result.error);
    return result.data;
  },
  async listRuleVersions(ruleId: RuleId) {
    const result = await openApiClient.GET("/v1/rules/{ruleId}/versions", {
      params: { path: { ruleId } },
    });
    if (!result.response.ok || result.data === undefined)
      throw await responseError(result.response, result.error);
    return result.data;
  },
  async saveRuleDraft(ruleId: RuleId, jdmGraph: JdmRuleGraph) {
    const result = await openApiClient.PUT("/v1/rules/{ruleId}/draft", {
      params: { path: { ruleId } },
      body: jdmGraph,
    });
    if (!result.response.ok || result.data === undefined)
      throw await responseError(result.response, result.error);
    return result.data;
  },
  async publishRuleVersion(ruleId: RuleId, versionId: string) {
    const result = await openApiClient.POST("/v1/rules/{ruleId}/publish", {
      params: { path: { ruleId } },
      body: { versionId },
    });
    if (!result.response.ok || result.data === undefined)
      throw await responseError(result.response, result.error);
    return result.data;
  },
  /**
   * Liveness and readiness. The browser's `navigator.onLine` only knows whether
   * a network exists, not whether BuildWatch answers, so the connectivity pill
   * asks the API directly.
   */
  async health(kind: "live" | "ready" = "ready"): Promise<boolean> {
    try {
      const response = await fetch(`/api/health/${kind}`, { cache: "no-store" });
      return response.ok;
    } catch {
      return false;
    }
  },
  /**
   * Project header on its own. The switcher only pages in the first hundred
   * projects, so a deep link outside that page still needs a name to show.
   */
  async project(projectId: string) {
    const response = await authorizedFetch(`/api/v1/projects/${encodeURIComponent(projectId)}`);
    if (!response.ok) throw await responseError(response);
    return projectSummarySchema.parse(await response.json());
  },
  /**
   * Field-level diff between two versions of the same target. This is the only
   * way to answer "what changed in revision 2" without reading hashes.
   */
  async compareVersions(projectId: string, leftId: string, rightId: string) {
    const query = new URLSearchParams({ leftId, rightId });
    const response = await authorizedFetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/versions/compare?${query.toString()}`,
    );
    if (!response.ok) throw await responseError(response);
    return versionComparisonSchema.parse(await response.json());
  },
  /**
   * Forecast as of a chosen date. The workspace only carries the newest
   * snapshots, so point-in-time questions have to go back to the API.
   */
  async latestForecast(projectId: string, asOf?: string) {
    const query = asOf === undefined ? "" : `?${new URLSearchParams({ asOf }).toString()}`;
    const response = await authorizedFetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/forecast/latest${query}`,
    );
    if (response.status === 204 || response.status === 404) return null;
    if (!response.ok) throw await responseError(response);
    return forecastSnapshotSchema.parse(await response.json());
  },
  async inventory(projectId: string) {
    const response = await authorizedFetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/inventory`,
    );
    if (!response.ok) throw await responseError(response);
    return inventorySchema.parse(await response.json());
  },
  async createStockMovement(
    projectId: string,
    input: {
      movementType: "RECEIPT" | "ISSUE" | "REVERSAL";
      materialItemId: string | null;
      quantity: string | null;
      unit: string | null;
      occurredAt: string;
      warehouseCode: string;
      referenceType: string;
      referenceId: string;
      reversalOfId: string | null;
      reason: string;
    },
    idempotencyKey: string,
  ) {
    const response = await authorizedFetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/inventory/movements`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) throw await responseError(response);
    return (await response.json()) as Record<string, unknown>;
  },
  /**
   * Turns an APPROVED review target into an APPLIED one. Approving alone leaves
   * the artefact staged; without this call nothing ever reaches the baseline.
   */
  async applyApprovedCommand(
    projectId: string,
    input: {
      reviewTaskId: string;
      targetType:
        | "REGISTRATION_DRAFT"
        | "QUANTITY_TAKEOFF"
        | "ESTIMATE"
        | "SCHEDULE"
        | "BASELINE"
        | "DAILY_WORK_PLAN"
        | "DAILY_REPORT"
        | "PROGRESS_VERIFICATION"
        | "RECOVERY_SCENARIO";
      targetId: string;
      targetVersion: number;
      expectedRowVersion: number;
      sourceHash: string;
      reason: string;
    },
    idempotencyKey: string,
  ) {
    const result = await openApiClient.POST("/v1/projects/{projectId}/approved-commands", {
      params: { path: { projectId }, header: { "Idempotency-Key": idempotencyKey } },
      body: {
        schemaVersion: 1,
        commandType: "APPLY_APPROVED_ARTIFACT",
        reviewTaskId: input.reviewTaskId,
        targetType: input.targetType,
        targetId: input.targetId,
        targetVersion: input.targetVersion,
        expectedRowVersion: input.expectedRowVersion,
        sourceHash: input.sourceHash,
        reason: input.reason,
        payload: {},
      },
    });
    if (!result.response.ok || result.data === undefined)
      throw await responseError(result.response, result.error);
    return result.data;
  },
  async signedArtifactUrl(projectId: string, artifactId: string) {
    const result = await openApiClient.POST(
      "/v1/projects/{projectId}/artifacts/{artifactId}/signed-url",
      {
        params: { path: { projectId, artifactId } },
        body: { expiresInSeconds: 300 },
      },
    );
    if (!result.response.ok || result.data === undefined)
      throw await responseError(result.response, result.error);
    return result.data;
  },
};

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
