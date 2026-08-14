import { z } from "zod";
import { phase9IdentifierSchema, phase9IsoDateTimeSchema } from "./contracts.js";

const nonnegativeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const percentageSchema = z.number().min(0).max(100);
const appliedFilterSchema = z.enum(["TENANT_ID", "AGENT_TYPE"]);

export const platformOverviewQuerySchema = z
  .object({
    window: z.enum(["24h", "7d", "30d"]).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    tenantId: phase9IdentifierSchema.optional(),
    agentType: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const platformOverviewFreshnessSchema = z
  .object({
    state: z.enum(["FRESH", "STALE", "UNKNOWN"]),
    source: z.enum(["LIVE_QUERY", "LIVE_PROBE", "SNAPSHOT"]),
    checkedAt: phase9IsoDateTimeSchema,
    freshAt: phase9IsoDateTimeSchema.nullable(),
    ageSeconds: nonnegativeIntegerSchema.nullable(),
    staleAfterSeconds: z.number().int().positive(),
    reason: z.string().trim().min(1).max(300).nullable(),
  })
  .strict();

export const platformOverviewWindowSchema = z
  .object({
    kind: z.enum([
      "SELECTED_RANGE",
      "PREVIOUS_RANGE",
      "SNAPSHOT",
      "MONTH_TO_DATE",
      "PREVIOUS_MONTH_COMPARABLE",
      "FIXED_ROLLING",
    ]),
    from: phase9IsoDateTimeSchema.nullable(),
    to: phase9IsoDateTimeSchema.nullable(),
    timeZone: z.literal("UTC"),
  })
  .strict();

export const platformOverviewComparisonSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("AVAILABLE"),
      kind: z.enum(["PREVIOUS_PERIOD", "PREVIOUS_MONTH_COMPARABLE"]),
      window: platformOverviewWindowSchema,
      previousValue: z.number(),
      delta: z.number(),
      deltaUnit: z.enum(["COUNT", "PERCENTAGE_POINTS", "MICRO_USD"]),
    })
    .strict(),
  z
    .object({
      state: z.literal("UNAVAILABLE"),
      reason: z.enum(["NOT_APPLICABLE", "NO_HISTORY", "INSUFFICIENT_SAMPLE", "SOURCE_UNAVAILABLE"]),
    })
    .strict(),
]);

export const platformOverviewMetricContextSchema = z
  .object({
    state: z.enum(["AVAILABLE", "NO_DATA", "INSUFFICIENT_SAMPLE", "UNKNOWN"]),
    window: platformOverviewWindowSchema,
    sampleSize: nonnegativeIntegerSchema,
    minimumSample: nonnegativeIntegerSchema,
    freshness: platformOverviewFreshnessSchema,
    comparison: platformOverviewComparisonSchema,
    appliedFilters: z.array(appliedFilterSchema).max(2),
  })
  .strict();

export const platformOverviewSectionContextSchema = z
  .object({
    state: z.enum(["AVAILABLE", "PARTIAL", "UNKNOWN"]),
    freshness: platformOverviewFreshnessSchema,
    appliedFilters: z.array(appliedFilterSchema).max(2),
  })
  .strict();

export const platformOverviewScopeSchema = z
  .object({
    tenantId: phase9IdentifierSchema.nullable(),
    tenantName: z.string().trim().min(1).max(200).nullable(),
    agentType: z.string().trim().min(1).max(100).nullable(),
    component: z.string().trim().min(1).max(100).nullable(),
  })
  .strict();

export const platformOverviewCauseSchema = z
  .object({
    causeId: phase9IdentifierSchema,
    severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
    title: z.string().trim().min(1).max(200),
    scope: platformOverviewScopeSchema,
    diagnosticsHref: z.string().startsWith("/platform/"),
    evidenceAt: phase9IsoDateTimeSchema.nullable(),
  })
  .strict();

