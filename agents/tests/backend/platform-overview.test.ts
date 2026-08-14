import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPhase9Api } from "../../src/backend/api.js";
import { platformOverviewAttentionItemSchema } from "../../src/backend/platform-overview-contracts.js";
import { PlatformOverviewService } from "../../src/backend/platform-overview-service.js";
import { platformOverviewSignalId } from "../../src/backend/platform-overview-signals.js";
import type {
  PlatformAgentAggregateRow,
  PlatformAgentMetricsData,
  PlatformAuditScalarRow,
  PlatformOverviewQueryResult,
  PlatformOverviewReadInput,
  PlatformOverviewReadModel,
  PlatformPostgresProbeData,
  PlatformReviewAggregateRow,
  PlatformStuckAggregateRow,
  PlatformSystemAggregateRow,
  PlatformTenantBaseRow,
} from "../../src/backend/platform-overview-read-model.js";
import { loginPhase9, startPhase9TestServer } from "./phase9-fixtures.js";
import { buildPlatformTestFixture, loginPlatform } from "./platform-fixtures.js";

const AS_OF = new Date("2026-08-11T04:00:00.000Z");
const SECRET_SENTINEL = "super-secret-overview-sentinel";

function liveQuery<T>(data: T): PlatformOverviewQueryResult<T> {
  return { data, source: "LIVE_QUERY", freshAt: new Date(AS_OF) };
}

function liveProbe(
  data: PlatformPostgresProbeData,
): PlatformOverviewQueryResult<PlatformPostgresProbeData> {
  return { data, source: "LIVE_PROBE", freshAt: new Date(AS_OF) };
}

