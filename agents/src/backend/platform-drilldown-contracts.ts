import { z } from "zod";
import { phase9IdentifierSchema, phase9IsoDateTimeSchema } from "./contracts.js";
import {
  platformOverviewCauseSchema,
  platformOverviewFreshnessSchema,
  platformOverviewSectionContextSchema,
  platformOverviewSystemComponentSchema,
  platformOverviewWindowSchema,
} from "./platform-overview-contracts.js";

/**
 * Phase 5 drill-down contracts. Every list shares one envelope so the console
 * can render loading, stale, empty and partial states the same way it already
 * does for the overview, and so cursor semantics never differ per endpoint.
 */

const nonnegativeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const percentageSchema = z.number().min(0).max(100);
const cursorSchema = z.string().trim().min(1).max(2_048);
const agentTypeSchema = z.string().trim().min(1).max(100);
const limitSchema = z.coerce.number().int().min(1).max(100);

export const PLATFORM_LIST_DEFAULT_LIMIT = 25;

const rangeQueryShape = {
  window: z.enum(["24h", "7d", "30d"]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
} as const;

const pageQueryShape = {
  limit: limitSchema.optional(),
  cursor: cursorSchema.optional(),
} as const;

export const platformListProblemSchema = z
  .object({
    section: z.enum(["TENANTS", "AGENTS", "REVIEWS", "USAGE", "SYSTEM", "AUDIT"]),
    code: z.enum(["SOURCE_UNAVAILABLE", "SOURCE_STALE"]),
    message: z.string().trim().min(1).max(300),
    retryable: z.boolean(),
  })
  .strict();

export const platformListPageSchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    hasMore: z.boolean(),
    nextCursor: cursorSchema.nullable(),
    sort: z.string().trim().min(1).max(60),
    order: z.enum(["ASC", "DESC"]),
  })
  .strict();

function envelope<Shape extends z.ZodRawShape>(schemaVersion: string, shape: Shape) {
  return z
    .object({
      schemaVersion: z.literal(schemaVersion),
      generatedAt: phase9IsoDateTimeSchema,
      asOf: phase9IsoDateTimeSchema,
      window: platformOverviewWindowSchema,
      freshness: platformOverviewFreshnessSchema,
      partial: z.boolean(),
      problems: z.array(platformListProblemSchema).max(10),
      ...shape,
    })
    .strict();
}

/* ---------------------------------------------------------------- tenants */