export const platformOverviewKpisSchema = z
  .object({
    criticalIssues: z
      .object({
        value: nonnegativeIntegerSchema.nullable(),
        critical: nonnegativeIntegerSchema.nullable(),
        high: nonnegativeIntegerSchema.nullable(),
        oldestEvidenceAt: phase9IsoDateTimeSchema.nullable(),
        context: platformOverviewMetricContextSchema,
      })
      .strict(),
    tenantHealth: z
      .object({
        healthy: nonnegativeIntegerSchema.nullable(),
        total: nonnegativeIntegerSchema.nullable(),
        warning: nonnegativeIntegerSchema.nullable(),
        critical: nonnegativeIntegerSchema.nullable(),
        unknown: nonnegativeIntegerSchema.nullable(),
        inactive: nonnegativeIntegerSchema.nullable(),
        context: platformOverviewMetricContextSchema,
      })
      .strict(),
    agentCompletion: z
      .object({
        valuePercent: percentageSchema.nullable(),
        completed: nonnegativeIntegerSchema.nullable(),
        terminal: nonnegativeIntegerSchema.nullable(),
        failed: nonnegativeIntegerSchema.nullable(),
        degraded: nonnegativeIntegerSchema.nullable(),
        rejected: nonnegativeIntegerSchema.nullable(),
        context: platformOverviewMetricContextSchema,
      })
      .strict(),
    reviewSla: z
      .object({
        breached: nonnegativeIntegerSchema.nullable(),
        waiting: nonnegativeIntegerSchema.nullable(),
        withoutDueAt: nonnegativeIntegerSchema.nullable(),
        oldestWaitingAt: phase9IsoDateTimeSchema.nullable(),
        oldestBreachedDueAt: phase9IsoDateTimeSchema.nullable(),
        context: platformOverviewMetricContextSchema,
      })
      .strict(),
    aiSpend: z
      .object({
        microUsd: nonnegativeIntegerSchema.nullable(),
        actualMicroUsd: nonnegativeIntegerSchema.nullable(),
        estimatedMicroUsd: nonnegativeIntegerSchema.nullable(),
        actualRunCount: nonnegativeIntegerSchema.nullable(),
        estimatedRunCount: nonnegativeIntegerSchema.nullable(),
        actualCoveragePercent: percentageSchema.nullable(),
        context: platformOverviewMetricContextSchema,
      })
      .strict(),
  })
  .strict();

export const platformOverviewAttentionItemSchema = z
  .object({
    signalId: phase9IdentifierSchema,
    incidentId: phase9IdentifierSchema.nullable(),
    ruleKey: phase9IdentifierSchema,
    ruleVersion: z.string().trim().min(1).max(100),
    severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
    state: z.enum(["OPEN", "ACKNOWLEDGED", "REOPENED"]),
    title: z.string().trim().min(1).max(200),
    impact: z.string().trim().min(1).max(500),
    scope: platformOverviewScopeSchema,
    firstEvidenceAt: phase9IsoDateTimeSchema.nullable(),
    lastEvidenceAt: phase9IsoDateTimeSchema.nullable(),
    evidence: z
      .array(
        z
          .object({
            metricKey: phase9IdentifierSchema,
            value: z.union([z.number(), z.string(), z.boolean()]),
            unit: z.string().trim().min(1).max(50),
            observedAt: phase9IsoDateTimeSchema,
          })
          .strict(),
      )
      .min(1)
      .max(10),
    recommendedAction: z.string().trim().min(1).max(500),
    diagnosticsHref: z.string().startsWith("/platform/"),
    freshness: platformOverviewFreshnessSchema,
  })
  .strict();

export const platformOverviewAttentionSchema = z
  .object({
    context: platformOverviewSectionContextSchema,
    total: nonnegativeIntegerSchema,
    truncated: z.boolean(),
    items: z.array(platformOverviewAttentionItemSchema).max(10),
  })
  .strict();

