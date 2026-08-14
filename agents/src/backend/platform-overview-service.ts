import { Phase9ApiError } from "./contracts.js";
import {
  platformOverviewQuerySchema,
  platformOverviewResponseSchema,
  type PlatformOverviewAgentItem,
  type PlatformOverviewAttentionItem,
  type PlatformOverviewCause,
  type PlatformOverviewFreshness,
  type PlatformOverviewQuery,
  type PlatformOverviewResponse,
  type PlatformOverviewTenantItem,
  type PlatformOverviewWindow,
} from "./platform-overview-contracts.js";
import type {
  PlatformAgentAggregateRow,
  PlatformAgentMetricsData,
  PlatformAuditScalarRow,
  PlatformOverviewReadInput,
  PlatformOverviewReadModel,
  PlatformReviewAggregateRow,
  PlatformStuckAggregateRow,
  PlatformSystemAggregateRow,
} from "./platform-overview-read-model.js";
import { platformOverviewSignalId } from "./platform-overview-signals.js";
import {
  combinedFreshness,
  DAY_MS,
  domainFromSettled,
  FRESHNESS_STALE_AFTER_SECONDS,
  iso,
  MIN_AGENT_SAMPLE,
  nonnegativeInteger,
  previousUtcMonthStart,
  roundedPercent,
  safeAgentType,
  safeIdentifier,
  safeTenantDisplayName,
  scope,
  selectedWindow,
  unavailableComparison,
  unknownFreshness,
  utcMonthStart,
} from "./platform-read-support.js";

const RULE_SET_VERSION = "platform-overview-rules.v1" as const;

/** Cost anomaly thresholds: deliberately conservative to stay actionable. */
const COST_ANOMALY_MULTIPLIER = 2;
const COST_ANOMALY_MIN_BASELINE_MICRO_USD = 1_000_000;
const COST_ANOMALY_MIN_SAMPLE = 20;

type AppliedFilter = "TENANT_ID" | "AGENT_TYPE";
type ProblemSection = "TENANTS" | "AGENTS" | "REVIEWS" | "USAGE" | "SYSTEM" | "AUDIT";
type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface PlatformOverviewSignalSnapshot {
  signals: PlatformOverviewAttentionItem[];
  sourcesComplete: boolean;
  asOf: string;
}

interface PlatformOverviewCollection extends PlatformOverviewSignalSnapshot {
  response: PlatformOverviewResponse;
}

interface ResolvedOverviewQuery {
  input: PlatformOverviewReadInput;
  window: PlatformOverviewWindow;
  previousWindow: PlatformOverviewWindow;
  monthToDateWindow: PlatformOverviewWindow;
  previousMonthWindow: PlatformOverviewWindow;
  query: PlatformOverviewQuery;
}

function resolveQuery(input: unknown, asOf: Date): ResolvedOverviewQuery {
  const query = platformOverviewQuerySchema.parse(input);
  const hasPreset = query.window !== undefined;
  const hasFrom = query.from !== undefined;
  const hasTo = query.to !== undefined;
  if ((hasFrom && !hasTo) || (!hasFrom && hasTo) || (hasPreset && (hasFrom || hasTo))) {
    throw new Phase9ApiError(
      "VALIDATION_FAILED",
      400,
      "Use either a preset window or both from and to",
    );
  }

  let from: Date;
  let to: Date;
  if (hasFrom && hasTo) {
    from = new Date(query.from!);
    to = new Date(query.to!);
  } else {
    const duration =
      query.window === "30d" ? 30 * DAY_MS : query.window === "7d" ? 7 * DAY_MS : DAY_MS;
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
      "Overview range must be half-open, no longer than 90 days, and end at or before asOf",
    );
  }

  const duration = to.getTime() - from.getTime();
  const previousFrom = new Date(from.getTime() - duration);
  const monthStart = utcMonthStart(asOf);
  const previousMonthStart = previousUtcMonthStart(asOf);
  const previousMonthComparableTo = new Date(
    Math.min(
      monthStart.getTime(),
      previousMonthStart.getTime() + (asOf.getTime() - monthStart.getTime()),
    ),
  );
  const rolling15From = new Date(asOf.getTime() - 15 * 60_000);
  const stuckBefore = new Date(asOf.getTime() - 30 * 60_000);
  const scanFrom = new Date(
    Math.min(
      previousFrom.getTime(),
      monthStart.getTime(),
      previousMonthStart.getTime(),
      rolling15From.getTime(),
    ),
  );

  return {
    query,
    window: selectedWindow(from, to),
    previousWindow: {
      kind: "PREVIOUS_RANGE",
      from: previousFrom.toISOString(),
      to: from.toISOString(),
      timeZone: "UTC",
    },
    monthToDateWindow: {
      kind: "MONTH_TO_DATE",
      from: monthStart.toISOString(),
      to: asOf.toISOString(),
      timeZone: "UTC",
    },
    previousMonthWindow: {
      kind: "PREVIOUS_MONTH_COMPARABLE",
      from: previousMonthStart.toISOString(),
      to: previousMonthComparableTo.toISOString(),
      timeZone: "UTC",
    },
    input: {
      asOf,
      selectedFrom: from,
      selectedTo: to,
      previousFrom,
      monthStart,
      previousMonthStart,
      previousMonthComparableTo,
      rolling15From,
      stuckBefore,
      scanFrom,
      tenantId: query.tenantId ?? null,
      agentType: query.agentType ?? null,
    },
  };
}

function filters(query: PlatformOverviewQuery, includeAgent = true): AppliedFilter[] {
  const result: AppliedFilter[] = [];
  if (query.tenantId !== undefined) result.push("TENANT_ID");
  if (includeAgent && query.agentType !== undefined) result.push("AGENT_TYPE");
  return result;
}

function causeFromSignal(signal: PlatformOverviewAttentionItem): PlatformOverviewCause {
  return {
    causeId: signal.signalId,
    severity: signal.severity,
    title: signal.title,
    scope: signal.scope,
    diagnosticsHref: signal.diagnosticsHref,
    evidenceAt: signal.firstEvidenceAt,
  };
}

