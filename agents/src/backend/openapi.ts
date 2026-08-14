const jsonContent = (schema: Record<string, unknown>) => ({
  "application/json": { schema },
});

const response = (description: string, schema?: Record<string, unknown>) => ({
  description,
  ...(schema === undefined ? {} : { content: jsonContent(schema) }),
});

const reference = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errorReference = { $ref: "#/components/responses/Error" };

const strictObject = (required: string[], properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});
const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: "null" }],
});
const overviewIso = { type: "string", format: "date-time" };
const overviewIdentifier = {
  type: "string",
  minLength: 1,
  maxLength: 200,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_.:/-]*$",
};
const overviewNonnegativeInteger = {
  type: "integer",
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
};
const overviewPercent = { type: "number", minimum: 0, maximum: 100 };
const overviewSeverity = { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] };
const overviewHealth = {
  type: "string",
  enum: ["HEALTHY", "WARNING", "CRITICAL", "UNKNOWN", "INACTIVE"],
};
const overviewAppliedFilters = {
  type: "array",
  maxItems: 2,
  items: { type: "string", enum: ["TENANT_ID", "AGENT_TYPE"] },
};

const overviewFreshnessSchema = strictObject(
  ["state", "source", "checkedAt", "freshAt", "ageSeconds", "staleAfterSeconds", "reason"],
  {
    state: { type: "string", enum: ["FRESH", "STALE", "UNKNOWN"] },
    source: { type: "string", enum: ["LIVE_QUERY", "LIVE_PROBE", "SNAPSHOT"] },
    checkedAt: overviewIso,
    freshAt: nullable(overviewIso),
    ageSeconds: nullable(overviewNonnegativeInteger),
    staleAfterSeconds: { type: "integer", minimum: 1 },
    reason: nullable({ type: "string", minLength: 1, maxLength: 300 }),
  },
);

const overviewWindowSchema = strictObject(["kind", "from", "to", "timeZone"], {
  kind: {
    type: "string",
    enum: [
      "SELECTED_RANGE",
      "PREVIOUS_RANGE",
      "SNAPSHOT",
      "MONTH_TO_DATE",
      "PREVIOUS_MONTH_COMPARABLE",
      "FIXED_ROLLING",
    ],
  },
  from: nullable(overviewIso),
  to: nullable(overviewIso),
  timeZone: { type: "string", enum: ["UTC"] },
});

const overviewComparisonSchema = {
  oneOf: [
    strictObject(["state", "kind", "window", "previousValue", "delta", "deltaUnit"], {
      state: { type: "string", enum: ["AVAILABLE"] },
      kind: {
        type: "string",
        enum: ["PREVIOUS_PERIOD", "PREVIOUS_MONTH_COMPARABLE"],
      },
      window: reference("PlatformOverviewWindow"),
      previousValue: { type: "number" },
      delta: { type: "number" },
      deltaUnit: {
        type: "string",
        enum: ["COUNT", "PERCENTAGE_POINTS", "MICRO_USD"],
      },
    }),
    strictObject(["state", "reason"], {
      state: { type: "string", enum: ["UNAVAILABLE"] },
      reason: {
        type: "string",
        enum: ["NOT_APPLICABLE", "NO_HISTORY", "INSUFFICIENT_SAMPLE", "SOURCE_UNAVAILABLE"],
      },
    }),
  ],
  discriminator: { propertyName: "state" },
};

const overviewMetricContextSchema = strictObject(
  ["state", "window", "sampleSize", "minimumSample", "freshness", "comparison", "appliedFilters"],
  {
    state: {
      type: "string",
      enum: ["AVAILABLE", "NO_DATA", "INSUFFICIENT_SAMPLE", "UNKNOWN"],
    },
    window: reference("PlatformOverviewWindow"),
    sampleSize: overviewNonnegativeInteger,
    minimumSample: overviewNonnegativeInteger,
    freshness: reference("PlatformOverviewFreshness"),
    comparison: reference("PlatformOverviewComparison"),
    appliedFilters: overviewAppliedFilters,
  },
);

const overviewSectionContextSchema = strictObject(["state", "freshness", "appliedFilters"], {
  state: { type: "string", enum: ["AVAILABLE", "PARTIAL", "UNKNOWN"] },
  freshness: reference("PlatformOverviewFreshness"),
  appliedFilters: overviewAppliedFilters,
});

const overviewScopeSchema = strictObject(["tenantId", "tenantName", "agentType", "component"], {
  tenantId: nullable(overviewIdentifier),
  tenantName: nullable({ type: "string", minLength: 1, maxLength: 200 }),
  agentType: nullable({ type: "string", minLength: 1, maxLength: 100 }),
  component: nullable({ type: "string", minLength: 1, maxLength: 100 }),
});

const overviewCauseSchema = strictObject(
  ["causeId", "severity", "title", "scope", "diagnosticsHref", "evidenceAt"],
  {
    causeId: overviewIdentifier,
    severity: overviewSeverity,
    title: { type: "string", minLength: 1, maxLength: 200 },
    scope: reference("PlatformOverviewScope"),
    diagnosticsHref: { type: "string", pattern: "^/platform/" },
    evidenceAt: nullable(overviewIso),
  },
);

const overviewKpisSchema = strictObject(
  ["criticalIssues", "tenantHealth", "agentCompletion", "reviewSla", "aiSpend"],
  {
    criticalIssues: strictObject(["value", "critical", "high", "oldestEvidenceAt", "context"], {
      value: nullable(overviewNonnegativeInteger),
      critical: nullable(overviewNonnegativeInteger),
      high: nullable(overviewNonnegativeInteger),
      oldestEvidenceAt: nullable(overviewIso),
      context: reference("PlatformOverviewMetricContext"),
    }),
    tenantHealth: strictObject(
      ["healthy", "total", "warning", "critical", "unknown", "inactive", "context"],
      {
        healthy: nullable(overviewNonnegativeInteger),
        total: nullable(overviewNonnegativeInteger),
        warning: nullable(overviewNonnegativeInteger),
        critical: nullable(overviewNonnegativeInteger),
        unknown: nullable(overviewNonnegativeInteger),
        inactive: nullable(overviewNonnegativeInteger),
        context: reference("PlatformOverviewMetricContext"),
      },
    ),
    agentCompletion: strictObject(
      ["valuePercent", "completed", "terminal", "failed", "degraded", "rejected", "context"],
      {
        valuePercent: nullable(overviewPercent),
        completed: nullable(overviewNonnegativeInteger),
        terminal: nullable(overviewNonnegativeInteger),
        failed: nullable(overviewNonnegativeInteger),
        degraded: nullable(overviewNonnegativeInteger),
        rejected: nullable(overviewNonnegativeInteger),
        context: reference("PlatformOverviewMetricContext"),
      },
    ),
    reviewSla: strictObject(
      ["breached", "waiting", "withoutDueAt", "oldestWaitingAt", "oldestBreachedDueAt", "context"],
      {
        breached: nullable(overviewNonnegativeInteger),
        waiting: nullable(overviewNonnegativeInteger),
        withoutDueAt: nullable(overviewNonnegativeInteger),
        oldestWaitingAt: nullable(overviewIso),
        oldestBreachedDueAt: nullable(overviewIso),
        context: reference("PlatformOverviewMetricContext"),
      },
    ),
    aiSpend: strictObject(
      [
        "microUsd",
        "actualMicroUsd",
        "estimatedMicroUsd",
        "actualRunCount",
        "estimatedRunCount",
        "actualCoveragePercent",
        "context",
      ],
      {
        microUsd: nullable(overviewNonnegativeInteger),
        actualMicroUsd: nullable(overviewNonnegativeInteger),
        estimatedMicroUsd: nullable(overviewNonnegativeInteger),
        actualRunCount: nullable(overviewNonnegativeInteger),
        estimatedRunCount: nullable(overviewNonnegativeInteger),
        actualCoveragePercent: nullable(overviewPercent),
        context: reference("PlatformOverviewMetricContext"),
      },
    ),
  },
);

const overviewAttentionItemSchema = strictObject(
  [
    "signalId",
    "incidentId",
    "ruleKey",
    "ruleVersion",
    "severity",
    "state",
    "title",
    "impact",
    "scope",
    "firstEvidenceAt",
    "lastEvidenceAt",
    "evidence",
    "recommendedAction",
    "diagnosticsHref",
    "freshness",
  ],
  {
    signalId: overviewIdentifier,
    incidentId: nullable(overviewIdentifier),
    ruleKey: overviewIdentifier,
    ruleVersion: { type: "string", minLength: 1, maxLength: 100 },
    severity: overviewSeverity,
    state: { type: "string", enum: ["OPEN", "ACKNOWLEDGED", "REOPENED"] },
    title: { type: "string", minLength: 1, maxLength: 200 },
    impact: { type: "string", minLength: 1, maxLength: 500 },
    scope: reference("PlatformOverviewScope"),
    firstEvidenceAt: nullable(overviewIso),
    lastEvidenceAt: nullable(overviewIso),
    evidence: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: strictObject(["metricKey", "value", "unit", "observedAt"], {
        metricKey: overviewIdentifier,
        value: { oneOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }] },
        unit: { type: "string", minLength: 1, maxLength: 50 },
        observedAt: overviewIso,
      }),
    },
    recommendedAction: { type: "string", minLength: 1, maxLength: 500 },
    diagnosticsHref: { type: "string", pattern: "^/platform/" },
    freshness: reference("PlatformOverviewFreshness"),
  },
);

const overviewAttentionSchema = strictObject(["context", "total", "truncated", "items"], {
  context: reference("PlatformOverviewSectionContext"),
  total: overviewNonnegativeInteger,
  truncated: { type: "boolean" },
  items: {
    type: "array",
    maxItems: 10,
    items: reference("PlatformOverviewAttentionItem"),
  },
});

const overviewTenantItemSchema = strictObject(
  [
    "tenantId",
    "name",
    "health",
    "reasons",
    "users",
    "runs",
    "review",
    "issues",
    "aiSpendMicroUsd",
    "storageBytes",
    "lastActivityAt",
    "unknownFields",
  ],
  {
    tenantId: overviewIdentifier,
    name: { type: "string", minLength: 1, maxLength: 200 },
    health: overviewHealth,
    reasons: { type: "array", maxItems: 3, items: reference("PlatformOverviewCause") },
    users: nullable(
      strictObject(["loggedIn24h", "activeAccounts"], {
        loggedIn24h: overviewNonnegativeInteger,
        activeAccounts: overviewNonnegativeInteger,
      }),
    ),
    runs: nullable(
      strictObject(["total", "completed", "failed", "degraded", "rejected", "stuck"], {
        total: overviewNonnegativeInteger,
        completed: overviewNonnegativeInteger,
        failed: overviewNonnegativeInteger,
        degraded: overviewNonnegativeInteger,
        rejected: overviewNonnegativeInteger,
        stuck: overviewNonnegativeInteger,
      }),
    ),
    review: nullable(
      strictObject(["waiting", "breached"], {
        waiting: overviewNonnegativeInteger,
        breached: overviewNonnegativeInteger,
      }),
    ),
    issues: nullable(
      strictObject(["critical", "high", "medium", "low"], {
        critical: overviewNonnegativeInteger,
        high: overviewNonnegativeInteger,
        medium: overviewNonnegativeInteger,
        low: overviewNonnegativeInteger,
      }),
    ),
    aiSpendMicroUsd: nullable(overviewNonnegativeInteger),
    storageBytes: nullable(overviewNonnegativeInteger),
    lastActivityAt: nullable(overviewIso),
    unknownFields: {
      type: "array",
      maxItems: 7,
      items: {
        type: "string",
        enum: ["USERS", "RUNS", "REVIEW", "ISSUES", "AI_SPEND", "STORAGE", "LAST_ACTIVITY"],
      },
    },
  },
);

const overviewTenantPreviewSchema = strictObject(["context", "total", "truncated", "items"], {
  context: reference("PlatformOverviewSectionContext"),
  total: overviewNonnegativeInteger,
  truncated: { type: "boolean" },
  items: { type: "array", maxItems: 10, items: reference("PlatformOverviewTenantItem") },
});

const overviewAgentItemSchema = strictObject(
  [
    "agentType",
    "state",
    "runs",
    "terminal",
    "completed",
    "failed",
    "degraded",
    "rejected",
    "completionPercent",
    "p50LatencyMs",
    "p95LatencyMs",
    "retriedRuns",
    "retryRatePercent",
    "stuck",
    "lastSuccessAt",
    "costMicroUsd",
    "reasons",
  ],
  {
    agentType: { type: "string", minLength: 1, maxLength: 100 },
    state: { type: "string", enum: ["ACTIVE", "DEGRADED", "UNKNOWN"] },
    runs: overviewNonnegativeInteger,
    terminal: overviewNonnegativeInteger,
    completed: overviewNonnegativeInteger,
    failed: overviewNonnegativeInteger,
    degraded: overviewNonnegativeInteger,
    rejected: overviewNonnegativeInteger,
    completionPercent: nullable(overviewPercent),
    p50LatencyMs: nullable(overviewNonnegativeInteger),
    p95LatencyMs: nullable(overviewNonnegativeInteger),
    retriedRuns: overviewNonnegativeInteger,
    retryRatePercent: nullable(overviewPercent),
    stuck: overviewNonnegativeInteger,
    lastSuccessAt: nullable(overviewIso),
    costMicroUsd: overviewNonnegativeInteger,
    reasons: { type: "array", maxItems: 3, items: reference("PlatformOverviewCause") },
  },
);

const overviewAgentPreviewSchema = strictObject(["context", "total", "truncated", "items"], {
  context: reference("PlatformOverviewSectionContext"),
  total: overviewNonnegativeInteger,
  truncated: { type: "boolean" },
  items: { type: "array", maxItems: 10, items: reference("PlatformOverviewAgentItem") },
});

const overviewSystemMetricSchema = strictObject(["key", "value", "unit"], {
  key: overviewIdentifier,
  value: { oneOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }] },
  unit: { type: "string", minLength: 1, maxLength: 50 },
});

const overviewSystemComponentSchema = strictObject(
  ["component", "state", "required", "summary", "metrics", "freshness", "diagnosticsHref"],
  {
    component: {
      type: "string",
      enum: ["API", "POSTGRES", "OUTBOX", "ARTIFACT_METADATA", "NOTIFICATION", "AI_PROVIDER"],
    },
    state: { type: "string", enum: ["HEALTHY", "DEGRADED", "DOWN", "UNKNOWN"] },
    required: { type: "boolean" },
    summary: { type: "string", minLength: 1, maxLength: 300 },
    metrics: { type: "array", maxItems: 20, items: reference("PlatformOverviewSystemMetric") },
    freshness: reference("PlatformOverviewFreshness"),
    diagnosticsHref: { type: "string", pattern: "^/platform/" },
  },
);

const overviewSystemHealthSchema = strictObject(["context", "components"], {
  context: reference("PlatformOverviewSectionContext"),
  components: {
    type: "array",
    maxItems: 10,
    items: reference("PlatformOverviewSystemComponent"),
  },
});

const overviewAuditItemSchema = strictObject(
  [
    "id",
    "actorId",
    "actorDisplayName",
    "actorRole",
    "action",
    "tenantId",
    "resourceType",
    "resourceId",
    "occurredAt",
    "result",
    "correlationId",
    "detailHref",
  ],
  {
    id: overviewIdentifier,
    actorId: nullable(overviewIdentifier),
    actorDisplayName: nullable({ type: "string", minLength: 1, maxLength: 200 }),
    actorRole: nullable({ type: "string", minLength: 1, maxLength: 100 }),
    action: { type: "string", minLength: 1, maxLength: 200 },
    tenantId: nullable(overviewIdentifier),
    resourceType: { type: "string", minLength: 1, maxLength: 100 },
    resourceId: nullable(overviewIdentifier),
    occurredAt: overviewIso,
    result: { type: "string", enum: ["SUCCESS", "DENIED", "FAILED"] },
    correlationId: overviewIdentifier,
    detailHref: { type: "string", pattern: "^/platform/" },
  },
);

