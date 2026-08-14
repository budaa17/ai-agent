import type {
  PlatformFreshness,
  PlatformMetricContext,
  PlatformMetricWindow,
  PlatformOverview,
  PlatformSectionContext,
} from "../api/platform-schemas";

const selectedWindow: PlatformMetricWindow = {
  kind: "SELECTED_RANGE",
  from: "2026-08-10T00:00:00.000Z",
  to: "2026-08-11T00:00:00.000Z",
  timeZone: "UTC",
};

const snapshotWindow: PlatformMetricWindow = {
  kind: "SNAPSHOT",
  from: null,
  to: "2026-08-11T00:00:00.000Z",
  timeZone: "UTC",
};

const monthToDateWindow: PlatformMetricWindow = {
  kind: "MONTH_TO_DATE",
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-11T00:00:00.000Z",
  timeZone: "UTC",
};

export const freshLiveQuery: PlatformFreshness = {
  state: "FRESH",
  source: "LIVE_QUERY",
  checkedAt: "2026-08-11T00:00:00.000Z",
  freshAt: "2026-08-11T00:00:00.000Z",
  ageSeconds: 0,
  staleAfterSeconds: 300,
  reason: null,
};

const noComparison = {
  state: "UNAVAILABLE" as const,
  reason: "NOT_APPLICABLE" as const,
};

function metricContext(
  window: PlatformMetricWindow,
  sampleSize: number,
  minimumSample = 0,
): PlatformMetricContext {
  return {
    state: "AVAILABLE",
    window,
    sampleSize,
    minimumSample,
    freshness: freshLiveQuery,
    comparison: noComparison,
    appliedFilters: [],
  };
}

export const availableSectionContext: PlatformSectionContext = {
  state: "AVAILABLE",
  freshness: freshLiveQuery,
  appliedFilters: [],
};