export const platformOverviewTenantItemSchema = z
  .object({
    tenantId: phase9IdentifierSchema,
    name: z.string().trim().min(1).max(200),
    health: z.enum(["HEALTHY", "WARNING", "CRITICAL", "UNKNOWN", "INACTIVE"]),
    reasons: z.array(platformOverviewCauseSchema).max(3),
    users: z
      .object({ loggedIn24h: nonnegativeIntegerSchema, activeAccounts: nonnegativeIntegerSchema })
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
      })
      .strict()
      .nullable(),
    review: z
      .object({ waiting: nonnegativeIntegerSchema, breached: nonnegativeIntegerSchema })
      .strict()
      .nullable(),
    issues: z
      .object({
        critical: nonnegativeIntegerSchema,
        high: nonnegativeIntegerSchema,
        medium: nonnegativeIntegerSchema,
        low: nonnegativeIntegerSchema,
      })
      .strict()
      .nullable(),
    aiSpendMicroUsd: nonnegativeIntegerSchema.nullable(),
    storageBytes: nonnegativeIntegerSchema.nullable(),
    lastActivityAt: phase9IsoDateTimeSchema.nullable(),
    unknownFields: z
      .array(z.enum(["USERS", "RUNS", "REVIEW", "ISSUES", "AI_SPEND", "STORAGE", "LAST_ACTIVITY"]))
      .max(7),
  })
  .strict();

export const platformOverviewTenantHealthPreviewSchema = z
  .object({
    context: platformOverviewSectionContextSchema,
    total: nonnegativeIntegerSchema,
    truncated: z.boolean(),
    items: z.array(platformOverviewTenantItemSchema).max(10),
  })
  .strict();

export const platformOverviewAgentItemSchema = z
  .object({
    agentType: z.string().trim().min(1).max(100),
    state: z.enum(["ACTIVE", "DEGRADED", "UNKNOWN"]),
    runs: nonnegativeIntegerSchema,
    terminal: nonnegativeIntegerSchema,
    completed: nonnegativeIntegerSchema,
    failed: nonnegativeIntegerSchema,
    degraded: nonnegativeIntegerSchema,
    rejected: nonnegativeIntegerSchema,
    completionPercent: percentageSchema.nullable(),
    p50LatencyMs: nonnegativeIntegerSchema.nullable(),
    p95LatencyMs: nonnegativeIntegerSchema.nullable(),
    retriedRuns: nonnegativeIntegerSchema,
    retryRatePercent: percentageSchema.nullable(),
    stuck: nonnegativeIntegerSchema,
    lastSuccessAt: phase9IsoDateTimeSchema.nullable(),
    costMicroUsd: nonnegativeIntegerSchema,
    reasons: z.array(platformOverviewCauseSchema).max(3),
  })
  .strict();

export const platformOverviewAgentHealthPreviewSchema = z
  .object({
    context: platformOverviewSectionContextSchema,
    total: nonnegativeIntegerSchema,
    truncated: z.boolean(),
    items: z.array(platformOverviewAgentItemSchema).max(10),
  })
  .strict();

export const platformOverviewSystemComponentSchema = z
  .object({
    component: z.enum([
      "API",
      "POSTGRES",
      "OUTBOX",
      "ARTIFACT_METADATA",
      "NOTIFICATION",
      "AI_PROVIDER",
    ]),
    state: z.enum(["HEALTHY", "DEGRADED", "DOWN", "UNKNOWN"]),
    required: z.boolean(),
    summary: z.string().trim().min(1).max(300),
    metrics: z
      .array(
        z
          .object({
            key: phase9IdentifierSchema,
            value: z.union([z.number(), z.string(), z.boolean()]),
            unit: z.string().trim().min(1).max(50),
          })
          .strict(),
      )
      .max(20),
    freshness: platformOverviewFreshnessSchema,
    diagnosticsHref: z.string().startsWith("/platform/"),
  })
  .strict();