function makeSignal(input: {
  ruleKey: string;
  severity: Severity;
  title: string;
  impact: string;
  scope: ReturnType<typeof scope>;
  firstEvidenceAt: Date | null;
  observedAt: Date;
  metricKey: string;
  value: number | string | boolean;
  unit: string;
  recommendedAction: string;
  diagnosticsHref: string;
  freshness: PlatformOverviewFreshness;
}): PlatformOverviewAttentionItem {
  const id = platformOverviewSignalId(input.ruleKey, input.scope);
  return {
    signalId: id,
    incidentId: null,
    ruleKey: input.ruleKey,
    ruleVersion: RULE_SET_VERSION,
    severity: input.severity,
    state: "OPEN",
    title: input.title,
    impact: input.impact,
    scope: input.scope,
    firstEvidenceAt: iso(input.firstEvidenceAt),
    lastEvidenceAt: input.observedAt.toISOString(),
    evidence: [
      {
        metricKey: input.metricKey,
        value: input.value,
        unit: input.unit,
        observedAt: input.observedAt.toISOString(),
      },
    ],
    recommendedAction: input.recommendedAction,
    diagnosticsHref: input.diagnosticsHref,
    freshness: input.freshness,
  };
}

const severityOrder: Readonly<Record<Severity, number>> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

function sortSignals(signals: PlatformOverviewAttentionItem[]) {
  return signals.sort((left, right) => {
    const severity = severityOrder[left.severity] - severityOrder[right.severity];
    if (severity !== 0) return severity;
    const leftAt =
      left.firstEvidenceAt === null ? Number.MAX_SAFE_INTEGER : Date.parse(left.firstEvidenceAt);
    const rightAt =
      right.firstEvidenceAt === null ? Number.MAX_SAFE_INTEGER : Date.parse(right.firstEvidenceAt);
    return leftAt - rightAt || left.signalId.localeCompare(right.signalId);
  });
}

function globalAgent(data: PlatformAgentMetricsData): PlatformAgentAggregateRow | null {
  return data.aggregates.find((row) => row.scopeKind === "GLOBAL") ?? null;
}

function globalReview(rows: PlatformReviewAggregateRow[]): PlatformReviewAggregateRow | null {
  return rows.find((row) => row.scopeKind === "GLOBAL") ?? null;
}

function globalSystem(
  rows: PlatformSystemAggregateRow[],
  kind: PlatformSystemAggregateRow["kind"],
): PlatformSystemAggregateRow | null {
  return rows.find((row) => row.scopeKind === "GLOBAL" && row.kind === kind) ?? null;
}

function auditItems(rows: PlatformAuditScalarRow[]) {
  return rows
    .filter((row) => safeIdentifier(row.id) !== null && safeIdentifier(row.correlationId) !== null)
    .slice(0, 5)
    .map((row) => ({
      id: row.id,
      actorId: safeIdentifier(row.actorPrincipalId),
      actorDisplayName:
        row.actorDisplayName === null ? null : row.actorDisplayName.trim().slice(0, 200) || null,
      actorRole: row.actorRole === null ? null : row.actorRole.trim().slice(0, 100) || null,
      action: row.action.trim().slice(0, 200) || "UNKNOWN_ACTION",
      tenantId: safeIdentifier(row.tenantId),
      resourceType: row.entityType.trim().slice(0, 100) || "PLATFORM_RESOURCE",
      resourceId: safeIdentifier(row.entityId),
      occurredAt: row.occurredAt.toISOString(),
      result: row.result,
      correlationId: row.correlationId,
      detailHref: `/platform/audit?auditId=${encodeURIComponent(row.id)}`,
    }));
}

function problem(section: ProblemSection, stale: boolean) {
  const labels: Readonly<Record<ProblemSection, string>> = {
    TENANTS: "Tenant health data is temporarily unavailable.",
    AGENTS: "Agent metrics are temporarily unavailable.",
    REVIEWS: "Review SLA data is temporarily unavailable.",
    USAGE: "Usage data is temporarily unavailable.",
    SYSTEM: "System health data is temporarily unavailable.",
    AUDIT: "Recent audit data is temporarily unavailable.",
  };
  return {
    section,
    code: stale ? ("SOURCE_STALE" as const) : ("SOURCE_UNAVAILABLE" as const),
    message: labels[section],
    retryable: true,
  };
}

/**
 * Resolves persisted incidents for the signals the overview just derived, so
 * the Control Tower can link straight to an incident instead of re-deriving it.
 */
export interface PlatformOverviewIncidentLookup {
  statesBySignalIds(
    signalIds: readonly string[],
  ): Promise<Map<string, { incidentId: string; state: string }>>;
}

export class PlatformOverviewService {
  constructor(
    private readonly readModel: PlatformOverviewReadModel,
    private readonly now: () => Date = () => new Date(),
    private readonly incidentLookup?: PlatformOverviewIncidentLookup,
  ) {}

  async overview(rawQuery: unknown): Promise<PlatformOverviewResponse> {
    return (await this.collect(rawQuery)).response;
  }

  /**
   * The untruncated signal set behind `attention`, for the Phase 6 alert
   * evaluator. `sourcesComplete` is false whenever any read failed or was
   * stale, so the evaluator can refuse to auto-resolve during an outage.
   */
  async evaluateSignals(rawQuery: unknown): Promise<PlatformOverviewSignalSnapshot> {
    const { signals, sourcesComplete, asOf } = await this.collect(rawQuery);
    return { signals, sourcesComplete, asOf };
  }