export const platformTenantListQuerySchema = z
  .object({
    ...rangeQueryShape,
    ...pageQueryShape,
    search: z.string().trim().min(1).max(200).optional(),
    health: z.enum(["HEALTHY", "WARNING", "CRITICAL", "UNKNOWN", "INACTIVE"]).optional(),
    sort: z
      .enum(["HEALTH", "NAME", "LAST_ACTIVITY", "RUNS", "REVIEW_BREACHED", "AI_SPEND"])
      .optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict();

export const platformTenantListItemSchema = z
  .object({
    tenantId: phase9IdentifierSchema,
    name: z.string().trim().min(1).max(200),
    health: z.enum(["HEALTHY", "WARNING", "CRITICAL", "UNKNOWN", "INACTIVE"]),
    reasons: z.array(platformOverviewCauseSchema).max(3),
    users: z
      .object({ loggedIn24h: nonnegativeIntegerSchema, activeAccounts: nonnegativeIntegerSchema })
      .strict()
      .nullable(),
    projects: z
      .object({ total: nonnegativeIntegerSchema, active: nonnegativeIntegerSchema })
      .strict()
      .nullable(),
    runs: z
      .object({
        total: nonnegativeIntegerSchema,
        completed: nonnegativeIntegerSchema,
        failed: nonnegativeIntegerSchema,
        degraded: nonnegativeIntegerSchema,
        rejected: nonnegativeIntegerSchema,
        stuck: nonnegativeIntegerSchema,
        completionPercent: percentageSchema.nullable(),
      })
      .strict()
      .nullable(),
    review: z
      .object({ waiting: nonnegativeIntegerSchema, breached: nonnegativeIntegerSchema })
      .strict()
      .nullable(),
    aiSpendMicroUsd: nonnegativeIntegerSchema.nullable(),
    storageBytes: nonnegativeIntegerSchema.nullable(),
    lastActivityAt: phase9IsoDateTimeSchema.nullable(),
    detailHref: z.string().startsWith("/platform/"),
    unknownFields: z
      .array(
        z.enum(["USERS", "PROJECTS", "RUNS", "REVIEW", "AI_SPEND", "STORAGE", "LAST_ACTIVITY"]),
      )
      .max(7),
  })
  .strict();

export const platformTenantListResponseSchema = envelope("platform-tenants.v1", {
  filters: z
    .object({
      search: z.string().trim().min(1).max(200).nullable(),
      health: z.enum(["HEALTHY", "WARNING", "CRITICAL", "UNKNOWN", "INACTIVE"]).nullable(),
    })
    .strict(),
  page: platformListPageSchema,
  totals: z
    .object({
      matched: nonnegativeIntegerSchema,
      healthy: nonnegativeIntegerSchema,
      warning: nonnegativeIntegerSchema,
      critical: nonnegativeIntegerSchema,
      unknown: nonnegativeIntegerSchema,
      inactive: nonnegativeIntegerSchema,
    })
    .strict(),
  items: z.array(platformTenantListItemSchema).max(100),
});

export const platformTenantHealthQuerySchema = z.object({ ...rangeQueryShape }).strict();

export const platformTenantHealthResponseSchema = envelope("platform-tenant-health.v1", {
  tenant: z
    .object({
      tenantId: phase9IdentifierSchema,
      name: z.string().trim().min(1).max(200),
      health: z.enum(["HEALTHY", "WARNING", "CRITICAL", "UNKNOWN", "INACTIVE"]),
      createdAt: phase9IsoDateTimeSchema.nullable(),
      lastActivityAt: phase9IsoDateTimeSchema.nullable(),
      inactiveDays: nonnegativeIntegerSchema.nullable(),
    })
    .strict(),
  signals: z
    .object({
      context: platformOverviewSectionContextSchema,
      total: nonnegativeIntegerSchema,
      items: z.array(platformOverviewCauseSchema).max(10),
    })
    .strict(),
  users: z
    .object({
      context: platformOverviewSectionContextSchema,
      activeAccounts: nonnegativeIntegerSchema.nullable(),
      suspendedAccounts: nonnegativeIntegerSchema.nullable(),
      loggedIn24h: nonnegativeIntegerSchema.nullable(),
      loggedIn7d: nonnegativeIntegerSchema.nullable(),
      neverLoggedIn: nonnegativeIntegerSchema.nullable(),
    })
    .strict(),
  agents: z
    .object({
      context: platformOverviewSectionContextSchema,
      total: nonnegativeIntegerSchema,
      items: z
        .array(
          z
            .object({
              agentType: agentTypeSchema,
              runs: nonnegativeIntegerSchema,
              terminal: nonnegativeIntegerSchema,
              completed: nonnegativeIntegerSchema,
              failed: nonnegativeIntegerSchema,
              degraded: nonnegativeIntegerSchema,
              rejected: nonnegativeIntegerSchema,
              stuck: nonnegativeIntegerSchema,
              completionPercent: percentageSchema.nullable(),
              lastSuccessAt: phase9IsoDateTimeSchema.nullable(),
              costMicroUsd: nonnegativeIntegerSchema,
              runsHref: z.string().startsWith("/platform/"),
            })
            .strict(),
        )
        .max(50),
    })
    .strict(),
  review: z
    .object({
      context: platformOverviewSectionContextSchema,
      waiting: nonnegativeIntegerSchema.nullable(),
      breached: nonnegativeIntegerSchema.nullable(),
      withoutDueAt: nonnegativeIntegerSchema.nullable(),
      oldestWaitingAt: phase9IsoDateTimeSchema.nullable(),
      oldestBreachedDueAt: phase9IsoDateTimeSchema.nullable(),
      backlogHref: z.string().startsWith("/platform/"),
    })
    .strict(),
  delivery: z
    .object({
      context: platformOverviewSectionContextSchema,
      components: z.array(platformOverviewSystemComponentSchema).max(10),
    })
    .strict(),
  storage: z
    .object({
      context: platformOverviewSectionContextSchema,
      totalBytes: nonnegativeIntegerSchema.nullable(),
      fileCount: nonnegativeIntegerSchema.nullable(),
      quarantinedCount: nonnegativeIntegerSchema.nullable(),
    })
    .strict(),
});

/* ----------------------------------------------------------------- agents */

export const platformAgentListQuerySchema = z
  .object({
    ...rangeQueryShape,
    ...pageQueryShape,
    tenantId: phase9IdentifierSchema.optional(),
    state: z.enum(["ACTIVE", "DEGRADED", "UNKNOWN"]).optional(),
    sort: z.enum(["STATE", "AGENT_TYPE", "RUNS", "COMPLETION", "P95_LATENCY", "COST"]).optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict();

export const platformAgentListItemSchema = z
  .object({
    agentType: agentTypeSchema,
    state: z.enum(["ACTIVE", "DEGRADED", "UNKNOWN"]),
    runs: nonnegativeIntegerSchema,
    terminal: nonnegativeIntegerSchema,
    completed: nonnegativeIntegerSchema,
    failed: nonnegativeIntegerSchema,
    degraded: nonnegativeIntegerSchema,
    rejected: nonnegativeIntegerSchema,
    running: nonnegativeIntegerSchema,
    stuck: nonnegativeIntegerSchema,
    completionPercent: percentageSchema.nullable(),
    minimumSample: nonnegativeIntegerSchema,
    p50LatencyMs: nonnegativeIntegerSchema.nullable(),
    p95LatencyMs: nonnegativeIntegerSchema.nullable(),
    retriedRuns: nonnegativeIntegerSchema,
    retryRatePercent: percentageSchema.nullable(),
    lastSuccessAt: phase9IsoDateTimeSchema.nullable(),
    costMicroUsd: nonnegativeIntegerSchema,
    reasons: z.array(platformOverviewCauseSchema).max(3),
    detailHref: z.string().startsWith("/platform/"),
  })
  .strict();

export const platformAgentListResponseSchema = envelope("platform-agents.v1", {
  filters: z
    .object({
      tenantId: phase9IdentifierSchema.nullable(),
      state: z.enum(["ACTIVE", "DEGRADED", "UNKNOWN"]).nullable(),
    })
    .strict(),
  page: platformListPageSchema,
  totals: z
    .object({
      matched: nonnegativeIntegerSchema,
      active: nonnegativeIntegerSchema,
      degraded: nonnegativeIntegerSchema,
      unknown: nonnegativeIntegerSchema,
    })
    .strict(),
  items: z.array(platformAgentListItemSchema).max(100),
});

export const platformAgentDetailQuerySchema = z
  .object({ ...rangeQueryShape, tenantId: phase9IdentifierSchema.optional() })
  .strict();

export const platformAgentDetailResponseSchema = envelope("platform-agent-detail.v1", {
  filters: z.object({ tenantId: phase9IdentifierSchema.nullable() }).strict(),
  agent: platformAgentListItemSchema,
  failureBreakdown: z
    .object({
      context: platformOverviewSectionContextSchema,
      items: z
        .array(
          z
            .object({
              failureCategory: z.string().trim().min(1).max(60),
              count: nonnegativeIntegerSchema,
              sharePercent: percentageSchema.nullable(),
              lastObservedAt: phase9IsoDateTimeSchema.nullable(),
            })
            .strict(),
        )
        .max(20),
    })
    .strict(),
  tenantBreakdown: z
    .object({
      context: platformOverviewSectionContextSchema,
      items: z
        .array(
          z
            .object({
              tenantId: phase9IdentifierSchema,
              tenantName: z.string().trim().min(1).max(200).nullable(),
              runs: nonnegativeIntegerSchema,
              terminal: nonnegativeIntegerSchema,
              completed: nonnegativeIntegerSchema,
              failed: nonnegativeIntegerSchema,
              degraded: nonnegativeIntegerSchema,
              rejected: nonnegativeIntegerSchema,
              completionPercent: percentageSchema.nullable(),
              costMicroUsd: nonnegativeIntegerSchema,
              healthHref: z.string().startsWith("/platform/"),
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
  models: z
    .object({
      context: platformOverviewSectionContextSchema,
      items: z
        .array(
          z
            .object({
              provider: z.string().trim().min(1).max(60),
              modelId: z.string().trim().min(1).max(120),
              runs: nonnegativeIntegerSchema,
              costMicroUsd: nonnegativeIntegerSchema,
              inputTokens: nonnegativeIntegerSchema,
              outputTokens: nonnegativeIntegerSchema,
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
});

/* ------------------------------------------------------------- agent runs */

export const platformAgentRunListQuerySchema = z
  .object({
    ...rangeQueryShape,
    ...pageQueryShape,
    tenantId: phase9IdentifierSchema.optional(),
    agentType: agentTypeSchema.optional(),
    status: z.enum(["RUNNING", "COMPLETED", "FAILED", "DEGRADED", "REJECTED"]).optional(),
    outcome: z.enum(["TERMINAL", "NON_COMPLETION"]).optional(),
    failureCategory: z.string().trim().min(1).max(60).optional(),
    stuck: z.enum(["true", "false"]).optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict();

export const platformAgentRunListItemSchema = z
  .object({
    runId: phase9IdentifierSchema,
    tenantId: phase9IdentifierSchema,
    tenantName: z.string().trim().min(1).max(200).nullable(),
    agentType: agentTypeSchema,
    status: z.enum(["RUNNING", "COMPLETED", "FAILED", "DEGRADED", "REJECTED"]),
    failureCategory: z.string().trim().min(1).max(60),
    trigger: z.string().trim().min(1).max(60),
    provider: z.string().trim().min(1).max(60),
    modelId: z.string().trim().min(1).max(120),
    promptVersion: z.string().trim().min(1).max(60),
    startedAt: phase9IsoDateTimeSchema,
    completedAt: phase9IsoDateTimeSchema.nullable(),
    latencyMs: nonnegativeIntegerSchema,
    retryCount: nonnegativeIntegerSchema,
    costMicroUsd: nonnegativeIntegerSchema,
    costBasis: z.enum(["ACTUAL", "ESTIMATED"]),
    stuck: z.boolean(),
    diagnosticsHref: z.string().startsWith("/platform/"),
  })
  .strict();

export const platformAgentRunListResponseSchema = envelope("platform-agent-runs.v1", {
  filters: z
    .object({
      tenantId: phase9IdentifierSchema.nullable(),
      agentType: agentTypeSchema.nullable(),
      status: z.enum(["RUNNING", "COMPLETED", "FAILED", "DEGRADED", "REJECTED"]).nullable(),
      outcome: z.enum(["TERMINAL", "NON_COMPLETION"]).nullable(),
      failureCategory: z.string().trim().min(1).max(60).nullable(),
      stuck: z.boolean(),
    })
    .strict(),
  page: platformListPageSchema,
  items: z.array(platformAgentRunListItemSchema).max(100),
});

/**
 * Diagnostics deliberately expose no prompt, research text, output payload or
 * raw provider error. The redaction block tells the operator which fields were
 * withheld so an empty panel is never mistaken for missing data.
 */
export const platformAgentRunDiagnosticsResponseSchema = envelope(
  "platform-agent-run-diagnostics.v1",
  {
    run: platformAgentRunListItemSchema,
    execution: z
      .object({
        requestId: phase9IdentifierSchema.nullable(),
        eventId: phase9IdentifierSchema.nullable(),
        traceId: phase9IdentifierSchema.nullable(),
        projectId: phase9IdentifierSchema,
        toolBundleVersion: z.string().trim().min(1).max(60),
        outputSchemaVersion: nonnegativeIntegerSchema,
        dataSnapshotVersion: z.string().trim().min(1).max(60),
        outputSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        contentLoggingEnabled: z.boolean(),
        asOf: phase9IsoDateTimeSchema,
      })
      .strict(),
    usage: z
      .object({
        inputTokens: nonnegativeIntegerSchema,
        outputTokens: nonnegativeIntegerSchema,
        cachedInputTokens: nonnegativeIntegerSchema,
        reasoningTokens: nonnegativeIntegerSchema,
        estimatedCostMicroUsd: nonnegativeIntegerSchema,
        actualCostMicroUsd: nonnegativeIntegerSchema.nullable(),
      })
      .strict(),
    validation: z
      .object({
        state: z.enum(["PASSED", "FAILED", "UNKNOWN"]),
        issueCount: nonnegativeIntegerSchema.nullable(),
      })
      .strict(),
    toolCalls: z
      .object({
        total: nonnegativeIntegerSchema,
        truncated: z.boolean(),
        items: z
          .array(
            z
              .object({
                id: phase9IdentifierSchema,
                toolName: z.string().trim().min(1).max(120),
                status: z.string().trim().min(1).max(60),
                sequence: nonnegativeIntegerSchema,
                latencyMs: nonnegativeIntegerSchema,
                retryCount: nonnegativeIntegerSchema,
                startedAt: phase9IsoDateTimeSchema.nullable(),
              })
              .strict(),
          )
          .max(50),
      })
      .strict(),
    redaction: z
      .object({
        policy: z.literal("platform-diagnostics-redaction.v1"),
        redactedFields: z.array(z.string().trim().min(1).max(60)).max(20),
        note: z.string().trim().min(1).max(300),
      })
      .strict(),
  },
);

/* ---------------------------------------------------------------- reviews */

export const platformReviewSummaryQuerySchema = z
  .object({ ...rangeQueryShape, tenantId: phase9IdentifierSchema.optional() })
  .strict();

export const platformReviewSummaryResponseSchema = envelope("platform-review-summary.v1", {
  filters: z.object({ tenantId: phase9IdentifierSchema.nullable() }).strict(),
  backlog: z
    .object({
      context: platformOverviewSectionContextSchema,
      waiting: nonnegativeIntegerSchema.nullable(),
      breached: nonnegativeIntegerSchema.nullable(),
      withoutDueAt: nonnegativeIntegerSchema.nullable(),
      draft: nonnegativeIntegerSchema.nullable(),
      oldestWaitingAt: phase9IsoDateTimeSchema.nullable(),
      oldestBreachedDueAt: phase9IsoDateTimeSchema.nullable(),
    })
    .strict(),
  ageBuckets: z
    .object({
      context: platformOverviewSectionContextSchema,
      items: z
        .array(
          z
            .object({
              bucket: z.enum(["UNDER_24H", "H24_TO_72H", "D3_TO_D7", "OVER_7D"]),
              waiting: nonnegativeIntegerSchema,
              breached: nonnegativeIntegerSchema,
            })
            .strict(),
        )
        .max(4),
    })
    .strict(),
  byTenant: z
    .object({
      context: platformOverviewSectionContextSchema,
      items: z
        .array(
          z
            .object({
              tenantId: phase9IdentifierSchema,
              tenantName: z.string().trim().min(1).max(200).nullable(),
              waiting: nonnegativeIntegerSchema,
              breached: nonnegativeIntegerSchema,
              oldestWaitingAt: phase9IsoDateTimeSchema.nullable(),
              backlogHref: z.string().startsWith("/platform/"),
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
  byTargetType: z
    .object({
      context: platformOverviewSectionContextSchema,
      items: z
        .array(
          z
            .object({
              targetType: z.string().trim().min(1).max(60),
              waiting: nonnegativeIntegerSchema,
              breached: nonnegativeIntegerSchema,
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
  throughput: z
    .object({
      context: platformOverviewSectionContextSchema,
      decided: nonnegativeIntegerSchema.nullable(),
      approved: nonnegativeIntegerSchema.nullable(),
      rejected: nonnegativeIntegerSchema.nullable(),
      corrected: nonnegativeIntegerSchema.nullable(),
      emergencyOverrides: nonnegativeIntegerSchema.nullable(),
      correctionRatePercent: percentageSchema.nullable(),
    })
    .strict(),
});

export const platformReviewBacklogQuerySchema = z
  .object({
    ...rangeQueryShape,
    ...pageQueryShape,
    tenantId: phase9IdentifierSchema.optional(),
    sla: z.enum(["ALL", "BREACHED", "DUE_SOON", "NO_DUE_DATE"]).optional(),
    targetType: z.string().trim().min(1).max(60).optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict();

export const platformReviewBacklogItemSchema = z
  .object({
    reviewTaskId: phase9IdentifierSchema,
    tenantId: phase9IdentifierSchema,
    tenantName: z.string().trim().min(1).max(200).nullable(),
    projectId: phase9IdentifierSchema,
    targetType: z.string().trim().min(1).max(60),
    targetVersion: nonnegativeIntegerSchema,
    assignedRole: z.string().trim().min(1).max(60),
    assigned: z.boolean(),
    status: z.string().trim().min(1).max(60),
    createdAt: phase9IsoDateTimeSchema,
    dueAt: phase9IsoDateTimeSchema.nullable(),
    waitingSeconds: nonnegativeIntegerSchema,
    sla: z.enum(["BREACHED", "DUE_SOON", "ON_TRACK", "NO_DUE_DATE"]),
    tenantHref: z.string().startsWith("/platform/"),
  })
  .strict();

export const platformReviewBacklogResponseSchema = envelope("platform-review-backlog.v1", {
  filters: z
    .object({
      tenantId: phase9IdentifierSchema.nullable(),
      sla: z.enum(["ALL", "BREACHED", "DUE_SOON", "NO_DUE_DATE"]),
      targetType: z.string().trim().min(1).max(60).nullable(),
    })
    .strict(),
  page: platformListPageSchema,
  items: z.array(platformReviewBacklogItemSchema).max(100),
});

/* ------------------------------------------------------------------ usage */

export const platformUsageQuerySchema = z
  .object({
    ...rangeQueryShape,
    tenantId: phase9IdentifierSchema.optional(),
    agentType: agentTypeSchema.optional(),
    groupBy: z.enum(["TENANT", "AGENT_TYPE", "MODEL"]).optional(),
  })
  .strict();

export const platformUsageGroupSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(200),
    href: z.string().startsWith("/platform/").nullable(),
    runs: nonnegativeIntegerSchema,
    costMicroUsd: nonnegativeIntegerSchema,
    actualMicroUsd: nonnegativeIntegerSchema,
    estimatedMicroUsd: nonnegativeIntegerSchema,
    actualRunCount: nonnegativeIntegerSchema,
    estimatedRunCount: nonnegativeIntegerSchema,
    actualCoveragePercent: percentageSchema.nullable(),
    inputTokens: nonnegativeIntegerSchema,
    outputTokens: nonnegativeIntegerSchema,
    cachedInputTokens: nonnegativeIntegerSchema,
    reasoningTokens: nonnegativeIntegerSchema,
    costSharePercent: percentageSchema.nullable(),
  })
  .strict();

export const platformUsageResponseSchema = envelope("platform-usage.v1", {
  filters: z
    .object({
      tenantId: phase9IdentifierSchema.nullable(),
      agentType: agentTypeSchema.nullable(),
      groupBy: z.enum(["TENANT", "AGENT_TYPE", "MODEL"]),
    })
    .strict(),
  totals: z
    .object({
      context: platformOverviewSectionContextSchema,
      runs: nonnegativeIntegerSchema.nullable(),
      costMicroUsd: nonnegativeIntegerSchema.nullable(),
      actualMicroUsd: nonnegativeIntegerSchema.nullable(),
      estimatedMicroUsd: nonnegativeIntegerSchema.nullable(),
      actualCoveragePercent: percentageSchema.nullable(),
      inputTokens: nonnegativeIntegerSchema.nullable(),
      outputTokens: nonnegativeIntegerSchema.nullable(),
      cachedInputTokens: nonnegativeIntegerSchema.nullable(),
      reasoningTokens: nonnegativeIntegerSchema.nullable(),
      /** No quota model exists yet, so no used/budget progress is emitted. */
      budgetModel: z.literal("NOT_CONFIGURED"),
    })
    .strict(),
  groups: z
    .object({
      context: platformOverviewSectionContextSchema,
      total: nonnegativeIntegerSchema,
      truncated: z.boolean(),
      items: z.array(platformUsageGroupSchema).max(50),
    })
    .strict(),
});

/* ---------------------------------------------------------- system health */

export const platformSystemHealthQuerySchema = z
  .object({ tenantId: phase9IdentifierSchema.optional() })
  .strict();

export const platformSystemHealthResponseSchema = envelope("platform-system-health.v1", {
  filters: z.object({ tenantId: phase9IdentifierSchema.nullable() }).strict(),
  state: z.enum(["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"]),
  components: z.array(platformOverviewSystemComponentSchema).max(10),
  outboxByType: z
    .object({
      context: platformOverviewSectionContextSchema,
      items: z
        .array(
          z
            .object({
              eventType: z.string().trim().min(1).max(120),
              pending: nonnegativeIntegerSchema,
              stalled: nonnegativeIntegerSchema,
              failed: nonnegativeIntegerSchema,
              deadLetter: nonnegativeIntegerSchema,
              oldestEvidenceAt: phase9IsoDateTimeSchema.nullable(),
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
  tenantImpact: z
    .object({
      context: platformOverviewSectionContextSchema,
      items: z
        .array(
          z
            .object({
              tenantId: phase9IdentifierSchema,
              tenantName: z.string().trim().min(1).max(200).nullable(),
              outboxStalled: nonnegativeIntegerSchema,
              outboxDeadLetter: nonnegativeIntegerSchema,
              notificationFailed: nonnegativeIntegerSchema,
              artifactQuarantined: nonnegativeIntegerSchema,
              healthHref: z.string().startsWith("/platform/"),
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
});

/* ------------------------------------------------------------------ audit */

export const platformAuditLogQuerySchema = z
  .object({
    ...rangeQueryShape,
    ...pageQueryShape,
    tenantId: phase9IdentifierSchema.optional(),
    actorId: phase9IdentifierSchema.optional(),
    source: z.enum(["ALL", "PLATFORM", "TENANT"]).optional(),
    actorRole: z.string().trim().min(1).max(100).optional(),
    action: z.string().trim().min(1).max(200).optional(),
    result: z.enum(["SUCCESS", "DENIED", "FAILED"]).optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict();

export const platformAuditLogItemSchema = z
  .object({
    id: phase9IdentifierSchema,
    actorId: phase9IdentifierSchema.nullable(),
    actorDisplayName: z.string().trim().min(1).max(200).nullable(),
    actorRole: z.string().trim().min(1).max(100).nullable(),
    action: z.string().trim().min(1).max(200),
    tenantId: phase9IdentifierSchema.nullable(),
    resourceType: z.string().trim().min(1).max(100),
    resourceId: phase9IdentifierSchema.nullable(),
    result: z.enum(["SUCCESS", "DENIED", "FAILED"]),
    reason: z.string().trim().min(1).max(300).nullable(),
    correlationId: phase9IdentifierSchema,
    beforeHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    afterHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    occurredAt: phase9IsoDateTimeSchema,
  })
  .strict();

export const platformAuditLogResponseSchema = envelope("platform-audit-logs.v1", {
  filters: z
    .object({
      tenantId: phase9IdentifierSchema.nullable(),
      actorId: phase9IdentifierSchema.nullable(),
      source: z.enum(["ALL", "PLATFORM", "TENANT"]),
      actorRole: z.string().trim().min(1).max(100).nullable(),
      action: z.string().trim().min(1).max(200).nullable(),
      result: z.enum(["SUCCESS", "DENIED", "FAILED"]).nullable(),
    })
    .strict(),
  page: platformListPageSchema,
  items: z.array(platformAuditLogItemSchema).max(100),
});

export type PlatformTenantListQuery = z.infer<typeof platformTenantListQuerySchema>;
export type PlatformTenantListResponse = z.infer<typeof platformTenantListResponseSchema>;
export type PlatformTenantListItem = z.infer<typeof platformTenantListItemSchema>;
export type PlatformTenantHealthResponse = z.infer<typeof platformTenantHealthResponseSchema>;
export type PlatformAgentListQuery = z.infer<typeof platformAgentListQuerySchema>;
export type PlatformAgentListResponse = z.infer<typeof platformAgentListResponseSchema>;
export type PlatformAgentListItem = z.infer<typeof platformAgentListItemSchema>;
export type PlatformAgentDetailResponse = z.infer<typeof platformAgentDetailResponseSchema>;
export type PlatformAgentRunListQuery = z.infer<typeof platformAgentRunListQuerySchema>;
export type PlatformAgentRunListResponse = z.infer<typeof platformAgentRunListResponseSchema>;
export type PlatformAgentRunListItem = z.infer<typeof platformAgentRunListItemSchema>;
export type PlatformAgentRunDiagnosticsResponse = z.infer<
  typeof platformAgentRunDiagnosticsResponseSchema
>;
export type PlatformReviewSummaryResponse = z.infer<typeof platformReviewSummaryResponseSchema>;
export type PlatformReviewBacklogQuery = z.infer<typeof platformReviewBacklogQuerySchema>;
export type PlatformReviewBacklogResponse = z.infer<typeof platformReviewBacklogResponseSchema>;
export type PlatformUsageQuery = z.infer<typeof platformUsageQuerySchema>;
export type PlatformUsageResponse = z.infer<typeof platformUsageResponseSchema>;
export type PlatformSystemHealthResponse = z.infer<typeof platformSystemHealthResponseSchema>;
export type PlatformAuditLogQuery = z.infer<typeof platformAuditLogQuerySchema>;
export type PlatformAuditLogResponse = z.infer<typeof platformAuditLogResponseSchema>;
