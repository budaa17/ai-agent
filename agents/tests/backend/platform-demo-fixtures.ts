import type {
  PlatformAgentMetricsData,
  PlatformAuditScalarRow,
  PlatformOverviewQueryResult,
  PlatformOverviewReadModel,
  PlatformPostgresProbeData,
  PlatformReviewAggregateRow,
  PlatformSystemAggregateRow,
  PlatformTenantBaseRow,
} from "../../src/backend/platform-overview-read-model.js";

/**
 * Demo data for every state the Control Tower can render. Phase 7 requires each
 * of Healthy, Degraded, Critical, Unknown/stale, Empty and Insufficient sample
 * to be reachable from real inputs, so the demo cannot show a state the code
 * could never actually produce.
 */

const AS_OF = new Date("2026-08-11T04:00:00.000Z");

export type PlatformDemoStateName =
  | "HEALTHY"
  | "DEGRADED"
  | "CRITICAL"
  | "UNKNOWN_STALE"
  | "EMPTY"
  | "INSUFFICIENT_SAMPLE";

export interface PlatformDemoStateFixture {
  agents: PlatformAgentMetricsData;
  reviews: PlatformReviewAggregateRow[];
  tenants: PlatformTenantBaseRow[];
  system: PlatformSystemAggregateRow[];
  audit: PlatformAuditScalarRow[];
  postgres: PlatformPostgresProbeData | null;
  /** Simulates a snapshot source that has fallen behind its freshness budget. */
  staleSeconds: number | null;
}

function agentAggregate(
  overrides: Partial<PlatformAgentMetricsData["aggregates"][number]> = {},
): PlatformAgentMetricsData["aggregates"][number] {
  return {
    scopeKind: "GLOBAL",
    tenantId: null,
    agentType: null,
    runs: 0,
    completed: 0,
    failed: 0,
    degraded: 0,
    rejected: 0,
    terminal: 0,
    previousCompleted: 0,
    previousTerminal: 0,
    rollingTerminal: 0,
    rollingNonCompletion: 0,
    rollingProviderFailures: 0,
    oldestRollingFailureAt: null,
    p50LatencyMs: null,
    p95LatencyMs: null,
    retriedRuns: 0,
    lastSuccessAt: null,
    mtdCostMicroUsd: 0,
    mtdActualMicroUsd: 0,
    mtdEstimatedMicroUsd: 0,
    mtdActualRunCount: 0,
    mtdEstimatedRunCount: 0,
    previousMonthCostMicroUsd: 0,
    previousMonthRunCount: 0,
    windowCostMicroUsd: 0,
    windowCostRunCount: 0,
    previousWindowCostMicroUsd: 0,
    previousWindowCostRunCount: 0,
    ...overrides,
  };
}

function systemAggregate(
  kind: PlatformSystemAggregateRow["kind"],
  overrides: Partial<PlatformSystemAggregateRow> = {},
): PlatformSystemAggregateRow {
  return {
    kind,
    scopeKind: "GLOBAL",
    tenantId: null,
    pendingCount: 0,
    stalledCount: 0,
    failedCount: 0,
    deadLetterCount: 0,
    quarantinedCount: 0,
    oldestEvidenceAt: null,
    ...overrides,
  };
}

function reviewAggregate(
  overrides: Partial<PlatformReviewAggregateRow> = {},
): PlatformReviewAggregateRow {
  return {
    scopeKind: "GLOBAL",
    tenantId: null,
    waiting: 0,
    breached: 0,
    withoutDueAt: 0,
    oldestWaitingAt: null,
    oldestBreachedDueAt: null,
    ...overrides,
  };
}

function tenant(overrides: Partial<PlatformTenantBaseRow> = {}): PlatformTenantBaseRow {
  return {
    tenantId: "tenant-alpha",
    name: "Alpha Construction",
    activeAccounts: 18,
    loggedIn24h: 6,
    storageBytes: 12_582_912,
    lastActivityAt: new Date("2026-08-11T03:40:00.000Z"),
    ...overrides,
  };
}

const healthySystem = [
  systemAggregate("OUTBOX"),
  systemAggregate("NOTIFICATION"),
  systemAggregate("FILE"),
];

const healthyAgents: PlatformAgentMetricsData = {
  aggregates: [
    agentAggregate({
      runs: 240,
      completed: 232,
      failed: 5,
      degraded: 2,
      rejected: 1,
      terminal: 240,
      previousCompleted: 220,
      previousTerminal: 230,
      mtdCostMicroUsd: 4_200_000,
      mtdActualMicroUsd: 3_000_000,
      mtdEstimatedMicroUsd: 1_200_000,
      mtdActualRunCount: 180,
      mtdEstimatedRunCount: 60,
      previousMonthCostMicroUsd: 3_800_000,
      previousMonthRunCount: 220,
    }),
    agentAggregate({
      scopeKind: "AGENT",
      agentType: "A1_PROGRESS",
      runs: 240,
      completed: 232,
      failed: 5,
      degraded: 2,
      rejected: 1,
      terminal: 240,
      p50LatencyMs: 850,
      p95LatencyMs: 3_100,
      retriedRuns: 6,
      lastSuccessAt: new Date("2026-08-11T03:55:00.000Z"),
      mtdCostMicroUsd: 4_200_000,
    }),
  ],
  stuck: [],
};

