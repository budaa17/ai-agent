import { z } from "zod";

export const platformLoginRequestSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(12),
  })
  .strict();

export const platformRoleSchema = z.enum([
  "PLATFORM_SUPER_ADMIN",
  "PLATFORM_OPERATOR",
  "PLATFORM_AUDITOR",
]);

export const platformPermissionSchema = z.enum([
  "PLATFORM_OVERVIEW_READ",
  "PLATFORM_TENANT_HEALTH_READ",
  "PLATFORM_AGENT_HEALTH_READ",
  "PLATFORM_AGENT_RUN_DIAGNOSTICS_READ",
  "PLATFORM_REVIEW_MONITOR_READ",
  "PLATFORM_USAGE_READ",
  "PLATFORM_SYSTEM_HEALTH_READ",
  "PLATFORM_AUDIT_READ",
  "PLATFORM_INCIDENT_MANAGE",
  "PLATFORM_INTEGRATION_MANAGE",
  "PLATFORM_SETTINGS_MANAGE",
  "PLATFORM_AGENT_STATE_MANAGE",
  "PLATFORM_SUPPORT_ACCESS_GRANT",
  "PLATFORM_BILLING_READ",
  "PLATFORM_BILLING_MANAGE",
  "PLATFORM_PLAN_MANAGE",
]);

export const platformSessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    principal: z
      .object({
        principalKind: z.literal("PLATFORM"),
        id: z.string(),
        email: z.string().email(),
        displayName: z.string(),
        role: platformRoleSchema,
      })
      .strict(),
    permissions: z.array(platformPermissionSchema),
  })
  .strict();

const platformIsoDateTimeSchema = z.string().datetime({ offset: true });
const platformIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);
const platformNonNegativeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const platformPercentageSchema = z.number().min(0).max(100);

export const platformOverviewQuerySchema = z
  .object({
    window: z.enum(["24h", "7d", "30d"]).optional(),
    from: platformIsoDateTimeSchema.optional(),
    to: platformIsoDateTimeSchema.optional(),
    tenantId: platformIdentifierSchema.optional(),
    agentType: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasCustomBoundary = value.from !== undefined || value.to !== undefined;
    if (value.window !== undefined && hasCustomBoundary) {
      context.addIssue({
        code: "custom",
        message: "Preset window болон custom range-ийг зэрэг илгээхгүй",
      });
    }
    if ((value.from === undefined) !== (value.to === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Custom range-д from, to хоёул шаардлагатай",
      });
    }
    if (
      value.from !== undefined &&
      value.to !== undefined &&
      Date.parse(value.from) >= Date.parse(value.to)
    ) {
      context.addIssue({
        code: "custom",
        message: "Custom range-ийн эхлэл төгсгөлөөс өмнө байна",
      });
    }
    if (
      value.from !== undefined &&
      value.to !== undefined &&
      Date.parse(value.to) - Date.parse(value.from) > 90 * 24 * 60 * 60 * 1_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Custom range 90 хоногоос урт байж болохгүй",
      });
    }
    if (value.to !== undefined && Date.parse(value.to) > Date.now()) {
      context.addIssue({
        code: "custom",
        message: "Custom range-ийн төгсгөл ирээдүйд байж болохгүй",
      });
    }
  });

export const platformSeveritySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const platformHealthSchema = z.enum([
  "HEALTHY",
  "WARNING",
  "CRITICAL",
  "UNKNOWN",
  "INACTIVE",
]);

export const platformFreshnessSchema = z
  .object({
    state: z.enum(["FRESH", "STALE", "UNKNOWN"]),
    source: z.enum(["LIVE_QUERY", "LIVE_PROBE", "SNAPSHOT"]),
    checkedAt: platformIsoDateTimeSchema,
    freshAt: platformIsoDateTimeSchema.nullable(),
    ageSeconds: platformNonNegativeIntegerSchema.nullable(),
    staleAfterSeconds: z.number().int().positive(),
    reason: z.string().trim().min(1).max(300).nullable(),
  })
  .strict();

export const platformMetricWindowSchema = z
  .object({
    kind: z.enum([
      "SELECTED_RANGE",
      "PREVIOUS_RANGE",
      "SNAPSHOT",
      "MONTH_TO_DATE",
      "PREVIOUS_MONTH_COMPARABLE",
      "FIXED_ROLLING",
    ]),
    from: platformIsoDateTimeSchema.nullable(),
    to: platformIsoDateTimeSchema.nullable(),
    timeZone: z.literal("UTC"),
  })
  .strict();

export const platformMetricComparisonSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("AVAILABLE"),
      kind: z.enum(["PREVIOUS_PERIOD", "PREVIOUS_MONTH_COMPARABLE"]),
      window: platformMetricWindowSchema,
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

export const platformMetricContextSchema = z
  .object({
    state: z.enum(["AVAILABLE", "NO_DATA", "INSUFFICIENT_SAMPLE", "UNKNOWN"]),
    window: platformMetricWindowSchema,
    sampleSize: platformNonNegativeIntegerSchema,
    minimumSample: platformNonNegativeIntegerSchema,
    freshness: platformFreshnessSchema,
    comparison: platformMetricComparisonSchema,
    appliedFilters: z.array(z.enum(["TENANT_ID", "AGENT_TYPE"])).max(2),
  })
  .strict();

export const platformSectionContextSchema = z
  .object({
    state: z.enum(["AVAILABLE", "PARTIAL", "UNKNOWN"]),
    freshness: platformFreshnessSchema,
    appliedFilters: z.array(z.enum(["TENANT_ID", "AGENT_TYPE"])).max(2),
  })
  .strict();

export const platformScopeSchema = z
  .object({
    tenantId: platformIdentifierSchema.nullable(),
    tenantName: z.string().trim().min(1).max(200).nullable(),
    agentType: z.string().trim().min(1).max(100).nullable(),
    component: z.string().trim().min(1).max(100).nullable(),
  })
  .strict();

export const platformCauseSchema = z
  .object({
    causeId: platformIdentifierSchema,
    severity: platformSeveritySchema,
    title: z.string().trim().min(1).max(200),
    scope: platformScopeSchema,
    diagnosticsHref: z.string().startsWith("/platform/"),
    evidenceAt: platformIsoDateTimeSchema.nullable(),
  })
  .strict();

const platformKpisSchema = z
  .object({
    criticalIssues: z
      .object({
        value: platformNonNegativeIntegerSchema.nullable(),
        critical: platformNonNegativeIntegerSchema.nullable(),
        high: platformNonNegativeIntegerSchema.nullable(),
        oldestEvidenceAt: platformIsoDateTimeSchema.nullable(),
        context: platformMetricContextSchema,
      })
      .strict(),
    tenantHealth: z
      .object({
        healthy: platformNonNegativeIntegerSchema.nullable(),
        total: platformNonNegativeIntegerSchema.nullable(),
        warning: platformNonNegativeIntegerSchema.nullable(),
        critical: platformNonNegativeIntegerSchema.nullable(),
        unknown: platformNonNegativeIntegerSchema.nullable(),
        inactive: platformNonNegativeIntegerSchema.nullable(),
        context: platformMetricContextSchema,
      })
      .strict(),
    agentCompletion: z
      .object({
        valuePercent: platformPercentageSchema.nullable(),
        completed: platformNonNegativeIntegerSchema.nullable(),
        terminal: platformNonNegativeIntegerSchema.nullable(),
        failed: platformNonNegativeIntegerSchema.nullable(),
        degraded: platformNonNegativeIntegerSchema.nullable(),
        rejected: platformNonNegativeIntegerSchema.nullable(),
        context: platformMetricContextSchema,
      })
      .strict(),
    reviewSla: z
      .object({
        breached: platformNonNegativeIntegerSchema.nullable(),
        waiting: platformNonNegativeIntegerSchema.nullable(),
        withoutDueAt: platformNonNegativeIntegerSchema.nullable(),
        oldestWaitingAt: platformIsoDateTimeSchema.nullable(),
        oldestBreachedDueAt: platformIsoDateTimeSchema.nullable(),
        context: platformMetricContextSchema,
      })
      .strict(),
    aiSpend: z
      .object({
        microUsd: platformNonNegativeIntegerSchema.nullable(),
        actualMicroUsd: platformNonNegativeIntegerSchema.nullable(),
        estimatedMicroUsd: platformNonNegativeIntegerSchema.nullable(),
        actualRunCount: platformNonNegativeIntegerSchema.nullable(),
        estimatedRunCount: platformNonNegativeIntegerSchema.nullable(),
        actualCoveragePercent: platformPercentageSchema.nullable(),
        context: platformMetricContextSchema,
      })
      .strict(),
  })
  .strict();