const overviewRecentAuditSchema = strictObject(["context", "items"], {
  context: reference("PlatformOverviewSectionContext"),
  items: { type: "array", maxItems: 5, items: reference("PlatformOverviewAuditItem") },
});

const overviewProblemSchema = strictObject(["section", "code", "message", "retryable"], {
  section: {
    type: "string",
    enum: ["TENANTS", "AGENTS", "REVIEWS", "USAGE", "SYSTEM", "AUDIT"],
  },
  code: { type: "string", enum: ["SOURCE_UNAVAILABLE", "SOURCE_STALE"] },
  message: { type: "string", minLength: 1, maxLength: 300 },
  retryable: { type: "boolean" },
});

const platformOverviewSchema = strictObject(
  [
    "schemaVersion",
    "generatedAt",
    "asOf",
    "window",
    "filters",
    "freshness",
    "partial",
    "problems",
    "platformStatus",
    "topCauses",
    "kpis",
    "attention",
    "tenantHealthPreview",
    "agentHealthPreview",
    "systemHealth",
    "recentAudit",
  ],
  {
    schemaVersion: { type: "string", enum: ["platform-overview.v1"] },
    generatedAt: overviewIso,
    asOf: overviewIso,
    window: reference("PlatformOverviewWindow"),
    filters: strictObject(["tenantId", "agentType"], {
      tenantId: nullable(overviewIdentifier),
      agentType: nullable({ type: "string", minLength: 1, maxLength: 100 }),
    }),
    freshness: reference("PlatformOverviewFreshness"),
    partial: { type: "boolean" },
    problems: { type: "array", maxItems: 10, items: reference("PlatformOverviewProblem") },
    platformStatus: strictObject(["state", "evaluatedAt", "ruleSetVersion"], {
      state: { type: "string", enum: ["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"] },
      evaluatedAt: overviewIso,
      ruleSetVersion: { type: "string", enum: ["platform-overview-rules.v1"] },
    }),
    topCauses: { type: "array", maxItems: 3, items: reference("PlatformOverviewCause") },
    kpis: reference("PlatformOverviewKpis"),
    attention: reference("PlatformOverviewAttention"),
    tenantHealthPreview: reference("PlatformOverviewTenantPreview"),
    agentHealthPreview: reference("PlatformOverviewAgentPreview"),
    systemHealth: reference("PlatformOverviewSystemHealth"),
    recentAudit: reference("PlatformOverviewRecentAudit"),
  },
);

/* --------------------------------- Phase 5 drill-down -------------------- */

const drilldownAgentType = { type: "string", minLength: 1, maxLength: 100 };
const drilldownShortText = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const drilldownSha256 = { type: "string", pattern: "^[a-f0-9]{64}$" };
const drilldownHref = { type: "string", pattern: "^/platform/" };

/** Envelope every drill-down response shares with the overview contract. */
const drilldownEnvelope = (
  schemaVersion: string,
  required: string[],
  properties: Record<string, unknown>,
) =>
  strictObject(
    [
      "schemaVersion",
      "generatedAt",
      "asOf",
      "window",
      "freshness",
      "partial",
      "problems",
      ...required,
    ],
    {
      schemaVersion: { type: "string", enum: [schemaVersion] },
      generatedAt: overviewIso,
      asOf: overviewIso,
      window: reference("PlatformOverviewWindow"),
      freshness: reference("PlatformOverviewFreshness"),
      partial: { type: "boolean" },
      problems: { type: "array", maxItems: 10, items: reference("PlatformOverviewProblem") },
      ...properties,
    },
  );

const drilldownSection = (required: string[], properties: Record<string, unknown>) =>
  strictObject(["context", ...required], {
    context: reference("PlatformOverviewSectionContext"),
    ...properties,
  });

const listPageSchema = strictObject(["limit", "hasMore", "nextCursor", "sort", "order"], {
  limit: { type: "integer", minimum: 1, maximum: 100 },
  hasMore: { type: "boolean" },
  nextCursor: nullable({ type: "string", minLength: 1, maxLength: 2048 }),
  sort: drilldownShortText(60),
  order: { type: "string", enum: ["ASC", "DESC"] },
});

const tenantListItemSchema = strictObject(
  [
    "tenantId",
    "name",
    "health",
    "reasons",
    "users",
    "projects",
    "runs",
    "review",
    "aiSpendMicroUsd",
    "storageBytes",
    "lastActivityAt",
    "detailHref",
    "unknownFields",
  ],
  {
    tenantId: overviewIdentifier,
    name: drilldownShortText(200),
    health: overviewHealth,
    reasons: { type: "array", maxItems: 3, items: reference("PlatformOverviewCause") },
    users: nullable(
      strictObject(["loggedIn24h", "activeAccounts"], {
        loggedIn24h: overviewNonnegativeInteger,
        activeAccounts: overviewNonnegativeInteger,
      }),
    ),
    projects: nullable(
      strictObject(["total", "active"], {
        total: overviewNonnegativeInteger,
        active: overviewNonnegativeInteger,
      }),
    ),
    runs: nullable(
      strictObject(
        ["total", "completed", "failed", "degraded", "rejected", "stuck", "completionPercent"],
        {
          total: overviewNonnegativeInteger,
          completed: overviewNonnegativeInteger,
          failed: overviewNonnegativeInteger,
          degraded: overviewNonnegativeInteger,
          rejected: overviewNonnegativeInteger,
          stuck: overviewNonnegativeInteger,
          completionPercent: nullable(overviewPercent),
        },
      ),
    ),
    review: nullable(
      strictObject(["waiting", "breached"], {
        waiting: overviewNonnegativeInteger,
        breached: overviewNonnegativeInteger,
      }),
    ),
    aiSpendMicroUsd: nullable(overviewNonnegativeInteger),
    storageBytes: nullable(overviewNonnegativeInteger),
    lastActivityAt: nullable(overviewIso),
    detailHref: drilldownHref,
    unknownFields: {
      type: "array",
      maxItems: 7,
      items: {
        type: "string",
        enum: ["USERS", "PROJECTS", "RUNS", "REVIEW", "AI_SPEND", "STORAGE", "LAST_ACTIVITY"],
      },
    },
  },
);

const tenantListSchema = drilldownEnvelope(
  "platform-tenants.v1",
  ["filters", "page", "totals", "items"],
  {
    filters: strictObject(["search", "health"], {
      search: nullable(drilldownShortText(200)),
      health: nullable(overviewHealth),
    }),
    page: reference("PlatformListPage"),
    totals: strictObject(["matched", "healthy", "warning", "critical", "unknown", "inactive"], {
      matched: overviewNonnegativeInteger,
      healthy: overviewNonnegativeInteger,
      warning: overviewNonnegativeInteger,
      critical: overviewNonnegativeInteger,
      unknown: overviewNonnegativeInteger,
      inactive: overviewNonnegativeInteger,
    }),
    items: { type: "array", maxItems: 100, items: reference("PlatformTenantListItem") },
  },
);

const tenantHealthSchema = drilldownEnvelope(
  "platform-tenant-health.v1",
  ["tenant", "signals", "users", "agents", "review", "delivery", "storage"],
  {
    tenant: strictObject(
      ["tenantId", "name", "health", "createdAt", "lastActivityAt", "inactiveDays"],
      {
        tenantId: overviewIdentifier,
        name: drilldownShortText(200),
        health: overviewHealth,
        createdAt: nullable(overviewIso),
        lastActivityAt: nullable(overviewIso),
        inactiveDays: nullable(overviewNonnegativeInteger),
      },
    ),
    signals: drilldownSection(["total", "items"], {
      total: overviewNonnegativeInteger,
      items: { type: "array", maxItems: 10, items: reference("PlatformOverviewCause") },
    }),
    users: drilldownSection(
      ["activeAccounts", "suspendedAccounts", "loggedIn24h", "loggedIn7d", "neverLoggedIn"],
      {
        activeAccounts: nullable(overviewNonnegativeInteger),
        suspendedAccounts: nullable(overviewNonnegativeInteger),
        loggedIn24h: nullable(overviewNonnegativeInteger),
        loggedIn7d: nullable(overviewNonnegativeInteger),
        neverLoggedIn: nullable(overviewNonnegativeInteger),
      },
    ),
    agents: drilldownSection(["total", "items"], {
      total: overviewNonnegativeInteger,
      items: {
        type: "array",
        maxItems: 50,
        items: strictObject(
          [
            "agentType",
            "runs",
            "terminal",
            "completed",
            "failed",
            "degraded",
            "rejected",
            "stuck",
            "completionPercent",
            "lastSuccessAt",
            "costMicroUsd",
            "runsHref",
          ],
          {
            agentType: drilldownAgentType,
            runs: overviewNonnegativeInteger,
            terminal: overviewNonnegativeInteger,
            completed: overviewNonnegativeInteger,
            failed: overviewNonnegativeInteger,
            degraded: overviewNonnegativeInteger,
            rejected: overviewNonnegativeInteger,
            stuck: overviewNonnegativeInteger,
            completionPercent: nullable(overviewPercent),
            lastSuccessAt: nullable(overviewIso),
            costMicroUsd: overviewNonnegativeInteger,
            runsHref: drilldownHref,
          },
        ),
      },
    }),
    review: drilldownSection(
      [
        "waiting",
        "breached",
        "withoutDueAt",
        "oldestWaitingAt",
        "oldestBreachedDueAt",
        "backlogHref",
      ],
      {
        waiting: nullable(overviewNonnegativeInteger),
        breached: nullable(overviewNonnegativeInteger),
        withoutDueAt: nullable(overviewNonnegativeInteger),
        oldestWaitingAt: nullable(overviewIso),
        oldestBreachedDueAt: nullable(overviewIso),
        backlogHref: drilldownHref,
      },
    ),
    delivery: drilldownSection(["components"], {
      components: {
        type: "array",
        maxItems: 10,
        items: reference("PlatformOverviewSystemComponent"),
      },
    }),
    storage: drilldownSection(["totalBytes", "fileCount", "quarantinedCount"], {
      totalBytes: nullable(overviewNonnegativeInteger),
      fileCount: nullable(overviewNonnegativeInteger),
      quarantinedCount: nullable(overviewNonnegativeInteger),
    }),
  },
);

const agentListItemSchema = strictObject(
  [
    "agentType",
    "state",
    "runs",
    "terminal",
    "completed",
    "failed",
    "degraded",
    "rejected",
    "running",
    "stuck",
    "completionPercent",
    "minimumSample",
    "p50LatencyMs",
    "p95LatencyMs",
    "retriedRuns",
    "retryRatePercent",
    "lastSuccessAt",
    "costMicroUsd",
    "reasons",
    "detailHref",
  ],
  {
    agentType: drilldownAgentType,
    state: { type: "string", enum: ["ACTIVE", "DEGRADED", "UNKNOWN"] },
    runs: overviewNonnegativeInteger,
    terminal: overviewNonnegativeInteger,
    completed: overviewNonnegativeInteger,
    failed: overviewNonnegativeInteger,
    degraded: overviewNonnegativeInteger,
    rejected: overviewNonnegativeInteger,
    running: overviewNonnegativeInteger,
    stuck: overviewNonnegativeInteger,
    completionPercent: nullable(overviewPercent),
    minimumSample: overviewNonnegativeInteger,
    p50LatencyMs: nullable(overviewNonnegativeInteger),
    p95LatencyMs: nullable(overviewNonnegativeInteger),
    retriedRuns: overviewNonnegativeInteger,
    retryRatePercent: nullable(overviewPercent),
    lastSuccessAt: nullable(overviewIso),
    costMicroUsd: overviewNonnegativeInteger,
    reasons: { type: "array", maxItems: 3, items: reference("PlatformOverviewCause") },
    detailHref: drilldownHref,
  },
);

const agentListSchema = drilldownEnvelope(
  "platform-agents.v1",
  ["filters", "page", "totals", "items"],
  {
    filters: strictObject(["tenantId", "state"], {
      tenantId: nullable(overviewIdentifier),
      state: nullable({ type: "string", enum: ["ACTIVE", "DEGRADED", "UNKNOWN"] }),
    }),
    page: reference("PlatformListPage"),
    totals: strictObject(["matched", "active", "degraded", "unknown"], {
      matched: overviewNonnegativeInteger,
      active: overviewNonnegativeInteger,
      degraded: overviewNonnegativeInteger,
      unknown: overviewNonnegativeInteger,
    }),
    items: { type: "array", maxItems: 100, items: reference("PlatformAgentListItem") },
  },
);

const agentDetailSchema = drilldownEnvelope(
  "platform-agent-detail.v1",
  ["filters", "agent", "failureBreakdown", "tenantBreakdown", "models"],
  {
    filters: strictObject(["tenantId"], { tenantId: nullable(overviewIdentifier) }),
    agent: reference("PlatformAgentListItem"),
    failureBreakdown: drilldownSection(["items"], {
      items: {
        type: "array",
        maxItems: 20,
        items: strictObject(["failureCategory", "count", "sharePercent", "lastObservedAt"], {
          failureCategory: drilldownShortText(60),
          count: overviewNonnegativeInteger,
          sharePercent: nullable(overviewPercent),
          lastObservedAt: nullable(overviewIso),
        }),
      },
    }),
    tenantBreakdown: drilldownSection(["items"], {
      items: {
        type: "array",
        maxItems: 25,
        items: strictObject(
          [
            "tenantId",
            "tenantName",
            "runs",
            "terminal",
            "completed",
            "failed",
            "degraded",
            "rejected",
            "completionPercent",
            "costMicroUsd",
            "healthHref",
          ],
          {
            tenantId: overviewIdentifier,
            tenantName: nullable(drilldownShortText(200)),
            runs: overviewNonnegativeInteger,
            terminal: overviewNonnegativeInteger,
            completed: overviewNonnegativeInteger,
            failed: overviewNonnegativeInteger,
            degraded: overviewNonnegativeInteger,
            rejected: overviewNonnegativeInteger,
            completionPercent: nullable(overviewPercent),
            costMicroUsd: overviewNonnegativeInteger,
            healthHref: drilldownHref,
          },
        ),
      },
    }),
    models: drilldownSection(["items"], {
      items: {
        type: "array",
        maxItems: 25,
        items: strictObject(
          ["provider", "modelId", "runs", "costMicroUsd", "inputTokens", "outputTokens"],
          {
            provider: drilldownShortText(60),
            modelId: drilldownShortText(120),
            runs: overviewNonnegativeInteger,
            costMicroUsd: overviewNonnegativeInteger,
            inputTokens: overviewNonnegativeInteger,
            outputTokens: overviewNonnegativeInteger,
          },
        ),
      },
    }),
  },
);

const agentRunItemSchema = strictObject(
  [
    "runId",
    "tenantId",
    "tenantName",
    "agentType",
    "status",
    "failureCategory",
    "trigger",
    "provider",
    "modelId",
    "promptVersion",
    "startedAt",
    "completedAt",
    "latencyMs",
    "retryCount",
    "costMicroUsd",
    "costBasis",
    "stuck",
    "diagnosticsHref",
  ],
  {
    runId: overviewIdentifier,
    tenantId: overviewIdentifier,
    tenantName: nullable(drilldownShortText(200)),
    agentType: drilldownAgentType,
    status: {
      type: "string",
      enum: ["RUNNING", "COMPLETED", "FAILED", "DEGRADED", "REJECTED"],
    },
    failureCategory: drilldownShortText(60),
    trigger: drilldownShortText(60),
    provider: drilldownShortText(60),
    modelId: drilldownShortText(120),
    promptVersion: drilldownShortText(60),
    startedAt: overviewIso,
    completedAt: nullable(overviewIso),
    latencyMs: overviewNonnegativeInteger,
    retryCount: overviewNonnegativeInteger,
    costMicroUsd: overviewNonnegativeInteger,
    costBasis: { type: "string", enum: ["ACTUAL", "ESTIMATED"] },
    stuck: { type: "boolean" },
    diagnosticsHref: drilldownHref,
  },
);