function agentAggregate(
  overrides: Partial<PlatformAgentAggregateRow> = {},
): PlatformAgentAggregateRow {
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

function stuckAggregate(
  overrides: Partial<PlatformStuckAggregateRow> = {},
): PlatformStuckAggregateRow {
  return {
    scopeKind: "GLOBAL",
    tenantId: null,
    agentType: null,
    stuck: 0,
    oldestStuckAt: null,
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

function tenantBase(overrides: Partial<PlatformTenantBaseRow> = {}): PlatformTenantBaseRow {
  return {
    tenantId: "tenant-default",
    name: "Default Tenant",
    activeAccounts: 1,
    loggedIn24h: 1,
    storageBytes: 100,
    lastActivityAt: new Date("2026-08-11T03:00:00.000Z"),
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

class FakePlatformOverviewReadModel implements PlatformOverviewReadModel {
  readonly inputs: PlatformOverviewReadInput[] = [];

  agentMetrics: PlatformAgentMetricsData = {
    aggregates: [agentAggregate()],
    stuck: [stuckAggregate()],
  };

  reviews: PlatformReviewAggregateRow[] = [reviewAggregate()];
  tenants: PlatformTenantBaseRow[] = [];
  system: PlatformSystemAggregateRow[] = [
    systemAggregate("OUTBOX"),
    systemAggregate("NOTIFICATION"),
    systemAggregate("FILE"),
  ];
  postgres: PlatformPostgresProbeData = { latencyMs: 4, checkedAt: new Date(AS_OF) };
  audit: PlatformAuditScalarRow[] = [];
  agentFailure: unknown = null;
  postgresFailure: unknown = null;
  agentSource: PlatformOverviewQueryResult<PlatformAgentMetricsData>["source"] = "LIVE_QUERY";
  agentFreshAt: Date | null = new Date(AS_OF);

  async queryAgentMetrics(input: PlatformOverviewReadInput) {
    this.inputs.push(input);
    if (this.agentFailure !== null) throw this.agentFailure;
    return {
      data: this.agentMetrics,
      source: this.agentSource,
      freshAt: this.agentFreshAt,
    };
  }

  async queryReviewMetrics(input: PlatformOverviewReadInput) {
    this.inputs.push(input);
    return liveQuery(this.reviews);
  }

  async queryTenantBase(input: PlatformOverviewReadInput) {
    this.inputs.push(input);
    return liveQuery(this.tenants);
  }

  async querySystemAggregates(input: PlatformOverviewReadInput) {
    this.inputs.push(input);
    return liveQuery(this.system);
  }

  async probePostgres() {
    if (this.postgresFailure !== null) throw this.postgresFailure;
    return liveProbe(this.postgres);
  }

  async queryRecentAudit(input: PlatformOverviewReadInput) {
    this.inputs.push(input);
    return liveQuery(this.audit);
  }
}

function serviceFor(readModel: FakePlatformOverviewReadModel) {
  return new PlatformOverviewService(readModel, () => new Date(AS_OF));
}

describe("platform overview service", () => {
  it("computes the frozen KPI example, MTD spend, review SLA, and a stable stuck-run signal", async () => {
    const readModel = new FakePlatformOverviewReadModel();
    const global = agentAggregate({
      runs: 24,
      completed: 20,
      failed: 2,
      degraded: 1,
      rejected: 1,
      terminal: 24,
      previousCompleted: 18,
      previousTerminal: 20,
      mtdCostMicroUsd: 300,
      mtdActualMicroUsd: 100,
      mtdEstimatedMicroUsd: 200,
      mtdActualRunCount: 2,
      mtdEstimatedRunCount: 1,
      previousMonthCostMicroUsd: 250,
      previousMonthRunCount: 3,
    });
    const byAgent = agentAggregate({
      scopeKind: "AGENT",
      agentType: "A1_PROGRESS",
      runs: 24,
      completed: 20,
      failed: 2,
      degraded: 1,
      rejected: 1,
      terminal: 24,
      p50LatencyMs: 1_200,
      p95LatencyMs: 4_800,
      retriedRuns: 3,
      lastSuccessAt: new Date("2026-08-11T03:55:00.000Z"),
      mtdCostMicroUsd: 300,
    });
    Object.assign(global, { request: SECRET_SENTINEL, output: SECRET_SENTINEL });
    readModel.agentMetrics = {
      aggregates: [global, byAgent],
      stuck: [
        stuckAggregate({
          scopeKind: "AGENT",
          agentType: "A1_PROGRESS",
          stuck: 1,
          oldestStuckAt: new Date("2026-08-11T03:20:00.000Z"),
        }),
      ],
    };
    readModel.reviews = [
      reviewAggregate({
        waiting: 3,
        breached: 1,
        withoutDueAt: 1,
        oldestWaitingAt: new Date("2026-08-10T20:00:00.000Z"),
        oldestBreachedDueAt: new Date("2026-08-11T03:59:59.999Z"),
      }),
    ];
    const auditRow = {
      id: "audit-1",
      actorPrincipalId: "platform-admin",
      actorDisplayName: "Platform Admin",
      actorRole: "PLATFORM_SUPER_ADMIN",
      tenantId: null,
      action: "PLATFORM_OVERVIEW_READ",
      entityType: "PLATFORM_OVERVIEW",
      entityId: "overview-1",
      result: "SUCCESS",
      occurredAt: new Date("2026-08-11T03:59:00.000Z"),
      correlationId: "correlation-1",
      metadata: SECRET_SENTINEL,
      beforeHash: SECRET_SENTINEL,
      afterHash: SECRET_SENTINEL,
    } satisfies PlatformAuditScalarRow & Record<string, unknown>;
    readModel.audit = [auditRow];

    const response = await serviceFor(readModel).overview({ window: "24h" });

    expect(response.asOf).toBe(AS_OF.toISOString());
    expect(response.kpis.agentCompletion).toMatchObject({
      valuePercent: 83.3,
      completed: 20,
      terminal: 24,
      failed: 2,
      degraded: 1,
      rejected: 1,
      context: {
        state: "AVAILABLE",
        sampleSize: 24,
        comparison: {
          state: "AVAILABLE",
          previousValue: 90,
          delta: -6.7,
          deltaUnit: "PERCENTAGE_POINTS",
        },
      },
    });
    expect(response.kpis.reviewSla).toMatchObject({
      waiting: 3,
      breached: 1,
      withoutDueAt: 1,
      oldestWaitingAt: "2026-08-10T20:00:00.000Z",
      oldestBreachedDueAt: "2026-08-11T03:59:59.999Z",
      context: { state: "AVAILABLE", sampleSize: 3 },
    });
    expect(response.kpis.aiSpend).toMatchObject({
      microUsd: 300,
      actualMicroUsd: 100,
      estimatedMicroUsd: 200,
      actualRunCount: 2,
      estimatedRunCount: 1,
      actualCoveragePercent: 66.7,
      context: {
        state: "AVAILABLE",
        sampleSize: 3,
        comparison: { state: "AVAILABLE", previousValue: 250, delta: 50 },
      },
    });
    expect(response.agentHealthPreview.items[0]).toMatchObject({
      agentType: "A1_PROGRESS",
      completionPercent: 83.3,
      stuck: 1,
    });

    const stuckSignal = response.attention.items.find(
      (item) => item.ruleKey === "AGENT_RUN_STUCK_30M",
    );
    expect(stuckSignal).toMatchObject({
      incidentId: null,
      state: "OPEN",
      diagnosticsHref: "/platform/agent-runs?stuck=true&agentType=A1_PROGRESS",
    });
    const expectedSignalId = createHash("sha256")
      .update(["v1", "AGENT_RUN_STUCK_30M", "", "A1_PROGRESS", ""].join("\u001f"))
      .digest("hex");
    expect(stuckSignal?.signalId).toBe(expectedSignalId);
    expect(
      platformOverviewSignalId("AGENT_RUN_STUCK_30M", {
        tenantId: null,
        agentType: "A1_PROGRESS",
        component: null,
      }),
    ).toBe(expectedSignalId);
    expect(JSON.stringify(response)).not.toContain(SECRET_SENTINEL);
  });

  it("keeps 19-terminal global and per-agent completion percentages unavailable", async () => {
    const readModel = new FakePlatformOverviewReadModel();
    readModel.agentMetrics = {
      aggregates: [
        agentAggregate({
          runs: 19,
          completed: 18,
          failed: 1,
          terminal: 19,
          previousCompleted: 18,
          previousTerminal: 20,
        }),
        agentAggregate({
          scopeKind: "AGENT",
          agentType: "A2_FORECAST",
          runs: 19,
          completed: 18,
          failed: 1,
          terminal: 19,
        }),
      ],
      stuck: [],
    };

    const response = await serviceFor(readModel).overview({});

    expect(response.kpis.agentCompletion.valuePercent).toBeNull();
    expect(response.kpis.agentCompletion.context).toMatchObject({
      state: "INSUFFICIENT_SAMPLE",
      sampleSize: 19,
      minimumSample: 20,
      comparison: { state: "UNAVAILABLE", reason: "INSUFFICIENT_SAMPLE" },
    });
    expect(response.agentHealthPreview.items).toEqual([
      expect.objectContaining({
        agentType: "A2_FORECAST",
        terminal: 19,
        completionPercent: null,
      }),
    ]);
  });

  it("returns explicit zero/no-data semantics for an otherwise healthy empty platform", async () => {
    const response = await serviceFor(new FakePlatformOverviewReadModel()).overview({});

    expect(response).toMatchObject({
      partial: false,
      problems: [],
      platformStatus: { state: "HEALTHY" },
      kpis: {
        criticalIssues: { value: 0, critical: 0, high: 0, context: { state: "AVAILABLE" } },
        tenantHealth: { total: 0, context: { state: "NO_DATA", sampleSize: 0 } },
        agentCompletion: {
          valuePercent: null,
          completed: 0,
          terminal: 0,
          context: { state: "NO_DATA", sampleSize: 0 },
        },
        reviewSla: {
          breached: 0,
          waiting: 0,
          withoutDueAt: 0,
          context: { state: "AVAILABLE", sampleSize: 0 },
        },
        aiSpend: {
          microUsd: 0,
          actualMicroUsd: 0,
          estimatedMicroUsd: 0,
          actualCoveragePercent: null,
          context: { state: "AVAILABLE", sampleSize: 0 },
        },
      },
    });
    expect(response.attention).toMatchObject({ total: 0, items: [] });
    expect(response.tenantHealthPreview).toMatchObject({ total: 0, items: [] });
    expect(response.agentHealthPreview).toMatchObject({ total: 0, items: [] });
  });

  it("degrades only agent-derived sections when the agent query rejects and sanitizes the error", async () => {
    const readModel = new FakePlatformOverviewReadModel();
    readModel.tenants = [tenantBase({ tenantId: "tenant-unknown", name: "Unknown Tenant" })];
    readModel.agentFailure = new Error(`database password=${SECRET_SENTINEL}`);

    const response = await serviceFor(readModel).overview({});
    const serialized = JSON.stringify(response);

    expect(response.partial).toBe(true);
    expect(response.problems).toEqual([
      {
        section: "AGENTS",
        code: "SOURCE_UNAVAILABLE",
        message: "Agent metrics are temporarily unavailable.",
        retryable: true,
      },
      {
        section: "USAGE",
        code: "SOURCE_UNAVAILABLE",
        message: "Usage data is temporarily unavailable.",
        retryable: true,
      },
    ]);
    expect(response.kpis.agentCompletion.context.state).toBe("UNKNOWN");
    expect(response.kpis.aiSpend.context.state).toBe("UNKNOWN");
    expect(response.agentHealthPreview.context.state).toBe("UNKNOWN");
    expect(response.kpis.reviewSla.context.state).toBe("AVAILABLE");
    expect(response.tenantHealthPreview.items[0]?.health).toBe("UNKNOWN");
    expect(serialized).not.toContain(SECRET_SENTINEL);
    expect(serialized).not.toContain("database password");
  });

  it("makes a failed Postgres probe the first critical cause with one sanitized SYSTEM problem", async () => {
    const readModel = new FakePlatformOverviewReadModel();
    readModel.postgresFailure = new Error(`postgres dsn=${SECRET_SENTINEL}`);

    const response = await serviceFor(readModel).overview({});

    expect(response.partial).toBe(true);
    expect(response.problems.filter((item) => item.section === "SYSTEM")).toEqual([
      {
        section: "SYSTEM",
        code: "SOURCE_UNAVAILABLE",
        message: "System health data is temporarily unavailable.",
        retryable: true,
      },
    ]);
    expect(response.platformStatus.state).toBe("CRITICAL");
    expect(response.attention.items[0]).toMatchObject({
      ruleKey: "POSTGRES_UNAVAILABLE",
      severity: "CRITICAL",
      state: "OPEN",
      diagnosticsHref: "/platform/system-health?component=POSTGRES",
    });
    expect(response.topCauses[0]?.causeId).toBe(response.attention.items[0]?.signalId);
    expect(
      response.systemHealth.components.find((item) => item.component === "POSTGRES")?.state,
    ).toBe("DOWN");
    expect(JSON.stringify(response)).not.toContain(SECRET_SENTINEL);
  });

  it("flags a cost anomaly against the tenant's own baseline, not against other tenants", async () => {
    const readModel = new FakePlatformOverviewReadModel();
    readModel.tenants = [
      tenantBase({ tenantId: "tenant-spiking", name: "Spiking" }),
      tenantBase({ tenantId: "tenant-large", name: "Large" }),
      tenantBase({ tenantId: "tenant-tiny", name: "Tiny" }),
    ];
    readModel.agentMetrics = {
      aggregates: [
        agentAggregate(),
        // Doubled against its own previous window, on a real sample.
        agentAggregate({
          scopeKind: "TENANT",
          tenantId: "tenant-spiking",
          windowCostMicroUsd: 9_000_000,
          windowCostRunCount: 60,
          previousWindowCostMicroUsd: 3_000_000,
          previousWindowCostRunCount: 55,
        }),
        // Expensive but steady: size alone must never raise a signal.
        agentAggregate({
          scopeKind: "TENANT",
          tenantId: "tenant-large",
          windowCostMicroUsd: 80_000_000,
          windowCostRunCount: 900,
          previousWindowCostMicroUsd: 78_000_000,
          previousWindowCostRunCount: 880,
        }),
        // Tripled, but on a baseline too small and too few runs to trust.
        agentAggregate({
          scopeKind: "TENANT",
          tenantId: "tenant-tiny",
          windowCostMicroUsd: 90_000,
          windowCostRunCount: 3,
          previousWindowCostMicroUsd: 30_000,
          previousWindowCostRunCount: 2,
        }),
      ],
      stuck: [],
    };

    const response = await serviceFor(readModel).overview({});

    const anomalies = response.attention.items.filter(
      (item) => item.ruleKey === "TENANT_COST_ANOMALY",
    );
    expect(anomalies.map((item) => item.scope.tenantId)).toEqual(["tenant-spiking"]);
    expect(anomalies[0]).toMatchObject({
      severity: "MEDIUM",
      diagnosticsHref: "/platform/usage?tenantId=tenant-spiking",
    });
    expect(anomalies[0]?.evidence[0]).toMatchObject({
      metricKey: "tenant_cost_increase_percent",
      value: 200,
      unit: "percent",
    });
  });

  it("sorts warning tenants before healthy and inactive tenants", async () => {
    const readModel = new FakePlatformOverviewReadModel();
    readModel.tenants = [
      tenantBase({
        tenantId: "tenant-inactive",
        name: "Inactive",
        lastActivityAt: new Date("2026-06-01T00:00:00.000Z"),
      }),
      tenantBase({ tenantId: "tenant-healthy", name: "Healthy" }),
      tenantBase({ tenantId: "tenant-warning", name: "Warning" }),
    ];
    readModel.reviews = [
      reviewAggregate({ waiting: 1, breached: 1 }),
      reviewAggregate({
        scopeKind: "TENANT",
        tenantId: "tenant-warning",
        waiting: 1,
        breached: 1,
        oldestWaitingAt: new Date("2026-08-11T02:00:00.000Z"),
        oldestBreachedDueAt: new Date("2026-08-11T03:00:00.000Z"),
      }),
    ];

    const response = await serviceFor(readModel).overview({});

    expect(
      response.tenantHealthPreview.items.map(({ tenantId, health }) => [tenantId, health]),
    ).toEqual([
      ["tenant-warning", "WARNING"],
      ["tenant-healthy", "HEALTHY"],
      ["tenant-inactive", "INACTIVE"],
    ]);
    expect(response.kpis.tenantHealth).toMatchObject({
      total: 3,
      warning: 1,
      healthy: 1,
      inactive: 1,
    });
  });

  it("sanitizes invalid tenant names and drops invalid aggregate agent types before strict parsing", async () => {
    const readModel = new FakePlatformOverviewReadModel();
    const oversizedTenantName = `OVERSIZED_TENANT_SECRET_${"n".repeat(220)}`;
    const oversizedAgentType = `INVALID_AGENT_SECRET_${"a".repeat(110)}`;
    readModel.tenants = [
      tenantBase({ tenantId: "tenant-blank-name", name: " \t  " }),
      tenantBase({ tenantId: "tenant-long-name", name: `  ${oversizedTenantName}  ` }),
    ];
    readModel.agentMetrics = {
      aggregates: [
        agentAggregate(),
        agentAggregate({
          scopeKind: "AGENT",
          agentType: "   ",
          runs: 20,
          terminal: 20,
          rollingTerminal: 20,
          rollingNonCompletion: 20,
        }),
        agentAggregate({
          scopeKind: "AGENT",
          agentType: oversizedAgentType,
          runs: 20,
          terminal: 20,
          rollingTerminal: 20,
          rollingNonCompletion: 20,
        }),
      ],
      stuck: [
        stuckAggregate({ scopeKind: "AGENT", agentType: "  ", stuck: 1 }),
        stuckAggregate({ scopeKind: "AGENT", agentType: oversizedAgentType, stuck: 1 }),
      ],
    };

    const response = await serviceFor(readModel).overview({});
    const blankNameTenant = response.tenantHealthPreview.items.find(
      (item) => item.tenantId === "tenant-blank-name",
    );
    const longNameTenant = response.tenantHealthPreview.items.find(
      (item) => item.tenantId === "tenant-long-name",
    );
    const serialized = JSON.stringify(response);

    expect(blankNameTenant?.name).toBe("tenant-blank-name");
    expect(longNameTenant?.name).toBe(oversizedTenantName.slice(0, 200));
    expect(longNameTenant?.name).toHaveLength(200);
    expect(response.agentHealthPreview.items).toEqual([]);
    expect(
      response.attention.items.some(
        (item) =>
          item.ruleKey === "AGENT_HIGH_FAILURE_RATE" || item.ruleKey === "AGENT_RUN_STUCK_30M",
      ),
    ).toBe(false);
    expect(serialized).not.toContain(oversizedTenantName);
    expect(serialized).not.toContain("INVALID_AGENT_SECRET_");
  });

  it("accepts persisted ACKNOWLEDGED and REOPENED attention lifecycle states", async () => {
    const readModel = new FakePlatformOverviewReadModel();
    readModel.agentMetrics.stuck = [
      stuckAggregate({
        scopeKind: "AGENT",
        agentType: "A3_COST",
        stuck: 1,
        oldestStuckAt: new Date("2026-08-11T03:00:00.000Z"),
      }),
    ];
    const response = await serviceFor(readModel).overview({});
    const openItem = response.attention.items[0];

    expect(openItem?.state).toBe("OPEN");
    expect(
      platformOverviewAttentionItemSchema.parse({ ...openItem, state: "ACKNOWLEDGED" }).state,
    ).toBe("ACKNOWLEDGED");
    expect(
      platformOverviewAttentionItemSchema.parse({ ...openItem, state: "REOPENED" }).state,
    ).toBe("REOPENED");
  });

  it("marks a 61-second-old agent snapshot stale and makes only its affected domains unknown", async () => {
    const readModel = new FakePlatformOverviewReadModel();
    readModel.agentSource = "SNAPSHOT";
    readModel.agentFreshAt = new Date(AS_OF.getTime() - 61_000);

    const response = await serviceFor(readModel).overview({});

    expect(response.partial).toBe(true);
    expect(
      response.problems.filter((item) => item.section === "AGENTS" || item.section === "USAGE"),
    ).toEqual([
      {
        section: "AGENTS",
        code: "SOURCE_STALE",
        message: "Agent metrics are temporarily unavailable.",
        retryable: true,
      },
      {
        section: "USAGE",
        code: "SOURCE_STALE",
        message: "Usage data is temporarily unavailable.",
        retryable: true,
      },
    ]);
    expect(response.kpis.agentCompletion.context).toMatchObject({
      state: "UNKNOWN",
      freshness: { state: "STALE", source: "SNAPSHOT", ageSeconds: 61 },
    });
    expect(response.kpis.aiSpend.context.state).toBe("UNKNOWN");
    expect(response.agentHealthPreview.context.state).toBe("UNKNOWN");
    expect(response.kpis.reviewSla.context.state).toBe("AVAILABLE");
    expect(response.freshness.state).toBe("STALE");
  });

  it("degrades the platform when the only signal is a MEDIUM artifact-processing issue", async () => {
    const readModel = new FakePlatformOverviewReadModel();
    readModel.tenants = [tenantBase({ tenantId: "tenant-artifact", name: "Artifact Tenant" })];
    readModel.system = [
      systemAggregate("OUTBOX"),
      systemAggregate("NOTIFICATION"),
      systemAggregate("FILE", {
        stalledCount: 1,
        oldestEvidenceAt: new Date("2026-08-11T03:30:00.000Z"),
      }),
      systemAggregate("FILE", {
        scopeKind: "TENANT",
        tenantId: "tenant-artifact",
        stalledCount: 1,
        oldestEvidenceAt: new Date("2026-08-11T03:30:00.000Z"),
      }),
    ];

    const response = await serviceFor(readModel).overview({});
    const artifactComponent = response.systemHealth.components.find(
      (item) => item.component === "ARTIFACT_METADATA",
    );

    expect(response.attention.items).toEqual([
      expect.objectContaining({ ruleKey: "ARTIFACT_PENDING_15M", severity: "MEDIUM" }),
    ]);
    expect(response.kpis.criticalIssues.value).toBe(0);
    expect(artifactComponent).toMatchObject({ required: true, state: "DEGRADED" });
    expect(response.platformStatus.state).toBe("DEGRADED");
  });

  it("emits NOTIFICATION_FAILED and degrades the platform for a notification-only optional component failure", async () => {
    const readModel = new FakePlatformOverviewReadModel();
    readModel.tenants = [
      tenantBase({ tenantId: "tenant-notification", name: "Notification Tenant" }),
    ];
    readModel.system = [
      systemAggregate("OUTBOX"),
      systemAggregate("NOTIFICATION", {
        failedCount: 2,
        oldestEvidenceAt: new Date("2026-08-11T03:10:00.000Z"),
      }),
      systemAggregate("FILE"),
      systemAggregate("NOTIFICATION", {
        scopeKind: "TENANT",
        tenantId: "tenant-notification",
        failedCount: 2,
        oldestEvidenceAt: new Date("2026-08-11T03:10:00.000Z"),
      }),
    ];

    const response = await serviceFor(readModel).overview({});
    const notification = response.systemHealth.components.find(
      (item) => item.component === "NOTIFICATION",
    );

    expect(response.attention.items).toEqual([
      expect.objectContaining({
        ruleKey: "NOTIFICATION_FAILED",
        severity: "MEDIUM",
        scope: expect.objectContaining({
          tenantId: "tenant-notification",
          component: "NOTIFICATION",
        }),
        diagnosticsHref:
          "/platform/system-health?component=NOTIFICATION&tenantId=tenant-notification",
      }),
    ]);
    expect(response.kpis.criticalIssues.value).toBe(0);
    expect(notification).toMatchObject({ required: false, state: "DEGRADED" });
    expect(response.platformStatus.state).toBe("DEGRADED");
  });

  it("emits ARTIFACT_QUARANTINED when file metadata reports quarantined artifacts", async () => {
    const readModel = new FakePlatformOverviewReadModel();
    readModel.tenants = [tenantBase({ tenantId: "tenant-quarantine", name: "Quarantine Tenant" })];
    readModel.system = [
      systemAggregate("OUTBOX"),
      systemAggregate("NOTIFICATION"),
      systemAggregate("FILE", {
        quarantinedCount: 3,
        oldestEvidenceAt: new Date("2026-08-11T02:45:00.000Z"),
      }),
      systemAggregate("FILE", {
        scopeKind: "TENANT",
        tenantId: "tenant-quarantine",
        quarantinedCount: 3,
        oldestEvidenceAt: new Date("2026-08-11T02:45:00.000Z"),
      }),
    ];

    const response = await serviceFor(readModel).overview({});

    expect(response.attention.items).toEqual([
      expect.objectContaining({
        ruleKey: "ARTIFACT_QUARANTINED",
        severity: "MEDIUM",
        scope: expect.objectContaining({
          tenantId: "tenant-quarantine",
          component: "ARTIFACT_METADATA",
        }),
        diagnosticsHref:
          "/platform/system-health?component=ARTIFACT_METADATA&tenantId=tenant-quarantine",
      }),
    ]);
    expect(response.kpis.criticalIssues.value).toBe(0);
    expect(
      response.systemHealth.components.find((item) => item.component === "ARTIFACT_METADATA"),
    ).toMatchObject({ required: true, state: "DEGRADED" });
    expect(response.platformStatus.state).toBe("DEGRADED");
  });

  it("excludes other-tenant system rows from filtered attention, causes, and tenant issues", async () => {
    const readModel = new FakePlatformOverviewReadModel();
    readModel.tenants = [tenantBase({ tenantId: "tenant-a", name: "Tenant A" })];
    readModel.system = [
      systemAggregate("OUTBOX"),
      systemAggregate("NOTIFICATION"),
      systemAggregate("FILE"),
      systemAggregate("OUTBOX", {
        scopeKind: "TENANT",
        tenantId: "tenant-b",
        stalledCount: 2,
        deadLetterCount: 1,
        oldestEvidenceAt: new Date("2026-08-11T02:00:00.000Z"),
      }),
    ];

    const response = await serviceFor(readModel).overview({ tenantId: "tenant-a" });

    expect(response.filters.tenantId).toBe("tenant-a");
    expect(response.attention.items).toEqual([]);
    expect(response.topCauses).toEqual([]);
    expect(response.tenantHealthPreview.items[0]).toMatchObject({
      tenantId: "tenant-a",
      health: "HEALTHY",
      issues: { critical: 0, high: 0, medium: 0, low: 0 },
    });
    expect(JSON.stringify(response)).not.toContain("tenant-b");
  });

  it("enforces platform overview permission wiring over HTTP", async () => {
    const fixture = await buildPlatformTestFixture();
    const readModel = new FakePlatformOverviewReadModel();
    const app = createPhase9Api({
      auth: fixture.tenant.auth,
      platformAuth: fixture.platformAuth,
      platformOverview: serviceFor(readModel),
      projects: fixture.tenant.projects,
      commands: fixture.tenant.commands,
      reviews: fixture.tenant.reviews,
      artifacts: fixture.tenant.artifacts,
      objectStore: fixture.tenant.objectStore,
    });
    const runtime = await startPhase9TestServer(app);
    try {
      const companyAdmin = await loginPhase9(runtime.baseUrl, "alpha", "admin@alpha.test");
      const tenantResponse = await fetch(`${runtime.baseUrl}/platform/v1/overview`, {
        headers: { authorization: `Bearer ${companyAdmin.accessToken}` },
      });
      expect(tenantResponse.status).toBe(403);
      expect(await tenantResponse.json()).toMatchObject({ error: { code: "AUTH_FORBIDDEN" } });
      expect(readModel.inputs).toHaveLength(0);

      const platform = await loginPlatform(runtime.baseUrl);
      const platformResponse = await fetch(`${runtime.baseUrl}/platform/v1/overview`, {
        headers: { authorization: `Bearer ${platform.accessToken}` },
      });
      expect(platformResponse.status).toBe(200);
      expect(await platformResponse.json()).toMatchObject({
        schemaVersion: "platform-overview.v1",
        platformStatus: { state: "HEALTHY" },
      });
      expect(readModel.inputs).toHaveLength(5);
    } finally {
      await runtime.close();
    }
  });

  it("keeps raw overview queries parameterized and forbids sensitive source columns", () => {
    const source = readFileSync(
      new URL("../../src/backend/platform-overview-read-model.ts", import.meta.url),
      "utf8",
    );
    const queryFragments = source.split("this.client.$queryRaw").slice(1);

    expect(queryFragments).toHaveLength(7);
    expect(source).not.toMatch(/\$(?:queryRaw|executeRaw)Unsafe/u);
    for (const fragment of queryFragments) {
      expect(fragment.slice(0, 180).replace(/\s+/gu, "")).toMatch(/^(?:<[^>]+>)?\(Prisma\.sql`/u);
    }
    for (const forbiddenColumn of [
      '."request"',
      '."output"',
      '."researchText"',
      '."validation"',
      '."errorMessage"',
      '."payload"',
      '."headers"',
      '."metadata"',
      '."beforeHash"',
      '."afterHash"',
    ]) {
      expect(source).not.toContain(forbiddenColumn);
    }
  });

  it.each([
    [
      "preset mixed with custom range",
      { window: "24h", from: "2026-08-10T04:00:00Z", to: "2026-08-11T04:00:00Z" },
    ],
    ["only one custom boundary", { from: "2026-08-10T04:00:00Z" }],
    ["empty custom range", { from: "2026-08-11T04:00:00Z", to: "2026-08-11T04:00:00Z" }],
    ["future custom range", { from: "2026-08-11T03:00:00Z", to: "2026-08-11T04:00:00.001Z" }],
    ["range longer than 90 days", { from: "2026-05-01T00:00:00Z", to: "2026-08-01T00:00:00Z" }],
    ["unknown query key", { unexpected: "value" }],
    ["blank agent type", { agentType: "   " }],
  ])("rejects strict invalid query input: %s", async (_label, query) => {
    const readModel = new FakePlatformOverviewReadModel();

    await expect(serviceFor(readModel).overview(query)).rejects.toBeDefined();
    expect(readModel.inputs).toHaveLength(0);
  });

  it("passes a valid half-open custom UTC range and frozen asOf to every read query", async () => {
    const readModel = new FakePlatformOverviewReadModel();

    const response = await serviceFor(readModel).overview({
      from: "2026-08-10T00:00:00+08:00",
      to: "2026-08-11T04:00:00Z",
      tenantId: "tenant-one",
      agentType: "A1_PROGRESS",
    });

    expect(response.window).toEqual({
      kind: "SELECTED_RANGE",
      from: "2026-08-09T16:00:00.000Z",
      to: "2026-08-11T04:00:00.000Z",
      timeZone: "UTC",
    });
    expect(response.filters).toEqual({ tenantId: "tenant-one", agentType: "A1_PROGRESS" });
    expect(readModel.inputs).toHaveLength(5);
    for (const input of readModel.inputs) {
      expect(input.asOf.toISOString()).toBe(AS_OF.toISOString());
      expect(input.selectedTo.toISOString()).toBe(AS_OF.toISOString());
      expect(input.tenantId).toBe("tenant-one");
      expect(input.agentType).toBe("A1_PROGRESS");
    }
  });
});