export const platformAttentionItemSchema = z
  .object({
    signalId: platformIdentifierSchema,
    incidentId: platformIdentifierSchema.nullable(),
    ruleKey: platformIdentifierSchema,
    ruleVersion: z.string().trim().min(1).max(100),
    severity: platformSeveritySchema,
    state: z.enum(["OPEN", "ACKNOWLEDGED", "REOPENED"]),
    title: z.string().trim().min(1).max(200),
    impact: z.string().trim().min(1).max(500),
    scope: platformScopeSchema,
    firstEvidenceAt: platformIsoDateTimeSchema.nullable(),
    lastEvidenceAt: platformIsoDateTimeSchema.nullable(),
    evidence: z
      .array(
        z
          .object({
            metricKey: platformIdentifierSchema,
            value: z.union([z.number(), z.string(), z.boolean()]),
            unit: z.string().trim().min(1).max(50),
            observedAt: platformIsoDateTimeSchema,
          })
          .strict(),
      )
      .min(1)
      .max(10),
    recommendedAction: z.string().trim().min(1).max(500),
    diagnosticsHref: z.string().startsWith("/platform/"),
    freshness: platformFreshnessSchema,
  })
  .strict();

export const platformAttentionSchema = z
  .object({
    context: platformSectionContextSchema,
    total: platformNonNegativeIntegerSchema,
    truncated: z.boolean(),
    items: z.array(platformAttentionItemSchema).max(10),
  })
  .strict();

export const platformTenantHealthItemSchema = z
  .object({
    tenantId: platformIdentifierSchema,
    name: z.string().trim().min(1).max(200),
    health: platformHealthSchema,
    reasons: z.array(platformCauseSchema).max(3),
    users: z
      .object({
        loggedIn24h: platformNonNegativeIntegerSchema,
        activeAccounts: platformNonNegativeIntegerSchema,
      })
      .strict()
      .nullable(),
    runs: z
      .object({
        total: platformNonNegativeIntegerSchema,
        completed: platformNonNegativeIntegerSchema,
        failed: platformNonNegativeIntegerSchema,
        degraded: platformNonNegativeIntegerSchema,
        rejected: platformNonNegativeIntegerSchema,
        stuck: platformNonNegativeIntegerSchema,
      })
      .strict()
      .nullable(),
    review: z
      .object({
        waiting: platformNonNegativeIntegerSchema,
        breached: platformNonNegativeIntegerSchema,
      })
      .strict()
      .nullable(),
    issues: z
      .object({
        critical: platformNonNegativeIntegerSchema,
        high: platformNonNegativeIntegerSchema,
        medium: platformNonNegativeIntegerSchema,
        low: platformNonNegativeIntegerSchema,
      })
      .strict()
      .nullable(),
    aiSpendMicroUsd: platformNonNegativeIntegerSchema.nullable(),
    storageBytes: platformNonNegativeIntegerSchema.nullable(),
    lastActivityAt: platformIsoDateTimeSchema.nullable(),
    unknownFields: z
      .array(z.enum(["USERS", "RUNS", "REVIEW", "ISSUES", "AI_SPEND", "STORAGE", "LAST_ACTIVITY"]))
      .max(7),
  })
  .strict();

export const platformTenantHealthPreviewSchema = z
  .object({
    context: platformSectionContextSchema,
    total: platformNonNegativeIntegerSchema,
    truncated: z.boolean(),
    items: z.array(platformTenantHealthItemSchema).max(10),
  })
  .strict();

export const platformAgentHealthItemSchema = z
  .object({
    agentType: z.string().trim().min(1).max(100),
    state: z.enum(["ACTIVE", "DEGRADED", "UNKNOWN"]),
    runs: platformNonNegativeIntegerSchema,
    terminal: platformNonNegativeIntegerSchema,
    completed: platformNonNegativeIntegerSchema,
    failed: platformNonNegativeIntegerSchema,
    degraded: platformNonNegativeIntegerSchema,
    rejected: platformNonNegativeIntegerSchema,
    completionPercent: platformPercentageSchema.nullable(),
    p50LatencyMs: platformNonNegativeIntegerSchema.nullable(),
    p95LatencyMs: platformNonNegativeIntegerSchema.nullable(),
    retriedRuns: platformNonNegativeIntegerSchema,
    retryRatePercent: platformPercentageSchema.nullable(),
    stuck: platformNonNegativeIntegerSchema,
    lastSuccessAt: platformIsoDateTimeSchema.nullable(),
    costMicroUsd: platformNonNegativeIntegerSchema,
    reasons: z.array(platformCauseSchema).max(3),
  })
  .strict();

export const platformAgentHealthPreviewSchema = z
  .object({
    context: platformSectionContextSchema,
    total: platformNonNegativeIntegerSchema,
    truncated: z.boolean(),
    items: z.array(platformAgentHealthItemSchema).max(10),
  })
  .strict();

const platformSystemMetricSchema = z
  .object({
    key: platformIdentifierSchema,
    value: z.union([z.number(), z.string(), z.boolean()]),
    unit: z.string().trim().min(1).max(50),
  })
  .strict();

export const platformSystemComponentSchema = z
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
    metrics: z.array(platformSystemMetricSchema).max(20),
    freshness: platformFreshnessSchema,
    diagnosticsHref: z.string().startsWith("/platform/"),
  })
  .strict();

export const platformSystemHealthSchema = z
  .object({
    context: platformSectionContextSchema,
    components: z.array(platformSystemComponentSchema).max(10),
  })
  .strict();

export const platformAuditItemSchema = z
  .object({
    id: platformIdentifierSchema,
    actorId: platformIdentifierSchema.nullable(),
    actorDisplayName: z.string().trim().min(1).max(200).nullable(),
    actorRole: z.string().trim().min(1).max(100).nullable(),
    action: z.string().trim().min(1).max(200),
    tenantId: platformIdentifierSchema.nullable(),
    resourceType: z.string().trim().min(1).max(100),
    resourceId: platformIdentifierSchema.nullable(),
    occurredAt: platformIsoDateTimeSchema,
    result: z.enum(["SUCCESS", "DENIED", "FAILED"]),
    correlationId: platformIdentifierSchema,
    detailHref: z.string().startsWith("/platform/"),
  })
  .strict();

export const platformRecentAuditSchema = z
  .object({
    context: platformSectionContextSchema,
    items: z.array(platformAuditItemSchema).max(5),
  })
  .strict();

export const platformOverviewResponseSchema = z
  .object({
    schemaVersion: z.literal("platform-overview.v1"),
    generatedAt: platformIsoDateTimeSchema,
    asOf: platformIsoDateTimeSchema,
    window: platformMetricWindowSchema,
    filters: z
      .object({
        tenantId: platformIdentifierSchema.nullable(),
        agentType: z.string().trim().min(1).max(100).nullable(),
      })
      .strict(),
    freshness: platformFreshnessSchema,
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
        evaluatedAt: platformIsoDateTimeSchema,
        ruleSetVersion: z.literal("platform-overview-rules.v1"),
      })
      .strict(),
    topCauses: z.array(platformCauseSchema).max(3),
    kpis: platformKpisSchema,
    attention: platformAttentionSchema,
    tenantHealthPreview: platformTenantHealthPreviewSchema,
    agentHealthPreview: platformAgentHealthPreviewSchema,
    systemHealth: platformSystemHealthSchema,
    recentAudit: platformRecentAuditSchema,
  })
  .strict();

/* ------------------------------ Phase 5 drill-down ---------------------- */

const platformRangeQueryShape = {
  window: z.enum(["24h", "7d", "30d"]).optional(),
  from: platformIsoDateTimeSchema.optional(),
  to: platformIsoDateTimeSchema.optional(),
} as const;

