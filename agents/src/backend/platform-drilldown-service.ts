import { z } from "zod";
import { Phase9ApiError } from "./contracts.js";
import {
  PLATFORM_LIST_DEFAULT_LIMIT,
  platformAgentDetailQuerySchema,
  platformAgentDetailResponseSchema,
  platformAgentListQuerySchema,
  platformAgentListResponseSchema,
  platformAgentRunDiagnosticsResponseSchema,
  platformAgentRunListQuerySchema,
  platformAgentRunListResponseSchema,
  platformAuditLogQuerySchema,
  platformAuditLogResponseSchema,
  platformReviewBacklogQuerySchema,
  platformReviewBacklogResponseSchema,
  platformReviewSummaryQuerySchema,
  platformReviewSummaryResponseSchema,
  platformSystemHealthQuerySchema,
  platformSystemHealthResponseSchema,
  platformTenantHealthQuerySchema,
  platformTenantHealthResponseSchema,
  platformTenantListQuerySchema,
  platformTenantListResponseSchema,
  platformUsageQuerySchema,
  platformUsageResponseSchema,
  type PlatformAgentDetailResponse,
  type PlatformAgentListItem,
  type PlatformAgentListResponse,
  type PlatformAgentRunDiagnosticsResponse,
  type PlatformAgentRunListItem,
  type PlatformAgentRunListResponse,
  type PlatformAuditLogResponse,
  type PlatformReviewBacklogResponse,
  type PlatformReviewSummaryResponse,
  type PlatformSystemHealthResponse,
  type PlatformTenantHealthResponse,
  type PlatformTenantListItem,
  type PlatformTenantListResponse,
  type PlatformUsageResponse,
} from "./platform-drilldown-contracts.js";
import {
  PLATFORM_TENANT_SCAN_LIMIT,
  type PlatformAgentListRow,
  type PlatformAgentRunRow,
  type PlatformDrilldownRange,
  type PlatformDrilldownReadModel,
  type PlatformTenantListRow,
} from "./platform-drilldown-read-model.js";
import type {
  PlatformOverviewCause,
  PlatformOverviewFreshness,
  PlatformOverviewSectionContext,
  PlatformOverviewSystemComponent,
  PlatformOverviewWindow,
} from "./platform-overview-contracts.js";
import type { PlatformOverviewReadModel } from "./platform-overview-read-model.js";
import { platformOverviewSignalId } from "./platform-overview-signals.js";
import {
  DAY_MS,
  decodeKeysetCursor,
  domainFromSettled,
  encodeKeysetCursor,
  freshFreshness,
  iso,
  MIN_AGENT_SAMPLE,
  nonnegativeInteger,
  redactedAuditReason,
  roundedPercent,
  safeAgentType,
  safeIdentifier,
  safeTenantDisplayName,
  scope,
  selectedWindow,
  snapshotWindow,
  unknownFreshness,
  utcMonthStart,
  type Domain,
} from "./platform-read-support.js";

type Health = "HEALTHY" | "WARNING" | "CRITICAL" | "UNKNOWN" | "INACTIVE";
type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type ProblemSection = "TENANTS" | "AGENTS" | "REVIEWS" | "USAGE" | "SYSTEM" | "AUDIT";

interface ListProblem {
  section: ProblemSection;
  code: "SOURCE_UNAVAILABLE" | "SOURCE_STALE";
  message: string;
  retryable: boolean;
}

const problemMessages: Readonly<Record<ProblemSection, string>> = {
  TENANTS: "Tenant data is temporarily unavailable.",
  AGENTS: "Agent metrics are temporarily unavailable.",
  REVIEWS: "Review data is temporarily unavailable.",
  USAGE: "Usage data is temporarily unavailable.",
  SYSTEM: "System health data is temporarily unavailable.",
  AUDIT: "Audit data is temporarily unavailable.",
};

function problem(section: ProblemSection, stale: boolean): ListProblem {
  return {
    section,
    code: stale ? "SOURCE_STALE" : "SOURCE_UNAVAILABLE",
    message: problemMessages[section],
    retryable: true,
  };
}

function problemsFor(sections: readonly [ProblemSection, Domain<unknown>][]): ListProblem[] {
  return sections
    .filter(([, domain]) => !domain.available)
    .map(([section, domain]) => problem(section, !domain.available && domain.stale));
}

function sectionContext(
  domain: Domain<unknown>,
  appliedFilters: ("TENANT_ID" | "AGENT_TYPE")[],
): PlatformOverviewSectionContext {
  return {
    state: domain.available ? "AVAILABLE" : domain.stale ? "PARTIAL" : "UNKNOWN",
    freshness: domain.freshness,
    appliedFilters,
  };
}

interface ResolvedRange {
  range: PlatformDrilldownRange;
  window: PlatformOverviewWindow;
}

const rangeShape = z.object({
  window: z.enum(["24h", "7d", "30d"]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

/**
 * Every drill-down endpoint shares the overview's range semantics: a preset or
 * an explicit half-open range, never both, never longer than 90 days and never
 * ending after `asOf`.
 */
function resolveRange(query: unknown, asOf: Date): ResolvedRange {
  const parsed = rangeShape.parse(query);
  const hasFrom = parsed.from !== undefined;
  const hasTo = parsed.to !== undefined;
  if ((hasFrom && !hasTo) || (!hasFrom && hasTo) || (parsed.window !== undefined && hasFrom)) {
    throw new Phase9ApiError(
      "VALIDATION_FAILED",
      400,
      "Use either a preset window or both from and to",
    );
  }
  let from: Date;
  let to: Date;
  if (hasFrom && hasTo) {
    from = new Date(parsed.from!);
    to = new Date(parsed.to!);
  } else {
    const duration =
      parsed.window === "30d" ? 30 * DAY_MS : parsed.window === "7d" ? 7 * DAY_MS : DAY_MS;
    to = new Date(asOf);
    from = new Date(to.getTime() - duration);
  }
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    from.getTime() >= to.getTime() ||
    to.getTime() > asOf.getTime() ||
    to.getTime() - from.getTime() > 90 * DAY_MS
  ) {
    throw new Phase9ApiError(
      "VALIDATION_FAILED",
      400,
      "Range must be half-open, no longer than 90 days, and end at or before asOf",
    );
  }
  return {
    window: selectedWindow(from, to),
    range: {
      asOf,
      from,
      to,
      stuckBefore: new Date(asOf.getTime() - 30 * 60_000),
      rolling15From: new Date(asOf.getTime() - 15 * 60_000),
      monthStart: utcMonthStart(asOf),
    },
  };
}

const timeCursorSchema = z
  .object({ at: z.string().datetime({ offset: true }), id: z.string().min(1).max(200) })
  .strict();

function decodeTimeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (cursor === undefined) return null;
  const parsed = timeCursorSchema.safeParse(decodeKeysetCursor(cursor));
  if (!parsed.success) {
    throw new Phase9ApiError("CURSOR_INVALID", 400, "Cursor is not valid");
  }
  return { at: new Date(parsed.data.at), id: parsed.data.id };
}

const rankCursorSchema = z
  .object({ rank: z.string().min(1).max(300), id: z.string().min(1).max(200) })
  .strict();

function decodeRankCursor(cursor: string | undefined): { rank: string; id: string } | null {
  if (cursor === undefined) return null;
  const parsed = rankCursorSchema.safeParse(decodeKeysetCursor(cursor));
  if (!parsed.success) {
    throw new Phase9ApiError("CURSOR_INVALID", 400, "Cursor is not valid");
  }
  return parsed.data;
}

/**
 * Page a fully materialised, deterministically ordered list with the same
 * keyset contract the SQL lists use, so the client never learns which lists
 * are paged in the database and which are paged in the service.
 */
function pageByRank<T>(
  items: readonly T[],
  rankOf: (item: T) => { rank: string; id: string },
  limit: number,
  cursor: { rank: string; id: string } | null,
): { page: T[]; hasMore: boolean; nextCursor: string | null } {
  const after =
    cursor === null
      ? items
      : items.filter((item) => {
          const key = rankOf(item);
          return key.rank > cursor.rank || (key.rank === cursor.rank && key.id > cursor.id);
        });
  const page = after.slice(0, limit);
  const hasMore = after.length > page.length;
  const last = page.at(-1);
  return {
    page,
    hasMore,
    nextCursor: hasMore && last !== undefined ? encodeKeysetCursor(rankOf(last)) : null,
  };
}

/** Fixed-width so lexicographic cursor comparison matches numeric ordering. */
function numericRank(value: number, descending: boolean): string {
  const bounded = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(value)));
  const normalized = descending ? Number.MAX_SAFE_INTEGER - bounded : bounded;
  return normalized.toString().padStart(16, "0");
}