export const platformOverviewSystemHealthSchema = z
  .object({
    context: platformOverviewSectionContextSchema,
    components: z.array(platformOverviewSystemComponentSchema).max(10),
  })
  .strict();

export const platformOverviewAuditItemSchema = z
  .object({
    id: phase9IdentifierSchema,
    actorId: phase9IdentifierSchema.nullable(),
    actorDisplayName: z.string().trim().min(1).max(200).nullable(),
    actorRole: z.string().trim().min(1).max(100).nullable(),
    action: z.string().trim().min(1).max(200),
    tenantId: phase9IdentifierSchema.nullable(),
    resourceType: z.string().trim().min(1).max(100),
    resourceId: phase9IdentifierSchema.nullable(),
    occurredAt: phase9IsoDateTimeSchema,
    result: z.enum(["SUCCESS", "DENIED", "FAILED"]),
    correlationId: phase9IdentifierSchema,
    detailHref: z.string().startsWith("/platform/"),
  })
  .strict();

export const platformOverviewRecentAuditSchema = z
  .object({
    context: platformOverviewSectionContextSchema,
    items: z.array(platformOverviewAuditItemSchema).max(5),
  })
  .strict();

export const platformOverviewResponseSchema = z
  .object({
    schemaVersion: z.literal("platform-overview.v1"),
    generatedAt: phase9IsoDateTimeSchema,
    asOf: phase9IsoDateTimeSchema,
    window: platformOverviewWindowSchema,
    filters: z
      .object({
        tenantId: phase9IdentifierSchema.nullable(),
        agentType: z.string().trim().min(1).max(100).nullable(),
      })
      .strict(),
    freshness: platformOverviewFreshnessSchema,
    partial: z.boolean(),
    problems: z
      .array(
        z
          .object({
            section: z.enum(["TENANTS", "AGENTS", "REVIEWS", "USAGE", "SYSTEM", "AUDIT"]),
            code: z.enum(["SOURCE_UNAVAILABLE", "SOURCE_STALE"]),
            message: z.string().trim().min(1).max(300),
            retryable: z.boolean(),
          })
          .strict(),
      )
      .max(10),
    platformStatus: z
      .object({
        state: z.enum(["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"]),
        evaluatedAt: phase9IsoDateTimeSchema,
        ruleSetVersion: z.literal("platform-overview-rules.v1"),
      })
      .strict(),
    topCauses: z.array(platformOverviewCauseSchema).max(3),
    kpis: platformOverviewKpisSchema,
    attention: platformOverviewAttentionSchema,
    tenantHealthPreview: platformOverviewTenantHealthPreviewSchema,
    agentHealthPreview: platformOverviewAgentHealthPreviewSchema,
    systemHealth: platformOverviewSystemHealthSchema,
    recentAudit: platformOverviewRecentAuditSchema,
  })
  .strict();

export type PlatformOverviewQuery = z.infer<typeof platformOverviewQuerySchema>;
export type PlatformOverviewResponse = z.infer<typeof platformOverviewResponseSchema>;
export type PlatformOverviewFreshness = z.infer<typeof platformOverviewFreshnessSchema>;
export type PlatformOverviewWindow = z.infer<typeof platformOverviewWindowSchema>;
export type PlatformOverviewCause = z.infer<typeof platformOverviewCauseSchema>;
export type PlatformOverviewSectionContext = z.infer<typeof platformOverviewSectionContextSchema>;
export type PlatformOverviewSystemComponent = z.infer<typeof platformOverviewSystemComponentSchema>;
export type PlatformOverviewAttentionItem = z.infer<typeof platformOverviewAttentionItemSchema>;
export type PlatformOverviewTenantItem = z.infer<typeof platformOverviewTenantItemSchema>;
export type PlatformOverviewAgentItem = z.infer<typeof platformOverviewAgentItemSchema>;