const platformPageQueryShape = {
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).max(2_048).optional(),
} as const;

/** Same range rules the backend enforces, so an invalid filter never leaves the console. */
function refinePlatformRange(
  value: { window?: string | undefined; from?: string | undefined; to?: string | undefined },
  context: z.RefinementCtx,
) {
  const hasCustomBoundary = value.from !== undefined || value.to !== undefined;
  if (value.window !== undefined && hasCustomBoundary) {
    context.addIssue({
      code: "custom",
      message: "Preset window болон custom range-ийг зэрэг илгээхгүй",
    });
  }
  if ((value.from === undefined) !== (value.to === undefined)) {
    context.addIssue({ code: "custom", message: "Custom range-д from, to хоёул шаардлагатай" });
  }
  if (
    value.from !== undefined &&
    value.to !== undefined &&
    Date.parse(value.from) >= Date.parse(value.to)
  ) {
    context.addIssue({ code: "custom", message: "Custom range-ийн эхлэл төгсгөлөөс өмнө байна" });
  }
  if (
    value.from !== undefined &&
    value.to !== undefined &&
    Date.parse(value.to) - Date.parse(value.from) > 90 * 24 * 60 * 60 * 1_000
  ) {
    context.addIssue({ code: "custom", message: "Custom range 90 хоногоос урт байж болохгүй" });
  }
}

const platformListProblemSchema = z
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
    nextCursor: z.string().trim().min(1).max(2_048).nullable(),
    sort: z.string().trim().min(1).max(60),
    order: z.enum(["ASC", "DESC"]),
  })
  .strict();

function platformEnvelope<Shape extends z.ZodRawShape>(schemaVersion: string, shape: Shape) {
  return z
    .object({
      schemaVersion: z.literal(schemaVersion),
      generatedAt: platformIsoDateTimeSchema,
      asOf: platformIsoDateTimeSchema,
      window: platformMetricWindowSchema,
      freshness: platformFreshnessSchema,
      partial: z.boolean(),
      problems: z.array(platformListProblemSchema).max(10),
      ...shape,
    })
    .strict();
}

const platformAgentTypeSchema = z.string().trim().min(1).max(100);
const platformHrefSchema = z.string().startsWith("/platform/");