function timeRank(value: Date | null, descending: boolean): string {
  return numericRank(value === null ? 0 : value.getTime(), descending);
}

function cause(input: {
  ruleKey: string;
  severity: Severity;
  title: string;
  tenantId?: string | null;
  tenantName?: string | null;
  agentType?: string | null;
  component?: string | null;
  evidenceAt: Date | null;
  diagnosticsHref: string;
}): PlatformOverviewCause {
  const causeScope = scope(input);
  return {
    causeId: platformOverviewSignalId(input.ruleKey, causeScope),
    severity: input.severity,
    title: input.title,
    scope: causeScope,
    diagnosticsHref: input.diagnosticsHref,
    evidenceAt: iso(input.evidenceAt),
  };
}

const severityOrder: Readonly<Record<Severity, number>> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

function sortCauses(causes: PlatformOverviewCause[]) {
  return causes.sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      left.causeId.localeCompare(right.causeId),
  );
}

/**
 * Same thresholds and rule keys the overview uses, so a tenant classified
 * WARNING on the Control Tower is never HEALTHY on the drill-down page.
 */
function tenantCauses(row: PlatformTenantListRow, asOf: Date): PlatformOverviewCause[] {
  const tenantName = safeTenantDisplayName(row.name, row.tenantId);
  const causes: PlatformOverviewCause[] = [];
  const rollingTerminal = nonnegativeInteger(row.rollingTerminal);
  const rollingFailures = nonnegativeInteger(row.rollingNonCompletion);
  if (rollingTerminal >= MIN_AGENT_SAMPLE && rollingFailures / rollingTerminal > 0.05) {
    causes.push(
      cause({
        ruleKey: "TENANT_AGENT_HIGH_FAILURE_RATE",
        severity: "HIGH",
        title: "Tenant agent non-completion rate is high",
        tenantId: row.tenantId,
        tenantName,
        evidenceAt: row.oldestRollingFailureAt,
        diagnosticsHref: `/platform/agent-runs?tenantId=${encodeURIComponent(row.tenantId)}`,
      }),
    );
  }
  if (nonnegativeInteger(row.stuck) > 0) {
    causes.push(
      cause({
        ruleKey: "TENANT_AGENT_RUN_STUCK_30M",
        severity: "HIGH",
        title: "Tenant has stuck agent runs",
        tenantId: row.tenantId,
        tenantName,
        evidenceAt: row.oldestStuckAt,
        diagnosticsHref: `/platform/agent-runs?stuck=true&tenantId=${encodeURIComponent(row.tenantId)}`,
      }),
    );
  }
  if (nonnegativeInteger(row.reviewBreached) > 0) {
    causes.push(
      cause({
        ruleKey: "REVIEW_SLA_BREACH",
        severity: "HIGH",
        title: "Review SLA is breached",
        tenantId: row.tenantId,
        tenantName,
        evidenceAt: row.oldestBreachedDueAt,
        diagnosticsHref: `/platform/review-quality?view=backlog&sla=BREACHED&tenantId=${encodeURIComponent(row.tenantId)}`,
      }),
    );
  }
  if (nonnegativeInteger(row.outboxDeadLetter) > 0) {
    causes.push(
      cause({
        ruleKey: "OUTBOX_DEAD_LETTER",
        severity: "HIGH",
        title: "Outbox events reached dead letter",
        tenantId: row.tenantId,
        tenantName,
        component: "OUTBOX",
        evidenceAt: null,
        diagnosticsHref: `/platform/system-health?component=OUTBOX&tenantId=${encodeURIComponent(row.tenantId)}`,
      }),
    );
  }
  if (nonnegativeInteger(row.outboxStalled) > 0) {
    causes.push(
      cause({
        ruleKey: "OUTBOX_STALLED_10M",
        severity: "HIGH",
        title: "Eligible outbox events are stalled",
        tenantId: row.tenantId,
        tenantName,
        component: "OUTBOX",
        evidenceAt: null,
        diagnosticsHref: `/platform/system-health?component=OUTBOX&tenantId=${encodeURIComponent(row.tenantId)}`,
      }),
    );
  }
  if (nonnegativeInteger(row.notificationFailed) > 0) {
    causes.push(
      cause({
        ruleKey: "NOTIFICATION_FAILED",
        severity: "MEDIUM",
        title: "Notification delivery failed",
        tenantId: row.tenantId,
        tenantName,
        component: "NOTIFICATION",
        evidenceAt: null,
        diagnosticsHref: `/platform/system-health?component=NOTIFICATION&tenantId=${encodeURIComponent(row.tenantId)}`,
      }),
    );
  }
  if (nonnegativeInteger(row.quarantinedFiles) > 0) {
    causes.push(
      cause({
        ruleKey: "ARTIFACT_QUARANTINED",
        severity: "MEDIUM",
        title: "Artifacts are quarantined",
        tenantId: row.tenantId,
        tenantName,
        component: "ARTIFACT_METADATA",
        evidenceAt: null,
        diagnosticsHref: `/platform/system-health?component=ARTIFACT_METADATA&tenantId=${encodeURIComponent(row.tenantId)}`,
      }),
    );
  }
  if (row.lastActivityAt !== null && row.lastActivityAt.getTime() <= asOf.getTime() - 30 * DAY_MS) {
    causes.push(
      cause({
        ruleKey: "TENANT_INACTIVE_30D",
        severity: "LOW",
        title: "Tenant has been inactive for 30 days",
        tenantId: row.tenantId,
        tenantName,
        evidenceAt: row.lastActivityAt,
        diagnosticsHref: `/platform/tenants/${encodeURIComponent(row.tenantId)}/health`,
      }),
    );
  }
  return sortCauses(causes);
}

function tenantHealth(causes: readonly PlatformOverviewCause[], inactive: boolean): Health {
  if (causes.some((item) => item.severity === "CRITICAL")) return "CRITICAL";
  if (causes.some((item) => item.severity === "HIGH" || item.severity === "MEDIUM")) {
    return "WARNING";
  }
  return inactive ? "INACTIVE" : "HEALTHY";
}

const healthOrder: Readonly<Record<Health, number>> = {
  CRITICAL: 0,
  WARNING: 1,
  UNKNOWN: 2,
  HEALTHY: 3,
  INACTIVE: 4,
};

function agentCauses(row: PlatformAgentListRow, agentType: string): PlatformOverviewCause[] {
  const causes: PlatformOverviewCause[] = [];
  const rollingTerminal = nonnegativeInteger(row.rollingTerminal);
  const rollingFailures = nonnegativeInteger(row.rollingNonCompletion);
  if (rollingTerminal >= MIN_AGENT_SAMPLE && rollingFailures / rollingTerminal > 0.05) {
    causes.push(
      cause({
        ruleKey: "AGENT_HIGH_FAILURE_RATE",
        severity: "HIGH",
        title: "Agent non-completion rate is high",
        agentType,
        evidenceAt: row.oldestRollingFailureAt,
        diagnosticsHref: `/platform/agents/${encodeURIComponent(agentType)}`,
      }),
    );
  }
  if (nonnegativeInteger(row.stuck) > 0) {
    causes.push(
      cause({
        ruleKey: "AGENT_RUN_STUCK_30M",
        severity: "HIGH",
        title: "Agent runs are stuck",
        agentType,
        evidenceAt: row.oldestStuckAt,
        diagnosticsHref: `/platform/agent-runs?stuck=true&agentType=${encodeURIComponent(agentType)}`,
      }),
    );
  }
  return sortCauses(causes);
}

function agentItem(row: PlatformAgentListRow, agentType: string): PlatformAgentListItem {
  const runs = nonnegativeInteger(row.runs);
  const terminal = nonnegativeInteger(row.terminal);
  const stuck = nonnegativeInteger(row.stuck);
  const rollingTerminal = nonnegativeInteger(row.rollingTerminal);
  const rollingFailures = nonnegativeInteger(row.rollingNonCompletion);
  const degraded =
    stuck > 0 || (rollingTerminal >= MIN_AGENT_SAMPLE && rollingFailures / rollingTerminal > 0.05);
  const retriedRuns = nonnegativeInteger(row.retriedRuns);
  return {
    agentType,
    state: degraded ? "DEGRADED" : runs > 0 ? "ACTIVE" : "UNKNOWN",
    runs,
    terminal,
    completed: nonnegativeInteger(row.completed),
    failed: nonnegativeInteger(row.failed),
    degraded: nonnegativeInteger(row.degraded),
    rejected: nonnegativeInteger(row.rejected),
    running: nonnegativeInteger(row.running),
    stuck,
    completionPercent:
      terminal >= MIN_AGENT_SAMPLE
        ? roundedPercent(nonnegativeInteger(row.completed), terminal)
        : null,
    minimumSample: MIN_AGENT_SAMPLE,
    p50LatencyMs: row.p50LatencyMs == null ? null : nonnegativeInteger(row.p50LatencyMs),
    p95LatencyMs: row.p95LatencyMs == null ? null : nonnegativeInteger(row.p95LatencyMs),
    retriedRuns,
    retryRatePercent: roundedPercent(retriedRuns, runs),
    lastSuccessAt: iso(row.lastSuccessAt),
    costMicroUsd: nonnegativeInteger(row.costMicroUsd),
    reasons: agentCauses(row, agentType).slice(0, 3),
    detailHref: `/platform/agents/${encodeURIComponent(agentType)}`,
  };
}