const agentRunListSchema = drilldownEnvelope(
  "platform-agent-runs.v1",
  ["filters", "page", "items"],
  {
    filters: strictObject(
      ["tenantId", "agentType", "status", "outcome", "failureCategory", "stuck"],
      {
        tenantId: nullable(overviewIdentifier),
        agentType: nullable(drilldownAgentType),
        status: nullable({
          type: "string",
          enum: ["RUNNING", "COMPLETED", "FAILED", "DEGRADED", "REJECTED"],
        }),
        outcome: nullable({ type: "string", enum: ["TERMINAL", "NON_COMPLETION"] }),
        failureCategory: nullable(drilldownShortText(60)),
        stuck: { type: "boolean" },
      },
    ),
    page: reference("PlatformListPage"),
    items: { type: "array", maxItems: 100, items: reference("PlatformAgentRunItem") },
  },
);

const agentRunDiagnosticsSchema = drilldownEnvelope(
  "platform-agent-run-diagnostics.v1",
  ["run", "execution", "usage", "validation", "toolCalls", "redaction"],
  {
    run: reference("PlatformAgentRunItem"),
    execution: strictObject(
      [
        "requestId",
        "eventId",
        "traceId",
        "projectId",
        "toolBundleVersion",
        "outputSchemaVersion",
        "dataSnapshotVersion",
        "outputSha256",
        "contentLoggingEnabled",
        "asOf",
      ],
      {
        requestId: nullable(overviewIdentifier),
        eventId: nullable(overviewIdentifier),
        traceId: nullable(overviewIdentifier),
        projectId: overviewIdentifier,
        toolBundleVersion: drilldownShortText(60),
        outputSchemaVersion: overviewNonnegativeInteger,
        dataSnapshotVersion: drilldownShortText(60),
        outputSha256: nullable(drilldownSha256),
        contentLoggingEnabled: { type: "boolean" },
        asOf: overviewIso,
      },
    ),
    usage: strictObject(
      [
        "inputTokens",
        "outputTokens",
        "cachedInputTokens",
        "reasoningTokens",
        "estimatedCostMicroUsd",
        "actualCostMicroUsd",
      ],
      {
        inputTokens: overviewNonnegativeInteger,
        outputTokens: overviewNonnegativeInteger,
        cachedInputTokens: overviewNonnegativeInteger,
        reasoningTokens: overviewNonnegativeInteger,
        estimatedCostMicroUsd: overviewNonnegativeInteger,
        actualCostMicroUsd: nullable(overviewNonnegativeInteger),
      },
    ),
    validation: strictObject(["state", "issueCount"], {
      state: { type: "string", enum: ["PASSED", "FAILED", "UNKNOWN"] },
      issueCount: nullable(overviewNonnegativeInteger),
    }),
    toolCalls: strictObject(["total", "truncated", "items"], {
      total: overviewNonnegativeInteger,
      truncated: { type: "boolean" },
      items: {
        type: "array",
        maxItems: 50,
        items: strictObject(
          ["id", "toolName", "status", "sequence", "latencyMs", "retryCount", "startedAt"],
          {
            id: overviewIdentifier,
            toolName: drilldownShortText(120),
            status: drilldownShortText(60),
            sequence: overviewNonnegativeInteger,
            latencyMs: overviewNonnegativeInteger,
            retryCount: overviewNonnegativeInteger,
            startedAt: nullable(overviewIso),
          },
        ),
      },
    }),
    redaction: strictObject(["policy", "redactedFields", "note"], {
      policy: { type: "string", enum: ["platform-diagnostics-redaction.v1"] },
      redactedFields: { type: "array", maxItems: 20, items: drilldownShortText(60) },
      note: drilldownShortText(300),
    }),
  },
);

const reviewSummarySchema = drilldownEnvelope(
  "platform-review-summary.v1",
  ["filters", "backlog", "ageBuckets", "byTenant", "byTargetType", "throughput"],
  {
    filters: strictObject(["tenantId"], { tenantId: nullable(overviewIdentifier) }),
    backlog: drilldownSection(
      ["waiting", "breached", "withoutDueAt", "draft", "oldestWaitingAt", "oldestBreachedDueAt"],
      {
        waiting: nullable(overviewNonnegativeInteger),
        breached: nullable(overviewNonnegativeInteger),
        withoutDueAt: nullable(overviewNonnegativeInteger),
        draft: nullable(overviewNonnegativeInteger),
        oldestWaitingAt: nullable(overviewIso),
        oldestBreachedDueAt: nullable(overviewIso),
      },
    ),
    ageBuckets: drilldownSection(["items"], {
      items: {
        type: "array",
        maxItems: 4,
        items: strictObject(["bucket", "waiting", "breached"], {
          bucket: { type: "string", enum: ["UNDER_24H", "H24_TO_72H", "D3_TO_D7", "OVER_7D"] },
          waiting: overviewNonnegativeInteger,
          breached: overviewNonnegativeInteger,
        }),
      },
    }),
    byTenant: drilldownSection(["items"], {
      items: {
        type: "array",
        maxItems: 25,
        items: strictObject(
          ["tenantId", "tenantName", "waiting", "breached", "oldestWaitingAt", "backlogHref"],
          {
            tenantId: overviewIdentifier,
            tenantName: nullable(drilldownShortText(200)),
            waiting: overviewNonnegativeInteger,
            breached: overviewNonnegativeInteger,
            oldestWaitingAt: nullable(overviewIso),
            backlogHref: drilldownHref,
          },
        ),
      },
    }),
    byTargetType: drilldownSection(["items"], {
      items: {
        type: "array",
        maxItems: 25,
        items: strictObject(["targetType", "waiting", "breached"], {
          targetType: drilldownShortText(60),
          waiting: overviewNonnegativeInteger,
          breached: overviewNonnegativeInteger,
        }),
      },
    }),
    throughput: drilldownSection(
      [
        "decided",
        "approved",
        "rejected",
        "corrected",
        "emergencyOverrides",
        "correctionRatePercent",
      ],
      {
        decided: nullable(overviewNonnegativeInteger),
        approved: nullable(overviewNonnegativeInteger),
        rejected: nullable(overviewNonnegativeInteger),
        corrected: nullable(overviewNonnegativeInteger),
        emergencyOverrides: nullable(overviewNonnegativeInteger),
        correctionRatePercent: nullable(overviewPercent),
      },
    ),
  },
);

const reviewBacklogSchema = drilldownEnvelope(
  "platform-review-backlog.v1",
  ["filters", "page", "items"],
  {
    filters: strictObject(["tenantId", "sla", "targetType"], {
      tenantId: nullable(overviewIdentifier),
      sla: { type: "string", enum: ["ALL", "BREACHED", "DUE_SOON", "NO_DUE_DATE"] },
      targetType: nullable(drilldownShortText(60)),
    }),
    page: reference("PlatformListPage"),
    items: {
      type: "array",
      maxItems: 100,
      items: strictObject(
        [
          "reviewTaskId",
          "tenantId",
          "tenantName",
          "projectId",
          "targetType",
          "targetVersion",
          "assignedRole",
          "assigned",
          "status",
          "createdAt",
          "dueAt",
          "waitingSeconds",
          "sla",
          "tenantHref",
        ],
        {
          reviewTaskId: overviewIdentifier,
          tenantId: overviewIdentifier,
          tenantName: nullable(drilldownShortText(200)),
          projectId: overviewIdentifier,
          targetType: drilldownShortText(60),
          targetVersion: overviewNonnegativeInteger,
          assignedRole: drilldownShortText(60),
          assigned: { type: "boolean" },
          status: drilldownShortText(60),
          createdAt: overviewIso,
          dueAt: nullable(overviewIso),
          waitingSeconds: overviewNonnegativeInteger,
          sla: { type: "string", enum: ["BREACHED", "DUE_SOON", "ON_TRACK", "NO_DUE_DATE"] },
          tenantHref: drilldownHref,
        },
      ),
    },
  },
);

const usageGroupSchema = strictObject(
  [
    "key",
    "label",
    "href",
    "runs",
    "costMicroUsd",
    "actualMicroUsd",
    "estimatedMicroUsd",
    "actualRunCount",
    "estimatedRunCount",
    "actualCoveragePercent",
    "inputTokens",
    "outputTokens",
    "cachedInputTokens",
    "reasoningTokens",
    "costSharePercent",
  ],
  {
    key: drilldownShortText(200),
    label: drilldownShortText(200),
    href: nullable(drilldownHref),
    runs: overviewNonnegativeInteger,
    costMicroUsd: overviewNonnegativeInteger,
    actualMicroUsd: overviewNonnegativeInteger,
    estimatedMicroUsd: overviewNonnegativeInteger,
    actualRunCount: overviewNonnegativeInteger,
    estimatedRunCount: overviewNonnegativeInteger,
    actualCoveragePercent: nullable(overviewPercent),
    inputTokens: overviewNonnegativeInteger,
    outputTokens: overviewNonnegativeInteger,
    cachedInputTokens: overviewNonnegativeInteger,
    reasoningTokens: overviewNonnegativeInteger,
    costSharePercent: nullable(overviewPercent),
  },
);

const usageSchema = drilldownEnvelope("platform-usage.v1", ["filters", "totals", "groups"], {
  filters: strictObject(["tenantId", "agentType", "groupBy"], {
    tenantId: nullable(overviewIdentifier),
    agentType: nullable(drilldownAgentType),
    groupBy: { type: "string", enum: ["TENANT", "AGENT_TYPE", "MODEL"] },
  }),
  totals: drilldownSection(
    [
      "runs",
      "costMicroUsd",
      "actualMicroUsd",
      "estimatedMicroUsd",
      "actualCoveragePercent",
      "inputTokens",
      "outputTokens",
      "cachedInputTokens",
      "reasoningTokens",
      "budgetModel",
    ],
    {
      runs: nullable(overviewNonnegativeInteger),
      costMicroUsd: nullable(overviewNonnegativeInteger),
      actualMicroUsd: nullable(overviewNonnegativeInteger),
      estimatedMicroUsd: nullable(overviewNonnegativeInteger),
      actualCoveragePercent: nullable(overviewPercent),
      inputTokens: nullable(overviewNonnegativeInteger),
      outputTokens: nullable(overviewNonnegativeInteger),
      cachedInputTokens: nullable(overviewNonnegativeInteger),
      reasoningTokens: nullable(overviewNonnegativeInteger),
      budgetModel: { type: "string", enum: ["NOT_CONFIGURED"] },
    },
  ),
  groups: drilldownSection(["total", "truncated", "items"], {
    total: overviewNonnegativeInteger,
    truncated: { type: "boolean" },
    items: { type: "array", maxItems: 50, items: reference("PlatformUsageGroup") },
  }),
});

const systemHealthDetailSchema = drilldownEnvelope(
  "platform-system-health.v1",
  ["filters", "state", "components", "outboxByType", "tenantImpact"],
  {
    filters: strictObject(["tenantId"], { tenantId: nullable(overviewIdentifier) }),
    state: { type: "string", enum: ["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"] },
    components: {
      type: "array",
      maxItems: 10,
      items: reference("PlatformOverviewSystemComponent"),
    },
    outboxByType: drilldownSection(["items"], {
      items: {
        type: "array",
        maxItems: 25,
        items: strictObject(
          ["eventType", "pending", "stalled", "failed", "deadLetter", "oldestEvidenceAt"],
          {
            eventType: drilldownShortText(120),
            pending: overviewNonnegativeInteger,
            stalled: overviewNonnegativeInteger,
            failed: overviewNonnegativeInteger,
            deadLetter: overviewNonnegativeInteger,
            oldestEvidenceAt: nullable(overviewIso),
          },
        ),
      },
    }),
    tenantImpact: drilldownSection(["items"], {
      items: {
        type: "array",
        maxItems: 25,
        items: strictObject(
          [
            "tenantId",
            "tenantName",
            "outboxStalled",
            "outboxDeadLetter",
            "notificationFailed",
            "artifactQuarantined",
            "healthHref",
          ],
          {
            tenantId: overviewIdentifier,
            tenantName: nullable(drilldownShortText(200)),
            outboxStalled: overviewNonnegativeInteger,
            outboxDeadLetter: overviewNonnegativeInteger,
            notificationFailed: overviewNonnegativeInteger,
            artifactQuarantined: overviewNonnegativeInteger,
            healthHref: drilldownHref,
          },
        ),
      },
    }),
  },
);

const auditLogSchema = drilldownEnvelope("platform-audit-logs.v1", ["filters", "page", "items"], {
  filters: strictObject(["tenantId", "actorId", "source", "actorRole", "action", "result"], {
    tenantId: nullable(overviewIdentifier),
    actorId: nullable(overviewIdentifier),
    source: { type: "string", enum: ["ALL", "PLATFORM", "TENANT"] },
    actorRole: nullable(drilldownShortText(100)),
    action: nullable(drilldownShortText(200)),
    result: nullable({ type: "string", enum: ["SUCCESS", "DENIED", "FAILED"] }),
  }),
  page: reference("PlatformListPage"),
  items: {
    type: "array",
    maxItems: 100,
    items: strictObject(
      [
        "id",
        "actorId",
        "actorDisplayName",
        "actorRole",
        "action",
        "tenantId",
        "resourceType",
        "resourceId",
        "result",
        "reason",
        "correlationId",
        "beforeHash",
        "afterHash",
        "occurredAt",
      ],
      {
        id: overviewIdentifier,
        actorId: nullable(overviewIdentifier),
        actorDisplayName: nullable(drilldownShortText(200)),
        actorRole: nullable(drilldownShortText(100)),
        action: drilldownShortText(200),
        tenantId: nullable(overviewIdentifier),
        resourceType: drilldownShortText(100),
        resourceId: nullable(overviewIdentifier),
        result: { type: "string", enum: ["SUCCESS", "DENIED", "FAILED"] },
        reason: nullable(drilldownShortText(300)),
        correlationId: overviewIdentifier,
        beforeHash: nullable(drilldownSha256),
        afterHash: nullable(drilldownSha256),
        occurredAt: overviewIso,
      },
    ),
  },
});

const queryParameter = (name: string, schema: Record<string, unknown>, description?: string) => ({
  name,
  in: "query",
  schema,
  ...(description === undefined ? {} : { description }),
});

const pathParameter = (name: string, schema: Record<string, unknown>) => ({
  name,
  in: "path",
  required: true,
  schema,
});

const rangeParameters = [
  queryParameter(
    "window",
    { type: "string", enum: ["24h", "7d", "30d"] },
    "Preset UTC range. Omit when from and to are supplied.",
  ),
  queryParameter("from", { type: "string", format: "date-time" }),
  queryParameter("to", { type: "string", format: "date-time" }),
];

const pageParameters = [
  queryParameter("limit", { type: "integer", minimum: 1, maximum: 100 }),
  queryParameter(
    "cursor",
    { type: "string", minLength: 1, maxLength: 2048 },
    "Opaque keyset cursor returned as page.nextCursor.",
  ),
];

const tenantIdParameter = queryParameter("tenantId", overviewIdentifier);
const agentTypeParameter = queryParameter("agentType", drilldownAgentType);
const orderParameter = queryParameter("order", { type: "string", enum: ["ASC", "DESC"] });

const drilldownOperation = (
  operationId: string,
  description: string,
  schemaName: string,
  parameters: Record<string, unknown>[],
) => ({
  get: {
    operationId,
    security: [{ platformBearerAuth: [] }],
    parameters,
    responses: {
      "200": response(description, reference(schemaName)),
      "400": errorReference,
      "401": errorReference,
      "403": errorReference,
      "404": errorReference,
    },
  },
});