export const platformDemoStateFixtures: Record<
  PlatformDemoStateName,
  PlatformDemoStateFixture
> = {
  HEALTHY: {
    agents: healthyAgents,
    reviews: [reviewAggregate({ waiting: 4, breached: 0 })],
    tenants: [tenant()],
    system: healthySystem,
    audit: [],
    postgres: { latencyMs: 4, checkedAt: AS_OF },
    staleSeconds: null,
  },

  // A confirmed delivery fault: outbox events reached dead letter.
  DEGRADED: {
    agents: healthyAgents,
    reviews: [reviewAggregate({ waiting: 6, breached: 0 })],
    tenants: [tenant()],
    system: [
      systemAggregate("OUTBOX", {
        pendingCount: 12,
        stalledCount: 4,
        deadLetterCount: 2,
        oldestEvidenceAt: new Date("2026-08-11T03:10:00.000Z"),
      }),
      systemAggregate("OUTBOX", {
        scopeKind: "TENANT",
        tenantId: "tenant-alpha",
        pendingCount: 12,
        stalledCount: 4,
        deadLetterCount: 2,
        oldestEvidenceAt: new Date("2026-08-11T03:10:00.000Z"),
      }),
      systemAggregate("NOTIFICATION"),
      systemAggregate("FILE"),
    ],
    audit: [],
    postgres: { latencyMs: 9, checkedAt: AS_OF },
    staleSeconds: null,
  },

  // The database probe itself failed, which outranks every other signal.
  CRITICAL: {
    agents: healthyAgents,
    reviews: [reviewAggregate({ waiting: 4, breached: 0 })],
    tenants: [tenant()],
    system: healthySystem,
    audit: [],
    postgres: null,
    staleSeconds: null,
  },

  // Sources answered, but from a snapshot older than the freshness budget.
  UNKNOWN_STALE: {
    agents: healthyAgents,
    reviews: [reviewAggregate({ waiting: 4, breached: 0 })],
    tenants: [tenant()],
    system: healthySystem,
    audit: [],
    postgres: { latencyMs: 6, checkedAt: AS_OF },
    staleSeconds: 900,
  },

  // A freshly provisioned platform: everything readable, nothing recorded yet.
  // GROUPING SETS still emits the global row on an empty table, so the fixture
  // carries a zeroed global aggregate exactly as PostgreSQL would.
  EMPTY: {
    agents: { aggregates: [agentAggregate()], stuck: [] },
    reviews: [reviewAggregate()],
    tenants: [],
    system: healthySystem,
    audit: [],
    postgres: { latencyMs: 3, checkedAt: AS_OF },
    staleSeconds: null,
  },

  // Real runs, but below the minimum sample the completion rule requires.
  INSUFFICIENT_SAMPLE: {
    agents: {
      aggregates: [
        agentAggregate({ runs: 6, completed: 5, failed: 1, terminal: 6 }),
        agentAggregate({
          scopeKind: "AGENT",
          agentType: "A2_FORECAST",
          runs: 6,
          completed: 5,
          failed: 1,
          terminal: 6,
          p50LatencyMs: 700,
          p95LatencyMs: 1_500,
          lastSuccessAt: new Date("2026-08-11T03:30:00.000Z"),
        }),
      ],
      stuck: [],
    },
    reviews: [reviewAggregate({ waiting: 1, breached: 0 })],
    tenants: [tenant()],
    system: healthySystem,
    audit: [],
    postgres: { latencyMs: 5, checkedAt: AS_OF },
    staleSeconds: null,
  },
};

/**
 * Builds a read model that serves one demo fixture. A `staleSeconds` fixture is
 * served as a SNAPSHOT whose age exceeds the freshness budget, which is exactly
 * how a real lagging rollup would present itself.
 */
export function stubOverviewReadModel(
  fixture: PlatformDemoStateFixture,
): PlatformOverviewReadModel {
  const wrap = <T>(data: T): PlatformOverviewQueryResult<T> =>
    fixture.staleSeconds === null
      ? { data, source: "LIVE_QUERY", freshAt: new Date(AS_OF) }
      : {
          data,
          source: "SNAPSHOT",
          freshAt: new Date(AS_OF.getTime() - fixture.staleSeconds * 1_000),
        };

  return {
    async queryAgentMetrics() {
      return wrap(fixture.agents);
    },
    async queryReviewMetrics() {
      return wrap(fixture.reviews);
    },
    async queryTenantBase() {
      return wrap(fixture.tenants);
    },
    async querySystemAggregates() {
      return wrap(fixture.system);
    },
    async probePostgres() {
      if (fixture.postgres === null) throw new Error("PostgreSQL probe failed");
      return { data: fixture.postgres, source: "LIVE_PROBE", freshAt: new Date(AS_OF) };
    },
    async queryRecentAudit() {
      return wrap(fixture.audit);
    },
  };
}