function runItem(row: PlatformAgentRunRow, stuckBefore: Date): PlatformAgentRunListItem | null {
  const runId = safeIdentifier(row.runId);
  const tenantId = safeIdentifier(row.tenantId);
  const agentType = safeAgentType(row.agentType);
  if (runId === null || tenantId === null || agentType === null) return null;
  const actual = row.actualCostMicroUsd;
  return {
    runId,
    tenantId,
    tenantName: safeTenantDisplayName(row.tenantName, tenantId),
    agentType,
    status: row.status,
    failureCategory: row.failureCategory.trim().slice(0, 60) || "NONE",
    trigger: row.trigger.trim().slice(0, 60) || "REQUEST",
    provider: row.provider.trim().slice(0, 60) || "UNKNOWN",
    modelId: row.modelId.trim().slice(0, 120) || "UNKNOWN",
    promptVersion: row.promptVersion.trim().slice(0, 60) || "legacy",
    startedAt: row.startedAt.toISOString(),
    completedAt: iso(row.completedAt),
    latencyMs: nonnegativeInteger(row.latencyMs),
    retryCount: nonnegativeInteger(row.retryCount),
    costMicroUsd: nonnegativeInteger(actual ?? row.estimatedCostMicroUsd),
    costBasis: actual === null ? "ESTIMATED" : "ACTUAL",
    stuck: row.status === "RUNNING" && row.startedAt.getTime() <= stuckBefore.getTime(),
    diagnosticsHref: `/platform/agent-runs/${encodeURIComponent(runId)}/diagnostics`,
  };
}

function deliveryComponent(input: {
  component: PlatformOverviewSystemComponent["component"];
  required: boolean;
  pending: number;
  stalled: number;
  failed: number;
  deadLetter: number;
  quarantined: number;
  freshness: PlatformOverviewFreshness;
  tenantId: string | null;
}): PlatformOverviewSystemComponent {
  const attention = input.stalled + input.failed + input.deadLetter + input.quarantined;
  const label = input.component.replace("_", " ");
  const tenantSuffix =
    input.tenantId === null ? "" : `&tenantId=${encodeURIComponent(input.tenantId)}`;
  return {
    component: input.component,
    state: attention > 0 ? "DEGRADED" : "HEALTHY",
    required: input.required,
    summary:
      attention > 0
        ? `${label} has items requiring attention.`
        : `${label} has no confirmed delivery or processing issue.`,
    metrics: [
      { key: "pending", value: input.pending, unit: "items" },
      { key: "stalled", value: input.stalled, unit: "items" },
      { key: "failed", value: input.failed, unit: "items" },
      { key: "dead_letter", value: input.deadLetter, unit: "items" },
      { key: "quarantined", value: input.quarantined, unit: "items" },
    ],
    freshness: input.freshness,
    diagnosticsHref: `/platform/system-health?component=${input.component}${tenantSuffix}`,
  };
}

function limitOf(value: number | undefined): number {
  return value ?? PLATFORM_LIST_DEFAULT_LIMIT;
}

export interface PlatformDrilldownServiceDependencies {
  drilldown: PlatformDrilldownReadModel;
  overview: PlatformOverviewReadModel;
}

export class PlatformDrilldownService {
  private readonly drilldown: PlatformDrilldownReadModel;
  private readonly overview: PlatformOverviewReadModel;

  constructor(
    dependencies: PlatformDrilldownServiceDependencies,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.drilldown = dependencies.drilldown;
    this.overview = dependencies.overview;
  }

  async tenants(rawQuery: unknown): Promise<PlatformTenantListResponse> {
    const asOf = new Date(this.now());
    const query = platformTenantListQuerySchema.parse(rawQuery);
    const { range, window } = resolveRange(query, asOf);
    const cursor = decodeRankCursor(query.cursor);
    const limit = limitOf(query.limit);
    const sort = query.sort ?? "HEALTH";
    // HEALTH and NAME read most-severe/A-Z first, so their natural order is ASC.
    const order = query.order ?? (sort === "NAME" || sort === "HEALTH" ? "ASC" : "DESC");

    const [settled] = await Promise.allSettled([
      this.drilldown.queryTenantList(range, { search: query.search ?? null, tenantId: null }),
    ]);
    const generatedAt = new Date(this.now());
    const tenants = domainFromSettled(settled, generatedAt);
    const problems = problemsFor([["TENANTS", tenants]]);

    const all: PlatformTenantListItem[] = tenants.available
      ? tenants.data
          .map((row): PlatformTenantListItem | null => {
            const tenantId = safeIdentifier(row.tenantId);
            if (tenantId === null) return null;
            const causes = tenantCauses(row, asOf);
            const inactive =
              row.lastActivityAt !== null &&
              row.lastActivityAt.getTime() <= asOf.getTime() - 30 * DAY_MS;
            const terminal = nonnegativeInteger(row.terminal);
            return {
              tenantId,
              name: safeTenantDisplayName(row.name, tenantId),
              health: tenantHealth(causes, inactive),
              reasons: causes.slice(0, 3),
              users: {
                loggedIn24h: nonnegativeInteger(row.loggedIn24h),
                activeAccounts: nonnegativeInteger(row.activeAccounts),
              },
              projects: {
                total: nonnegativeInteger(row.totalProjects),
                active: nonnegativeInteger(row.activeProjects),
              },
              runs: {
                total: nonnegativeInteger(row.runs),
                completed: nonnegativeInteger(row.completed),
                failed: nonnegativeInteger(row.failed),
                degraded: nonnegativeInteger(row.degraded),
                rejected: nonnegativeInteger(row.rejected),
                stuck: nonnegativeInteger(row.stuck),
                completionPercent:
                  terminal >= MIN_AGENT_SAMPLE
                    ? roundedPercent(nonnegativeInteger(row.completed), terminal)
                    : null,
              },
              review: {
                waiting: nonnegativeInteger(row.reviewWaiting),
                breached: nonnegativeInteger(row.reviewBreached),
              },
              aiSpendMicroUsd: nonnegativeInteger(row.mtdCostMicroUsd),
              storageBytes: nonnegativeInteger(row.storageBytes),
              lastActivityAt: iso(row.lastActivityAt),
              detailHref: `/platform/tenants/${encodeURIComponent(tenantId)}/health`,
              unknownFields: [],
            };
          })
          .filter((item): item is PlatformTenantListItem => item !== null)
      : [];

    const matched = query.health === undefined ? all : all.filter((i) => i.health === query.health);
    const descending = order === "DESC";
    const rankOf = (item: PlatformTenantListItem) => {
      switch (sort) {
        case "NAME":
          return { rank: descending ? invertText(item.name) : item.name, id: item.tenantId };
        case "LAST_ACTIVITY":
          return {
            rank: timeRank(
              item.lastActivityAt === null ? null : new Date(item.lastActivityAt),
              descending,
            ),
            id: item.tenantId,
          };
        case "RUNS":
          return { rank: numericRank(item.runs?.total ?? 0, descending), id: item.tenantId };
        case "REVIEW_BREACHED":
          return { rank: numericRank(item.review?.breached ?? 0, descending), id: item.tenantId };
        case "AI_SPEND":
          return { rank: numericRank(item.aiSpendMicroUsd ?? 0, descending), id: item.tenantId };
        default:
          return {
            rank: `${numericRank(healthOrder[item.health], descending)}${
              descending ? invertText(item.name) : item.name
            }`,
            id: item.tenantId,
          };
      }
    };
    const sorted = [...matched].sort((left, right) => {
      const leftKey = rankOf(left);
      const rightKey = rankOf(right);
      return leftKey.rank.localeCompare(rightKey.rank) || leftKey.id.localeCompare(rightKey.id);
    });
    const paged = pageByRank(sorted, rankOf, limit, cursor);

    if (tenants.available && tenants.data.length >= PLATFORM_TENANT_SCAN_LIMIT) {
      problems.push({
        section: "TENANTS",
        code: "SOURCE_STALE",
        message: "Tenant scan hit its bound; narrow the search to see the remaining tenants.",
        retryable: false,
      });
    }

    return platformTenantListResponseSchema.parse({
      schemaVersion: "platform-tenants.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: asOf.toISOString(),
      window,
      freshness: tenants.freshness,
      partial: problems.length > 0,
      problems: problems.slice(0, 10),
      filters: { search: query.search ?? null, health: query.health ?? null },
      page: {
        limit,
        hasMore: paged.hasMore,
        nextCursor: paged.nextCursor,
        sort,
        order,
      },
      totals: {
        matched: matched.length,
        healthy: all.filter((item) => item.health === "HEALTHY").length,
        warning: all.filter((item) => item.health === "WARNING").length,
        critical: all.filter((item) => item.health === "CRITICAL").length,
        unknown: all.filter((item) => item.health === "UNKNOWN").length,
        inactive: all.filter((item) => item.health === "INACTIVE").length,
      },
      items: paged.page,
    });
  }