const platformDrilldownPaths = {
  "/platform/v1/tenants": drilldownOperation(
    "listPlatformTenants",
    "Cross-tenant health list with server-side filter, sort and keyset pagination",
    "PlatformTenantList",
    [
      ...rangeParameters,
      ...pageParameters,
      queryParameter("search", { type: "string", minLength: 1, maxLength: 200 }),
      queryParameter("health", overviewHealth),
      queryParameter("sort", {
        type: "string",
        enum: ["HEALTH", "NAME", "LAST_ACTIVITY", "RUNS", "REVIEW_BREACHED", "AI_SPEND"],
      }),
      orderParameter,
    ],
  ),
  "/platform/v1/tenants/{tenantId}/health": drilldownOperation(
    "getPlatformTenantHealth",
    "Single tenant health detail with redacted evidence",
    "PlatformTenantHealth",
    [pathParameter("tenantId", overviewIdentifier), ...rangeParameters],
  ),
  "/platform/v1/agents": drilldownOperation(
    "listPlatformAgents",
    "Agent type health list",
    "PlatformAgentList",
    [
      ...rangeParameters,
      ...pageParameters,
      tenantIdParameter,
      queryParameter("state", { type: "string", enum: ["ACTIVE", "DEGRADED", "UNKNOWN"] }),
      queryParameter("sort", {
        type: "string",
        enum: ["STATE", "AGENT_TYPE", "RUNS", "COMPLETION", "P95_LATENCY", "COST"],
      }),
      orderParameter,
    ],
  ),
  "/platform/v1/agents/{agentType}": drilldownOperation(
    "getPlatformAgentDetail",
    "Agent type detail with failure, tenant and model breakdown",
    "PlatformAgentDetail",
    [pathParameter("agentType", drilldownAgentType), ...rangeParameters, tenantIdParameter],
  ),
  "/platform/v1/agent-runs": drilldownOperation(
    "listPlatformAgentRuns",
    "Agent run list with keyset pagination and no run content",
    "PlatformAgentRunList",
    [
      ...rangeParameters,
      ...pageParameters,
      tenantIdParameter,
      agentTypeParameter,
      queryParameter("status", {
        type: "string",
        enum: ["RUNNING", "COMPLETED", "FAILED", "DEGRADED", "REJECTED"],
      }),
      queryParameter("outcome", { type: "string", enum: ["TERMINAL", "NON_COMPLETION"] }),
      queryParameter("failureCategory", { type: "string", minLength: 1, maxLength: 60 }),
      queryParameter("stuck", { type: "string", enum: ["true", "false"] }),
      orderParameter,
    ],
  ),
  "/platform/v1/agent-runs/{runId}/diagnostics": drilldownOperation(
    "getPlatformAgentRunDiagnostics",
    "Run diagnostics with prompt, output and tool payloads redacted",
    "PlatformAgentRunDiagnostics",
    [pathParameter("runId", overviewIdentifier)],
  ),
  "/platform/v1/reviews/summary": drilldownOperation(
    "getPlatformReviewSummary",
    "Review backlog, ageing and decision throughput summary",
    "PlatformReviewSummary",
    [...rangeParameters, tenantIdParameter],
  ),
  "/platform/v1/reviews/backlog": drilldownOperation(
    "listPlatformReviewBacklog",
    "Waiting review tasks with SLA classification and no review content",
    "PlatformReviewBacklog",
    [
      ...rangeParameters,
      ...pageParameters,
      tenantIdParameter,
      queryParameter("sla", {
        type: "string",
        enum: ["ALL", "BREACHED", "DUE_SOON", "NO_DUE_DATE"],
      }),
      queryParameter("targetType", { type: "string", minLength: 1, maxLength: 60 }),
      orderParameter,
    ],
  ),
  "/platform/v1/usage": drilldownOperation(
    "getPlatformUsage",
    "Token and cost usage grouped by tenant, agent type or model",
    "PlatformUsage",
    [
      ...rangeParameters,
      tenantIdParameter,
      agentTypeParameter,
      queryParameter("groupBy", { type: "string", enum: ["TENANT", "AGENT_TYPE", "MODEL"] }),
    ],
  ),
  "/platform/v1/system-health": drilldownOperation(
    "getPlatformSystemHealth",
    "Component health with outbox event-type and tenant impact detail",
    "PlatformSystemHealthDetail",
    [tenantIdParameter],
  ),
  "/platform/v1/audit-logs": drilldownOperation(
    "listPlatformAuditLogs",
    "Platform audit trail with keyset pagination",
    "PlatformAuditLogList",
    [
      ...rangeParameters,
      ...pageParameters,
      tenantIdParameter,
      queryParameter("actorId", overviewIdentifier),
      queryParameter("source", { type: "string", enum: ["ALL", "PLATFORM", "TENANT"] }),
      queryParameter("actorRole", { type: "string", minLength: 1, maxLength: 100 }),
      queryParameter("action", { type: "string", minLength: 1, maxLength: 200 }),
      queryParameter("result", { type: "string", enum: ["SUCCESS", "DENIED", "FAILED"] }),
      orderParameter,
    ],
  ),
} as const;

/* ------------------------------ Phase 6 incidents ------------------------ */

const incidentSeverity = { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] };
const incidentState = {
  type: "string",
  enum: ["OPEN", "ACKNOWLEDGED", "RESOLVED", "REOPENED"],
};
const principalRefSchema = strictObject(["principalId", "displayName"], {
  principalId: overviewIdentifier,
  displayName: nullable(drilldownShortText(200)),
});

const incidentSchema = strictObject(
  [
    "incidentId",
    "signalId",
    "ruleKey",
    "ruleVersion",
    "severity",
    "state",
    "active",
    "title",
    "impact",
    "recommendedAction",
    "scope",
    "diagnosticsHref",
    "detailHref",
    "evidence",
    "firstEvidenceAt",
    "lastEvidenceAt",
    "openedAt",
    "acknowledgedAt",
    "acknowledgedBy",
    "assignedAt",
    "assignedTo",
    "resolvedAt",
    "resolvedBy",
    "resolutionNote",
    "autoResolved",
    "reopenCount",
    "rowVersion",
  ],
  {
    incidentId: overviewIdentifier,
    signalId: overviewIdentifier,
    ruleKey: overviewIdentifier,
    ruleVersion: drilldownShortText(100),
    severity: incidentSeverity,
    state: incidentState,
    active: { type: "boolean" },
    title: drilldownShortText(200),
    impact: drilldownShortText(500),
    recommendedAction: drilldownShortText(500),
    scope: reference("PlatformOverviewScope"),
    diagnosticsHref: drilldownHref,
    detailHref: drilldownHref,
    evidence: {
      type: "array",
      maxItems: 10,
      items: strictObject(["metricKey", "value", "unit", "observedAt"], {
        metricKey: overviewIdentifier,
        value: { anyOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }] },
        unit: drilldownShortText(50),
        observedAt: overviewIso,
      }),
    },
    firstEvidenceAt: nullable(overviewIso),
    lastEvidenceAt: overviewIso,
    openedAt: overviewIso,
    acknowledgedAt: nullable(overviewIso),
    acknowledgedBy: nullable(reference("PlatformPrincipalRef")),
    assignedAt: nullable(overviewIso),
    assignedTo: nullable(reference("PlatformPrincipalRef")),
    resolvedAt: nullable(overviewIso),
    resolvedBy: nullable(reference("PlatformPrincipalRef")),
    resolutionNote: nullable(drilldownShortText(1000)),
    autoResolved: { type: "boolean" },
    reopenCount: overviewNonnegativeInteger,
    rowVersion: { type: "integer", minimum: 1 },
  },
);

const incidentEventSchema = strictObject(
  [
    "eventId",
    "type",
    "fromState",
    "toState",
    "actor",
    "actorRole",
    "reason",
    "note",
    "correlationId",
    "occurredAt",
  ],
  {
    eventId: overviewIdentifier,
    type: {
      type: "string",
      enum: [
        "OPENED",
        "SEVERITY_CHANGED",
        "ACKNOWLEDGED",
        "ASSIGNED",
        "RESOLVED",
        "AUTO_RESOLVED",
        "REOPENED",
      ],
    },
    fromState: nullable(incidentState),
    toState: incidentState,
    actor: nullable(reference("PlatformPrincipalRef")),
    actorRole: nullable(drilldownShortText(100)),
    reason: nullable(drilldownShortText(500)),
    note: nullable(drilldownShortText(1000)),
    correlationId: overviewIdentifier,
    occurredAt: overviewIso,
  },
);

const incidentEnvelope = (
  schemaVersion: string,
  required: string[],
  properties: Record<string, unknown>,
) =>
  strictObject(["schemaVersion", "generatedAt", "asOf", "partial", "problems", ...required], {
    schemaVersion: { type: "string", enum: [schemaVersion] },
    generatedAt: overviewIso,
    asOf: overviewIso,
    partial: { type: "boolean" },
    problems: { type: "array", maxItems: 10, items: reference("PlatformOverviewProblem") },
    ...properties,
  });

const incidentListSchema = incidentEnvelope(
  "platform-incidents.v1",
  ["filters", "page", "totals", "items"],
  {
    filters: strictObject(
      ["state", "activeOnly", "severity", "tenantId", "agentType", "assignedToId"],
      {
        state: nullable(incidentState),
        activeOnly: { type: "boolean" },
        severity: nullable(incidentSeverity),
        tenantId: nullable(overviewIdentifier),
        agentType: nullable(drilldownAgentType),
        assignedToId: nullable(overviewIdentifier),
      },
    ),
    page: reference("PlatformListPage"),
    totals: strictObject(["open", "acknowledged", "reopened", "resolved", "critical", "high"], {
      open: overviewNonnegativeInteger,
      acknowledged: overviewNonnegativeInteger,
      reopened: overviewNonnegativeInteger,
      resolved: overviewNonnegativeInteger,
      critical: overviewNonnegativeInteger,
      high: overviewNonnegativeInteger,
    }),
    items: { type: "array", maxItems: 100, items: reference("PlatformIncident") },
  },
);

const incidentDetailSchema = incidentEnvelope(
  "platform-incident-detail.v1",
  ["incident", "timeline", "allowedActions", "resolveRequiresStepUp"],
  {
    incident: reference("PlatformIncident"),
    timeline: strictObject(["total", "truncated", "items"], {
      total: overviewNonnegativeInteger,
      truncated: { type: "boolean" },
      items: { type: "array", maxItems: 200, items: reference("PlatformIncidentEvent") },
    }),
    allowedActions: {
      type: "array",
      maxItems: 3,
      items: { type: "string", enum: ["ACKNOWLEDGE", "ASSIGN", "RESOLVE"] },
    },
    resolveRequiresStepUp: { type: "boolean" },
  },
);

const incidentMutationSchema = incidentEnvelope(
  "platform-incident-mutation.v1",
  ["incident", "event", "change"],
  {
    incident: reference("PlatformIncident"),
    event: reference("PlatformIncidentEvent"),
    change: strictObject(["beforeHash", "afterHash", "summary", "idempotent", "correlationId"], {
      beforeHash: drilldownSha256,
      afterHash: drilldownSha256,
      summary: drilldownShortText(300),
      idempotent: { type: "boolean" },
      correlationId: overviewIdentifier,
    }),
  },
);

const incidentReasonSchema = { type: "string", minLength: 8, maxLength: 500 };
const incidentRowVersionSchema = { type: "integer", minimum: 1 };

const incidentAcknowledgeRequestSchema = strictObject(["reason", "rowVersion"], {
  reason: incidentReasonSchema,
  rowVersion: incidentRowVersionSchema,
});

const incidentAssignRequestSchema = strictObject(["reason", "rowVersion", "assigneePrincipalId"], {
  reason: incidentReasonSchema,
  rowVersion: incidentRowVersionSchema,
  assigneePrincipalId: overviewIdentifier,
});

const incidentResolveRequestSchema = strictObject(["reason", "rowVersion", "resolutionNote"], {
  reason: incidentReasonSchema,
  rowVersion: incidentRowVersionSchema,
  resolutionNote: { type: "string", minLength: 1, maxLength: 1000 },
  stepUpPassword: {
    type: "string",
    minLength: 12,
    maxLength: 200,
    description: "Required when resolving a CRITICAL or HIGH incident.",
  },
});

const idempotencyKeyParameter = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  schema: { type: "string", minLength: 8, maxLength: 200 },
  description: "Replaying the same key returns the recorded transition unchanged.",
};

const incidentActionOperation = (operationId: string, description: string, schemaName: string) => ({
  post: {
    operationId,
    security: [{ platformBearerAuth: [] }],
    parameters: [pathParameter("incidentId", overviewIdentifier), idempotencyKeyParameter],
    requestBody: { required: true, content: jsonContent(reference(schemaName)) },
    responses: {
      "200": response(description, reference("PlatformIncidentMutation")),
      "400": errorReference,
      "401": errorReference,
      "403": errorReference,
      "404": errorReference,
      "409": errorReference,
    },
  },
});

const platformIncidentPaths = {
  "/platform/v1/incidents": drilldownOperation(
    "listPlatformIncidents",
    "Deduplicated platform incidents with lifecycle state",
    "PlatformIncidentList",
    [
      ...pageParameters,
      queryParameter("state", incidentState),
      queryParameter("activeOnly", { type: "string", enum: ["true", "false"] }),
      queryParameter("severity", incidentSeverity),
      tenantIdParameter,
      agentTypeParameter,
      queryParameter("assignedToId", overviewIdentifier),
      orderParameter,
    ],
  ),
  "/platform/v1/incidents/{incidentId}": drilldownOperation(
    "getPlatformIncident",
    "Incident detail with its append-only lifecycle timeline",
    "PlatformIncidentDetail",
    [pathParameter("incidentId", overviewIdentifier)],
  ),
  "/platform/v1/incidents/{incidentId}/acknowledge": incidentActionOperation(
    "acknowledgePlatformIncident",
    "Incident acknowledged",
    "PlatformIncidentAcknowledgeRequest",
  ),
  "/platform/v1/incidents/{incidentId}/assign": incidentActionOperation(
    "assignPlatformIncident",
    "Incident owner assigned",
    "PlatformIncidentAssignRequest",
  ),
  "/platform/v1/incidents/{incidentId}/resolve": incidentActionOperation(
    "resolvePlatformIncident",
    "Incident resolved",
    "PlatformIncidentResolveRequest",
  ),
} as const;

/* ------------------------ Phase 8: quality and support ------------------- */

const qualityMetricSchema = strictObject(
  [
    "kind",
    "label",
    "definition",
    "state",
    "valuePercent",
    "passed",
    "total",
    "sampleSize",
    "minimumSample",
    "window",
    "freshAt",
    "previousValuePercent",
    "deltaPercentagePoints",
    "source",
  ],
  {
    kind: {
      type: "string",
      enum: ["OFFLINE_EVALUATION", "PRODUCTION_VALIDATION", "HUMAN_FEEDBACK"],
    },
    label: drilldownShortText(120),
    definition: drilldownShortText(300),
    state: {
      type: "string",
      enum: ["AVAILABLE", "NO_DATA", "INSUFFICIENT_SAMPLE", "UNKNOWN"],
    },
    valuePercent: nullable(overviewPercent),
    passed: nullable(overviewNonnegativeInteger),
    total: nullable(overviewNonnegativeInteger),
    sampleSize: overviewNonnegativeInteger,
    minimumSample: overviewNonnegativeInteger,
    window: strictObject(["from", "to", "timeZone"], {
      from: overviewIso,
      to: overviewIso,
      timeZone: { type: "string", enum: ["UTC"] },
    }),
    freshAt: nullable(overviewIso),
    previousValuePercent: nullable(overviewPercent),
    deltaPercentagePoints: nullable({ type: "number" }),
    source: nullable(drilldownShortText(200)),
  },
);