export const platformTenantListQuerySchema = z
  .object({
    ...platformRangeQueryShape,
    ...platformPageQueryShape,
    search: z.string().trim().min(1).max(200).optional(),
    health: platformHealthSchema.optional(),
    sort: z
      .enum(["HEALTH", "NAME", "LAST_ACTIVITY", "RUNS", "REVIEW_BREACHED", "AI_SPEND"])
      .optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict()
  .superRefine(refinePlatformRange);

export const platformTenantListItemSchema = z
  .object({
    tenantId: platformIdentifierSchema,
    name: z.string().trim().min(1).max(200),
    health: platformHealthSchema,
    reasons: z.array(platformCauseSchema).max(3),
    users: z
      .object({
        loggedIn24h: platformNonNegativeIntegerSchema,
        activeAccounts: platformNonNegativeIntegerSchema,
      })
      .strict()
      .nullable(),
    projects: z
      .object({
        total: platformNonNegativeIntegerSchema,
        active: platformNonNegativeIntegerSchema,
      })
      .strict()
      .nullable(),
    runs: z
      .object({
        total: platformNonNegativeIntegerSchema,
        completed: platformNonNegativeIntegerSchema,
        failed: platformNonNegativeIntegerSchema,
        degraded: platformNonNegativeIntegerSchema,
        rejected: platformNonNegativeIntegerSchema,
        stuck: platformNonNegativeIntegerSchema,
        completionPercent: platformPercentageSchema.nullable(),
      })
      .strict()
      .nullable(),
    review: z
      .object({
        waiting: platformNonNegativeIntegerSchema,
        breached: platformNonNegativeIntegerSchema,
      })
      .strict()
      .nullable(),
    aiSpendMicroUsd: platformNonNegativeIntegerSchema.nullable(),
    storageBytes: platformNonNegativeIntegerSchema.nullable(),
    lastActivityAt: platformIsoDateTimeSchema.nullable(),
    detailHref: platformHrefSchema,
    unknownFields: z
      .array(
        z.enum(["USERS", "PROJECTS", "RUNS", "REVIEW", "AI_SPEND", "STORAGE", "LAST_ACTIVITY"]),
      )
      .max(7),
  })
  .strict();

export const platformTenantListResponseSchema = platformEnvelope("platform-tenants.v1", {
  filters: z
    .object({
      search: z.string().trim().min(1).max(200).nullable(),
      health: platformHealthSchema.nullable(),
    })
    .strict(),
  page: platformListPageSchema,
  totals: z
    .object({
      matched: platformNonNegativeIntegerSchema,
      healthy: platformNonNegativeIntegerSchema,
      warning: platformNonNegativeIntegerSchema,
      critical: platformNonNegativeIntegerSchema,
      unknown: platformNonNegativeIntegerSchema,
      inactive: platformNonNegativeIntegerSchema,
    })
    .strict(),
  items: z.array(platformTenantListItemSchema).max(100),
});

export const platformTenantHealthResponseSchema = platformEnvelope("platform-tenant-health.v1", {
  tenant: z
    .object({
      tenantId: platformIdentifierSchema,
      name: z.string().trim().min(1).max(200),
      health: platformHealthSchema,
      createdAt: platformIsoDateTimeSchema.nullable(),
      lastActivityAt: platformIsoDateTimeSchema.nullable(),
      inactiveDays: platformNonNegativeIntegerSchema.nullable(),
    })
    .strict(),
  signals: z
    .object({
      context: platformSectionContextSchema,
      total: platformNonNegativeIntegerSchema,
      items: z.array(platformCauseSchema).max(10),
    })
    .strict(),
  users: z
    .object({
      context: platformSectionContextSchema,
      activeAccounts: platformNonNegativeIntegerSchema.nullable(),
      suspendedAccounts: platformNonNegativeIntegerSchema.nullable(),
      loggedIn24h: platformNonNegativeIntegerSchema.nullable(),
      loggedIn7d: platformNonNegativeIntegerSchema.nullable(),
      neverLoggedIn: platformNonNegativeIntegerSchema.nullable(),
    })
    .strict(),
  agents: z
    .object({
      context: platformSectionContextSchema,
      total: platformNonNegativeIntegerSchema,
      items: z
        .array(
          z
            .object({
              agentType: platformAgentTypeSchema,
              runs: platformNonNegativeIntegerSchema,
              terminal: platformNonNegativeIntegerSchema,
              completed: platformNonNegativeIntegerSchema,
              failed: platformNonNegativeIntegerSchema,
              degraded: platformNonNegativeIntegerSchema,
              rejected: platformNonNegativeIntegerSchema,
              stuck: platformNonNegativeIntegerSchema,
              completionPercent: platformPercentageSchema.nullable(),
              lastSuccessAt: platformIsoDateTimeSchema.nullable(),
              costMicroUsd: platformNonNegativeIntegerSchema,
              runsHref: platformHrefSchema,
            })
            .strict(),
        )
        .max(50),
    })
    .strict(),
  review: z
    .object({
      context: platformSectionContextSchema,
      waiting: platformNonNegativeIntegerSchema.nullable(),
      breached: platformNonNegativeIntegerSchema.nullable(),
      withoutDueAt: platformNonNegativeIntegerSchema.nullable(),
      oldestWaitingAt: platformIsoDateTimeSchema.nullable(),
      oldestBreachedDueAt: platformIsoDateTimeSchema.nullable(),
      backlogHref: platformHrefSchema,
    })
    .strict(),
  delivery: z
    .object({
      context: platformSectionContextSchema,
      components: z.array(platformSystemComponentSchema).max(10),
    })
    .strict(),
  storage: z
    .object({
      context: platformSectionContextSchema,
      totalBytes: platformNonNegativeIntegerSchema.nullable(),
      fileCount: platformNonNegativeIntegerSchema.nullable(),
      quarantinedCount: platformNonNegativeIntegerSchema.nullable(),
    })
    .strict(),
});

export const platformAgentListQuerySchema = z
  .object({
    ...platformRangeQueryShape,
    ...platformPageQueryShape,
    tenantId: platformIdentifierSchema.optional(),
    state: z.enum(["ACTIVE", "DEGRADED", "UNKNOWN"]).optional(),
    sort: z.enum(["STATE", "AGENT_TYPE", "RUNS", "COMPLETION", "P95_LATENCY", "COST"]).optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict()
  .superRefine(refinePlatformRange);

export const platformAgentListItemSchema = z
  .object({
    agentType: platformAgentTypeSchema,
    state: z.enum(["ACTIVE", "DEGRADED", "UNKNOWN"]),
    runs: platformNonNegativeIntegerSchema,
    terminal: platformNonNegativeIntegerSchema,
    completed: platformNonNegativeIntegerSchema,
    failed: platformNonNegativeIntegerSchema,
    degraded: platformNonNegativeIntegerSchema,
    rejected: platformNonNegativeIntegerSchema,
    running: platformNonNegativeIntegerSchema,
    stuck: platformNonNegativeIntegerSchema,
    completionPercent: platformPercentageSchema.nullable(),
    minimumSample: platformNonNegativeIntegerSchema,
    p50LatencyMs: platformNonNegativeIntegerSchema.nullable(),
    p95LatencyMs: platformNonNegativeIntegerSchema.nullable(),
    retriedRuns: platformNonNegativeIntegerSchema,
    retryRatePercent: platformPercentageSchema.nullable(),
    lastSuccessAt: platformIsoDateTimeSchema.nullable(),
    costMicroUsd: platformNonNegativeIntegerSchema,
    reasons: z.array(platformCauseSchema).max(3),
    detailHref: platformHrefSchema,
  })
  .strict();

export const platformAgentListResponseSchema = platformEnvelope("platform-agents.v1", {
  filters: z
    .object({
      tenantId: platformIdentifierSchema.nullable(),
      state: z.enum(["ACTIVE", "DEGRADED", "UNKNOWN"]).nullable(),
    })
    .strict(),
  page: platformListPageSchema,
  totals: z
    .object({
      matched: platformNonNegativeIntegerSchema,
      active: platformNonNegativeIntegerSchema,
      degraded: platformNonNegativeIntegerSchema,
      unknown: platformNonNegativeIntegerSchema,
    })
    .strict(),
  items: z.array(platformAgentListItemSchema).max(100),
});

export const platformAgentDetailQuerySchema = z
  .object({ ...platformRangeQueryShape, tenantId: platformIdentifierSchema.optional() })
  .strict()
  .superRefine(refinePlatformRange);

export const platformAgentDetailResponseSchema = platformEnvelope("platform-agent-detail.v1", {
  filters: z.object({ tenantId: platformIdentifierSchema.nullable() }).strict(),
  agent: platformAgentListItemSchema,
  failureBreakdown: z
    .object({
      context: platformSectionContextSchema,
      items: z
        .array(
          z
            .object({
              failureCategory: z.string().trim().min(1).max(60),
              count: platformNonNegativeIntegerSchema,
              sharePercent: platformPercentageSchema.nullable(),
              lastObservedAt: platformIsoDateTimeSchema.nullable(),
            })
            .strict(),
        )
        .max(20),
    })
    .strict(),
  tenantBreakdown: z
    .object({
      context: platformSectionContextSchema,
      items: z
        .array(
          z
            .object({
              tenantId: platformIdentifierSchema,
              tenantName: z.string().trim().min(1).max(200).nullable(),
              runs: platformNonNegativeIntegerSchema,
              terminal: platformNonNegativeIntegerSchema,
              completed: platformNonNegativeIntegerSchema,
              failed: platformNonNegativeIntegerSchema,
              degraded: platformNonNegativeIntegerSchema,
              rejected: platformNonNegativeIntegerSchema,
              completionPercent: platformPercentageSchema.nullable(),
              costMicroUsd: platformNonNegativeIntegerSchema,
              healthHref: platformHrefSchema,
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
  models: z
    .object({
      context: platformSectionContextSchema,
      items: z
        .array(
          z
            .object({
              provider: z.string().trim().min(1).max(60),
              modelId: z.string().trim().min(1).max(120),
              runs: platformNonNegativeIntegerSchema,
              costMicroUsd: platformNonNegativeIntegerSchema,
              inputTokens: platformNonNegativeIntegerSchema,
              outputTokens: platformNonNegativeIntegerSchema,
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
});

export const platformAgentRunListQuerySchema = z
  .object({
    ...platformRangeQueryShape,
    ...platformPageQueryShape,
    tenantId: platformIdentifierSchema.optional(),
    agentType: platformAgentTypeSchema.optional(),
    status: z.enum(["RUNNING", "COMPLETED", "FAILED", "DEGRADED", "REJECTED"]).optional(),
    outcome: z.enum(["TERMINAL", "NON_COMPLETION"]).optional(),
    failureCategory: z.string().trim().min(1).max(60).optional(),
    stuck: z.enum(["true", "false"]).optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict()
  .superRefine(refinePlatformRange);

export const platformAgentRunItemSchema = z
  .object({
    runId: platformIdentifierSchema,
    tenantId: platformIdentifierSchema,
    tenantName: z.string().trim().min(1).max(200).nullable(),
    agentType: platformAgentTypeSchema,
    status: z.enum(["RUNNING", "COMPLETED", "FAILED", "DEGRADED", "REJECTED"]),
    failureCategory: z.string().trim().min(1).max(60),
    trigger: z.string().trim().min(1).max(60),
    provider: z.string().trim().min(1).max(60),
    modelId: z.string().trim().min(1).max(120),
    promptVersion: z.string().trim().min(1).max(60),
    startedAt: platformIsoDateTimeSchema,
    completedAt: platformIsoDateTimeSchema.nullable(),
    latencyMs: platformNonNegativeIntegerSchema,
    retryCount: platformNonNegativeIntegerSchema,
    costMicroUsd: platformNonNegativeIntegerSchema,
    costBasis: z.enum(["ACTUAL", "ESTIMATED"]),
    stuck: z.boolean(),
    diagnosticsHref: platformHrefSchema,
  })
  .strict();

export const platformAgentRunListResponseSchema = platformEnvelope("platform-agent-runs.v1", {
  filters: z
    .object({
      tenantId: platformIdentifierSchema.nullable(),
      agentType: platformAgentTypeSchema.nullable(),
      status: z.enum(["RUNNING", "COMPLETED", "FAILED", "DEGRADED", "REJECTED"]).nullable(),
      outcome: z.enum(["TERMINAL", "NON_COMPLETION"]).nullable(),
      failureCategory: z.string().trim().min(1).max(60).nullable(),
      stuck: z.boolean(),
    })
    .strict(),
  page: platformListPageSchema,
  items: z.array(platformAgentRunItemSchema).max(100),
});

export const platformAgentRunDiagnosticsResponseSchema = platformEnvelope(
  "platform-agent-run-diagnostics.v1",
  {
    run: platformAgentRunItemSchema,
    execution: z
      .object({
        requestId: platformIdentifierSchema.nullable(),
        eventId: platformIdentifierSchema.nullable(),
        traceId: platformIdentifierSchema.nullable(),
        projectId: platformIdentifierSchema,
        toolBundleVersion: z.string().trim().min(1).max(60),
        outputSchemaVersion: platformNonNegativeIntegerSchema,
        dataSnapshotVersion: z.string().trim().min(1).max(60),
        outputSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        contentLoggingEnabled: z.boolean(),
        asOf: platformIsoDateTimeSchema,
      })
      .strict(),
    usage: z
      .object({
        inputTokens: platformNonNegativeIntegerSchema,
        outputTokens: platformNonNegativeIntegerSchema,
        cachedInputTokens: platformNonNegativeIntegerSchema,
        reasoningTokens: platformNonNegativeIntegerSchema,
        estimatedCostMicroUsd: platformNonNegativeIntegerSchema,
        actualCostMicroUsd: platformNonNegativeIntegerSchema.nullable(),
      })
      .strict(),
    validation: z
      .object({
        state: z.enum(["PASSED", "FAILED", "UNKNOWN"]),
        issueCount: platformNonNegativeIntegerSchema.nullable(),
      })
      .strict(),
    toolCalls: z
      .object({
        total: platformNonNegativeIntegerSchema,
        truncated: z.boolean(),
        items: z
          .array(
            z
              .object({
                id: platformIdentifierSchema,
                toolName: z.string().trim().min(1).max(120),
                status: z.string().trim().min(1).max(60),
                sequence: platformNonNegativeIntegerSchema,
                latencyMs: platformNonNegativeIntegerSchema,
                retryCount: platformNonNegativeIntegerSchema,
                startedAt: platformIsoDateTimeSchema.nullable(),
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

export const platformReviewSummaryQuerySchema = z
  .object({ ...platformRangeQueryShape, tenantId: platformIdentifierSchema.optional() })
  .strict()
  .superRefine(refinePlatformRange);

export const platformReviewSummaryResponseSchema = platformEnvelope("platform-review-summary.v1", {
  filters: z.object({ tenantId: platformIdentifierSchema.nullable() }).strict(),
  backlog: z
    .object({
      context: platformSectionContextSchema,
      waiting: platformNonNegativeIntegerSchema.nullable(),
      breached: platformNonNegativeIntegerSchema.nullable(),
      withoutDueAt: platformNonNegativeIntegerSchema.nullable(),
      draft: platformNonNegativeIntegerSchema.nullable(),
      oldestWaitingAt: platformIsoDateTimeSchema.nullable(),
      oldestBreachedDueAt: platformIsoDateTimeSchema.nullable(),
    })
    .strict(),
  ageBuckets: z
    .object({
      context: platformSectionContextSchema,
      items: z
        .array(
          z
            .object({
              bucket: z.enum(["UNDER_24H", "H24_TO_72H", "D3_TO_D7", "OVER_7D"]),
              waiting: platformNonNegativeIntegerSchema,
              breached: platformNonNegativeIntegerSchema,
            })
            .strict(),
        )
        .max(4),
    })
    .strict(),
  byTenant: z
    .object({
      context: platformSectionContextSchema,
      items: z
        .array(
          z
            .object({
              tenantId: platformIdentifierSchema,
              tenantName: z.string().trim().min(1).max(200).nullable(),
              waiting: platformNonNegativeIntegerSchema,
              breached: platformNonNegativeIntegerSchema,
              oldestWaitingAt: platformIsoDateTimeSchema.nullable(),
              backlogHref: platformHrefSchema,
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
  byTargetType: z
    .object({
      context: platformSectionContextSchema,
      items: z
        .array(
          z
            .object({
              targetType: z.string().trim().min(1).max(60),
              waiting: platformNonNegativeIntegerSchema,
              breached: platformNonNegativeIntegerSchema,
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
  throughput: z
    .object({
      context: platformSectionContextSchema,
      decided: platformNonNegativeIntegerSchema.nullable(),
      approved: platformNonNegativeIntegerSchema.nullable(),
      rejected: platformNonNegativeIntegerSchema.nullable(),
      corrected: platformNonNegativeIntegerSchema.nullable(),
      emergencyOverrides: platformNonNegativeIntegerSchema.nullable(),
      correctionRatePercent: platformPercentageSchema.nullable(),
    })
    .strict(),
});

export const platformReviewBacklogQuerySchema = z
  .object({
    ...platformRangeQueryShape,
    ...platformPageQueryShape,
    tenantId: platformIdentifierSchema.optional(),
    sla: z.enum(["ALL", "BREACHED", "DUE_SOON", "NO_DUE_DATE"]).optional(),
    targetType: z.string().trim().min(1).max(60).optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict()
  .superRefine(refinePlatformRange);

export const platformReviewBacklogItemSchema = z
  .object({
    reviewTaskId: platformIdentifierSchema,
    tenantId: platformIdentifierSchema,
    tenantName: z.string().trim().min(1).max(200).nullable(),
    projectId: platformIdentifierSchema,
    targetType: z.string().trim().min(1).max(60),
    targetVersion: platformNonNegativeIntegerSchema,
    assignedRole: z.string().trim().min(1).max(60),
    assigned: z.boolean(),
    status: z.string().trim().min(1).max(60),
    createdAt: platformIsoDateTimeSchema,
    dueAt: platformIsoDateTimeSchema.nullable(),
    waitingSeconds: platformNonNegativeIntegerSchema,
    sla: z.enum(["BREACHED", "DUE_SOON", "ON_TRACK", "NO_DUE_DATE"]),
    tenantHref: platformHrefSchema,
  })
  .strict();

export const platformReviewBacklogResponseSchema = platformEnvelope("platform-review-backlog.v1", {
  filters: z
    .object({
      tenantId: platformIdentifierSchema.nullable(),
      sla: z.enum(["ALL", "BREACHED", "DUE_SOON", "NO_DUE_DATE"]),
      targetType: z.string().trim().min(1).max(60).nullable(),
    })
    .strict(),
  page: platformListPageSchema,
  items: z.array(platformReviewBacklogItemSchema).max(100),
});

export const platformUsageQuerySchema = z
  .object({
    ...platformRangeQueryShape,
    tenantId: platformIdentifierSchema.optional(),
    agentType: platformAgentTypeSchema.optional(),
    groupBy: z.enum(["TENANT", "AGENT_TYPE", "MODEL"]).optional(),
  })
  .strict()
  .superRefine(refinePlatformRange);

export const platformUsageGroupSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    label: z.string().trim().min(1).max(200),
    href: platformHrefSchema.nullable(),
    runs: platformNonNegativeIntegerSchema,
    costMicroUsd: platformNonNegativeIntegerSchema,
    actualMicroUsd: platformNonNegativeIntegerSchema,
    estimatedMicroUsd: platformNonNegativeIntegerSchema,
    actualRunCount: platformNonNegativeIntegerSchema,
    estimatedRunCount: platformNonNegativeIntegerSchema,
    actualCoveragePercent: platformPercentageSchema.nullable(),
    inputTokens: platformNonNegativeIntegerSchema,
    outputTokens: platformNonNegativeIntegerSchema,
    cachedInputTokens: platformNonNegativeIntegerSchema,
    reasoningTokens: platformNonNegativeIntegerSchema,
    costSharePercent: platformPercentageSchema.nullable(),
  })
  .strict();

export const platformUsageResponseSchema = platformEnvelope("platform-usage.v1", {
  filters: z
    .object({
      tenantId: platformIdentifierSchema.nullable(),
      agentType: platformAgentTypeSchema.nullable(),
      groupBy: z.enum(["TENANT", "AGENT_TYPE", "MODEL"]),
    })
    .strict(),
  totals: z
    .object({
      context: platformSectionContextSchema,
      runs: platformNonNegativeIntegerSchema.nullable(),
      costMicroUsd: platformNonNegativeIntegerSchema.nullable(),
      actualMicroUsd: platformNonNegativeIntegerSchema.nullable(),
      estimatedMicroUsd: platformNonNegativeIntegerSchema.nullable(),
      actualCoveragePercent: platformPercentageSchema.nullable(),
      inputTokens: platformNonNegativeIntegerSchema.nullable(),
      outputTokens: platformNonNegativeIntegerSchema.nullable(),
      cachedInputTokens: platformNonNegativeIntegerSchema.nullable(),
      reasoningTokens: platformNonNegativeIntegerSchema.nullable(),
      budgetModel: z.literal("NOT_CONFIGURED"),
    })
    .strict(),
  groups: z
    .object({
      context: platformSectionContextSchema,
      total: platformNonNegativeIntegerSchema,
      truncated: z.boolean(),
      items: z.array(platformUsageGroupSchema).max(50),
    })
    .strict(),
});

export const platformSystemHealthQuerySchema = z
  .object({ tenantId: platformIdentifierSchema.optional() })
  .strict();

export const platformSystemHealthResponseSchema = platformEnvelope("platform-system-health.v1", {
  filters: z.object({ tenantId: platformIdentifierSchema.nullable() }).strict(),
  state: z.enum(["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"]),
  components: z.array(platformSystemComponentSchema).max(10),
  outboxByType: z
    .object({
      context: platformSectionContextSchema,
      items: z
        .array(
          z
            .object({
              eventType: z.string().trim().min(1).max(120),
              pending: platformNonNegativeIntegerSchema,
              stalled: platformNonNegativeIntegerSchema,
              failed: platformNonNegativeIntegerSchema,
              deadLetter: platformNonNegativeIntegerSchema,
              oldestEvidenceAt: platformIsoDateTimeSchema.nullable(),
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
  tenantImpact: z
    .object({
      context: platformSectionContextSchema,
      items: z
        .array(
          z
            .object({
              tenantId: platformIdentifierSchema,
              tenantName: z.string().trim().min(1).max(200).nullable(),
              outboxStalled: platformNonNegativeIntegerSchema,
              outboxDeadLetter: platformNonNegativeIntegerSchema,
              notificationFailed: platformNonNegativeIntegerSchema,
              artifactQuarantined: platformNonNegativeIntegerSchema,
              healthHref: platformHrefSchema,
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
});

export const platformAuditLogQuerySchema = z
  .object({
    ...platformRangeQueryShape,
    ...platformPageQueryShape,
    tenantId: platformIdentifierSchema.optional(),
    actorId: platformIdentifierSchema.optional(),
    source: z.enum(["ALL", "PLATFORM", "TENANT"]).optional(),
    actorRole: z.string().trim().min(1).max(100).optional(),
    action: z.string().trim().min(1).max(200).optional(),
    result: z.enum(["SUCCESS", "DENIED", "FAILED"]).optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict()
  .superRefine(refinePlatformRange);

export const platformAuditLogItemSchema = z
  .object({
    id: platformIdentifierSchema,
    actorId: platformIdentifierSchema.nullable(),
    actorDisplayName: z.string().trim().min(1).max(200).nullable(),
    actorRole: z.string().trim().min(1).max(100).nullable(),
    action: z.string().trim().min(1).max(200),
    tenantId: platformIdentifierSchema.nullable(),
    resourceType: z.string().trim().min(1).max(100),
    resourceId: platformIdentifierSchema.nullable(),
    result: z.enum(["SUCCESS", "DENIED", "FAILED"]),
    reason: z.string().trim().min(1).max(300).nullable(),
    correlationId: platformIdentifierSchema,
    beforeHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    afterHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    occurredAt: platformIsoDateTimeSchema,
  })
  .strict();

export const platformAuditLogResponseSchema = platformEnvelope("platform-audit-logs.v1", {
  filters: z
    .object({
      tenantId: platformIdentifierSchema.nullable(),
      actorId: platformIdentifierSchema.nullable(),
      source: z.enum(["ALL", "PLATFORM", "TENANT"]),
      actorRole: z.string().trim().min(1).max(100).nullable(),
      action: z.string().trim().min(1).max(200).nullable(),
      result: z.enum(["SUCCESS", "DENIED", "FAILED"]).nullable(),
    })
    .strict(),
  page: platformListPageSchema,
  items: z.array(platformAuditLogItemSchema).max(100),
});

/* ------------------------------- Phase 6 incidents ---------------------- */

export const platformIncidentSeveritySchema = platformSeveritySchema;
export const platformIncidentStateSchema = z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "REOPENED"]);

const platformPrincipalRefSchema = z
  .object({
    principalId: platformIdentifierSchema,
    displayName: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

export const platformIncidentListQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().trim().min(1).max(2_048).optional(),
    state: platformIncidentStateSchema.optional(),
    activeOnly: z.enum(["true", "false"]).optional(),
    severity: platformIncidentSeveritySchema.optional(),
    tenantId: platformIdentifierSchema.optional(),
    agentType: platformAgentTypeSchema.optional(),
    assignedToId: platformIdentifierSchema.optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict();

export const platformIncidentSchema = z
  .object({
    incidentId: platformIdentifierSchema,
    signalId: platformIdentifierSchema,
    ruleKey: platformIdentifierSchema,
    ruleVersion: z.string().trim().min(1).max(100),
    severity: platformIncidentSeveritySchema,
    state: platformIncidentStateSchema,
    active: z.boolean(),
    title: z.string().trim().min(1).max(200),
    impact: z.string().trim().min(1).max(500),
    recommendedAction: z.string().trim().min(1).max(500),
    scope: platformScopeSchema,
    diagnosticsHref: platformHrefSchema,
    detailHref: platformHrefSchema,
    evidence: z
      .array(
        z
          .object({
            metricKey: platformIdentifierSchema,
            value: z.union([z.number(), z.string(), z.boolean()]),
            unit: z.string().trim().min(1).max(50),
            observedAt: platformIsoDateTimeSchema,
          })
          .strict(),
      )
      .max(10),
    firstEvidenceAt: platformIsoDateTimeSchema.nullable(),
    lastEvidenceAt: platformIsoDateTimeSchema,
    openedAt: platformIsoDateTimeSchema,
    acknowledgedAt: platformIsoDateTimeSchema.nullable(),
    acknowledgedBy: platformPrincipalRefSchema.nullable(),
    assignedAt: platformIsoDateTimeSchema.nullable(),
    assignedTo: platformPrincipalRefSchema.nullable(),
    resolvedAt: platformIsoDateTimeSchema.nullable(),
    resolvedBy: platformPrincipalRefSchema.nullable(),
    resolutionNote: z.string().trim().min(1).max(1_000).nullable(),
    autoResolved: z.boolean(),
    reopenCount: platformNonNegativeIntegerSchema,
    rowVersion: z.number().int().min(1),
  })
  .strict();

export const platformIncidentEventSchema = z
  .object({
    eventId: platformIdentifierSchema,
    type: z.enum([
      "OPENED",
      "SEVERITY_CHANGED",
      "ACKNOWLEDGED",
      "ASSIGNED",
      "RESOLVED",
      "AUTO_RESOLVED",
      "REOPENED",
    ]),
    fromState: platformIncidentStateSchema.nullable(),
    toState: platformIncidentStateSchema,
    actor: platformPrincipalRefSchema.nullable(),
    actorRole: z.string().trim().min(1).max(100).nullable(),
    reason: z.string().trim().min(1).max(500).nullable(),
    note: z.string().trim().min(1).max(1_000).nullable(),
    correlationId: platformIdentifierSchema,
    occurredAt: platformIsoDateTimeSchema,
  })
  .strict();

function platformIncidentEnvelope<Shape extends z.ZodRawShape>(
  schemaVersion: string,
  shape: Shape,
) {
  return z
    .object({
      schemaVersion: z.literal(schemaVersion),
      generatedAt: platformIsoDateTimeSchema,
      asOf: platformIsoDateTimeSchema,
      partial: z.boolean(),
      problems: z.array(platformListProblemSchema).max(10),
      ...shape,
    })
    .strict();
}

export const platformIncidentListResponseSchema = platformIncidentEnvelope(
  "platform-incidents.v1",
  {
    filters: z
      .object({
        state: platformIncidentStateSchema.nullable(),
        activeOnly: z.boolean(),
        severity: platformIncidentSeveritySchema.nullable(),
        tenantId: platformIdentifierSchema.nullable(),
        agentType: platformAgentTypeSchema.nullable(),
        assignedToId: platformIdentifierSchema.nullable(),
      })
      .strict(),
    page: platformListPageSchema,
    totals: z
      .object({
        open: platformNonNegativeIntegerSchema,
        acknowledged: platformNonNegativeIntegerSchema,
        reopened: platformNonNegativeIntegerSchema,
        resolved: platformNonNegativeIntegerSchema,
        critical: platformNonNegativeIntegerSchema,
        high: platformNonNegativeIntegerSchema,
      })
      .strict(),
    items: z.array(platformIncidentSchema).max(100),
  },
);

export const platformIncidentDetailResponseSchema = platformIncidentEnvelope(
  "platform-incident-detail.v1",
  {
    incident: platformIncidentSchema,
    timeline: z
      .object({
        total: platformNonNegativeIntegerSchema,
        truncated: z.boolean(),
        items: z.array(platformIncidentEventSchema).max(200),
      })
      .strict(),
    allowedActions: z.array(z.enum(["ACKNOWLEDGE", "ASSIGN", "RESOLVE"])).max(3),
    resolveRequiresStepUp: z.boolean(),
  },
);

export const platformIncidentMutationResponseSchema = platformIncidentEnvelope(
  "platform-incident-mutation.v1",
  {
    incident: platformIncidentSchema,
    event: platformIncidentEventSchema,
    change: z
      .object({
        beforeHash: z.string().regex(/^[a-f0-9]{64}$/),
        afterHash: z.string().regex(/^[a-f0-9]{64}$/),
        summary: z.string().trim().min(1).max(300),
        idempotent: z.boolean(),
        correlationId: platformIdentifierSchema,
      })
      .strict(),
  },
);

const incidentReasonSchema = z.string().trim().min(8).max(500);

export const platformIncidentAcknowledgeRequestSchema = z
  .object({ reason: incidentReasonSchema, rowVersion: z.number().int().min(1) })
  .strict();

export const platformIncidentAssignRequestSchema = z
  .object({
    reason: incidentReasonSchema,
    rowVersion: z.number().int().min(1),
    assigneePrincipalId: platformIdentifierSchema,
  })
  .strict();

export const platformIncidentResolveRequestSchema = z
  .object({
    reason: incidentReasonSchema,
    rowVersion: z.number().int().min(1),
    resolutionNote: z.string().trim().min(1).max(1_000),
    stepUpPassword: z.string().min(12).max(200).optional(),
  })
  .strict();

/* ------------------------------ Phase 8 advanced ------------------------ */

export const platformQualityQuerySchema = z
  .object({
    window: z.enum(["7d", "30d", "90d"]).optional(),
    agentType: platformAgentTypeSchema.optional(),
  })
  .strict();

export const platformQualityMetricSchema = z
  .object({
    kind: z.enum(["OFFLINE_EVALUATION", "PRODUCTION_VALIDATION", "HUMAN_FEEDBACK"]),
    label: z.string().trim().min(1).max(120),
    definition: z.string().trim().min(1).max(300),
    state: z.enum(["AVAILABLE", "NO_DATA", "INSUFFICIENT_SAMPLE", "UNKNOWN"]),
    valuePercent: platformPercentageSchema.nullable(),
    passed: platformNonNegativeIntegerSchema.nullable(),
    total: platformNonNegativeIntegerSchema.nullable(),
    sampleSize: platformNonNegativeIntegerSchema,
    minimumSample: platformNonNegativeIntegerSchema,
    window: z
      .object({
        from: platformIsoDateTimeSchema,
        to: platformIsoDateTimeSchema,
        timeZone: z.literal("UTC"),
      })
      .strict(),
    freshAt: platformIsoDateTimeSchema.nullable(),
    previousValuePercent: platformPercentageSchema.nullable(),
    deltaPercentagePoints: z.number().nullable(),
    source: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

export const platformQualityResponseSchema = platformIncidentEnvelope("platform-quality.v1", {
  filters: z
    .object({
      window: z.enum(["7d", "30d", "90d"]),
      agentType: platformAgentTypeSchema.nullable(),
    })
    .strict(),
  metrics: z
    .object({
      context: platformSectionContextSchema,
      items: z.array(platformQualityMetricSchema).max(3),
    })
    .strict(),
  byAgent: z
    .object({
      context: platformSectionContextSchema,
      items: z
        .array(
          z
            .object({
              agentType: platformAgentTypeSchema,
              offline: platformQualityMetricSchema.nullable(),
              production: platformQualityMetricSchema.nullable(),
              humanFeedback: platformQualityMetricSchema.nullable(),
              detailHref: platformHrefSchema,
            })
            .strict(),
        )
        .max(50),
    })
    .strict(),
  releases: z
    .object({
      context: platformSectionContextSchema,
      total: platformNonNegativeIntegerSchema,
      truncated: z.boolean(),
      items: z
        .array(
          z
            .object({
              agentRelease: z.string().trim().min(1).max(200),
              promptVersion: z.string().trim().min(1).max(60),
              modelId: z.string().trim().min(1).max(120),
              provider: z.string().trim().min(1).max(60),
              firstSeenAt: platformIsoDateTimeSchema,
              lastSeenAt: platformIsoDateTimeSchema,
              offline: platformQualityMetricSchema.nullable(),
              production: platformQualityMetricSchema.nullable(),
              humanFeedback: platformQualityMetricSchema.nullable(),
              runs: platformNonNegativeIntegerSchema,
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
  evaluationHistory: z
    .object({
      context: platformSectionContextSchema,
      total: platformNonNegativeIntegerSchema,
      items: z
        .array(
          z
            .object({
              runId: platformIdentifierSchema,
              suiteKey: z.string().trim().min(1).max(120),
              suiteVersion: z.string().trim().min(1).max(60),
              agentType: platformAgentTypeSchema,
              agentRelease: z.string().trim().min(1).max(200),
              caseCount: platformNonNegativeIntegerSchema,
              passedCount: platformNonNegativeIntegerSchema,
              failedCount: platformNonNegativeIntegerSchema,
              skippedCount: platformNonNegativeIntegerSchema,
              scorePercent: platformPercentageSchema.nullable(),
              completedAt: platformIsoDateTimeSchema,
              sourceRef: z.string().trim().min(1).max(200).nullable(),
            })
            .strict(),
        )
        .max(50),
    })
    .strict(),
});

export const platformSupportAccessStateSchema = z.enum([
  "REQUESTED",
  "APPROVED",
  "DENIED",
  "REVOKED",
  "EXPIRED",
]);

export const platformSupportAccessOperationSchema = z.enum([
  "READ_TENANT_HEALTH",
  "READ_AGENT_RUNS",
  "READ_RUN_DIAGNOSTICS",
  "READ_REVIEW_BACKLOG",
  "READ_SYSTEM_HEALTH",
]);

export const platformSupportAccessGrantSchema = z
  .object({
    grantId: platformIdentifierSchema,
    ticketReference: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(500),
    tenantId: platformIdentifierSchema,
    tenantName: z.string().trim().min(1).max(200).nullable(),
    projectId: platformIdentifierSchema.nullable(),
    allowedOperations: z.array(platformSupportAccessOperationSchema).min(1).max(5),
    maskedOnly: z.literal(true),
    state: platformSupportAccessStateSchema,
    active: z.boolean(),
    requestedBy: platformPrincipalRefSchema,
    requestedAt: platformIsoDateTimeSchema,
    approvedBy: platformPrincipalRefSchema.nullable(),
    approvedAt: platformIsoDateTimeSchema.nullable(),
    startsAt: platformIsoDateTimeSchema.nullable(),
    expiresAt: platformIsoDateTimeSchema,
    expiresInSeconds: z.number().int().nullable(),
    decisionReason: z.string().trim().min(1).max(500).nullable(),
    revokedBy: platformPrincipalRefSchema.nullable(),
    revokedAt: platformIsoDateTimeSchema.nullable(),
    useCount: platformNonNegativeIntegerSchema,
    lastUsedAt: platformIsoDateTimeSchema.nullable(),
    detailHref: platformHrefSchema,
    rowVersion: z.number().int().min(1),
  })
  .strict();

export const platformSupportAccessEventSchema = z
  .object({
    eventId: platformIdentifierSchema,
    type: z.enum(["REQUESTED", "APPROVED", "DENIED", "REVOKED", "EXPIRED", "USED"]),
    fromState: platformSupportAccessStateSchema.nullable(),
    toState: platformSupportAccessStateSchema,
    actor: platformPrincipalRefSchema.nullable(),
    actorRole: z.string().trim().min(1).max(100).nullable(),
    reason: z.string().trim().min(1).max(500).nullable(),
    correlationId: platformIdentifierSchema,
    occurredAt: platformIsoDateTimeSchema,
  })
  .strict();

export const platformSupportAccessListQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().trim().min(1).max(2_048).optional(),
    state: platformSupportAccessStateSchema.optional(),
    activeOnly: z.enum(["true", "false"]).optional(),
    tenantId: platformIdentifierSchema.optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict();

export const platformSupportAccessListResponseSchema = platformIncidentEnvelope(
  "platform-support-access.v1",
  {
    filters: z
      .object({
        state: platformSupportAccessStateSchema.nullable(),
        activeOnly: z.boolean(),
        tenantId: platformIdentifierSchema.nullable(),
      })
      .strict(),
    page: platformListPageSchema,
    totals: z
      .object({
        requested: platformNonNegativeIntegerSchema,
        approved: platformNonNegativeIntegerSchema,
        active: platformNonNegativeIntegerSchema,
        expired: platformNonNegativeIntegerSchema,
        revoked: platformNonNegativeIntegerSchema,
        denied: platformNonNegativeIntegerSchema,
      })
      .strict(),
    items: z.array(platformSupportAccessGrantSchema).max(100),
  },
);

export const platformSupportAccessDetailResponseSchema = platformIncidentEnvelope(
  "platform-support-access-detail.v1",
  {
    grant: platformSupportAccessGrantSchema,
    timeline: z
      .object({
        total: platformNonNegativeIntegerSchema,
        truncated: z.boolean(),
        items: z.array(platformSupportAccessEventSchema).max(200),
      })
      .strict(),
    allowedActions: z.array(z.enum(["APPROVE", "DENY", "REVOKE"])).max(3),
    canApprove: z.boolean(),
  },
);

export const platformSupportAccessMutationResponseSchema = platformIncidentEnvelope(
  "platform-support-access-mutation.v1",
  {
    grant: platformSupportAccessGrantSchema,
    event: platformSupportAccessEventSchema,
    change: z
      .object({
        beforeHash: z.string().regex(/^[a-f0-9]{64}$/),
        afterHash: z.string().regex(/^[a-f0-9]{64}$/),
        summary: z.string().trim().min(1).max(300),
        idempotent: z.boolean(),
        correlationId: platformIdentifierSchema,
      })
      .strict(),
  },
);

export const platformSupportAccessRequestSchema = z
  .object({
    ticketReference: z.string().trim().min(1).max(120),
    reason: incidentReasonSchema,
    tenantId: platformIdentifierSchema,
    projectId: platformIdentifierSchema.optional(),
    allowedOperations: z.array(platformSupportAccessOperationSchema).min(1).max(5),
    durationSeconds: z.number().int().min(300).max(28_800),
  })
  .strict();

export const platformSupportAccessDecisionSchema = z
  .object({ reason: incidentReasonSchema, rowVersion: z.number().int().min(1) })
  .strict();

export type PlatformLoginRequest = z.infer<typeof platformLoginRequestSchema>;
export type PlatformRole = z.infer<typeof platformRoleSchema>;
export type PlatformPermission = z.infer<typeof platformPermissionSchema>;
export type PlatformSession = z.infer<typeof platformSessionSchema>;
export type PlatformOverviewQuery = z.infer<typeof platformOverviewQuerySchema>;
export type PlatformFreshness = z.infer<typeof platformFreshnessSchema>;
export type PlatformMetricWindow = z.infer<typeof platformMetricWindowSchema>;
export type PlatformMetricContext = z.infer<typeof platformMetricContextSchema>;
export type PlatformSectionContext = z.infer<typeof platformSectionContextSchema>;
export type PlatformCause = z.infer<typeof platformCauseSchema>;
export type PlatformAttentionItem = z.infer<typeof platformAttentionItemSchema>;
export type PlatformTenantHealthItem = z.infer<typeof platformTenantHealthItemSchema>;
export type PlatformAgentHealthItem = z.infer<typeof platformAgentHealthItemSchema>;
export type PlatformSystemComponent = z.infer<typeof platformSystemComponentSchema>;
export type PlatformAuditItem = z.infer<typeof platformAuditItemSchema>;
export type PlatformOverview = z.infer<typeof platformOverviewResponseSchema>;
export type PlatformListPage = z.infer<typeof platformListPageSchema>;
export type PlatformTenantListQuery = z.infer<typeof platformTenantListQuerySchema>;
export type PlatformTenantList = z.infer<typeof platformTenantListResponseSchema>;
export type PlatformTenantListItem = z.infer<typeof platformTenantListItemSchema>;
export type PlatformTenantHealth = z.infer<typeof platformTenantHealthResponseSchema>;
export type PlatformAgentListQuery = z.infer<typeof platformAgentListQuerySchema>;
export type PlatformAgentList = z.infer<typeof platformAgentListResponseSchema>;
export type PlatformAgentListItem = z.infer<typeof platformAgentListItemSchema>;
export type PlatformAgentDetailQuery = z.infer<typeof platformAgentDetailQuerySchema>;
export type PlatformAgentDetail = z.infer<typeof platformAgentDetailResponseSchema>;
export type PlatformAgentRunListQuery = z.infer<typeof platformAgentRunListQuerySchema>;
export type PlatformAgentRunList = z.infer<typeof platformAgentRunListResponseSchema>;
export type PlatformAgentRunItem = z.infer<typeof platformAgentRunItemSchema>;
export type PlatformAgentRunDiagnostics = z.infer<typeof platformAgentRunDiagnosticsResponseSchema>;
export type PlatformReviewSummaryQuery = z.infer<typeof platformReviewSummaryQuerySchema>;
export type PlatformReviewSummary = z.infer<typeof platformReviewSummaryResponseSchema>;
export type PlatformReviewBacklogQuery = z.infer<typeof platformReviewBacklogQuerySchema>;
export type PlatformReviewBacklog = z.infer<typeof platformReviewBacklogResponseSchema>;
export type PlatformReviewBacklogItem = z.infer<typeof platformReviewBacklogItemSchema>;
export type PlatformUsageQuery = z.infer<typeof platformUsageQuerySchema>;
export type PlatformUsage = z.infer<typeof platformUsageResponseSchema>;
export type PlatformUsageGroup = z.infer<typeof platformUsageGroupSchema>;
export type PlatformSystemHealthQuery = z.infer<typeof platformSystemHealthQuerySchema>;
export type PlatformSystemHealth = z.infer<typeof platformSystemHealthResponseSchema>;
export type PlatformAuditLogQuery = z.infer<typeof platformAuditLogQuerySchema>;
export type PlatformAuditLogList = z.infer<typeof platformAuditLogResponseSchema>;
export type PlatformAuditLogItem = z.infer<typeof platformAuditLogItemSchema>;
export type PlatformIncidentState = z.infer<typeof platformIncidentStateSchema>;
export type PlatformIncidentListQuery = z.infer<typeof platformIncidentListQuerySchema>;
export type PlatformIncidentList = z.infer<typeof platformIncidentListResponseSchema>;
export type PlatformIncident = z.infer<typeof platformIncidentSchema>;
export type PlatformIncidentEvent = z.infer<typeof platformIncidentEventSchema>;
export type PlatformIncidentDetail = z.infer<typeof platformIncidentDetailResponseSchema>;
export type PlatformIncidentMutation = z.infer<typeof platformIncidentMutationResponseSchema>;
export type PlatformIncidentAcknowledgeRequest = z.infer<
  typeof platformIncidentAcknowledgeRequestSchema
>;
export type PlatformIncidentAssignRequest = z.infer<typeof platformIncidentAssignRequestSchema>;
export type PlatformIncidentResolveRequest = z.infer<typeof platformIncidentResolveRequestSchema>;
export type PlatformQualityQuery = z.infer<typeof platformQualityQuerySchema>;
export type PlatformQuality = z.infer<typeof platformQualityResponseSchema>;
export type PlatformQualityMetric = z.infer<typeof platformQualityMetricSchema>;
export type PlatformSupportAccessState = z.infer<typeof platformSupportAccessStateSchema>;
export type PlatformSupportAccessGrant = z.infer<typeof platformSupportAccessGrantSchema>;
export type PlatformSupportAccessListQuery = z.infer<typeof platformSupportAccessListQuerySchema>;
export type PlatformSupportAccessList = z.infer<typeof platformSupportAccessListResponseSchema>;
export type PlatformSupportAccessDetail = z.infer<typeof platformSupportAccessDetailResponseSchema>;
export type PlatformSupportAccessMutation = z.infer<
  typeof platformSupportAccessMutationResponseSchema
>;
export type PlatformSupportAccessRequest = z.infer<typeof platformSupportAccessRequestSchema>;
export type PlatformSupportAccessDecision = z.infer<typeof platformSupportAccessDecisionSchema>;