  async tenantHealth(
    rawTenantId: unknown,
    rawQuery: unknown,
  ): Promise<PlatformTenantHealthResponse> {
    const asOf = new Date(this.now());
    const tenantId = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/)
      .parse(rawTenantId);
    const query = platformTenantHealthQuerySchema.parse(rawQuery);
    const { range, window } = resolveRange(query, asOf);

    const settled = await Promise.allSettled([
      this.drilldown.queryTenantList(range, { search: null, tenantId }),
      this.drilldown.queryTenantAgents(range, tenantId),
    ] as const);
    const generatedAt = new Date(this.now());
    const base = domainFromSettled(settled[0], generatedAt);
    const agents = domainFromSettled(settled[1], generatedAt);

    if (base.available && base.data.length === 0) {
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Tenant not found");
    }
    const row = base.available ? (base.data.at(0) ?? null) : null;
    const problems = problemsFor([
      ["TENANTS", base],
      ["AGENTS", agents],
    ]);
    const tenantFilter = ["TENANT_ID"] as ("TENANT_ID" | "AGENT_TYPE")[];
    const causes = row === null ? [] : tenantCauses(row, asOf);
    const inactive =
      row?.lastActivityAt != null && row.lastActivityAt.getTime() <= asOf.getTime() - 30 * DAY_MS;
    const name = row === null ? tenantId : safeTenantDisplayName(row.name, tenantId);