const qualitySchema = drilldownEnvelope(
  "platform-quality.v1",
  ["filters", "metrics", "byAgent", "releases", "evaluationHistory"],
  {
    filters: strictObject(["window", "agentType"], {
      window: { type: "string", enum: ["7d", "30d", "90d"] },
      agentType: nullable(drilldownAgentType),
    }),
    metrics: drilldownSection(["items"], {
      items: { type: "array", maxItems: 3, items: reference("PlatformQualityMetric") },
    }),
    byAgent: drilldownSection(["items"], {
      items: {
        type: "array",
        maxItems: 50,
        items: strictObject(["agentType", "offline", "production", "humanFeedback", "detailHref"], {
          agentType: drilldownAgentType,
          offline: nullable(reference("PlatformQualityMetric")),
          production: nullable(reference("PlatformQualityMetric")),
          humanFeedback: nullable(reference("PlatformQualityMetric")),
          detailHref: drilldownHref,
        }),
      },
    }),
    releases: drilldownSection(["total", "truncated", "items"], {
      total: overviewNonnegativeInteger,
      truncated: { type: "boolean" },
      items: {
        type: "array",
        maxItems: 25,
        items: strictObject(
          [
            "agentRelease",
            "promptVersion",
            "modelId",
            "provider",
            "firstSeenAt",
            "lastSeenAt",
            "offline",
            "production",
            "humanFeedback",
            "runs",
          ],
          {
            agentRelease: drilldownShortText(200),
            promptVersion: drilldownShortText(60),
            modelId: drilldownShortText(120),
            provider: drilldownShortText(60),
            firstSeenAt: overviewIso,
            lastSeenAt: overviewIso,
            offline: nullable(reference("PlatformQualityMetric")),
            production: nullable(reference("PlatformQualityMetric")),
            humanFeedback: nullable(reference("PlatformQualityMetric")),
            runs: overviewNonnegativeInteger,
          },
        ),
      },
    }),
    evaluationHistory: drilldownSection(["total", "items"], {
      total: overviewNonnegativeInteger,
      items: {
        type: "array",
        maxItems: 50,
        items: strictObject(
          [
            "runId",
            "suiteKey",
            "suiteVersion",
            "agentType",
            "agentRelease",
            "caseCount",
            "passedCount",
            "failedCount",
            "skippedCount",
            "scorePercent",
            "completedAt",
            "sourceRef",
          ],
          {
            runId: overviewIdentifier,
            suiteKey: drilldownShortText(120),
            suiteVersion: drilldownShortText(60),
            agentType: drilldownAgentType,
            agentRelease: drilldownShortText(200),
            caseCount: overviewNonnegativeInteger,
            passedCount: overviewNonnegativeInteger,
            failedCount: overviewNonnegativeInteger,
            skippedCount: overviewNonnegativeInteger,
            scorePercent: nullable(overviewPercent),
            completedAt: overviewIso,
            sourceRef: nullable(drilldownShortText(200)),
          },
        ),
      },
    }),
  },
);

const supportAccessState = {
  type: "string",
  enum: ["REQUESTED", "APPROVED", "DENIED", "REVOKED", "EXPIRED"],
};
const supportAccessOperation = {
  type: "string",
  enum: [
    "READ_TENANT_HEALTH",
    "READ_AGENT_RUNS",
    "READ_RUN_DIAGNOSTICS",
    "READ_REVIEW_BACKLOG",
    "READ_SYSTEM_HEALTH",
  ],
};

const supportAccessGrantSchema = strictObject(
  [
    "grantId",
    "ticketReference",
    "reason",
    "tenantId",
    "tenantName",
    "projectId",
    "allowedOperations",
    "maskedOnly",
    "state",
    "active",
    "requestedBy",
    "requestedAt",
    "approvedBy",
    "approvedAt",
    "startsAt",
    "expiresAt",
    "expiresInSeconds",
    "decisionReason",
    "revokedBy",
    "revokedAt",
    "useCount",
    "lastUsedAt",
    "detailHref",
    "rowVersion",
  ],
  {
    grantId: overviewIdentifier,
    ticketReference: drilldownShortText(120),
    reason: drilldownShortText(500),
    tenantId: overviewIdentifier,
    tenantName: nullable(drilldownShortText(200)),
    projectId: nullable(overviewIdentifier),
    allowedOperations: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: supportAccessOperation,
    },
    maskedOnly: { type: "boolean", enum: [true] },
    state: supportAccessState,
    active: { type: "boolean" },
    requestedBy: reference("PlatformPrincipalRef"),
    requestedAt: overviewIso,
    approvedBy: nullable(reference("PlatformPrincipalRef")),
    approvedAt: nullable(overviewIso),
    startsAt: nullable(overviewIso),
    expiresAt: overviewIso,
    expiresInSeconds: nullable({ type: "integer" }),
    decisionReason: nullable(drilldownShortText(500)),
    revokedBy: nullable(reference("PlatformPrincipalRef")),
    revokedAt: nullable(overviewIso),
    useCount: overviewNonnegativeInteger,
    lastUsedAt: nullable(overviewIso),
    detailHref: drilldownHref,
    rowVersion: { type: "integer", minimum: 1 },
  },
);

const supportAccessEventSchema = strictObject(
  [
    "eventId",
    "type",
    "fromState",
    "toState",
    "actor",
    "actorRole",
    "reason",
    "correlationId",
    "occurredAt",
  ],
  {
    eventId: overviewIdentifier,
    type: {
      type: "string",
      enum: ["REQUESTED", "APPROVED", "DENIED", "REVOKED", "EXPIRED", "USED"],
    },
    fromState: nullable(supportAccessState),
    toState: supportAccessState,
    actor: nullable(reference("PlatformPrincipalRef")),
    actorRole: nullable(drilldownShortText(100)),
    reason: nullable(drilldownShortText(500)),
    correlationId: overviewIdentifier,
    occurredAt: overviewIso,
  },
);

const supportAccessListSchema = incidentEnvelope(
  "platform-support-access.v1",
  ["filters", "page", "totals", "items"],
  {
    filters: strictObject(["state", "activeOnly", "tenantId"], {
      state: nullable(supportAccessState),
      activeOnly: { type: "boolean" },
      tenantId: nullable(overviewIdentifier),
    }),
    page: reference("PlatformListPage"),
    totals: strictObject(["requested", "approved", "active", "expired", "revoked", "denied"], {
      requested: overviewNonnegativeInteger,
      approved: overviewNonnegativeInteger,
      active: overviewNonnegativeInteger,
      expired: overviewNonnegativeInteger,
      revoked: overviewNonnegativeInteger,
      denied: overviewNonnegativeInteger,
    }),
    items: { type: "array", maxItems: 100, items: reference("PlatformSupportAccessGrant") },
  },
);

const supportAccessDetailSchema = incidentEnvelope(
  "platform-support-access-detail.v1",
  ["grant", "timeline", "allowedActions", "canApprove"],
  {
    grant: reference("PlatformSupportAccessGrant"),
    timeline: strictObject(["total", "truncated", "items"], {
      total: overviewNonnegativeInteger,
      truncated: { type: "boolean" },
      items: {
        type: "array",
        maxItems: 200,
        items: reference("PlatformSupportAccessEvent"),
      },
    }),
    allowedActions: {
      type: "array",
      maxItems: 3,
      items: { type: "string", enum: ["APPROVE", "DENY", "REVOKE"] },
    },
    canApprove: { type: "boolean" },
  },
);

const supportAccessMutationSchema = incidentEnvelope(
  "platform-support-access-mutation.v1",
  ["grant", "event", "change"],
  {
    grant: reference("PlatformSupportAccessGrant"),
    event: reference("PlatformSupportAccessEvent"),
    change: strictObject(["beforeHash", "afterHash", "summary", "idempotent", "correlationId"], {
      beforeHash: drilldownSha256,
      afterHash: drilldownSha256,
      summary: drilldownShortText(300),
      idempotent: { type: "boolean" },
      correlationId: overviewIdentifier,
    }),
  },
);

const supportAccessRequestSchema = strictObject(
  ["ticketReference", "reason", "tenantId", "allowedOperations", "durationSeconds"],
  {
    ticketReference: drilldownShortText(120),
    reason: incidentReasonSchema,
    tenantId: overviewIdentifier,
    projectId: overviewIdentifier,
    allowedOperations: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: supportAccessOperation,
    },
    durationSeconds: { type: "integer", minimum: 300, maximum: 28800 },
  },
);

const supportAccessDecisionSchema = strictObject(["reason", "rowVersion"], {
  reason: incidentReasonSchema,
  rowVersion: incidentRowVersionSchema,
});

const supportActionOperation = (
  operationId: string,
  description: string,
  schemaName: string,
  parameters: Record<string, unknown>[],
) => ({
  post: {
    operationId,
    security: [{ platformBearerAuth: [] }],
    parameters,
    requestBody: { required: true, content: jsonContent(reference(schemaName)) },
    responses: {
      "200": response(description, reference("PlatformSupportAccessMutation")),
      "400": errorReference,
      "401": errorReference,
      "403": errorReference,
      "404": errorReference,
      "409": errorReference,
    },
  },
});

const platformAdvancedPaths = {
  "/platform/v1/quality": drilldownOperation(
    "getPlatformQuality",
    "Offline evaluation, production validation and human feedback as separate metrics",
    "PlatformQuality",
    [queryParameter("window", { type: "string", enum: ["7d", "30d", "90d"] }), agentTypeParameter],
  ),
  "/platform/v1/support-access": {
    ...drilldownOperation(
      "listPlatformSupportAccess",
      "Time-boxed support diagnostic access grants",
      "PlatformSupportAccessList",
      [
        ...pageParameters,
        queryParameter("state", supportAccessState),
        queryParameter("activeOnly", { type: "string", enum: ["true", "false"] }),
        tenantIdParameter,
        orderParameter,
      ],
    ),
    ...supportActionOperation(
      "requestPlatformSupportAccess",
      "Support access requested and awaiting a second approver",
      "PlatformSupportAccessRequest",
      [idempotencyKeyParameter],
    ),
  },
  "/platform/v1/support-access/{grantId}": drilldownOperation(
    "getPlatformSupportAccess",
    "Support access grant with its append-only history",
    "PlatformSupportAccessDetail",
    [pathParameter("grantId", overviewIdentifier)],
  ),
  "/platform/v1/support-access/{grantId}/approve": supportActionOperation(
    "approvePlatformSupportAccess",
    "Support access approved by a second principal",
    "PlatformSupportAccessDecision",
    [pathParameter("grantId", overviewIdentifier), idempotencyKeyParameter],
  ),
  "/platform/v1/support-access/{grantId}/deny": supportActionOperation(
    "denyPlatformSupportAccess",
    "Support access denied",
    "PlatformSupportAccessDecision",
    [pathParameter("grantId", overviewIdentifier), idempotencyKeyParameter],
  ),
  "/platform/v1/support-access/{grantId}/revoke": supportActionOperation(
    "revokePlatformSupportAccess",
    "Support access revoked before expiry",
    "PlatformSupportAccessDecision",
    [pathParameter("grantId", overviewIdentifier), idempotencyKeyParameter],
  ),
} as const;

const platformAdvancedSchemas = {
  PlatformQualityMetric: qualityMetricSchema,
  PlatformQuality: qualitySchema,
  PlatformSupportAccessGrant: supportAccessGrantSchema,
  PlatformSupportAccessEvent: supportAccessEventSchema,
  PlatformSupportAccessList: supportAccessListSchema,
  PlatformSupportAccessDetail: supportAccessDetailSchema,
  PlatformSupportAccessMutation: supportAccessMutationSchema,
  PlatformSupportAccessRequest: supportAccessRequestSchema,
  PlatformSupportAccessDecision: supportAccessDecisionSchema,
} as const;

const platformIncidentSchemas = {
  PlatformPrincipalRef: principalRefSchema,
  PlatformIncident: incidentSchema,
  PlatformIncidentEvent: incidentEventSchema,
  PlatformIncidentList: incidentListSchema,
  PlatformIncidentDetail: incidentDetailSchema,
  PlatformIncidentMutation: incidentMutationSchema,
  PlatformIncidentAcknowledgeRequest: incidentAcknowledgeRequestSchema,
  PlatformIncidentAssignRequest: incidentAssignRequestSchema,
  PlatformIncidentResolveRequest: incidentResolveRequestSchema,
} as const;

const platformDrilldownSchemas = {
  PlatformListPage: listPageSchema,
  PlatformTenantListItem: tenantListItemSchema,
  PlatformTenantList: tenantListSchema,
  PlatformTenantHealth: tenantHealthSchema,
  PlatformAgentListItem: agentListItemSchema,
  PlatformAgentList: agentListSchema,
  PlatformAgentDetail: agentDetailSchema,
  PlatformAgentRunItem: agentRunItemSchema,
  PlatformAgentRunList: agentRunListSchema,
  PlatformAgentRunDiagnostics: agentRunDiagnosticsSchema,
  PlatformReviewSummary: reviewSummarySchema,
  PlatformReviewBacklog: reviewBacklogSchema,
  PlatformUsageGroup: usageGroupSchema,
  PlatformUsage: usageSchema,
  PlatformSystemHealthDetail: systemHealthDetailSchema,
  PlatformAuditLogList: auditLogSchema,
} as const;