export const platformOverviewFixture: PlatformOverview = {
  schemaVersion: "platform-overview.v1",
  generatedAt: "2026-08-11T00:00:01.000Z",
  asOf: "2026-08-11T00:00:00.000Z",
  window: selectedWindow,
  filters: { tenantId: null, agentType: null },
  freshness: freshLiveQuery,
  partial: false,
  problems: [],
  platformStatus: {
    state: "DEGRADED",
    evaluatedAt: "2026-08-11T00:00:00.000Z",
    ruleSetVersion: "platform-overview-rules.v1",
  },
  topCauses: [
    {
      causeId: "cause-ai-provider",
      severity: "HIGH",
      title: "AI provider latency high",
      scope: { tenantId: null, tenantName: null, agentType: null, component: "AI_PROVIDER" },
      diagnosticsHref: "/platform/system-health/AI_PROVIDER",
      evidenceAt: "2026-08-10T23:59:00.000Z",
    },
  ],
  kpis: {
    criticalIssues: {
      value: 2,
      critical: 1,
      high: 1,
      oldestEvidenceAt: "2026-08-10T21:00:00.000Z",
      context: metricContext(snapshotWindow, 2),
    },
    tenantHealth: {
      healthy: 16,
      total: 18,
      warning: 1,
      critical: 1,
      unknown: 0,
      inactive: 0,
      context: metricContext(snapshotWindow, 18),
    },
    agentCompletion: {
      valuePercent: 95.8,
      completed: 184,
      terminal: 192,
      failed: 4,
      degraded: 3,
      rejected: 1,
      context: {
        ...metricContext(selectedWindow, 192, 20),
        comparison: {
          state: "AVAILABLE",
          kind: "PREVIOUS_PERIOD",
          window: {
            kind: "PREVIOUS_RANGE",
            from: "2026-08-09T00:00:00.000Z",
            to: "2026-08-10T00:00:00.000Z",
            timeZone: "UTC",
          },
          previousValue: 93.2,
          delta: 2.6,
          deltaUnit: "PERCENTAGE_POINTS",
        },
      },
    },
    reviewSla: {
      breached: 3,
      waiting: 14,
      withoutDueAt: 2,
      oldestWaitingAt: "2026-08-10T20:00:00.000Z",
      oldestBreachedDueAt: "2026-08-10T22:00:00.000Z",
      context: metricContext(snapshotWindow, 14),
    },
    aiSpend: {
      microUsd: 184_000_000,
      actualMicroUsd: 132_000_000,
      estimatedMicroUsd: 52_000_000,
      actualRunCount: 140,
      estimatedRunCount: 52,
      actualCoveragePercent: 72,
      context: metricContext(monthToDateWindow, 192),
    },
  },
  attention: {
    context: { ...availableSectionContext },
    total: 1,
    truncated: false,
    items: [
      {
        signalId: "signal-provider-latency",
        incidentId: null,
        ruleKey: "ai-provider-latency",
        ruleVersion: "v1",
        severity: "HIGH",
        state: "OPEN",
        title: "AI provider latency high",
        impact: "A1 болон A4 agent хариу удааширсан.",
        scope: { tenantId: null, tenantName: null, agentType: "A1", component: "AI_PROVIDER" },
        firstEvidenceAt: "2026-08-10T23:30:00.000Z",
        lastEvidenceAt: "2026-08-10T23:59:00.000Z",
        evidence: [
          {
            metricKey: "p95-latency-ms",
            value: 8_200,
            unit: "ms",
            observedAt: "2026-08-10T23:59:00.000Z",
          },
        ],
        recommendedAction: "Provider diagnostics болон retry rate-ийг шалгана уу.",
        diagnosticsHref: "/platform/system-health/AI_PROVIDER",
        freshness: freshLiveQuery,
      },
    ],
  },
  tenantHealthPreview: {
    context: { ...availableSectionContext },
    total: 18,
    truncated: true,
    items: [
      {
        tenantId: "tenant-atlas",
        name: "Atlas Construction",
        health: "WARNING",
        reasons: [],
        users: { loggedIn24h: 12, activeAccounts: 42 },
        runs: { total: 44, completed: 40, failed: 2, degraded: 1, rejected: 1, stuck: 0 },
        review: { waiting: 5, breached: 1 },
        issues: { critical: 0, high: 1, medium: 2, low: 0 },
        aiSpendMicroUsd: 42_000_000,
        storageBytes: 8_589_934_592,
        lastActivityAt: "2026-08-10T23:58:00.000Z",
        unknownFields: [],
      },
    ],
  },
  agentHealthPreview: {
    context: { ...availableSectionContext },
    total: 1,
    truncated: false,
    items: [
      {
        agentType: "A1",
        state: "DEGRADED",
        runs: 44,
        terminal: 43,
        completed: 40,
        failed: 2,
        degraded: 1,
        rejected: 0,
        completionPercent: 93,
        p50LatencyMs: 2_100,
        p95LatencyMs: 8_200,
        retriedRuns: 4,
        retryRatePercent: 9.1,
        stuck: 1,
        lastSuccessAt: "2026-08-10T23:58:00.000Z",
        costMicroUsd: 42_000_000,
        reasons: [],
      },
    ],
  },
  systemHealth: {
    context: { ...availableSectionContext },
    components: [
      {
        component: "API",
        state: "HEALTHY",
        required: true,
        summary: "API ready probe хэвийн.",
        metrics: [{ key: "latency-ms", value: 32, unit: "ms" }],
        freshness: { ...freshLiveQuery, source: "LIVE_PROBE" },
        diagnosticsHref: "/platform/system-health/API",
      },
      {
        component: "AI_PROVIDER",
        state: "DEGRADED",
        required: true,
        summary: "p95 latency threshold давсан.",
        metrics: [{ key: "p95-latency-ms", value: 8_200, unit: "ms" }],
        freshness: { ...freshLiveQuery, source: "LIVE_PROBE" },
        diagnosticsHref: "/platform/system-health/AI_PROVIDER",
      },
    ],
  },
  recentAudit: {
    context: { ...availableSectionContext },
    items: [
      {
        id: "audit-1",
        actorId: "principal-1",
        actorDisplayName: "Platform Admin",
        actorRole: "PLATFORM_SUPER_ADMIN",
        action: "PLATFORM_LOGIN_SUCCEEDED",
        tenantId: null,
        resourceType: "PlatformSession",
        resourceId: "session-1",
        occurredAt: "2026-08-10T23:50:00.000Z",
        result: "SUCCESS",
        correlationId: "correlation-1",
        detailHref: "/platform/audit/audit-1",
      },
    ],
  },
};