    return platformTenantHealthResponseSchema.parse({
      schemaVersion: "platform-tenant-health.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: asOf.toISOString(),
      window,
      freshness: base.freshness,
      partial: problems.length > 0,
      problems: problems.slice(0, 10),
      tenant: {
        tenantId,
        name,
        health: row === null ? "UNKNOWN" : tenantHealth(causes, inactive === true),
        createdAt: iso(row?.createdAt ?? null),
        lastActivityAt: iso(row?.lastActivityAt ?? null),
        inactiveDays:
          row?.lastActivityAt == null
            ? null
            : Math.max(0, Math.floor((asOf.getTime() - row.lastActivityAt.getTime()) / DAY_MS)),
      },
      signals: {
        context: sectionContext(base, tenantFilter),
        total: causes.length,
        items: causes.slice(0, 10),
      },
      users: {
        context: sectionContext(base, tenantFilter),
        activeAccounts: row === null ? null : nonnegativeInteger(row.activeAccounts),
        suspendedAccounts: row === null ? null : nonnegativeInteger(row.suspendedAccounts),
        loggedIn24h: row === null ? null : nonnegativeInteger(row.loggedIn24h),
        loggedIn7d: row === null ? null : nonnegativeInteger(row.loggedIn7d),
        neverLoggedIn: row === null ? null : nonnegativeInteger(row.neverLoggedIn),
      },
      agents: {
        context: sectionContext(agents, tenantFilter),
        total: agents.available ? agents.data.length : 0,
        items: agents.available
          ? agents.data
              .map((agent) => {
                const agentType = safeAgentType(agent.agentType);
                if (agentType === null) return null;
                const terminal = nonnegativeInteger(agent.terminal);
                return {
                  agentType,
                  runs: nonnegativeInteger(agent.runs),
                  terminal,
                  completed: nonnegativeInteger(agent.completed),
                  failed: nonnegativeInteger(agent.failed),
                  degraded: nonnegativeInteger(agent.degraded),
                  rejected: nonnegativeInteger(agent.rejected),
                  stuck: nonnegativeInteger(agent.stuck),
                  completionPercent:
                    terminal >= MIN_AGENT_SAMPLE
                      ? roundedPercent(nonnegativeInteger(agent.completed), terminal)
                      : null,
                  lastSuccessAt: iso(agent.lastSuccessAt),
                  costMicroUsd: nonnegativeInteger(agent.costMicroUsd),
                  runsHref: `/platform/agent-runs?tenantId=${encodeURIComponent(tenantId)}&agentType=${encodeURIComponent(agentType)}`,
                };
              })
              .filter((item): item is NonNullable<typeof item> => item !== null)
              .slice(0, 50)
          : [],
      },
      review: {
        context: sectionContext(base, tenantFilter),
        waiting: row === null ? null : nonnegativeInteger(row.reviewWaiting),
        breached: row === null ? null : nonnegativeInteger(row.reviewBreached),
        withoutDueAt: row === null ? null : nonnegativeInteger(row.reviewWithoutDueAt),
        oldestWaitingAt: iso(row?.oldestWaitingAt ?? null),
        oldestBreachedDueAt: iso(row?.oldestBreachedDueAt ?? null),
        backlogHref: `/platform/review-quality?view=backlog&tenantId=${encodeURIComponent(tenantId)}`,
      },
      delivery: {
        context: sectionContext(base, tenantFilter),
        components:
          row === null
            ? []
            : [
                deliveryComponent({
                  component: "OUTBOX",
                  required: true,
                  pending: nonnegativeInteger(row.outboxStalled),
                  stalled: nonnegativeInteger(row.outboxStalled),
                  failed: 0,
                  deadLetter: nonnegativeInteger(row.outboxDeadLetter),
                  quarantined: 0,
                  freshness: base.freshness,
                  tenantId,
                }),
                deliveryComponent({
                  component: "NOTIFICATION",
                  required: false,
                  pending: 0,
                  stalled: 0,
                  failed: nonnegativeInteger(row.notificationFailed),
                  deadLetter: 0,
                  quarantined: 0,
                  freshness: base.freshness,
                  tenantId,
                }),
                deliveryComponent({
                  component: "ARTIFACT_METADATA",
                  required: true,
                  pending: 0,
                  stalled: 0,
                  failed: 0,
                  deadLetter: 0,
                  quarantined: nonnegativeInteger(row.quarantinedFiles),
                  freshness: base.freshness,
                  tenantId,
                }),
              ],
      },
      storage: {
        context: sectionContext(base, tenantFilter),
        totalBytes: row === null ? null : nonnegativeInteger(row.storageBytes),
        fileCount: row === null ? null : nonnegativeInteger(row.fileCount),
        quarantinedCount: row === null ? null : nonnegativeInteger(row.quarantinedFiles),
      },
    });
  }

  async agents(rawQuery: unknown): Promise<PlatformAgentListResponse> {
    const asOf = new Date(this.now());
    const query = platformAgentListQuerySchema.parse(rawQuery);
    const { range, window } = resolveRange(query, asOf);
    const sort = query.sort ?? "STATE";
    // STATE and AGENT_TYPE read most-degraded/A-Z first, so their natural order is ASC.
    const order = query.order ?? (sort === "AGENT_TYPE" || sort === "STATE" ? "ASC" : "DESC");

    const [settled] = await Promise.allSettled([
      this.drilldown.queryAgentList(range, query.tenantId ?? null),
    ]);
    const generatedAt = new Date(this.now());
    const agents = domainFromSettled(settled, generatedAt);
    const problems = problemsFor([["AGENTS", agents]]);

    const all = agents.available
      ? agents.data
          .map((row) => {
            const agentType = safeAgentType(row.agentType);
            return agentType === null ? null : agentItem(row, agentType);
          })
          .filter((item): item is PlatformAgentListItem => item !== null)
      : [];
    const matched = query.state === undefined ? all : all.filter((i) => i.state === query.state);
    const descending = order === "DESC";
    const stateOrder = { DEGRADED: 0, ACTIVE: 1, UNKNOWN: 2 } as const;
    const rankOf = (item: PlatformAgentListItem) => {
      switch (sort) {
        case "AGENT_TYPE":
          return {
            rank: descending ? invertText(item.agentType) : item.agentType,
            id: item.agentType,
          };
        case "RUNS":
          return { rank: numericRank(item.runs, descending), id: item.agentType };
        case "COMPLETION":
          return {
            rank: numericRank((item.completionPercent ?? 0) * 10, descending),
            id: item.agentType,
          };
        case "P95_LATENCY":
          return { rank: numericRank(item.p95LatencyMs ?? 0, descending), id: item.agentType };
        case "COST":
          return { rank: numericRank(item.costMicroUsd, descending), id: item.agentType };
        default:
          return {
            rank: `${numericRank(stateOrder[item.state], descending)}${numericRank(item.runs, true)}`,
            id: item.agentType,
          };
      }
    };
    const sorted = [...matched].sort((left, right) => {
      const leftKey = rankOf(left);
      const rightKey = rankOf(right);
      return leftKey.rank.localeCompare(rightKey.rank) || leftKey.id.localeCompare(rightKey.id);
    });
    const paged = pageByRank(sorted, rankOf, limitOf(query.limit), decodeRankCursor(query.cursor));

    return platformAgentListResponseSchema.parse({
      schemaVersion: "platform-agents.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: asOf.toISOString(),
      window,
      freshness: agents.freshness,
      partial: problems.length > 0,
      problems,
      filters: { tenantId: query.tenantId ?? null, state: query.state ?? null },
      page: {
        limit: limitOf(query.limit),
        hasMore: paged.hasMore,
        nextCursor: paged.nextCursor,
        sort,
        order,
      },
      totals: {
        matched: matched.length,
        active: all.filter((item) => item.state === "ACTIVE").length,
        degraded: all.filter((item) => item.state === "DEGRADED").length,
        unknown: all.filter((item) => item.state === "UNKNOWN").length,
      },
      items: paged.page,
    });
  }

  async agentDetail(
    rawAgentType: unknown,
    rawQuery: unknown,
  ): Promise<PlatformAgentDetailResponse> {
    const asOf = new Date(this.now());
    const agentType = z.string().trim().min(1).max(100).parse(rawAgentType);
    const query = platformAgentDetailQuerySchema.parse(rawQuery);
    const { range, window } = resolveRange(query, asOf);
    const tenantId = query.tenantId ?? null;

    const settled = await Promise.allSettled([
      this.drilldown.queryAgentList(range, tenantId),
      this.drilldown.queryAgentDetail(range, agentType, tenantId),
    ] as const);
    const generatedAt = new Date(this.now());
    const list = domainFromSettled(settled[0], generatedAt);
    const detail = domainFromSettled(settled[1], generatedAt);
    const problems = problemsFor([
      ["AGENTS", list],
      ["AGENTS", detail],
    ]);
    const appliedFilters = (tenantId === null ? [] : ["TENANT_ID"]) as (
      "TENANT_ID" | "AGENT_TYPE"
    )[];

    const row = list.available
      ? (list.data.find((candidate) => candidate.agentType === agentType) ?? null)
      : null;
    if (list.available && row === null) {
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Agent type not found");
    }
    const agent =
      row === null
        ? {
            agentType,
            state: "UNKNOWN" as const,
            runs: 0,
            terminal: 0,
            completed: 0,
            failed: 0,
            degraded: 0,
            rejected: 0,
            running: 0,
            stuck: 0,
            completionPercent: null,
            minimumSample: MIN_AGENT_SAMPLE,
            p50LatencyMs: null,
            p95LatencyMs: null,
            retriedRuns: 0,
            retryRatePercent: null,
            lastSuccessAt: null,
            costMicroUsd: 0,
            reasons: [],
            detailHref: `/platform/agents/${encodeURIComponent(agentType)}`,
          }
        : agentItem(row, agentType);
    const nonCompletionTotal = detail.available
      ? detail.data.failures.reduce((sum, item) => sum + nonnegativeInteger(item.count), 0)
      : 0;

    return platformAgentDetailResponseSchema.parse({
      schemaVersion: "platform-agent-detail.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: asOf.toISOString(),
      window,
      freshness: detail.freshness,
      partial: problems.length > 0,
      problems,
      filters: { tenantId },
      agent,
      failureBreakdown: {
        context: sectionContext(detail, appliedFilters),
        items: detail.available
          ? detail.data.failures.map((item) => ({
              failureCategory: item.failureCategory.trim().slice(0, 60) || "NONE",
              count: nonnegativeInteger(item.count),
              sharePercent: roundedPercent(nonnegativeInteger(item.count), nonCompletionTotal),
              lastObservedAt: iso(item.lastObservedAt),
            }))
          : [],
      },
      tenantBreakdown: {
        context: sectionContext(detail, appliedFilters),
        items: detail.available
          ? detail.data.tenants
              .map((item) => {
                const id = safeIdentifier(item.tenantId);
                if (id === null) return null;
                const terminal = nonnegativeInteger(item.terminal);
                return {
                  tenantId: id,
                  tenantName: safeTenantDisplayName(item.tenantName, id),
                  runs: nonnegativeInteger(item.runs),
                  terminal,
                  completed: nonnegativeInteger(item.completed),
                  failed: nonnegativeInteger(item.failed),
                  degraded: nonnegativeInteger(item.degraded),
                  rejected: nonnegativeInteger(item.rejected),
                  completionPercent:
                    terminal >= MIN_AGENT_SAMPLE
                      ? roundedPercent(nonnegativeInteger(item.completed), terminal)
                      : null,
                  costMicroUsd: nonnegativeInteger(item.costMicroUsd),
                  healthHref: `/platform/tenants/${encodeURIComponent(id)}/health`,
                };
              })
              .filter((item): item is NonNullable<typeof item> => item !== null)
          : [],
      },
      models: {
        context: sectionContext(detail, appliedFilters),
        items: detail.available
          ? detail.data.models.map((item) => ({
              provider: item.provider.trim().slice(0, 60) || "UNKNOWN",
              modelId: item.modelId.trim().slice(0, 120) || "UNKNOWN",
              runs: nonnegativeInteger(item.runs),
              costMicroUsd: nonnegativeInteger(item.costMicroUsd),
              inputTokens: nonnegativeInteger(item.inputTokens),
              outputTokens: nonnegativeInteger(item.outputTokens),
            }))
          : [],
      },
    });
  }

  async agentRuns(rawQuery: unknown): Promise<PlatformAgentRunListResponse> {
    const asOf = new Date(this.now());
    const query = platformAgentRunListQuerySchema.parse(rawQuery);
    const { range, window } = resolveRange(query, asOf);
    const limit = limitOf(query.limit);
    const order = query.order ?? "DESC";
    const cursor = decodeTimeCursor(query.cursor);
    const stuck = query.stuck === "true";

    const [settled] = await Promise.allSettled([
      this.drilldown.queryAgentRuns(range, {
        limit: limit + 1,
        cursorAt: cursor?.at ?? null,
        cursorId: cursor?.id ?? null,
        order,
        tenantId: query.tenantId ?? null,
        agentType: query.agentType ?? null,
        status: query.status ?? null,
        outcome: query.outcome ?? null,
        failureCategory: query.failureCategory ?? null,
        stuck,
      }),
    ]);
    const generatedAt = new Date(this.now());
    const runs = domainFromSettled(settled, generatedAt);
    const problems = problemsFor([["AGENTS", runs]]);
    const rows = runs.available ? runs.data : [];
    const hasMore = rows.length > limit;
    const items = rows
      .slice(0, limit)
      .map((row) => runItem(row, range.stuckBefore))
      .filter((item): item is PlatformAgentRunListItem => item !== null);
    const last = rows.slice(0, limit).at(-1);

    return platformAgentRunListResponseSchema.parse({
      schemaVersion: "platform-agent-runs.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: asOf.toISOString(),
      window,
      freshness: runs.freshness,
      partial: problems.length > 0,
      problems,
      filters: {
        tenantId: query.tenantId ?? null,
        agentType: query.agentType ?? null,
        status: query.status ?? null,
        outcome: query.outcome ?? null,
        failureCategory: query.failureCategory ?? null,
        stuck,
      },
      page: {
        limit,
        hasMore,
        nextCursor:
          hasMore && last !== undefined
            ? encodeKeysetCursor({ at: last.startedAt.toISOString(), id: last.runId })
            : null,
        sort: "STARTED_AT",
        order,
      },
      items,
    });
  }

  async agentRunDiagnostics(rawRunId: unknown): Promise<PlatformAgentRunDiagnosticsResponse> {
    const asOf = new Date(this.now());
    const runId = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/)
      .parse(rawRunId);
    const { range, window } = resolveRange({}, asOf);

    const result = await this.drilldown.queryAgentRunDiagnostics(range, runId);
    const generatedAt = new Date(this.now());
    if (result.data === null)
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Agent run not found");
    const { run, toolCalls, toolCallTotal } = result.data;
    const item = runItem(run, range.stuckBefore);
    if (item === null) throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Agent run not found");

    return platformAgentRunDiagnosticsResponseSchema.parse({
      schemaVersion: "platform-agent-run-diagnostics.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: asOf.toISOString(),
      window,
      freshness: freshFreshness(generatedAt),
      partial: false,
      problems: [],
      run: item,
      execution: {
        requestId: safeIdentifier(run.requestId),
        eventId: safeIdentifier(run.eventId),
        traceId: safeIdentifier(run.traceId),
        projectId: run.projectId,
        toolBundleVersion: run.toolBundleVersion.trim().slice(0, 60) || "legacy",
        outputSchemaVersion: nonnegativeInteger(run.outputSchemaVersion),
        dataSnapshotVersion: run.dataSnapshotVersion.trim().slice(0, 60) || "legacy",
        outputSha256: /^[a-f0-9]{64}$/.test(run.outputSha256 ?? "") ? run.outputSha256 : null,
        contentLoggingEnabled: run.contentLoggingEnabled,
        asOf: run.asOf.toISOString(),
      },
      usage: {
        inputTokens: nonnegativeInteger(run.inputTokens),
        outputTokens: nonnegativeInteger(run.outputTokens),
        cachedInputTokens: nonnegativeInteger(run.cachedInputTokens),
        reasoningTokens: nonnegativeInteger(run.reasoningTokens),
        estimatedCostMicroUsd: nonnegativeInteger(run.estimatedCostMicroUsd),
        actualCostMicroUsd:
          run.actualCostMicroUsd === null ? null : nonnegativeInteger(run.actualCostMicroUsd),
      },
      validation: {
        state: run.validationState,
        issueCount:
          run.validationIssueCount === null ? null : nonnegativeInteger(run.validationIssueCount),
      },
      toolCalls: {
        total: nonnegativeInteger(toolCallTotal),
        truncated: nonnegativeInteger(toolCallTotal) > toolCalls.length,
        items: toolCalls
          .map((call) => {
            const id = safeIdentifier(call.id);
            return id === null
              ? null
              : {
                  id,
                  toolName: call.toolName.trim().slice(0, 120) || "unknown",
                  status: call.status.trim().slice(0, 60) || "UNKNOWN",
                  sequence: nonnegativeInteger(call.stepNumber),
                  latencyMs: call.durationMs === null ? 0 : nonnegativeInteger(call.durationMs),
                  retryCount: 0,
                  startedAt: iso(call.occurredAt),
                };
          })
          .filter((call): call is NonNullable<typeof call> => call !== null),
      },
      redaction: {
        policy: "platform-diagnostics-redaction.v1",
        redactedFields: [
          "request",
          "researchText",
          "output",
          "validationDetail",
          "errorMessage",
          "toolCallInput",
          "toolCallOutput",
        ],
        note: "Platform diagnostics expose run metadata only. Prompt, research, output and tool payloads stay inside the tenant boundary.",
      },
    });
  }

  async reviewSummary(rawQuery: unknown): Promise<PlatformReviewSummaryResponse> {
    const asOf = new Date(this.now());
    const query = platformReviewSummaryQuerySchema.parse(rawQuery);
    const { range, window } = resolveRange(query, asOf);
    const tenantId = query.tenantId ?? null;

    const [settled] = await Promise.allSettled([
      this.drilldown.queryReviewSummary(range, tenantId),
    ]);
    const generatedAt = new Date(this.now());
    const reviews = domainFromSettled(settled, generatedAt);
    const problems = problemsFor([["REVIEWS", reviews]]);
    const appliedFilters = (tenantId === null ? [] : ["TENANT_ID"]) as (
      "TENANT_ID" | "AGENT_TYPE"
    )[];
    const context = sectionContext(reviews, appliedFilters);
    const totals = reviews.available ? reviews.data.totals : null;
    const throughput = reviews.available ? reviews.data.throughput : null;
    const bucketOrder = ["UNDER_24H", "H24_TO_72H", "D3_TO_D7", "OVER_7D"] as const;
    const decided = throughput === null ? null : nonnegativeInteger(throughput.decided);
    const corrected = throughput === null ? null : nonnegativeInteger(throughput.corrected);

    return platformReviewSummaryResponseSchema.parse({
      schemaVersion: "platform-review-summary.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: asOf.toISOString(),
      window,
      freshness: reviews.freshness,
      partial: problems.length > 0,
      problems,
      filters: { tenantId },
      backlog: {
        context,
        waiting: totals === null ? null : nonnegativeInteger(totals.waiting),
        breached: totals === null ? null : nonnegativeInteger(totals.breached),
        withoutDueAt: totals === null ? null : nonnegativeInteger(totals.withoutDueAt),
        draft: totals === null ? null : nonnegativeInteger(totals.draft),
        oldestWaitingAt: iso(totals?.oldestWaitingAt ?? null),
        oldestBreachedDueAt: iso(totals?.oldestBreachedDueAt ?? null),
      },
      ageBuckets: {
        context,
        items: bucketOrder.map((bucket) => {
          const found = reviews.available
            ? reviews.data.buckets.find((item) => item.bucket === bucket)
            : undefined;
          return {
            bucket,
            waiting: nonnegativeInteger(found?.waiting),
            breached: nonnegativeInteger(found?.breached),
          };
        }),
      },
      byTenant: {
        context,
        items: reviews.available
          ? reviews.data.tenants
              .map((item) => {
                const id = safeIdentifier(item.tenantId);
                return id === null
                  ? null
                  : {
                      tenantId: id,
                      tenantName: safeTenantDisplayName(item.tenantName, id),
                      waiting: nonnegativeInteger(item.waiting),
                      breached: nonnegativeInteger(item.breached),
                      oldestWaitingAt: iso(item.oldestWaitingAt),
                      backlogHref: `/platform/review-quality?view=backlog&tenantId=${encodeURIComponent(id)}`,
                    };
              })
              .filter((item): item is NonNullable<typeof item> => item !== null)
          : [],
      },
      byTargetType: {
        context,
        items: reviews.available
          ? reviews.data.targets.map((item) => ({
              targetType: item.targetType.trim().slice(0, 60) || "UNKNOWN",
              waiting: nonnegativeInteger(item.waiting),
              breached: nonnegativeInteger(item.breached),
            }))
          : [],
      },
      throughput: {
        context,
        decided,
        approved: throughput === null ? null : nonnegativeInteger(throughput.approved),
        rejected: throughput === null ? null : nonnegativeInteger(throughput.rejected),
        corrected,
        emergencyOverrides:
          throughput === null ? null : nonnegativeInteger(throughput.emergencyOverrides),
        correctionRatePercent:
          decided === null || corrected === null ? null : roundedPercent(corrected, decided),
      },
    });
  }

  async reviewBacklog(rawQuery: unknown): Promise<PlatformReviewBacklogResponse> {
    const asOf = new Date(this.now());
    const query = platformReviewBacklogQuerySchema.parse(rawQuery);
    const { range, window } = resolveRange(query, asOf);
    const limit = limitOf(query.limit);
    const order = query.order ?? "ASC";
    const cursor = decodeTimeCursor(query.cursor);
    const sla = query.sla ?? "ALL";

    const [settled] = await Promise.allSettled([
      this.drilldown.queryReviewBacklog(range, {
        limit: limit + 1,
        cursorAt: cursor?.at ?? null,
        cursorId: cursor?.id ?? null,
        order,
        tenantId: query.tenantId ?? null,
        sla,
        targetType: query.targetType ?? null,
      }),
    ]);
    const generatedAt = new Date(this.now());
    const backlog = domainFromSettled(settled, generatedAt);
    const problems = problemsFor([["REVIEWS", backlog]]);
    const rows = backlog.available ? backlog.data : [];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const dueSoonBefore = asOf.getTime() + DAY_MS;

    return platformReviewBacklogResponseSchema.parse({
      schemaVersion: "platform-review-backlog.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: asOf.toISOString(),
      window,
      freshness: backlog.freshness,
      partial: problems.length > 0,
      problems,
      filters: { tenantId: query.tenantId ?? null, sla, targetType: query.targetType ?? null },
      page: {
        limit,
        hasMore,
        nextCursor:
          hasMore && page.at(-1) !== undefined
            ? encodeKeysetCursor({
                at: page.at(-1)!.createdAt.toISOString(),
                id: page.at(-1)!.reviewTaskId,
              })
            : null,
        sort: "CREATED_AT",
        order,
      },
      items: page
        .map((row) => {
          const id = safeIdentifier(row.reviewTaskId);
          const tenantId = safeIdentifier(row.tenantId);
          const projectId = safeIdentifier(row.projectId);
          if (id === null || tenantId === null || projectId === null) return null;
          const due = row.dueAt;
          return {
            reviewTaskId: id,
            tenantId,
            tenantName: safeTenantDisplayName(row.tenantName, tenantId),
            projectId,
            targetType: row.targetType.trim().slice(0, 60) || "UNKNOWN",
            targetVersion: nonnegativeInteger(row.targetVersion),
            assignedRole: row.assignedRole.trim().slice(0, 60) || "UNKNOWN",
            assigned: row.assignedUserId !== null,
            status: row.status.trim().slice(0, 60) || "UNKNOWN",
            createdAt: row.createdAt.toISOString(),
            dueAt: iso(due),
            waitingSeconds: Math.max(
              0,
              Math.floor((asOf.getTime() - row.createdAt.getTime()) / 1_000),
            ),
            sla:
              due === null
                ? ("NO_DUE_DATE" as const)
                : due.getTime() < asOf.getTime()
                  ? ("BREACHED" as const)
                  : due.getTime() < dueSoonBefore
                    ? ("DUE_SOON" as const)
                    : ("ON_TRACK" as const),
            tenantHref: `/platform/tenants/${encodeURIComponent(tenantId)}/health`,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    });
  }

  async usage(rawQuery: unknown): Promise<PlatformUsageResponse> {
    const asOf = new Date(this.now());
    const query = platformUsageQuerySchema.parse(rawQuery);
    const { range, window } = resolveRange(query, asOf);
    const groupBy = query.groupBy ?? "TENANT";

    const [settled] = await Promise.allSettled([
      this.drilldown.queryUsage(range, {
        tenantId: query.tenantId ?? null,
        agentType: query.agentType ?? null,
        groupBy,
      }),
    ]);
    const generatedAt = new Date(this.now());
    const usage = domainFromSettled(settled, generatedAt);
    const problems = problemsFor([["USAGE", usage]]);
    const appliedFilters: ("TENANT_ID" | "AGENT_TYPE")[] = [];
    if (query.tenantId !== undefined) appliedFilters.push("TENANT_ID");
    if (query.agentType !== undefined) appliedFilters.push("AGENT_TYPE");
    const context = sectionContext(usage, appliedFilters);
    const rows = usage.available ? usage.data : [];
    const totalCost = rows.reduce((sum, row) => sum + nonnegativeInteger(row.costMicroUsd), 0);
    const totalActualRuns = rows.reduce(
      (sum, row) => sum + nonnegativeInteger(row.actualRunCount),
      0,
    );
    const totalRuns = rows.reduce((sum, row) => sum + nonnegativeInteger(row.runs), 0);

    return platformUsageResponseSchema.parse({
      schemaVersion: "platform-usage.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: asOf.toISOString(),
      window,
      freshness: usage.freshness,
      partial: problems.length > 0,
      problems,
      filters: {
        tenantId: query.tenantId ?? null,
        agentType: query.agentType ?? null,
        groupBy,
      },
      totals: {
        context,
        runs: usage.available ? totalRuns : null,
        costMicroUsd: usage.available ? totalCost : null,
        actualMicroUsd: usage.available
          ? rows.reduce((sum, row) => sum + nonnegativeInteger(row.actualMicroUsd), 0)
          : null,
        estimatedMicroUsd: usage.available
          ? rows.reduce((sum, row) => sum + nonnegativeInteger(row.estimatedMicroUsd), 0)
          : null,
        actualCoveragePercent: usage.available ? roundedPercent(totalActualRuns, totalRuns) : null,
        inputTokens: usage.available
          ? rows.reduce((sum, row) => sum + nonnegativeInteger(row.inputTokens), 0)
          : null,
        outputTokens: usage.available
          ? rows.reduce((sum, row) => sum + nonnegativeInteger(row.outputTokens), 0)
          : null,
        cachedInputTokens: usage.available
          ? rows.reduce((sum, row) => sum + nonnegativeInteger(row.cachedInputTokens), 0)
          : null,
        reasoningTokens: usage.available
          ? rows.reduce((sum, row) => sum + nonnegativeInteger(row.reasoningTokens), 0)
          : null,
        budgetModel: "NOT_CONFIGURED",
      },
      groups: {
        context,
        total: rows.length,
        truncated: rows.length >= 50,
        items: rows.map((row) => {
          const runCount = nonnegativeInteger(row.runs);
          const actualRuns = nonnegativeInteger(row.actualRunCount);
          const key = row.key.trim().slice(0, 200) || "UNKNOWN";
          return {
            key,
            label: row.label.trim().slice(0, 200) || key,
            href:
              groupBy === "TENANT" && safeIdentifier(key) !== null
                ? `/platform/tenants/${encodeURIComponent(key)}/health`
                : groupBy === "AGENT_TYPE"
                  ? `/platform/agents/${encodeURIComponent(key)}`
                  : null,
            runs: runCount,
            costMicroUsd: nonnegativeInteger(row.costMicroUsd),
            actualMicroUsd: nonnegativeInteger(row.actualMicroUsd),
            estimatedMicroUsd: nonnegativeInteger(row.estimatedMicroUsd),
            actualRunCount: actualRuns,
            estimatedRunCount: nonnegativeInteger(row.estimatedRunCount),
            actualCoveragePercent: roundedPercent(actualRuns, runCount),
            inputTokens: nonnegativeInteger(row.inputTokens),
            outputTokens: nonnegativeInteger(row.outputTokens),
            cachedInputTokens: nonnegativeInteger(row.cachedInputTokens),
            reasoningTokens: nonnegativeInteger(row.reasoningTokens),
            costSharePercent: roundedPercent(nonnegativeInteger(row.costMicroUsd), totalCost),
          };
        }),
      },
    });
  }

  async systemHealth(rawQuery: unknown): Promise<PlatformSystemHealthResponse> {
    const asOf = new Date(this.now());
    const query = platformSystemHealthQuerySchema.parse(rawQuery);
    const tenantId = query.tenantId ?? null;
    const range: PlatformDrilldownRange = {
      asOf,
      from: new Date(asOf.getTime() - DAY_MS),
      to: asOf,
      stuckBefore: new Date(asOf.getTime() - 30 * 60_000),
      rolling15From: new Date(asOf.getTime() - 15 * 60_000),
      monthStart: utcMonthStart(asOf),
    };

    const overviewInput = {
      asOf,
      selectedFrom: range.from,
      selectedTo: range.to,
      previousFrom: range.from,
      monthStart: range.monthStart,
      previousMonthStart: range.monthStart,
      previousMonthComparableTo: range.monthStart,
      rolling15From: range.rolling15From,
      stuckBefore: range.stuckBefore,
      scanFrom: range.from,
      tenantId,
      agentType: null,
    };
    const settled = await Promise.allSettled([
      this.overview.querySystemAggregates(overviewInput),
      this.overview.probePostgres(),
      this.drilldown.querySystemDetail(range, tenantId),
      this.overview.queryAgentMetrics(overviewInput),
    ] as const);
    const generatedAt = new Date(this.now());
    const aggregates = domainFromSettled(settled[0], generatedAt);
    const postgres = domainFromSettled(settled[1], generatedAt, "LIVE_PROBE");
    const detail = domainFromSettled(settled[2], generatedAt);
    const agents = domainFromSettled(settled[3], generatedAt);
    const problems = problemsFor([
      ["SYSTEM", aggregates],
      ["SYSTEM", postgres],
      ["SYSTEM", detail],
      ["SYSTEM", agents],
    ]);
    const appliedFilters = (tenantId === null ? [] : ["TENANT_ID"]) as (
      "TENANT_ID" | "AGENT_TYPE"
    )[];

    const scoped = (kind: "OUTBOX" | "NOTIFICATION" | "FILE") => {
      if (!aggregates.available) return null;
      return (
        aggregates.data.find((row) =>
          tenantId === null
            ? row.scopeKind === "GLOBAL" && row.kind === kind
            : row.scopeKind === "TENANT" && row.tenantId === tenantId && row.kind === kind,
        ) ?? null
      );
    };

    const components: PlatformOverviewSystemComponent[] = [
      {
        component: "API",
        state: "HEALTHY",
        required: true,
        summary: "The authenticated API request is live.",
        metrics: [],
        freshness: freshFreshness(generatedAt, "LIVE_PROBE"),
        diagnosticsHref: "/platform/system-health?component=API",
      },
      postgres.available
        ? {
            component: "POSTGRES",
            state: "HEALTHY",
            required: true,
            summary: "PostgreSQL responded to the live probe.",
            metrics: [
              { key: "postgres_latency_ms", value: postgres.data.latencyMs, unit: "milliseconds" },
            ],
            freshness: postgres.freshness,
            diagnosticsHref: "/platform/system-health?component=POSTGRES",
          }
        : {
            component: "POSTGRES",
            state: postgres.stale ? "UNKNOWN" : "DOWN",
            required: true,
            summary: postgres.stale
              ? "PostgreSQL probe data is stale."
              : "PostgreSQL did not respond to the live probe.",
            metrics: [],
            freshness: postgres.freshness,
            diagnosticsHref: "/platform/system-health?component=POSTGRES",
          },
    ];
    for (const [component, kind, required] of [
      ["OUTBOX", "OUTBOX", true],
      ["ARTIFACT_METADATA", "FILE", true],
      ["NOTIFICATION", "NOTIFICATION", false],
    ] as const) {
      const row = scoped(kind);
      if (row === null) {
        components.push({
          component,
          state: "UNKNOWN",
          required,
          summary: `${component.replace("_", " ")} aggregate is unavailable.`,
          metrics: [],
          freshness: aggregates.freshness,
          diagnosticsHref: `/platform/system-health?component=${component}`,
        });
        continue;
      }
      components.push(
        deliveryComponent({
          component,
          required,
          pending: nonnegativeInteger(row.pendingCount),
          stalled: nonnegativeInteger(row.stalledCount),
          failed: nonnegativeInteger(row.failedCount),
          deadLetter: nonnegativeInteger(row.deadLetterCount),
          quarantined: nonnegativeInteger(row.quarantinedCount),
          freshness: aggregates.freshness,
          tenantId,
        }),
      );
    }

    // This is deliberately UNKNOWN when the recent run taxonomy contains no
    // provider evidence: absence of a direct provider probe must never be
    // presented as healthy. Keeping the component in this detail response also
    // makes the overview's AI_PROVIDER diagnostics link land on real evidence.
    const globalAgentRow = agents.available
      ? (agents.data.aggregates.find((row) => row.scopeKind === "GLOBAL") ?? null)
      : null;
    const providerFailures =
      globalAgentRow === null ? null : nonnegativeInteger(globalAgentRow.rollingProviderFailures);
    components.push({
      component: "AI_PROVIDER",
      state: providerFailures !== null && providerFailures > 0 ? "DEGRADED" : "UNKNOWN",
      required: false,
      summary:
        providerFailures !== null && providerFailures > 0
          ? "Canonical provider failures were observed in the last 15 minutes."
          : "No direct AI provider probe is available.",
      metrics:
        providerFailures === null
          ? []
          : [{ key: "canonical_provider_failures_15m", value: providerFailures, unit: "runs" }],
      freshness: agents.freshness,
      diagnosticsHref: "/platform/system-health?component=AI_PROVIDER",
    });

    const down = components.some((item) => item.state === "DOWN");
    const degraded = components.some((item) => item.state === "DEGRADED");
    const unknown = components.some((item) => item.required && item.state === "UNKNOWN");

    return platformSystemHealthResponseSchema.parse({
      schemaVersion: "platform-system-health.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: asOf.toISOString(),
      window: snapshotWindow(asOf),
      freshness: postgres.available ? postgres.freshness : unknownFreshness(generatedAt),
      partial: problems.length > 0,
      problems,
      filters: { tenantId },
      state: down ? "CRITICAL" : degraded ? "DEGRADED" : unknown ? "UNKNOWN" : "HEALTHY",
      components,
      outboxByType: {
        context: sectionContext(detail, appliedFilters),
        items: detail.available
          ? detail.data.outboxByType.map((row) => ({
              eventType: row.eventType.trim().slice(0, 120) || "UNKNOWN",
              pending: nonnegativeInteger(row.pending),
              stalled: nonnegativeInteger(row.stalled),
              failed: nonnegativeInteger(row.failed),
              deadLetter: nonnegativeInteger(row.deadLetter),
              oldestEvidenceAt: iso(row.oldestEvidenceAt),
            }))
          : [],
      },
      tenantImpact: {
        context: sectionContext(detail, appliedFilters),
        items: detail.available
          ? detail.data.tenantImpact
              .map((row) => {
                const id = safeIdentifier(row.tenantId);
                return id === null
                  ? null
                  : {
                      tenantId: id,
                      tenantName: safeTenantDisplayName(row.tenantName, id),
                      outboxStalled: nonnegativeInteger(row.outboxStalled),
                      outboxDeadLetter: nonnegativeInteger(row.outboxDeadLetter),
                      notificationFailed: nonnegativeInteger(row.notificationFailed),
                      artifactQuarantined: nonnegativeInteger(row.artifactQuarantined),
                      healthHref: `/platform/tenants/${encodeURIComponent(id)}/health`,
                    };
              })
              .filter((item): item is NonNullable<typeof item> => item !== null)
          : [],
      },
    });
  }

  async auditLogs(rawQuery: unknown): Promise<PlatformAuditLogResponse> {
    const asOf = new Date(this.now());
    const query = platformAuditLogQuerySchema.parse(rawQuery);
    const { range, window } = resolveRange(query, asOf);
    const limit = limitOf(query.limit);
    const order = query.order ?? "DESC";
    const cursor = decodeTimeCursor(query.cursor);

    const [settled] = await Promise.allSettled([
      this.drilldown.queryAuditLogs(range, {
        limit: limit + 1,
        cursorAt: cursor?.at ?? null,
        cursorId: cursor?.id ?? null,
        order,
        tenantId: query.tenantId ?? null,
        actorId: query.actorId ?? null,
        source: query.source ?? "ALL",
        actorRole: query.actorRole ?? null,
        action: query.action ?? null,
        result: query.result ?? null,
      }),
    ]);
    const generatedAt = new Date(this.now());
    const audit = domainFromSettled(settled, generatedAt);
    const problems = problemsFor([["AUDIT", audit]]);
    const rows = audit.available ? audit.data : [];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);

    return platformAuditLogResponseSchema.parse({
      schemaVersion: "platform-audit-logs.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: asOf.toISOString(),
      window,
      freshness: audit.freshness,
      partial: problems.length > 0,
      problems,
      filters: {
        tenantId: query.tenantId ?? null,
        actorId: query.actorId ?? null,
        source: query.source ?? "ALL",
        actorRole: query.actorRole ?? null,
        action: query.action ?? null,
        result: query.result ?? null,
      },
      page: {
        limit,
        hasMore,
        nextCursor:
          hasMore && last !== undefined
            ? encodeKeysetCursor({ at: last.occurredAt.toISOString(), id: last.id })
            : null,
        sort: "OCCURRED_AT",
        order,
      },
      items: page
        .filter(
          (row) => safeIdentifier(row.id) !== null && safeIdentifier(row.correlationId) !== null,
        )
        .map((row) => ({
          id: row.id,
          actorId: safeIdentifier(row.actorPrincipalId),
          actorDisplayName:
            row.actorDisplayName === null
              ? null
              : row.actorDisplayName.trim().slice(0, 200) || null,
          actorRole: row.actorRole === null ? null : row.actorRole.trim().slice(0, 100) || null,
          action: row.action.trim().slice(0, 200) || "UNKNOWN_ACTION",
          tenantId: safeIdentifier(row.tenantId),
          resourceType: row.entityType.trim().slice(0, 100) || "PLATFORM_RESOURCE",
          resourceId: safeIdentifier(row.entityId),
          result: row.result,
          reason: redactedAuditReason(row.reason),
          correlationId: row.correlationId,
          beforeHash: /^[a-f0-9]{64}$/.test(row.beforeHash ?? "") ? row.beforeHash : null,
          afterHash: /^[a-f0-9]{64}$/.test(row.afterHash ?? "") ? row.afterHash : null,
          occurredAt: row.occurredAt.toISOString(),
        })),
    });
  }
}

/**
 * Descending text sort inside a lexicographic cursor: invert each code unit so
 * "z" ranks before "a" without needing a separate comparator per direction.
 */
function invertText(value: string): string {
  return Array.from(value.slice(0, 120))
    .map((character) => String.fromCharCode(0xffff - character.charCodeAt(0)))
    .join("");
}