export const buildWatchPhase9OpenApi = Object.freeze({
  openapi: "3.1.0",
  info: {
    title: "BuildWatch Canonical Backend API",
    version: "2.2.0-platform-phase3",
  },
  servers: [{ url: "/api" }],
  security: [{ bearerAuth: [] }],
  paths: {
    "/health/live": {
      get: {
        operationId: "getLiveness",
        security: [],
        responses: { "200": response("Live") },
      },
    },
    "/health/ready": {
      get: {
        operationId: "getReadiness",
        security: [],
        responses: {
          "200": response("Ready"),
          "503": response("Not ready"),
        },
      },
    },
    "/platform/v1/auth/login": {
      post: {
        operationId: "platformLogin",
        security: [],
        requestBody: {
          required: true,
          content: jsonContent(reference("PlatformLoginRequest")),
        },
        responses: {
          "200": response("Platform token pair", reference("PlatformTokenPair")),
          "401": errorReference,
        },
      },
    },
    "/platform/v1/auth/refresh": {
      post: {
        operationId: "platformRefreshSession",
        security: [],
        requestBody: {
          required: true,
          content: jsonContent(reference("PlatformRefreshRequest")),
        },
        responses: {
          "200": response("Rotated platform token pair", reference("PlatformTokenPair")),
          "401": errorReference,
        },
      },
    },
    "/platform/v1/auth/logout": {
      post: {
        operationId: "platformLogout",
        security: [],
        requestBody: {
          required: true,
          content: jsonContent(reference("PlatformRefreshRequest")),
        },
        responses: { "204": response("Platform session logged out") },
      },
    },
    "/platform/v1/session": {
      get: {
        operationId: "getPlatformSession",
        security: [{ platformBearerAuth: [] }],
        responses: {
          "200": response("Authenticated platform session", reference("PlatformSession")),
          "401": errorReference,
          "403": errorReference,
        },
      },
    },
    "/platform/v1/overview": {
      get: {
        operationId: "getPlatformOverview",
        security: [{ platformBearerAuth: [] }],
        parameters: [
          {
            name: "window",
            in: "query",
            schema: { type: "string", enum: ["24h", "7d", "30d"] },
            description: "Preset UTC range. Omit when from and to are supplied.",
          },
          {
            name: "from",
            in: "query",
            schema: { type: "string", format: "date-time" },
            description: "Inclusive custom UTC range start; requires to.",
          },
          {
            name: "to",
            in: "query",
            schema: { type: "string", format: "date-time" },
            description: "Exclusive custom UTC range end; requires from and cannot exceed asOf.",
          },
          {
            name: "tenantId",
            in: "query",
            schema: {
              type: "string",
              minLength: 1,
              maxLength: 200,
              pattern: "^[A-Za-z0-9][A-Za-z0-9_.:/-]*$",
            },
          },
          {
            name: "agentType",
            in: "query",
            schema: { type: "string", minLength: 1, maxLength: 100 },
          },
        ],
        responses: {
          "200": response("Strict platform control-tower overview", reference("PlatformOverview")),
          "400": errorReference,
          "401": errorReference,
          "403": errorReference,
        },
      },
    },
    ...platformDrilldownPaths,
    ...platformIncidentPaths,
    ...platformAdvancedPaths,
    "/public/v1/company-signups": {
      post: {
        operationId: "createCompanySignup",
        security: [],
        requestBody: {
          required: true,
          content: jsonContent(reference("CompanySignupRequest")),
        },
        responses: {
          "201": response(
            "Signup intent and email verification challenge",
            reference("CompanySignupCreated"),
          ),
          "400": errorReference,
          "429": errorReference,
        },
      },
    },
    "/public/v1/company-signups/{signupIntentId}/verify-email": {
      post: {
        operationId: "verifyCompanySignupEmail",
        security: [],
        parameters: [pathParameter("signupIntentId", overviewIdentifier)],
        requestBody: {
          required: true,
          content: jsonContent(reference("CompanySignupVerifyRequest")),
        },
        responses: {
          "200": response("Email verified", reference("CompanySignupStatus")),
          "400": errorReference,
          "429": errorReference,
        },
      },
    },
    "/public/v1/company-signups/{signupIntentId}/resend-verification-code": {
      post: {
        operationId: "resendCompanySignupVerificationCode",
        security: [],
        parameters: [pathParameter("signupIntentId", overviewIdentifier)],
        responses: {
          "200": response(
            "Fresh verification code sent",
            reference("CompanySignupVerificationSent"),
          ),
          "400": errorReference,
          "429": errorReference,
        },
      },
    },
    "/public/v1/company-signups/account-setup": {
      post: {
        operationId: "completeCompanySignupAccountSetup",
        security: [],
        requestBody: {
          required: true,
          content: jsonContent(reference("CompanyAccountSetupRequest")),
        },
        responses: {
          "200": response(
            "Company Admin account activated",
            reference("CompanyAccountSetupResult"),
          ),
          "400": errorReference,
          "429": errorReference,
        },
      },
    },
    "/v1/auth/login": {
      post: {
        operationId: "login",
        security: [],
        requestBody: {
          required: true,
          content: jsonContent(reference("LoginRequest")),
        },
        responses: {
          "200": response(
            "Token pair, or the organizations this email and password unlocked",
            reference("LoginResult"),
          ),
          "401": errorReference,
        },
      },
    },
    "/v1/auth/login/tenant": {
      post: {
        operationId: "completeTenantSelection",
        security: [],
        requestBody: {
          required: true,
          content: jsonContent(reference("TenantSelectionRequest")),
        },
        responses: {
          "200": response("Token pair", reference("AuthenticatedResult")),
          "401": errorReference,
        },
      },
    },
    "/v1/auth/refresh": {
      post: {
        operationId: "refreshSession",
        security: [],
        requestBody: {
          required: true,
          content: jsonContent(reference("RefreshRequest")),
        },
        responses: {
          "200": response("Rotated token pair", reference("TokenPair")),
          "401": errorReference,
        },
      },
    },
    "/v1/auth/logout": {
      post: {
        operationId: "logout",
        security: [],
        requestBody: {
          required: true,
          content: jsonContent(reference("RefreshRequest")),
        },
        responses: { "204": response("Logged out") },
      },
    },
    "/v1/session": {
      get: {
        operationId: "getSession",
        responses: {
          "200": response("Authenticated session", reference("Session")),
          "401": errorReference,
        },
      },
    },
    "/v1/invitations": {
      post: {
        operationId: "createInvitation",
        requestBody: {
          required: true,
          content: jsonContent(reference("InvitationRequest")),
        },
        responses: {
          "201": response("Invitation created", reference("InvitationResult")),
          "403": errorReference,
        },
      },
    },
    "/v1/invitations/accept": {
      post: {
        operationId: "acceptInvitation",
        security: [],
        requestBody: {
          required: true,
          content: jsonContent(reference("AcceptInvitationRequest")),
        },
        responses: {
          "201": response("Invitation accepted", reference("AcceptInvitationResult")),
          "400": errorReference,
        },
      },
    },
    "/v1/projects": {
      get: {
        operationId: "listProjects",
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          "200": response("Cursor project page", reference("ProjectPage")),
        },
      },
      post: {
        operationId: "createProject",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: jsonContent(reference("ProjectCreateRequest")),
        },
        responses: {
          "201": response("Project created", reference("ProjectCreateResult")),
          "409": errorReference,
        },
      },
    },
    "/v1/rules": {
      get: {
        operationId: "listRules",
        responses: {
          "200": response("DET-14 threshold rule catalog summary", reference("RuleListResult")),
        },
      },
    },
    "/v1/rules/{ruleId}/versions": {
      get: {
        operationId: "listRuleVersions",
        parameters: [{ $ref: "#/components/parameters/RuleId" }],
        responses: {
          "200": response("JDM graph versions for a rule", reference("RuleVersionsResult")),
          "400": errorReference,
        },
      },
    },
    "/v1/rules/{ruleId}/draft": {
      put: {
        operationId: "saveRuleDraft",
        parameters: [{ $ref: "#/components/parameters/RuleId" }],
        requestBody: {
          required: true,
          content: jsonContent(reference("JdmRuleGraph")),
        },
        responses: {
          "201": response("Draft JDM graph version saved", reference("RuleCatalogVersion")),
          "400": errorReference,
        },
      },
    },
    "/v1/rules/{ruleId}/publish": {
      post: {
        operationId: "publishRuleVersion",
        parameters: [{ $ref: "#/components/parameters/RuleId" }],
        requestBody: {
          required: true,
          content: jsonContent(reference("RulePublishRequest")),
        },
        responses: {
          "200": response(
            "Version applied as the tenant's active rule",
            reference("RuleCatalogVersion"),
          ),
          "404": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}": {
      get: {
        operationId: "getProject",
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        responses: {
          "200": response("Project", reference("ProjectSummary")),
          "404": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}/workspace": {
      get: {
        operationId: "getProjectWorkspace",
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        responses: {
          "200": response("Production frontend workspace", reference("Workspace")),
          "404": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}/daily-report-drafts": {
      post: {
        operationId: "submitDailyReportDraft",
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: jsonContent(reference("DailyReportDraftRequest")),
        },
        responses: {
          "201": response("Daily report review draft created", reference("DailyReportDraftResult")),
          "409": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}/artifacts": {
      post: {
        operationId: "uploadArtifact",
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          { $ref: "#/components/parameters/IdempotencyKey" },
          {
            name: "x-file-name",
            in: "header",
            required: true,
            description:
              "Original file name. Percent-encoded when x-file-name-encoding is percent.",
            schema: { type: "string", maxLength: 4096 },
          },
          {
            name: "x-file-name-encoding",
            in: "header",
            description: "Encoding marker used for Unicode-safe file names.",
            schema: { type: "string", enum: ["percent"] },
          },
          {
            name: "x-content-sha256",
            in: "header",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/pdf": { schema: { type: "string", format: "binary" } },
            "image/jpeg": { schema: { type: "string", format: "binary" } },
            "image/png": { schema: { type: "string", format: "binary" } },
            "image/webp": { schema: { type: "string", format: "binary" } },
            "application/acad": { schema: { type: "string", format: "binary" } },
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        responses: {
          "201": response("Artifact uploaded", reference("ArtifactUploadResult")),
          "409": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}/a0-intakes": {
      post: {
        operationId: "processA0Intake",
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: jsonContent(reference("A0IntakeRequest")),
        },
        responses: {
          "201": response("A0 package processed into review drafts", reference("A0IntakeResult")),
          "409": errorReference,
          "422": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}/a1-intakes": {
      post: {
        operationId: "processA1Intake",
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        requestBody: {
          required: true,
          content: jsonContent(reference("A1IntakeRequest")),
        },
        responses: {
          "201": response(
            "A1 text/image intake structured into a review draft",
            reference("A1IntakeResult"),
          ),
          "404": errorReference,
          "422": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}/a1-drafts/{draftId}": {
      patch: {
        operationId: "correctA1Draft",
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          {
            name: "draftId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: jsonContent(reference("A1DraftCorrectionRequest")),
        },
        responses: {
          "200": response(
            "Corrected A1 draft and replacement review task",
            reference("A1IntakeResult"),
          ),
          "404": errorReference,
          "409": errorReference,
          "422": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}/a3-documents": {
      post: {
        operationId: "generateA3Documents",
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        requestBody: {
          required: true,
          content: jsonContent(reference("A3DocumentRequest")),
        },
        responses: {
          "201": response(
            "A3 report, conclusion, and official-letter drafts",
            reference("A3DocumentResult"),
          ),
          "404": errorReference,
          "422": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}/inventory": {
      get: {
        operationId: "getProjectInventory",
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        responses: {
          "200": response(
            "Project stock ledger, balances, and material catalog",
            reference("InventoryResult"),
          ),
          "404": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}/inventory/movements": {
      post: {
        operationId: "createStockMovement",
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: jsonContent(reference("StockMovementRequest")),
        },
        responses: {
          "201": response("Append-only stock movement", reference("StockMovement")),
          "404": errorReference,
          "409": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}/chat": {
      post: {
        operationId: "askProjectAssistant",
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        requestBody: {
          required: true,
          content: jsonContent(reference("A4Question")),
        },
        responses: {
          "200": response("Source-backed read-only answer", reference("A4Answer")),
          "404": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}/reviews/{reviewTaskId}/decisions": {
      post: {
        operationId: "decideReview",
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          {
            name: "reviewTaskId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: jsonContent(reference("ReviewDecisionRequest")),
        },
        responses: {
          "200": response("Review decision", reference("ReviewDecisionResult")),
          "409": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}/approved-commands": {
      post: {
        operationId: "applyApprovedCommand",
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: jsonContent(reference("ApprovedCommandRequest")),
        },
        responses: {
          "201": response("Atomically applied command", reference("AppliedCommandResult")),
          "409": errorReference,
        },
      },
    },
    "/v1/projects/{projectId}/versions/compare": {
      get: {
        operationId: "compareVersions",
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          { name: "leftId", in: "query", required: true, schema: { type: "string" } },
          { name: "rightId", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": response("Version comparison") },
      },
    },
    "/v1/projects/{projectId}/forecast/latest": {
      get: {
        operationId: "getLatestForecast",
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          { name: "asOf", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": response("Latest authorized forecast"),
          "204": response("No forecast has been generated yet"),
        },
      },
    },
    "/v1/projects/{projectId}/audit": {
      get: {
        operationId: "listAudit",
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        responses: { "200": response("Audit entries", reference("AuditPage")) },
      },
    },
    "/v1/projects/{projectId}/artifacts/{artifactId}/signed-url": {
      post: {
        operationId: "createSignedArtifactUrl",
        parameters: [
          { $ref: "#/components/parameters/ProjectId" },
          {
            name: "artifactId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: jsonContent(reference("SignedArtifactRequest")),
        },
        responses: {
          "200": response("Short-lived signed URL", reference("SignedArtifactResult")),
        },
      },
    },
    "/v1/artifacts/{artifactId}/content": {
      get: {
        operationId: "downloadSignedArtifact",
        security: [],
        responses: {
          "200": response("Signed artifact content"),
          "403": errorReference,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      platformBearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Platform-only JWT: principalKind=PLATFORM and audience=buildwatch-platform",
      },
    },
    parameters: {
      ProjectId: {
        name: "projectId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 200 },
      },
      RuleId: {
        name: "ruleId",
        in: "path",
        required: true,
        schema: reference("RuleId"),
      },
    },
    responses: {
      Error: {
        description: "Stable BuildWatch error envelope",
        content: jsonContent(reference("ErrorEnvelope")),
      },
    },
    schemas: {
      ErrorEnvelope: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "correlationId"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              correlationId: { type: "string" },
              details: { type: "object", additionalProperties: true },
            },
          },
        },
      },
      PlatformLoginRequest: {
        type: "object",
        additionalProperties: false,
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", maxLength: 320 },
          password: { type: "string", minLength: 12, maxLength: 200 },
          deviceName: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
      PlatformRefreshRequest: {
        type: "object",
        additionalProperties: false,
        required: ["refreshToken"],
        properties: {
          refreshToken: { type: "string", minLength: 32, maxLength: 8192 },
        },
      },
      PlatformTokenPair: {
        type: "object",
        additionalProperties: false,
        required: [
          "tokenType",
          "accessToken",
          "accessExpiresAt",
          "refreshToken",
          "refreshExpiresAt",
        ],
        properties: {
          tokenType: { type: "string", enum: ["Bearer"] },
          accessToken: { type: "string", minLength: 32 },
          accessExpiresAt: { type: "string", format: "date-time" },
          refreshToken: { type: "string", minLength: 32 },
          refreshExpiresAt: { type: "string", format: "date-time" },
        },
      },
      PlatformSession: {
        type: "object",
        additionalProperties: false,
        required: ["schemaVersion", "principal", "permissions"],
        properties: {
          schemaVersion: { type: "integer", enum: [1] },
          principal: {
            type: "object",
            additionalProperties: false,
            required: ["principalKind", "id", "email", "displayName", "role"],
            properties: {
              principalKind: { type: "string", enum: ["PLATFORM"] },
              id: { type: "string" },
              email: { type: "string", format: "email" },
              displayName: { type: "string" },
              role: {
                type: "string",
                enum: ["PLATFORM_SUPER_ADMIN", "PLATFORM_OPERATOR", "PLATFORM_AUDITOR"],
              },
            },
          },
          permissions: {
            type: "array",
            items: {
              type: "string",
              enum: [
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
              ],
            },
          },
        },
      },
      PlatformOverviewFreshness: overviewFreshnessSchema,
      PlatformOverviewWindow: overviewWindowSchema,
      PlatformOverviewComparison: overviewComparisonSchema,
      PlatformOverviewMetricContext: overviewMetricContextSchema,
      PlatformOverviewSectionContext: overviewSectionContextSchema,
      PlatformOverviewScope: overviewScopeSchema,
      PlatformOverviewCause: overviewCauseSchema,
      PlatformOverviewKpis: overviewKpisSchema,
      PlatformOverviewAttentionItem: overviewAttentionItemSchema,
      PlatformOverviewAttention: overviewAttentionSchema,
      PlatformOverviewTenantItem: overviewTenantItemSchema,
      PlatformOverviewTenantPreview: overviewTenantPreviewSchema,
      PlatformOverviewAgentItem: overviewAgentItemSchema,
      PlatformOverviewAgentPreview: overviewAgentPreviewSchema,
      PlatformOverviewSystemMetric: overviewSystemMetricSchema,
      PlatformOverviewSystemComponent: overviewSystemComponentSchema,
      PlatformOverviewSystemHealth: overviewSystemHealthSchema,
      PlatformOverviewAuditItem: overviewAuditItemSchema,
      PlatformOverviewRecentAudit: overviewRecentAuditSchema,
      PlatformOverviewProblem: overviewProblemSchema,
      PlatformOverview: platformOverviewSchema,
      ...platformDrilldownSchemas,
      ...platformIncidentSchemas,
      ...platformAdvancedSchemas,
      CompanySignupRequest: strictObject(
        ["companyName", "desiredSlug", "adminEmail", "adminDisplayName", "planCode", "interval"],
        {
          companyName: { type: "string", minLength: 2, maxLength: 200 },
          desiredSlug: {
            type: "string",
            minLength: 2,
            maxLength: 60,
            pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$",
          },
          adminEmail: { type: "string", format: "email", maxLength: 320 },
          adminDisplayName: { type: "string", minLength: 2, maxLength: 200 },
          planCode: { type: "string", minLength: 2, maxLength: 60 },
          interval: { type: "string", enum: ["MONTH", "YEAR"] },
        },
      ),
      CompanySignupCreated: strictObject(["signupIntentId", "status"], {
        signupIntentId: overviewIdentifier,
        status: {
          type: "string",
          enum: ["PENDING", "CONFIRMING", "ACTIVE", "FAILED", "EXPIRED"],
        },
        verificationCode: {
          type: "string",
          pattern: "^[0-9]{6}$",
          description: "Development and test environments only; never returned in production.",
        },
      }),
      CompanySignupVerifyRequest: strictObject(["code"], {
        code: { type: "string", pattern: "^[0-9]{6}$" },
      }),
      CompanySignupStatus: strictObject(["status"], {
        status: {
          type: "string",
          enum: ["PENDING", "CONFIRMING", "ACTIVE", "FAILED", "EXPIRED"],
        },
      }),
      CompanySignupVerificationSent: strictObject(["status", "retryAfterSeconds"], {
        status: { type: "string", enum: ["PENDING"] },
        retryAfterSeconds: { type: "integer", minimum: 1 },
        verificationCode: {
          type: "string",
          pattern: "^[0-9]{6}$",
          description: "Development and test environments only; never returned in production.",
        },
      }),
      CompanyAccountSetupRequest: strictObject(["tenantId", "setupToken", "password"], {
        tenantId: overviewIdentifier,
        setupToken: { type: "string", minLength: 32, maxLength: 1024 },
        password: { type: "string", minLength: 12, maxLength: 200 },
      }),
      CompanyAccountSetupResult: strictObject(["tenantSlug", "email"], {
        tenantSlug: { type: "string", minLength: 2, maxLength: 100 },
        email: { type: "string", format: "email", maxLength: 320 },
      }),
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          tenantSlug: {
            type: "string",
            description:
              "Optional. Sign-in resolves the organization from the email; supply this only to force one.",
          },
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 12 },
          deviceName: { type: "string" },
        },
      },
      TenantChoice: {
        type: "object",
        required: ["tenantSlug", "tenantName"],
        additionalProperties: false,
        properties: {
          tenantSlug: { type: "string" },
          tenantName: { type: "string" },
        },
      },
      TenantSelectionResult: {
        type: "object",
        required: ["status", "selectionToken", "expiresAt", "tenants"],
        additionalProperties: false,
        description:
          "The password matched accounts in more than one organization. Only organizations the password actually unlocked are listed, so this leaks nothing to someone who does not know it.",
        properties: {
          status: { type: "string", enum: ["TENANT_SELECTION_REQUIRED"] },
          selectionToken: { type: "string" },
          expiresAt: { type: "string", format: "date-time" },
          tenants: {
            type: "array",
            minItems: 2,
            items: { $ref: "#/components/schemas/TenantChoice" },
          },
        },
      },
      TenantSelectionRequest: {
        type: "object",
        required: ["selectionToken", "tenantSlug"],
        additionalProperties: false,
        properties: {
          selectionToken: { type: "string" },
          tenantSlug: { type: "string" },
          deviceName: { type: "string" },
        },
      },
      RefreshRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: { refreshToken: { type: "string" } },
      },
      InvitationRequest: {
        type: "object",
        additionalProperties: false,
        required: ["email", "role"],
        properties: {
          email: { type: "string", format: "email", maxLength: 320 },
          role: {
            type: "string",
            enum: [
              "COMPANY_ADMIN",
              "PROJECT_MANAGER",
              "ENGINEER",
              "SITE_SUPERVISOR",
              "STOREKEEPER",
              "OBSERVER",
            ],
          },
          projectIds: { type: "array", maxItems: 100, items: { type: "string" }, default: [] },
          expiresInHours: { type: "integer", minimum: 1, maximum: 168, default: 48 },
        },
      },
      InvitationResult: {
        type: "object",
        additionalProperties: false,
        required: ["invitationId", "invitationToken", "expiresAt"],
        properties: {
          invitationId: { type: "string" },
          invitationToken: { type: "string" },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
      AcceptInvitationRequest: {
        type: "object",
        additionalProperties: false,
        required: ["invitationToken", "displayName", "password"],
        properties: {
          invitationToken: { type: "string", minLength: 32, maxLength: 1024 },
          displayName: { type: "string", minLength: 2, maxLength: 200 },
          password: { type: "string", minLength: 12, maxLength: 200 },
        },
      },
      AcceptInvitationResult: {
        type: "object",
        additionalProperties: false,
        required: ["userId", "email", "tenantSlug"],
        properties: {
          userId: { type: "string" },
          email: { type: "string", format: "email" },
          tenantSlug: {
            type: ["string", "null"],
            description:
              "Slug the new user must sign in with. The login form is keyed by slug and the invitation token does not reveal it.",
          },
        },
      },
      TokenPair: {
        type: "object",
        required: [
          "tokenType",
          "accessToken",
          "accessExpiresAt",
          "refreshToken",
          "refreshExpiresAt",
        ],
        properties: {
          tokenType: { type: "string", enum: ["Bearer"] },
          accessToken: { type: "string" },
          accessExpiresAt: { type: "string", format: "date-time" },
          refreshToken: { type: "string" },
          refreshExpiresAt: { type: "string", format: "date-time" },
        },
      },
      AuthenticatedResult: {
        type: "object",
        required: [
          "status",
          "tokenType",
          "accessToken",
          "accessExpiresAt",
          "refreshToken",
          "refreshExpiresAt",
        ],
        additionalProperties: false,
        description: "A TokenPair plus a status discriminator.",
        properties: {
          status: { type: "string", enum: ["AUTHENTICATED"] },
          tokenType: { type: "string", enum: ["Bearer"] },
          accessToken: { type: "string" },
          accessExpiresAt: { type: "string", format: "date-time" },
          refreshToken: { type: "string" },
          refreshExpiresAt: { type: "string", format: "date-time" },
        },
      },
      LoginResult: {
        oneOf: [
          { $ref: "#/components/schemas/AuthenticatedResult" },
          { $ref: "#/components/schemas/TenantSelectionResult" },
        ],
        discriminator: {
          propertyName: "status",
          mapping: {
            AUTHENTICATED: "#/components/schemas/AuthenticatedResult",
            TENANT_SELECTION_REQUIRED: "#/components/schemas/TenantSelectionResult",
          },
        },
      },
      Session: {
        type: "object",
        required: ["schemaVersion", "user", "tenantPermissions", "projectMemberships"],
        properties: {
          schemaVersion: { type: "integer", enum: [1] },
          user: {
            type: "object",
            required: ["id", "tenantId", "email", "displayName", "tenantRole"],
            properties: {
              id: { type: "string" },
              tenantId: { type: "string" },
              email: { type: "string", format: "email" },
              displayName: { type: "string" },
              tenantRole: { type: "string" },
            },
          },
          tenantPermissions: { type: "array", items: { type: "string" } },
          projectMemberships: {
            type: "array",
            items: {
              type: "object",
              required: ["projectId", "role", "permissions"],
              properties: {
                projectId: { type: "string" },
                role: { type: "string" },
                permissions: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
      ProjectPage: {
        type: "object",
        required: ["data", "page"],
        properties: {
          data: {
            type: "array",
            items: {
              type: "object",
              required: [
                "id",
                "code",
                "name",
                "status",
                "role",
                "plannedStart",
                "plannedEnd",
                "rowVersion",
              ],
              properties: {
                id: { type: "string" },
                code: { type: "string" },
                name: { type: "string" },
                status: { type: "string" },
                role: { type: "string" },
                plannedStart: { type: "string", format: "date-time" },
                plannedEnd: { type: "string", format: "date-time" },
                rowVersion: { type: "integer" },
              },
            },
          },
          page: {
            type: "object",
            required: ["nextCursor", "hasMore"],
            properties: {
              nextCursor: { type: ["string", "null"] },
              hasMore: { type: "boolean" },
            },
          },
        },
      },
      ProjectSummary: {
        type: "object",
        additionalProperties: true,
        required: [
          "id",
          "code",
          "name",
          "status",
          "role",
          "plannedStart",
          "plannedEnd",
          "rowVersion",
        ],
        properties: {
          id: { type: "string" },
          code: {
            type: "string",
            minLength: 2,
            maxLength: 100,
            description:
              "Project code beginning with a Unicode letter or ASCII digit; supports Mongolian, English, digits, dot, underscore, and hyphen.",
          },
          name: { type: "string" },
          status: { type: "string", enum: ["PLANNED", "ACTIVE", "PAUSED", "COMPLETED"] },
          role: { type: "string" },
          plannedStart: { type: "string", format: "date-time" },
          plannedEnd: { type: "string", format: "date-time" },
          rowVersion: { type: "integer", minimum: 1 },
        },
      },
      ProjectCreateRequest: {
        type: "object",
        required: ["code", "name", "plannedStart", "plannedEnd", "budgetMnt"],
        properties: {
          code: {
            type: "string",
            minLength: 2,
            maxLength: 100,
            description:
              "Project code beginning with a Unicode letter or ASCII digit; supports Mongolian, English, digits, dot, underscore, and hyphen.",
          },
          name: { type: "string" },
          description: { type: ["string", "null"] },
          location: { type: ["string", "null"] },
          plannedStart: { type: "string", format: "date" },
          plannedEnd: { type: "string", format: "date" },
          budgetMnt: { type: ["string", "number"] },
          timezone: { type: "string" },
        },
      },
      ProjectCreateResult: {
        type: "object",
        required: ["projectId", "code", "status", "eventId", "auditId", "createdAt", "replayed"],
        properties: {
          projectId: { type: "string" },
          code: { type: "string" },
          status: { type: "string", enum: ["PLANNED"] },
          eventId: { type: "string" },
          auditId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          replayed: { type: "boolean" },
        },
      },
      A0IntakeRequest: {
        type: "object",
        additionalProperties: false,
        required: ["schemaVersion", "requestId", "revisionCode", "effectiveDate", "artifacts"],
        properties: {
          schemaVersion: { type: "integer", enum: [1] },
          requestId: { type: "string" },
          revisionCode: { type: "string" },
          effectiveDate: { type: "string", format: "date" },
          artifacts: {
            type: "array",
            minItems: 4,
            maxItems: 14,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["artifactId", "role"],
              properties: {
                artifactId: { type: "string" },
                role: {
                  type: "string",
                  enum: [
                    "MATERIAL_PRICE_CATALOG",
                    "MATERIAL_NORMS",
                    "BOQ_WORK_ITEMS",
                    "WBS_DEPENDENCIES",
                    "DRAWING_REFERENCE",
                  ],
                },
              },
            },
          },
        },
      },
      A0IntakeResult: {
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "runId",
          "requestId",
          "status",
          "quantityVersionId",
          "estimateVersionId",
          "scheduleVersionId",
          "baselineVersionId",
          "reviewTaskIds",
          "counts",
          "estimateTotalMnt",
          "plannedStart",
          "plannedFinish",
          "criticalActivityCodes",
          "warnings",
          "eventId",
          "auditId",
          "createdAt",
          "replayed",
        ],
        properties: {
          schemaVersion: { type: "integer", enum: [1] },
          runId: { type: "string" },
          requestId: { type: "string" },
          status: { type: "string", enum: ["REVIEW_REQUIRED"] },
          quantityVersionId: { type: "string" },
          estimateVersionId: { type: "string" },
          scheduleVersionId: { type: "string" },
          baselineVersionId: { type: "string" },
          reviewTaskIds: {
            type: "object",
            additionalProperties: false,
            required: ["quantity", "estimate", "schedule", "baseline"],
            properties: {
              quantity: { type: "string" },
              estimate: { type: "string" },
              schedule: { type: "string" },
              baseline: { type: "string" },
            },
          },
          counts: {
            type: "object",
            additionalProperties: false,
            required: [
              "documents",
              "quantityItems",
              "materialRequirements",
              "estimateLines",
              "scheduleActivities",
              "scheduleDependencies",
            ],
            properties: {
              documents: { type: "integer" },
              quantityItems: { type: "integer" },
              materialRequirements: { type: "integer" },
              estimateLines: { type: "integer" },
              scheduleActivities: { type: "integer" },
              scheduleDependencies: { type: "integer" },
            },
          },
          estimateTotalMnt: { type: "string" },
          plannedStart: { type: "string", format: "date" },
          plannedFinish: { type: "string", format: "date" },
          criticalActivityCodes: { type: "array", items: { type: "string" } },
          warnings: { type: "array", items: { type: "string" } },
          eventId: { type: "string" },
          auditId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          replayed: { type: "boolean" },
        },
      },
      A1IntakeRequest: {
        type: "object",
        additionalProperties: false,
        required: ["requestId", "referenceDate"],
        properties: {
          requestId: { type: "string", minLength: 1, maxLength: 200 },
          referenceDate: { type: "string", format: "date" },
          sourceText: { type: ["string", "null"], maxLength: 20_000 },
          imageArtifactId: { type: ["string", "null"] },
        },
        anyOf: [
          {
            required: ["sourceText"],
            properties: { sourceText: { type: "string", minLength: 1 } },
          },
          {
            required: ["imageArtifactId"],
            properties: { imageArtifactId: { type: "string", minLength: 1 } },
          },
        ],
      },
      A1IntakeResult: {
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "draftId",
          "requestId",
          "status",
          "rowVersion",
          "reviewTaskId",
          "reviewStatus",
          "sourceHash",
          "reused",
          "draft",
        ],
        properties: {
          schemaVersion: { type: "integer", enum: [1] },
          draftId: { type: "string" },
          requestId: { type: "string" },
          status: { type: "string" },
          rowVersion: { type: "integer", minimum: 1 },
          reviewTaskId: { type: ["string", "null"] },
          reviewStatus: { type: ["string", "null"] },
          sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
          reused: { type: "boolean" },
          draft: { type: "object", additionalProperties: true },
        },
      },
      A1DraftCorrectionRequest: {
        type: "object",
        additionalProperties: false,
        required: ["expectedRowVersion", "structuredData", "reason"],
        properties: {
          expectedRowVersion: { type: "integer", minimum: 1 },
          structuredData: { type: "object", additionalProperties: true },
          reason: { type: "string", minLength: 3, maxLength: 2_000 },
        },
      },
      A3DocumentRequest: {
        type: "object",
        additionalProperties: false,
        required: ["requestId", "asOf"],
        properties: {
          requestId: { type: "string", minLength: 1, maxLength: 200 },
          asOf: { type: "string", format: "date-time" },
          includePdf: { type: "boolean", default: true },
        },
      },
      A3DocumentResult: {
        type: "object",
        additionalProperties: false,
        required: ["schemaVersion", "runId", "draftIds", "reused", "pdfPath"],
        properties: {
          schemaVersion: { type: "integer", enum: [1] },
          runId: { type: "string" },
          draftIds: { type: "array", items: { type: "string" } },
          reused: { type: "boolean" },
          pdfPath: { type: ["string", "null"] },
        },
      },
      StockMovementRequest: {
        type: "object",
        additionalProperties: false,
        required: ["movementType", "occurredAt", "referenceId", "reason"],
        properties: {
          movementType: { type: "string", enum: ["RECEIPT", "ISSUE", "REVERSAL"] },
          materialItemId: { type: ["string", "null"] },
          quantity: { type: ["string", "number", "null"] },
          unit: { type: ["string", "null"] },
          occurredAt: { type: "string", format: "date-time" },
          warehouseCode: { type: "string", default: "MAIN" },
          referenceType: { type: "string", default: "MANUAL" },
          referenceId: { type: "string" },
          reversalOfId: { type: ["string", "null"] },
          reason: { type: "string", minLength: 3, maxLength: 2_000 },
        },
      },
      StockMovement: {
        type: "object",
        additionalProperties: true,
        required: [
          "id",
          "projectId",
          "materialItemId",
          "movementType",
          "quantity",
          "unit",
          "occurredAt",
        ],
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          materialItemId: { type: "string" },
          movementType: { type: "string" },
          quantity: { type: "string" },
          unit: { type: "string" },
          occurredAt: { type: "string", format: "date-time" },
          reversalOfId: { type: ["string", "null"] },
        },
      },
      InventoryResult: {
        type: "object",
        additionalProperties: false,
        required: ["schemaVersion", "materials", "movements", "balances"],
        properties: {
          schemaVersion: { type: "integer", enum: [1] },
          materials: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          movements: {
            type: "array",
            items: reference("StockMovement"),
          },
          balances: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["materialItemId", "code", "name", "unit", "quantity"],
              properties: {
                materialItemId: { type: "string" },
                code: { type: "string" },
                name: { type: "string" },
                unit: { type: "string" },
                quantity: { type: "string" },
              },
            },
          },
        },
      },
      Workspace: {
        type: "object",
        required: [
          "schemaVersion",
          "generatedAt",
          "role",
          "permissions",
          "project",
          "dashboard",
          "workItems",
          "dependencies",
          "design",
          "commercial",
          "schedule",
          "resources",
          "operations",
          "forecast",
          "reviews",
          "artifacts",
          "assistants",
          "alerts",
        ],
        additionalProperties: false,
        properties: {
          schemaVersion: { type: "integer", enum: [1] },
          generatedAt: { type: "string", format: "date-time" },
          role: { type: "string" },
          permissions: { type: "array", items: { type: "string" } },
          project: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "code",
              "name",
              "description",
              "location",
              "status",
              "plannedStart",
              "plannedEnd",
              "budgetMnt",
              "actualCostMnt",
              "rowVersion",
            ],
            properties: {
              id: { type: "string" },
              code: { type: "string" },
              name: { type: "string" },
              description: { type: ["string", "null"] },
              location: { type: ["string", "null"] },
              status: { type: "string", enum: ["PLANNED", "ACTIVE", "PAUSED", "COMPLETED"] },
              plannedStart: { type: "string", format: "date-time" },
              plannedEnd: { type: "string", format: "date-time" },
              budgetMnt: { type: ["string", "null"] },
              actualCostMnt: { type: ["string", "null"] },
              rowVersion: { type: "integer", minimum: 1 },
            },
          },
          dashboard: {
            type: "object",
            additionalProperties: false,
            required: [
              "plannedProgressPercent",
              "actualProgressPercent",
              "projectedFinish",
              "projectedDelayDays",
              "costVarianceMnt",
              "criticalActivityCount",
              "openAlertCount",
            ],
            properties: {
              plannedProgressPercent: { type: "number", minimum: 0, maximum: 100 },
              actualProgressPercent: { type: "number", minimum: 0, maximum: 100 },
              projectedFinish: { type: ["string", "null"], format: "date-time" },
              projectedDelayDays: { type: ["string", "null"] },
              costVarianceMnt: { type: ["string", "null"] },
              criticalActivityCount: { type: "integer", minimum: 0 },
              openAlertCount: { type: "integer", minimum: 0 },
            },
          },
          workItems: { type: "array", items: { type: "object", additionalProperties: true } },
          dependencies: { type: "array", items: { type: "object", additionalProperties: true } },
          design: { $ref: "#/components/schemas/DesignWorkspace" },
          commercial: { $ref: "#/components/schemas/CommercialWorkspace" },
          schedule: { $ref: "#/components/schemas/ScheduleWorkspace" },
          resources: { $ref: "#/components/schemas/ResourceWorkspace" },
          operations: { $ref: "#/components/schemas/OperationsWorkspace" },
          forecast: { $ref: "#/components/schemas/ForecastWorkspace" },
          reviews: { type: "array", items: { type: "object", additionalProperties: true } },
          artifacts: { type: "array", items: { type: "object", additionalProperties: true } },
          assistants: {
            type: "object",
            additionalProperties: false,
            required: ["a1Drafts", "a3Drafts"],
            properties: {
              a1Drafts: { type: "array", items: { type: "object", additionalProperties: true } },
              a3Drafts: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
          alerts: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
      DesignWorkspace: {
        type: "object",
        additionalProperties: false,
        required: ["documents", "revisions", "pages", "scales", "elements"],
        properties: {
          documents: { type: "array", items: { type: "object", additionalProperties: true } },
          revisions: { type: "array", items: { type: "object", additionalProperties: true } },
          pages: { type: "array", items: { type: "object", additionalProperties: true } },
          scales: { type: "array", items: { type: "object", additionalProperties: true } },
          elements: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
      CommercialWorkspace: {
        type: "object",
        additionalProperties: false,
        required: [
          "quantityVersions",
          "quantityItems",
          "estimateVersions",
          "estimateLines",
          "estimateAssumptions",
          "baselines",
        ],
        properties: {
          quantityVersions: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          quantityItems: { type: "array", items: { type: "object", additionalProperties: true } },
          estimateVersions: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          estimateLines: { type: "array", items: { type: "object", additionalProperties: true } },
          estimateAssumptions: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          baselines: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
      ScheduleWorkspace: {
        type: "object",
        additionalProperties: false,
        required: ["versions", "activities", "dependencies"],
        properties: {
          versions: { type: "array", items: { type: "object", additionalProperties: true } },
          activities: { type: "array", items: { type: "object", additionalProperties: true } },
          dependencies: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
      ResourceWorkspace: {
        type: "object",
        additionalProperties: false,
        required: ["crews", "equipment"],
        properties: {
          crews: { type: "array", items: { type: "object", additionalProperties: true } },
          equipment: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
      OperationsWorkspace: {
        type: "object",
        additionalProperties: false,
        required: [
          "plans",
          "planItems",
          "reports",
          "progress",
          "attendance",
          "photos",
          "verifications",
          "variances",
        ],
        properties: {
          plans: { type: "array", items: { type: "object", additionalProperties: true } },
          planItems: { type: "array", items: { type: "object", additionalProperties: true } },
          reports: { type: "array", items: { type: "object", additionalProperties: true } },
          progress: { type: "array", items: { type: "object", additionalProperties: true } },
          attendance: { type: "array", items: { type: "object", additionalProperties: true } },
          photos: { type: "array", items: { type: "object", additionalProperties: true } },
          verifications: { type: "array", items: { type: "object", additionalProperties: true } },
          variances: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
      ForecastWorkspace: {
        type: "object",
        additionalProperties: false,
        required: ["snapshots", "workItems", "drivers", "recoveryScenarios"],
        properties: {
          snapshots: { type: "array", items: { type: "object", additionalProperties: true } },
          workItems: { type: "array", items: { type: "object", additionalProperties: true } },
          drivers: { type: "array", items: { type: "object", additionalProperties: true } },
          recoveryScenarios: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
        },
      },
      DailyReportDraftRequest: {
        type: "object",
        required: ["reportDate", "progress"],
        additionalProperties: false,
        properties: {
          reportDate: { type: "string", format: "date" },
          timezone: { type: "string" },
          narrative: { type: ["string", "null"] },
          weather: { type: ["object", "null"], additionalProperties: true },
          sourceDraftId: { type: ["string", "null"] },
          progress: {
            type: "array",
            minItems: 1,
            maxItems: 200,
            items: { $ref: "#/components/schemas/DailyProgressInput" },
          },
          attendance: {
            type: "array",
            maxItems: 100,
            items: { $ref: "#/components/schemas/AttendanceInput" },
          },
          photos: {
            type: "array",
            maxItems: 20,
            items: { $ref: "#/components/schemas/PhotoInput" },
          },
        },
      },
      DailyProgressInput: {
        type: "object",
        additionalProperties: false,
        required: ["workItemId", "quantity", "unit"],
        properties: {
          workItemId: { type: "string" },
          planItemId: { type: ["string", "null"] },
          quantity: { type: ["string", "number"], minimum: 0 },
          unit: { type: "string", minLength: 1, maxLength: 50 },
          progressPercent: { type: ["number", "null"], minimum: 0, maximum: 100 },
          sourceRefs: {
            type: "array",
            maxItems: 100,
            items: { type: "object", additionalProperties: true },
          },
        },
      },
      AttendanceInput: {
        type: "object",
        additionalProperties: false,
        required: ["trade", "workerCount", "hoursPerWorker"],
        properties: {
          crewId: { type: ["string", "null"] },
          trade: { type: "string", minLength: 1, maxLength: 200 },
          workerCount: { type: "integer", minimum: 1, maximum: 10000 },
          hoursPerWorker: { type: "number", minimum: 0, maximum: 24 },
          laborRateMnt: { type: ["string", "number", "null"] },
          sourceRefs: {
            type: "array",
            maxItems: 100,
            items: { type: "object", additionalProperties: true },
          },
        },
      },
      PhotoInput: {
        type: "object",
        additionalProperties: false,
        required: ["fileAssetId", "capturedAt"],
        properties: {
          fileAssetId: { type: "string" },
          capturedAt: { type: "string", format: "date-time" },
          planItemId: { type: ["string", "null"] },
          latitude: { type: ["number", "null"], minimum: -90, maximum: 90 },
          longitude: { type: ["number", "null"], minimum: -180, maximum: 180 },
          orientation: { type: ["integer", "null"], minimum: 0, maximum: 359 },
        },
      },
      DailyReportDraftResult: {
        type: "object",
        required: [
          "reportId",
          "reviewTaskId",
          "status",
          "sourceHash",
          "rowVersion",
          "eventId",
          "auditId",
          "createdAt",
          "replayed",
        ],
        properties: {
          reportId: { type: "string" },
          reviewTaskId: { type: "string" },
          status: { type: "string", enum: ["REVIEW_REQUIRED"] },
          sourceHash: { type: "string" },
          rowVersion: { type: "integer" },
          eventId: { type: "string" },
          auditId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          replayed: { type: "boolean" },
        },
      },
      ArtifactUploadResult: {
        type: "object",
        required: [
          "artifactId",
          "originalFileName",
          "mediaType",
          "sizeBytes",
          "sha256",
          "status",
          "eventId",
          "createdAt",
          "replayed",
        ],
        properties: {
          artifactId: { type: "string" },
          originalFileName: { type: "string" },
          mediaType: { type: "string" },
          sizeBytes: { type: "integer" },
          sha256: { type: "string" },
          status: { type: "string", enum: ["AVAILABLE"] },
          eventId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          replayed: { type: "boolean" },
        },
      },
      A4Question: {
        type: "object",
        required: ["question"],
        properties: { question: { type: "string", minLength: 2, maxLength: 2000 } },
      },
      A4Answer: {
        type: "object",
        required: ["schemaVersion", "status", "answer", "claims", "sources", "toolNames"],
        properties: {
          schemaVersion: { type: "integer", enum: [1] },
          status: { type: "string", enum: ["ANSWERED", "INSUFFICIENT_EVIDENCE"] },
          answer: { type: "string" },
          claims: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "sourceIds"],
              properties: {
                text: { type: "string" },
                sourceIds: { type: "array", minItems: 1, items: { type: "string" } },
              },
            },
          },
          sources: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sourceId", "entityType", "entityId", "field", "value"],
              properties: {
                sourceId: { type: "string" },
                entityType: { type: "string" },
                entityId: { type: "string" },
                field: { type: "string" },
                value: {},
              },
            },
          },
          toolNames: { type: "array", items: { type: "string" } },
        },
      },
      ReviewDecisionRequest: {
        type: "object",
        additionalProperties: false,
        required: ["decision", "expectedRowVersion", "reason"],
        properties: {
          decision: { type: "string", enum: ["APPROVE", "REJECT"] },
          expectedRowVersion: { type: "integer", minimum: 1 },
          reason: { type: "string", minLength: 3, maxLength: 2000 },
          emergencyOverride: { type: "boolean", default: false },
        },
      },
      ReviewDecisionResult: {
        type: "object",
        additionalProperties: false,
        required: ["decisionId", "reviewTaskId", "status", "rowVersion", "eventId", "decidedAt"],
        properties: {
          decisionId: { type: "string" },
          reviewTaskId: { type: "string" },
          status: { type: "string", enum: ["APPROVED", "REJECTED", "REPLAYED"] },
          rowVersion: { type: "integer", minimum: 1 },
          eventId: { type: "string" },
          decidedAt: { type: "string", format: "date-time" },
        },
      },
      ApprovedCommandRequest: {
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "commandType",
          "reviewTaskId",
          "targetType",
          "targetId",
          "targetVersion",
          "expectedRowVersion",
          "sourceHash",
          "reason",
          "payload",
        ],
        properties: {
          schemaVersion: { type: "integer", enum: [1] },
          commandType: { type: "string", enum: ["APPLY_APPROVED_ARTIFACT"] },
          reviewTaskId: { type: "string" },
          targetType: {
            type: "string",
            enum: [
              "REGISTRATION_DRAFT",
              "QUANTITY_TAKEOFF",
              "ESTIMATE",
              "SCHEDULE",
              "BASELINE",
              "DAILY_WORK_PLAN",
              "DAILY_REPORT",
              "PROGRESS_VERIFICATION",
              "RECOVERY_SCENARIO",
            ],
          },
          targetId: { type: "string" },
          targetVersion: { type: "integer", minimum: 1 },
          expectedRowVersion: { type: "integer", minimum: 1 },
          sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
          reason: { type: "string", minLength: 3, maxLength: 2000 },
          payload: { type: "object", additionalProperties: true },
        },
      },
      AppliedCommandResult: {
        type: "object",
        additionalProperties: false,
        required: [
          "commandId",
          "idempotencyKey",
          "status",
          "targetType",
          "targetId",
          "targetVersion",
          "eventId",
          "auditId",
          "appliedAt",
        ],
        properties: {
          commandId: { type: "string" },
          idempotencyKey: { type: "string" },
          status: { type: "string", enum: ["APPLIED", "REPLAYED"] },
          targetType: { type: "string" },
          targetId: { type: "string" },
          targetVersion: { type: "integer" },
          eventId: { type: "string" },
          auditId: { type: "string" },
          appliedAt: { type: "string", format: "date-time" },
        },
      },
      SignedArtifactRequest: {
        type: "object",
        additionalProperties: false,
        properties: {
          expiresInSeconds: { type: "integer", minimum: 30, maximum: 900, default: 300 },
        },
      },
      SignedArtifactResult: {
        type: "object",
        additionalProperties: false,
        required: ["artifactId", "url", "expiresAt"],
        properties: {
          artifactId: { type: "string" },
          url: { type: "string", format: "uri" },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
      AuditPage: {
        type: "object",
        additionalProperties: false,
        required: ["data"],
        properties: {
          data: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
      RuleId: {
        type: "string",
        enum: [
          "OVERDUE_WORK_ITEM",
          "MATERIAL_OVERUSE",
          "STOCK_SHORTAGE",
          "PRODUCTIVITY_DECLINE",
          "COST_AHEAD_OF_PROGRESS",
          "SUBCONTRACTOR_DEVIATION",
          "MISSING_DAILY_REPORT",
        ],
      },
      JdmRuleGraph: {
        type: "object",
        description:
          "GoRules JSON Decision Model graph (see production-analysis/rule-graphs.ts): a single inputNode -> decisionTableNode -> outputNode chain, editable via the @gorules/jdm-editor UI.",
        required: ["nodes", "edges"],
        properties: {
          nodes: {
            type: "array",
            minItems: 3,
            items: { type: "object", additionalProperties: true },
          },
          edges: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
      RuleCatalogVersion: {
        type: "object",
        required: ["id", "versionNumber", "status", "jdmGraph"],
        properties: {
          id: { type: "string" },
          versionNumber: { type: "integer" },
          status: {
            type: "string",
            enum: [
              "DRAFT",
              "REVIEW_REQUIRED",
              "APPROVED",
              "APPLIED",
              "SUPERSEDED",
              "REJECTED",
              "CANCELLED",
            ],
          },
          jdmGraph: reference("JdmRuleGraph"),
          createdByUserId: { type: "string" },
          approvedByUserId: { type: "string", nullable: true },
          approvedAt: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      RuleListResult: {
        type: "array",
        items: {
          type: "object",
          required: ["ruleId", "source", "latestVersion"],
          properties: {
            ruleId: reference("RuleId"),
            source: { type: "string", enum: ["DEFAULT", "TENANT"] },
            latestVersion: {
              type: "object",
              nullable: true,
              properties: {
                id: { type: "string" },
                versionNumber: { type: "integer" },
                status: { type: "string" },
              },
            },
          },
        },
      },
      RuleVersionsResult: {
        type: "object",
        required: ["ruleId", "defaultGraph", "versions"],
        properties: {
          ruleId: reference("RuleId"),
          defaultGraph: reference("JdmRuleGraph"),
          versions: { type: "array", items: reference("RuleCatalogVersion") },
        },
      },
      RulePublishRequest: {
        type: "object",
        additionalProperties: false,
        required: ["versionId"],
        properties: { versionId: { type: "string" } },
      },
    },
  },
});