  private async collect(rawQuery: unknown): Promise<PlatformOverviewCollection> {
    const asOf = new Date(this.now());
    const resolved = resolveQuery(rawQuery, asOf);
    const settled = await Promise.allSettled([
      this.readModel.queryAgentMetrics(resolved.input),
      this.readModel.queryReviewMetrics(resolved.input),
      this.readModel.queryTenantBase(resolved.input),
      this.readModel.querySystemAggregates(resolved.input),
      this.readModel.probePostgres(),
      this.readModel.queryRecentAudit(resolved.input),
    ] as const);
    const generatedAt = new Date(this.now());
    const agents = domainFromSettled(settled[0], generatedAt);
    const reviews = domainFromSettled(settled[1], generatedAt);
    const tenants = domainFromSettled(settled[2], generatedAt);
    const system = domainFromSettled(settled[3], generatedAt);
    const postgres = domainFromSettled(settled[4], generatedAt, "LIVE_PROBE");
    const audit = domainFromSettled(settled[5], generatedAt);

    const problems = [] as ReturnType<typeof problem>[];
    if (!agents.available) {
      problems.push(problem("AGENTS", agents.stale));
      problems.push(problem("USAGE", agents.stale));
    }
    if (!reviews.available) problems.push(problem("REVIEWS", reviews.stale));
    if (!tenants.available) problems.push(problem("TENANTS", tenants.stale));
    if (!system.available || !postgres.available) {
      const allUnavailableSourcesAreStale =
        (system.available || system.stale) && (postgres.available || postgres.stale);
      problems.push(problem("SYSTEM", allUnavailableSourcesAreStale));
    }
    if (!audit.available) problems.push(problem("AUDIT", audit.stale));

    const tenantNames = new Map<string, string>();
    if (tenants.available) {
      for (const tenant of tenants.data) {
        tenantNames.set(tenant.tenantId, safeTenantDisplayName(tenant.name, tenant.tenantId));
      }
    }

    const signals: PlatformOverviewAttentionItem[] = [];
    if (agents.available) {
      for (const row of agents.data.aggregates.filter(
        (candidate) => candidate.scopeKind === "AGENT",
      )) {
        const terminal = nonnegativeInteger(row.rollingTerminal);
        const nonCompletion = nonnegativeInteger(row.rollingNonCompletion);
        const agentType = safeAgentType(row.agentType);
        if (agentType !== null && terminal >= MIN_AGENT_SAMPLE && nonCompletion / terminal > 0.05) {
          const signalScope = scope({
            tenantId: resolved.input.tenantId,
            tenantName:
              resolved.input.tenantId === null
                ? null
                : (tenantNames.get(resolved.input.tenantId) ?? null),
            agentType,
          });
          signals.push(
            makeSignal({
              ruleKey: "AGENT_HIGH_FAILURE_RATE",
              severity: "HIGH",
              title: "Agent non-completion rate is high",
              impact: "Recent terminal agent runs exceed the allowed non-completion threshold.",
              scope: signalScope,
              firstEvidenceAt: row.oldestRollingFailureAt,
              observedAt: asOf,
              metricKey: "agent_noncompletion_percent_15m",
              value: roundedPercent(nonCompletion, terminal) ?? 0,
              unit: "percent",
              recommendedAction: "Inspect recent run diagnostics and provider/tool failures.",
              diagnosticsHref: `/platform/agents/${encodeURIComponent(agentType)}`,
              freshness: agents.freshness,
            }),
          );
        }
      }
      for (const row of agents.data.stuck.filter((candidate) => candidate.scopeKind === "AGENT")) {
        const stuck = nonnegativeInteger(row.stuck);
        const agentType = safeAgentType(row.agentType);
        if (agentType === null || stuck === 0) continue;
        const signalScope = scope({
          tenantId: resolved.input.tenantId,
          tenantName:
            resolved.input.tenantId === null
              ? null
              : (tenantNames.get(resolved.input.tenantId) ?? null),
          agentType,
        });
        signals.push(
          makeSignal({
            ruleKey: "AGENT_RUN_STUCK_30M",
            severity: "HIGH",
            title: "Agent runs are stuck",
            impact: "One or more agent runs have remained RUNNING for at least 30 minutes.",
            scope: signalScope,
            firstEvidenceAt: row.oldestStuckAt,
            observedAt: asOf,
            metricKey: "stuck_agent_runs",
            value: stuck,
            unit: "runs",
            recommendedAction: "Inspect the stuck runs before retrying or changing agent state.",
            diagnosticsHref: `/platform/agent-runs?stuck=true&agentType=${encodeURIComponent(agentType)}`,
            freshness: agents.freshness,
          }),
        );
      }
    }

    if (reviews.available) {
      for (const row of reviews.data.filter((candidate) => candidate.scopeKind === "TENANT")) {
        const breached = nonnegativeInteger(row.breached);
        if (row.tenantId === null || breached === 0) continue;
        signals.push(
          makeSignal({
            ruleKey: "REVIEW_SLA_BREACH",
            severity: "HIGH",
            title: "Review SLA is breached",
            impact: "Human review tasks are waiting beyond their due time.",
            scope: scope({
              tenantId: row.tenantId,
              tenantName: tenantNames.get(row.tenantId) ?? null,
            }),
            firstEvidenceAt: row.oldestBreachedDueAt,
            observedAt: asOf,
            metricKey: "review_sla_breached",
            value: breached,
            unit: "tasks",
            recommendedAction: "Ask the tenant review owner to triage overdue tasks.",
            diagnosticsHref: `/platform/review-quality?view=backlog&sla=BREACHED&tenantId=${encodeURIComponent(row.tenantId)}`,
            freshness: reviews.freshness,
          }),
        );
      }
    }

    if (system.available) {
      for (const row of system.data.filter(
        (candidate) =>
          candidate.scopeKind === "TENANT" &&
          (resolved.input.tenantId === null || candidate.tenantId === resolved.input.tenantId),
      )) {
        if (row.tenantId === null) continue;
        const tenantScope = scope({
          tenantId: row.tenantId,
          tenantName: tenantNames.get(row.tenantId) ?? null,
          component: row.kind === "FILE" ? "ARTIFACT_METADATA" : row.kind,
        });
        const deadLetter = nonnegativeInteger(row.deadLetterCount);
        const stalled = nonnegativeInteger(row.stalledCount);
        const failed = nonnegativeInteger(row.failedCount);
        const quarantined = nonnegativeInteger(row.quarantinedCount);
        if (row.kind === "OUTBOX" && deadLetter > 0) {
          signals.push(
            makeSignal({
              ruleKey: "OUTBOX_DEAD_LETTER",
              severity: "HIGH",
              title: "Outbox events reached dead letter",
              impact: "One or more durable events could not be delivered.",
              scope: tenantScope,
              firstEvidenceAt: row.oldestEvidenceAt,
              observedAt: asOf,
              metricKey: "outbox_dead_letter",
              value: deadLetter,
              unit: "events",
              recommendedAction:
                "Inspect delivery infrastructure and replay only after the cause is fixed.",
              diagnosticsHref: `/platform/system-health?component=OUTBOX&tenantId=${encodeURIComponent(row.tenantId)}`,
              freshness: system.freshness,
            }),
          );
        }
        if (row.kind === "OUTBOX" && stalled > 0) {
          signals.push(
            makeSignal({
              ruleKey: "OUTBOX_STALLED_10M",
              severity: "HIGH",
              title: "Eligible outbox events are stalled",
              impact:
                "Events available for delivery have remained pending for more than 10 minutes.",
              scope: tenantScope,
              firstEvidenceAt: row.oldestEvidenceAt,
              observedAt: asOf,
              metricKey: "outbox_stalled",
              value: stalled,
              unit: "events",
              recommendedAction: "Check the outbox worker and delivery queue health.",
              diagnosticsHref: `/platform/system-health?component=OUTBOX&tenantId=${encodeURIComponent(row.tenantId)}`,
              freshness: system.freshness,
            }),
          );
        }
        if (row.kind === "NOTIFICATION" && stalled > 0) {
          signals.push(
            makeSignal({
              ruleKey: "NOTIFICATION_STALLED_10M",
              severity: "MEDIUM",
              title: "Notifications are stalled",
              impact: "Pending notifications have not been delivered for more than 10 minutes.",
              scope: tenantScope,
              firstEvidenceAt: row.oldestEvidenceAt,
              observedAt: asOf,
              metricKey: "notification_stalled",
              value: stalled,
              unit: "notifications",
              recommendedAction: "Inspect notification delivery and retry state.",
              diagnosticsHref: `/platform/system-health?component=NOTIFICATION&tenantId=${encodeURIComponent(row.tenantId)}`,
              freshness: system.freshness,
            }),
          );
        }
        if (row.kind === "NOTIFICATION" && failed > 0) {
          signals.push(
            makeSignal({
              ruleKey: "NOTIFICATION_FAILED",
              severity: "MEDIUM",
              title: "Notification delivery failed",
              impact: "One or more notifications reached a failed delivery state.",
              scope: tenantScope,
              firstEvidenceAt: row.oldestEvidenceAt,
              observedAt: asOf,
              metricKey: "notification_failed",
              value: failed,
              unit: "notifications",
              recommendedAction: "Inspect the notification provider response and retry policy.",
              diagnosticsHref: `/platform/system-health?component=NOTIFICATION&tenantId=${encodeURIComponent(row.tenantId)}`,
              freshness: system.freshness,
            }),
          );
        }
        if (row.kind === "FILE" && stalled > 0) {
          signals.push(
            makeSignal({
              ruleKey: "ARTIFACT_PENDING_15M",
              severity: "MEDIUM",
              title: "Artifact metadata is pending",
              impact: "File intake metadata has remained pending for more than 15 minutes.",
              scope: tenantScope,
              firstEvidenceAt: row.oldestEvidenceAt,
              observedAt: asOf,
              metricKey: "artifact_pending_stalled",
              value: stalled,
              unit: "files",
              recommendedAction: "Inspect artifact scanning and metadata processing.",
              diagnosticsHref: `/platform/system-health?component=ARTIFACT_METADATA&tenantId=${encodeURIComponent(row.tenantId)}`,
              freshness: system.freshness,
            }),
          );
        }
        if (row.kind === "FILE" && quarantined > 0) {
          signals.push(
            makeSignal({
              ruleKey: "ARTIFACT_QUARANTINED",
              severity: "MEDIUM",
              title: "Artifacts are quarantined",
              impact: "One or more uploaded artifacts are unavailable while quarantined.",
              scope: tenantScope,
              firstEvidenceAt: row.oldestEvidenceAt,
              observedAt: asOf,
              metricKey: "artifact_quarantined",
              value: quarantined,
              unit: "files",
              recommendedAction:
                "Review quarantine diagnostics before releasing or deleting artifacts.",
              diagnosticsHref: `/platform/system-health?component=ARTIFACT_METADATA&tenantId=${encodeURIComponent(row.tenantId)}`,
              freshness: system.freshness,
            }),
          );
        }
      }
    }

    // Phase 8 cost anomaly: a tenant's own trailing window is the baseline, so
    // a large tenant is not flagged merely for being large. A minimum baseline
    // spend and run count keep a jump from one cheap run out of the alert set.
    if (agents.available) {
      for (const row of agents.data.aggregates.filter(
        (candidate) => candidate.scopeKind === "TENANT",
      )) {
        if (row.tenantId === null) continue;
        const current = nonnegativeInteger(row.windowCostMicroUsd);
        const baseline = nonnegativeInteger(row.previousWindowCostMicroUsd);
        const runs = nonnegativeInteger(row.windowCostRunCount);
        const baselineRuns = nonnegativeInteger(row.previousWindowCostRunCount);
        if (
          baseline < COST_ANOMALY_MIN_BASELINE_MICRO_USD ||
          baselineRuns < COST_ANOMALY_MIN_SAMPLE ||
          runs < COST_ANOMALY_MIN_SAMPLE ||
          current <= baseline * COST_ANOMALY_MULTIPLIER
        ) {
          continue;
        }
        signals.push(
          makeSignal({
            ruleKey: "TENANT_COST_ANOMALY",
            severity: "MEDIUM",
            title: "Tenant AI spend rose sharply",
            impact:
              "Spend in this window is well above the same tenant's immediately preceding window.",
            scope: scope({
              tenantId: row.tenantId,
              tenantName: tenantNames.get(row.tenantId) ?? null,
            }),
            firstEvidenceAt: resolved.input.selectedFrom,
            observedAt: asOf,
            metricKey: "tenant_cost_increase_percent",
            value: roundedPercent(current - baseline, baseline) ?? 0,
            unit: "percent",
            recommendedAction:
              "Compare the tenant's recent runs and model mix before assuming a pricing fault.",
            diagnosticsHref: `/platform/usage?tenantId=${encodeURIComponent(row.tenantId)}`,
            freshness: agents.freshness,
          }),
        );
      }
    }

    if (tenants.available) {
      for (const tenant of tenants.data) {
        if (
          tenant.lastActivityAt !== null &&
          tenant.lastActivityAt.getTime() <= asOf.getTime() - 30 * DAY_MS
        ) {
          signals.push(
            makeSignal({
              ruleKey: "TENANT_INACTIVE_30D",
              severity: "LOW",
              title: "Tenant has been inactive for 30 days",
              impact: "No tracked platform activity has been observed for at least 30 days.",
              scope: scope({
                tenantId: tenant.tenantId,
                tenantName: safeTenantDisplayName(tenant.name, tenant.tenantId),
              }),
              firstEvidenceAt: tenant.lastActivityAt,
              observedAt: asOf,
              metricKey: "tenant_inactive_days",
              value: Math.floor((asOf.getTime() - tenant.lastActivityAt.getTime()) / DAY_MS),
              unit: "days",
              recommendedAction: "Confirm whether the tenant is intentionally inactive.",
              diagnosticsHref: `/platform/tenants/${encodeURIComponent(tenant.tenantId)}/health`,
              freshness: tenants.freshness,
            }),
          );
        }
      }
    }

    if (!postgres.available && !postgres.stale) {
      signals.push(
        makeSignal({
          ruleKey: "POSTGRES_UNAVAILABLE",
          severity: "CRITICAL",
          title: "PostgreSQL probe failed",
          impact: "The platform database probe could not confirm availability.",
          scope: scope({ component: "POSTGRES" }),
          firstEvidenceAt: asOf,
          observedAt: asOf,
          metricKey: "postgres_available",
          value: false,
          unit: "boolean",
          recommendedAction: "Check database connectivity and failover before other diagnostics.",
          diagnosticsHref: "/platform/system-health?component=POSTGRES",
          freshness: unknownFreshness(generatedAt, "LIVE_PROBE"),
        }),
      );
    }

    sortSignals(signals);
    // Linking is best-effort: a lookup failure must not degrade the overview,
    // it only means the operator navigates by diagnostics href instead.
    if (this.incidentLookup !== undefined && signals.length > 0) {
      try {
        const linked = await this.incidentLookup.statesBySignalIds(
          signals.map((signal) => signal.signalId),
        );
        for (const signal of signals) {
          const incident = linked.get(signal.signalId);
          if (incident === undefined) continue;
          signal.incidentId = incident.incidentId;
          if (incident.state === "ACKNOWLEDGED" || incident.state === "REOPENED") {
            signal.state = incident.state;
          }
        }
      } catch {
        // Intentionally ignored: incidentId simply stays null.
      }
    }
    const globalAgentRow = agents.available ? globalAgent(agents.data) : null;
    const globalReviewRow = reviews.available ? globalReview(reviews.data) : null;

    const agentKpi = (() => {
      if (!agents.available || globalAgentRow === null) {
        return {
          valuePercent: null,
          completed: null,
          terminal: null,
          failed: null,
          degraded: null,
          rejected: null,
          context: {
            state: "UNKNOWN" as const,
            window: resolved.window,
            sampleSize: 0,
            minimumSample: MIN_AGENT_SAMPLE,
            freshness: agents.freshness,
            comparison: unavailableComparison("SOURCE_UNAVAILABLE"),
            appliedFilters: filters(resolved.query),
          },
        };
      }
      const completed = nonnegativeInteger(globalAgentRow.completed);
      const terminal = nonnegativeInteger(globalAgentRow.terminal);
      const failed = nonnegativeInteger(globalAgentRow.failed);
      const degraded = nonnegativeInteger(globalAgentRow.degraded);
      const rejected = nonnegativeInteger(globalAgentRow.rejected);
      const previousTerminal = nonnegativeInteger(globalAgentRow.previousTerminal);
      const previousCompleted = nonnegativeInteger(globalAgentRow.previousCompleted);
      const state =
        terminal === 0
          ? "NO_DATA"
          : terminal < MIN_AGENT_SAMPLE
            ? "INSUFFICIENT_SAMPLE"
            : "AVAILABLE";
      const valuePercent = state === "AVAILABLE" ? roundedPercent(completed, terminal) : null;
      const previousPercent = roundedPercent(previousCompleted, previousTerminal);
      return {
        valuePercent,
        completed,
        terminal,
        failed,
        degraded,
        rejected,
        context: {
          state,
          window: resolved.window,
          sampleSize: terminal,
          minimumSample: MIN_AGENT_SAMPLE,
          freshness: agents.freshness,
          comparison:
            state === "AVAILABLE" &&
            previousTerminal >= MIN_AGENT_SAMPLE &&
            previousPercent !== null
              ? {
                  state: "AVAILABLE" as const,
                  kind: "PREVIOUS_PERIOD" as const,
                  window: resolved.previousWindow,
                  previousValue: previousPercent,
                  delta: Math.round(((valuePercent ?? 0) - previousPercent) * 10) / 10,
                  deltaUnit: "PERCENTAGE_POINTS" as const,
                }
              : unavailableComparison(
                  previousTerminal === 0 ? "NO_HISTORY" : "INSUFFICIENT_SAMPLE",
                ),
          appliedFilters: filters(resolved.query),
        },
      };
    })();

    const aiSpendKpi = (() => {
      if (!agents.available || globalAgentRow === null) {
        return {
          microUsd: null,
          actualMicroUsd: null,
          estimatedMicroUsd: null,
          actualRunCount: null,
          estimatedRunCount: null,
          actualCoveragePercent: null,
          context: {
            state: "UNKNOWN" as const,
            window: resolved.monthToDateWindow,
            sampleSize: 0,
            minimumSample: 0,
            freshness: agents.freshness,
            comparison: unavailableComparison("SOURCE_UNAVAILABLE"),
            appliedFilters: filters(resolved.query),
          },
        };
      }
      const microUsd = nonnegativeInteger(globalAgentRow.mtdCostMicroUsd);
      const actualMicroUsd = nonnegativeInteger(globalAgentRow.mtdActualMicroUsd);
      const estimatedMicroUsd = nonnegativeInteger(globalAgentRow.mtdEstimatedMicroUsd);
      const actualRunCount = nonnegativeInteger(globalAgentRow.mtdActualRunCount);
      const estimatedRunCount = nonnegativeInteger(globalAgentRow.mtdEstimatedRunCount);
      const sampleSize = actualRunCount + estimatedRunCount;
      const previousRuns = nonnegativeInteger(globalAgentRow.previousMonthRunCount);
      const previousCost = nonnegativeInteger(globalAgentRow.previousMonthCostMicroUsd);
      return {
        microUsd,
        actualMicroUsd,
        estimatedMicroUsd,
        actualRunCount,
        estimatedRunCount,
        actualCoveragePercent: roundedPercent(actualRunCount, sampleSize),
        context: {
          state: "AVAILABLE" as const,
          window: resolved.monthToDateWindow,
          sampleSize,
          minimumSample: 0,
          freshness: agents.freshness,
          comparison:
            previousRuns > 0
              ? {
                  state: "AVAILABLE" as const,
                  kind: "PREVIOUS_MONTH_COMPARABLE" as const,
                  window: resolved.previousMonthWindow,
                  previousValue: previousCost,
                  delta: microUsd - previousCost,
                  deltaUnit: "MICRO_USD" as const,
                }
              : unavailableComparison("NO_HISTORY"),
          appliedFilters: filters(resolved.query),
        },
      };
    })();

    const reviewKpi = (() => {
      if (!reviews.available || globalReviewRow === null) {
        return {
          breached: null,
          waiting: null,
          withoutDueAt: null,
          oldestWaitingAt: null,
          oldestBreachedDueAt: null,
          context: {
            state: "UNKNOWN" as const,
            window: {
              kind: "SNAPSHOT" as const,
              from: null,
              to: asOf.toISOString(),
              timeZone: "UTC" as const,
            },
            sampleSize: 0,
            minimumSample: 0,
            freshness: reviews.freshness,
            comparison: unavailableComparison("SOURCE_UNAVAILABLE"),
            appliedFilters: filters(resolved.query, false),
          },
        };
      }
      const waiting = nonnegativeInteger(globalReviewRow.waiting);
      return {
        breached: nonnegativeInteger(globalReviewRow.breached),
        waiting,
        withoutDueAt: nonnegativeInteger(globalReviewRow.withoutDueAt),
        oldestWaitingAt: iso(globalReviewRow.oldestWaitingAt),
        oldestBreachedDueAt: iso(globalReviewRow.oldestBreachedDueAt),
        context: {
          state: "AVAILABLE" as const,
          window: {
            kind: "SNAPSHOT" as const,
            from: null,
            to: asOf.toISOString(),
            timeZone: "UTC" as const,
          },
          sampleSize: waiting,
          minimumSample: 0,
          freshness: reviews.freshness,
          comparison: unavailableComparison("NO_HISTORY"),
          appliedFilters: filters(resolved.query, false),
        },
      };
    })();

    const tenantAgentRows = agents.available
      ? new Map(
          agents.data.aggregates
            .filter((row) => row.scopeKind === "TENANT" && row.tenantId !== null)
            .map((row) => [row.tenantId!, row]),
        )
      : new Map<string, PlatformAgentAggregateRow>();
    const tenantStuckRows = agents.available
      ? new Map(
          agents.data.stuck
            .filter((row) => row.scopeKind === "TENANT" && row.tenantId !== null)
            .map((row) => [row.tenantId!, row]),
        )
      : new Map<string, PlatformStuckAggregateRow>();
    const tenantReviewRows = reviews.available
      ? new Map(
          reviews.data
            .filter((row) => row.scopeKind === "TENANT" && row.tenantId !== null)
            .map((row) => [row.tenantId!, row]),
        )
      : new Map<string, PlatformReviewAggregateRow>();
    const signalsByTenant = new Map<string, PlatformOverviewAttentionItem[]>();
    for (const signal of signals) {
      if (signal.scope.tenantId === null) continue;
      const existing = signalsByTenant.get(signal.scope.tenantId) ?? [];
      existing.push(signal);
      signalsByTenant.set(signal.scope.tenantId, existing);
    }

    const tenantItems: PlatformOverviewTenantItem[] = tenants.available
      ? tenants.data.map((tenant) => {
          const agent = tenantAgentRows.get(tenant.tenantId);
          const stuck = tenantStuckRows.get(tenant.tenantId);
          const review = tenantReviewRows.get(tenant.tenantId);
          const knownSignals = [...(signalsByTenant.get(tenant.tenantId) ?? [])];
          if (agents.available && agent !== undefined) {
            const rollingTerminal = nonnegativeInteger(agent.rollingTerminal);
            const rollingFailures = nonnegativeInteger(agent.rollingNonCompletion);
            if (rollingTerminal >= MIN_AGENT_SAMPLE && rollingFailures / rollingTerminal > 0.05) {
              knownSignals.push(
                makeSignal({
                  ruleKey: "TENANT_AGENT_HIGH_FAILURE_RATE",
                  severity: "HIGH",
                  title: "Tenant agent non-completion rate is high",
                  impact: "Recent tenant agent runs exceed the non-completion threshold.",
                  scope: scope({
                    tenantId: tenant.tenantId,
                    tenantName: safeTenantDisplayName(tenant.name, tenant.tenantId),
                  }),
                  firstEvidenceAt: agent.oldestRollingFailureAt,
                  observedAt: asOf,
                  metricKey: "tenant_agent_noncompletion_percent_15m",
                  value: roundedPercent(rollingFailures, rollingTerminal) ?? 0,
                  unit: "percent",
                  recommendedAction: "Inspect the tenant's recent agent run diagnostics.",
                  diagnosticsHref: `/platform/agent-runs?tenantId=${encodeURIComponent(tenant.tenantId)}`,
                  freshness: agents.freshness,
                }),
              );
            }
          }
          if (agents.available && stuck !== undefined && nonnegativeInteger(stuck.stuck) > 0) {
            knownSignals.push(
              makeSignal({
                ruleKey: "TENANT_AGENT_RUN_STUCK_30M",
                severity: "HIGH",
                title: "Tenant has stuck agent runs",
                impact: "Tenant agent runs have remained RUNNING for at least 30 minutes.",
                scope: scope({
                  tenantId: tenant.tenantId,
                  tenantName: safeTenantDisplayName(tenant.name, tenant.tenantId),
                }),
                firstEvidenceAt: stuck.oldestStuckAt,
                observedAt: asOf,
                metricKey: "tenant_stuck_agent_runs",
                value: nonnegativeInteger(stuck.stuck),
                unit: "runs",
                recommendedAction: "Inspect the tenant's stuck run diagnostics.",
                diagnosticsHref: `/platform/agent-runs?stuck=true&tenantId=${encodeURIComponent(tenant.tenantId)}`,
                freshness: agents.freshness,
              }),
            );
          }
          sortSignals(knownSignals);
          const issueSourcesKnown = agents.available && reviews.available && system.available;
          const unknownFields: PlatformOverviewTenantItem["unknownFields"] = [];
          if (!agents.available) unknownFields.push("RUNS", "AI_SPEND");
          if (!reviews.available) unknownFields.push("REVIEW");
          if (!issueSourcesKnown) unknownFields.push("ISSUES");
          const hasCritical = knownSignals.some((signal) => signal.severity === "CRITICAL");
          const hasWarning = knownSignals.some(
            (signal) => signal.severity === "HIGH" || signal.severity === "MEDIUM",
          );
          const inactive =
            tenant.lastActivityAt !== null &&
            tenant.lastActivityAt.getTime() <= asOf.getTime() - 30 * DAY_MS;
          const health = hasCritical
            ? "CRITICAL"
            : hasWarning
              ? "WARNING"
              : !issueSourcesKnown
                ? "UNKNOWN"
                : inactive
                  ? "INACTIVE"
                  : "HEALTHY";
          return {
            tenantId: tenant.tenantId,
            name: safeTenantDisplayName(tenant.name, tenant.tenantId),
            health,
            reasons: knownSignals.slice(0, 3).map(causeFromSignal),
            users: {
              loggedIn24h: nonnegativeInteger(tenant.loggedIn24h),
              activeAccounts: nonnegativeInteger(tenant.activeAccounts),
            },
            runs: agents.available
              ? {
                  total: nonnegativeInteger(agent?.runs),
                  completed: nonnegativeInteger(agent?.completed),
                  failed: nonnegativeInteger(agent?.failed),
                  degraded: nonnegativeInteger(agent?.degraded),
                  rejected: nonnegativeInteger(agent?.rejected),
                  stuck: nonnegativeInteger(stuck?.stuck),
                }
              : null,
            review: reviews.available
              ? {
                  waiting: nonnegativeInteger(review?.waiting),
                  breached: nonnegativeInteger(review?.breached),
                }
              : null,
            issues: issueSourcesKnown
              ? {
                  critical: knownSignals.filter((signal) => signal.severity === "CRITICAL").length,
                  high: knownSignals.filter((signal) => signal.severity === "HIGH").length,
                  medium: knownSignals.filter((signal) => signal.severity === "MEDIUM").length,
                  low: knownSignals.filter((signal) => signal.severity === "LOW").length,
                }
              : null,
            aiSpendMicroUsd: agents.available ? nonnegativeInteger(agent?.mtdCostMicroUsd) : null,
            storageBytes: nonnegativeInteger(tenant.storageBytes),
            lastActivityAt: iso(tenant.lastActivityAt),
            unknownFields,
          };
        })
      : [];
    const tenantHealthOrder = {
      CRITICAL: 0,
      WARNING: 1,
      UNKNOWN: 2,
      HEALTHY: 3,
      INACTIVE: 4,
    } as const;
    tenantItems.sort(
      (left, right) =>
        tenantHealthOrder[left.health] - tenantHealthOrder[right.health] ||
        left.name.localeCompare(right.name) ||
        left.tenantId.localeCompare(right.tenantId),
    );

    const tenantKpi = tenants.available
      ? {
          healthy: tenantItems.filter((item) => item.health === "HEALTHY").length,
          total: tenantItems.length,
          warning: tenantItems.filter((item) => item.health === "WARNING").length,
          critical: tenantItems.filter((item) => item.health === "CRITICAL").length,
          unknown: tenantItems.filter((item) => item.health === "UNKNOWN").length,
          inactive: tenantItems.filter((item) => item.health === "INACTIVE").length,
          context: {
            state: tenantItems.length === 0 ? ("NO_DATA" as const) : ("AVAILABLE" as const),
            window: {
              kind: "SNAPSHOT" as const,
              from: null,
              to: asOf.toISOString(),
              timeZone: "UTC" as const,
            },
            sampleSize: tenantItems.length,
            minimumSample: 0,
            freshness: combinedFreshness([tenants, agents, reviews, system], generatedAt),
            comparison: unavailableComparison("NO_HISTORY"),
            appliedFilters: filters(resolved.query),
          },
        }
      : {
          healthy: null,
          total: null,
          warning: null,
          critical: null,
          unknown: null,
          inactive: null,
          context: {
            state: "UNKNOWN" as const,
            window: {
              kind: "SNAPSHOT" as const,
              from: null,
              to: asOf.toISOString(),
              timeZone: "UTC" as const,
            },
            sampleSize: 0,
            minimumSample: 0,
            freshness: tenants.freshness,
            comparison: unavailableComparison("SOURCE_UNAVAILABLE"),
            appliedFilters: filters(resolved.query),
          },
        };

    const agentItems: PlatformOverviewAgentItem[] = [];
    if (agents.available) {
      const byAgent = new Map<
        string,
        { aggregate?: PlatformAgentAggregateRow; stuck?: PlatformStuckAggregateRow }
      >();
      for (const row of agents.data.aggregates.filter(
        (candidate) => candidate.scopeKind === "AGENT",
      )) {
        const agentType = safeAgentType(row.agentType);
        if (agentType !== null) byAgent.set(agentType, { aggregate: row });
      }
      for (const row of agents.data.stuck.filter((candidate) => candidate.scopeKind === "AGENT")) {
        const agentType = safeAgentType(row.agentType);
        if (agentType === null) continue;
        const existing = byAgent.get(agentType);
        byAgent.set(
          agentType,
          existing === undefined ? { stuck: row } : { ...existing, stuck: row },
        );
      }
      for (const [agentType, value] of byAgent) {
        const row = value.aggregate;
        const stuck = nonnegativeInteger(value.stuck?.stuck);
        const runs = nonnegativeInteger(row?.runs);
        const terminal = nonnegativeInteger(row?.terminal);
        const rollingTerminal = nonnegativeInteger(row?.rollingTerminal);
        const rollingFailures = nonnegativeInteger(row?.rollingNonCompletion);
        const degraded =
          stuck > 0 ||
          (rollingTerminal >= MIN_AGENT_SAMPLE && rollingFailures / rollingTerminal > 0.05);
        const reasons = signals
          .filter((signal) => signal.scope.agentType === agentType)
          .slice(0, 3)
          .map(causeFromSignal);
        agentItems.push({
          agentType,
          state: degraded ? "DEGRADED" : runs > 0 ? "ACTIVE" : "UNKNOWN",
          runs,
          terminal,
          completed: nonnegativeInteger(row?.completed),
          failed: nonnegativeInteger(row?.failed),
          degraded: nonnegativeInteger(row?.degraded),
          rejected: nonnegativeInteger(row?.rejected),
          completionPercent:
            terminal >= MIN_AGENT_SAMPLE
              ? roundedPercent(nonnegativeInteger(row?.completed), terminal)
              : null,
          p50LatencyMs: row?.p50LatencyMs == null ? null : nonnegativeInteger(row.p50LatencyMs),
          p95LatencyMs: row?.p95LatencyMs == null ? null : nonnegativeInteger(row.p95LatencyMs),
          retriedRuns: nonnegativeInteger(row?.retriedRuns),
          retryRatePercent: roundedPercent(nonnegativeInteger(row?.retriedRuns), runs),
          stuck,
          lastSuccessAt: iso(row?.lastSuccessAt ?? null),
          costMicroUsd: nonnegativeInteger(row?.mtdCostMicroUsd),
          reasons,
        });
      }
      agentItems.sort(
        (left, right) =>
          (left.state === "DEGRADED" ? 0 : left.state === "ACTIVE" ? 1 : 2) -
            (right.state === "DEGRADED" ? 0 : right.state === "ACTIVE" ? 1 : 2) ||
          right.runs - left.runs ||
          left.agentType.localeCompare(right.agentType),
      );
    }

    const systemComponents: PlatformOverviewResponse["systemHealth"]["components"] = [
      {
        component: "API",
        state: "HEALTHY",
        required: true,
        summary: "The authenticated API request is live.",
        metrics: [],
        freshness: {
          state: "FRESH",
          source: "LIVE_PROBE",
          checkedAt: generatedAt.toISOString(),
          freshAt: generatedAt.toISOString(),
          ageSeconds: 0,
          staleAfterSeconds: FRESHNESS_STALE_AFTER_SECONDS,
          reason: null,
        },
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
    const componentConfig = [
      ["OUTBOX", "OUTBOX", true],
      ["ARTIFACT_METADATA", "FILE", true],
      ["NOTIFICATION", "NOTIFICATION", false],
    ] as const;
    for (const [component, kind, required] of componentConfig) {
      const row = system.available ? globalSystem(system.data, kind) : null;
      if (!system.available || row === null) {
        systemComponents.push({
          component,
          state: "UNKNOWN",
          required,
          summary: `${component.replace("_", " ")} aggregate is unavailable.`,
          metrics: [],
          freshness: system.freshness,
          diagnosticsHref: `/platform/system-health?component=${component}`,
        });
        continue;
      }
      const stalled = nonnegativeInteger(row.stalledCount);
      const failed = nonnegativeInteger(row.failedCount);
      const dead = nonnegativeInteger(row.deadLetterCount);
      const quarantined = nonnegativeInteger(row.quarantinedCount);
      systemComponents.push({
        component,
        state: stalled + failed + dead + quarantined > 0 ? "DEGRADED" : "HEALTHY",
        required,
        summary:
          stalled + failed + dead + quarantined > 0
            ? `${component.replace("_", " ")} has items requiring attention.`
            : `${component.replace("_", " ")} has no confirmed delivery or processing issue.`,
        metrics: [
          { key: "pending", value: nonnegativeInteger(row.pendingCount), unit: "items" },
          { key: "stalled", value: stalled, unit: "items" },
          { key: "failed", value: failed, unit: "items" },
          { key: "dead_letter", value: dead, unit: "items" },
          { key: "quarantined", value: quarantined, unit: "items" },
        ],
        freshness: system.freshness,
        diagnosticsHref: `/platform/system-health?component=${component}`,
      });
    }
    const providerFailures =
      agents.available && globalAgentRow !== null
        ? nonnegativeInteger(globalAgentRow.rollingProviderFailures)
        : null;
    systemComponents.push({
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

    const issueSourcesKnown =
      agents.available && reviews.available && tenants.available && system.available;
    const critical = signals.filter((signal) => signal.severity === "CRITICAL").length;
    const high = signals.filter((signal) => signal.severity === "HIGH").length;
    const oldestIssueAt =
      signals
        .filter((signal) => signal.severity === "CRITICAL" || signal.severity === "HIGH")
        .map((signal) => signal.firstEvidenceAt)
        .filter((value): value is string => value !== null)
        .sort()[0] ?? null;
    const criticalIssuesKpi = issueSourcesKnown
      ? {
          value: critical + high,
          critical,
          high,
          oldestEvidenceAt: oldestIssueAt,
          context: {
            state: "AVAILABLE" as const,
            window: {
              kind: "SNAPSHOT" as const,
              from: null,
              to: asOf.toISOString(),
              timeZone: "UTC" as const,
            },
            sampleSize: critical + high,
            minimumSample: 0,
            freshness: combinedFreshness([agents, reviews, tenants, system], generatedAt),
            comparison: unavailableComparison("NO_HISTORY"),
            appliedFilters: filters(resolved.query),
          },
        }
      : {
          value: null,
          critical: null,
          high: null,
          oldestEvidenceAt: null,
          context: {
            state: "UNKNOWN" as const,
            window: {
              kind: "SNAPSHOT" as const,
              from: null,
              to: asOf.toISOString(),
              timeZone: "UTC" as const,
            },
            sampleSize: 0,
            minimumSample: 0,
            freshness: combinedFreshness([agents, reviews, tenants, system], generatedAt),
            comparison: unavailableComparison("SOURCE_UNAVAILABLE"),
            appliedFilters: filters(resolved.query),
          },
        };

    const requiredComponentUnknown = systemComponents.some(
      (component) => component.required && component.state === "UNKNOWN",
    );
    const requiredUnknown =
      !agents.available ||
      !reviews.available ||
      !tenants.available ||
      !system.available ||
      !postgres.available ||
      requiredComponentUnknown;
    const confirmedComponentDegraded = systemComponents.some(
      (component) => component.state === "DEGRADED" || component.state === "DOWN",
    );
    const platformState = signals.some((signal) => signal.severity === "CRITICAL")
      ? "CRITICAL"
      : signals.some((signal) => signal.severity === "HIGH") || confirmedComponentDegraded
        ? "DEGRADED"
        : requiredUnknown
          ? "UNKNOWN"
          : "HEALTHY";
    const partial = problems.length > 0;
    const tenantDependencyUnavailable =
      !agents.available || !reviews.available || !system.available;

    const response = platformOverviewResponseSchema.parse({
      schemaVersion: "platform-overview.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: asOf.toISOString(),
      window: resolved.window,
      filters: {
        tenantId: resolved.input.tenantId,
        agentType: resolved.input.agentType,
      },
      freshness: combinedFreshness([agents, reviews, tenants, system, postgres], generatedAt),
      partial,
      problems: problems.slice(0, 10),
      platformStatus: {
        state: platformState,
        evaluatedAt: generatedAt.toISOString(),
        ruleSetVersion: RULE_SET_VERSION,
      },
      topCauses: signals.slice(0, 3).map(causeFromSignal),
      kpis: {
        criticalIssues: criticalIssuesKpi,
        tenantHealth: tenantKpi,
        agentCompletion: agentKpi,
        reviewSla: reviewKpi,
        aiSpend: aiSpendKpi,
      },
      attention: {
        context: {
          state: issueSourcesKnown ? "AVAILABLE" : signals.length > 0 ? "PARTIAL" : "UNKNOWN",
          freshness: combinedFreshness([agents, reviews, tenants, system], generatedAt),
          appliedFilters: filters(resolved.query),
        },
        total: signals.length,
        truncated: signals.length > 10,
        items: signals.slice(0, 10),
      },
      tenantHealthPreview: {
        context: {
          state: !tenants.available
            ? "UNKNOWN"
            : tenantDependencyUnavailable
              ? "PARTIAL"
              : "AVAILABLE",
          freshness: combinedFreshness([tenants, agents, reviews, system], generatedAt),
          appliedFilters: filters(resolved.query),
        },
        total: tenantItems.length,
        truncated: tenantItems.length > 10,
        items: tenantItems.slice(0, 10),
      },
      agentHealthPreview: {
        context: {
          state: agents.available ? "AVAILABLE" : "UNKNOWN",
          freshness: agents.freshness,
          appliedFilters: filters(resolved.query),
        },
        total: agentItems.length,
        truncated: agentItems.length > 10,
        items: agentItems.slice(0, 10),
      },
      systemHealth: {
        context: {
          state: system.available && postgres.available ? "AVAILABLE" : "PARTIAL",
          freshness: combinedFreshness([system, postgres], generatedAt),
          appliedFilters: [],
        },
        components: systemComponents,
      },
      recentAudit: {
        context: {
          state: audit.available ? "AVAILABLE" : "UNKNOWN",
          freshness: audit.freshness,
          appliedFilters: filters(resolved.query, false),
        },
        items: audit.available ? auditItems(audit.data) : [],
      },
    });

    return {
      response,
      signals,
      asOf: asOf.toISOString(),
      sourcesComplete:
        agents.available &&
        reviews.available &&
        tenants.available &&
        system.available &&
        postgres.available,
    };
  }
}
