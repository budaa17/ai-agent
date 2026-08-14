import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPhase9Api } from "../../src/backend/api.js";
import { PlatformDrilldownService } from "../../src/backend/platform-drilldown-service.js";
import type {
  PlatformAgentDetailData,
  PlatformAgentListRow,
  PlatformAgentRunDiagnosticsData,
  PlatformAgentRunFilter,
  PlatformAgentRunRow,
  PlatformAuditFilter,
  PlatformAuditRow,
  PlatformDrilldownRange,
  PlatformDrilldownReadModel,
  PlatformReviewBacklogFilter,
  PlatformReviewBacklogRow,
  PlatformReviewSummaryData,
  PlatformSystemDetailData,
  PlatformTenantAgentRow,
  PlatformTenantListRow,
  PlatformUsageGroupRow,
} from "../../src/backend/platform-drilldown-read-model.js";
import type {
  PlatformOverviewQueryResult,
  PlatformOverviewReadModel,
  PlatformPostgresProbeData,
  PlatformSystemAggregateRow,
} from "../../src/backend/platform-overview-read-model.js";
import { loginPhase9, startPhase9TestServer } from "./phase9-fixtures.js";
import { buildPlatformTestFixture, loginPlatform } from "./platform-fixtures.js";

const AS_OF = new Date("2026-08-11T04:00:00.000Z");
const SECRET_SENTINEL = "super-secret-drilldown-sentinel";

function liveQuery<T>(data: T): PlatformOverviewQueryResult<T> {
  return { data, source: "LIVE_QUERY", freshAt: new Date(AS_OF) };
}

function tenantRow(overrides: Partial<PlatformTenantListRow> = {}): PlatformTenantListRow {
  return {
    tenantId: "tenant-alpha",
    name: "Alpha",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    activeAccounts: 5,
    suspendedAccounts: 0,
    loggedIn24h: 2,
    loggedIn7d: 4,
    neverLoggedIn: 1,
    totalProjects: 3,
    activeProjects: 2,
    storageBytes: 2_048,
    fileCount: 7,
    quarantinedFiles: 0,
    runs: 10,
    completed: 8,
    failed: 1,
    degraded: 1,
    rejected: 0,
    terminal: 10,
    stuck: 0,
    rollingTerminal: 0,
    rollingNonCompletion: 0,
    oldestRollingFailureAt: null,
    oldestStuckAt: null,
    mtdCostMicroUsd: 1_500,
    reviewWaiting: 0,
    reviewBreached: 0,
    reviewWithoutDueAt: 0,
    oldestWaitingAt: null,
    oldestBreachedDueAt: null,
    outboxStalled: 0,
    outboxDeadLetter: 0,
    notificationFailed: 0,
    lastActivityAt: new Date("2026-08-11T03:00:00.000Z"),
    ...overrides,
  };
}

function agentRow(overrides: Partial<PlatformAgentListRow> = {}): PlatformAgentListRow {
  return {
    agentType: "A1_PROGRESS",
    runs: 30,
    terminal: 30,
    completed: 27,
    failed: 2,
    degraded: 1,
    rejected: 0,
    running: 0,
    stuck: 0,
    oldestStuckAt: null,
    rollingTerminal: 0,
    rollingNonCompletion: 0,
    oldestRollingFailureAt: null,
    p50LatencyMs: 900,
    p95LatencyMs: 3_400,
    retriedRuns: 3,
    lastSuccessAt: new Date("2026-08-11T03:50:00.000Z"),
    costMicroUsd: 4_200,
    ...overrides,
  };
}

function runRow(overrides: Partial<PlatformAgentRunRow> = {}): PlatformAgentRunRow {
  return {
    runId: "run-1",
    tenantId: "tenant-alpha",
    tenantName: "Alpha",
    projectId: "project-1",
    agentType: "A1_PROGRESS",
    status: "COMPLETED",
    failureCategory: "NONE",
    trigger: "REQUEST",
    provider: "anthropic",
    modelId: "claude-sonnet-5",
    promptVersion: "a1.v3",
    startedAt: new Date("2026-08-11T03:30:00.000Z"),
    completedAt: new Date("2026-08-11T03:31:00.000Z"),
    latencyMs: 60_000,
    retryCount: 0,
    estimatedCostMicroUsd: 900,
    actualCostMicroUsd: 1_100,
    ...overrides,
  };
}

class FakeDrilldownReadModel implements PlatformDrilldownReadModel {
  readonly calls: string[] = [];

  tenants: PlatformTenantListRow[] = [tenantRow()];
  tenantAgents: PlatformTenantAgentRow[] = [];
  agents: PlatformAgentListRow[] = [agentRow()];
  agentDetail: PlatformAgentDetailData = { failures: [], tenants: [], models: [] };
  runs: PlatformAgentRunRow[] = [runRow()];
  diagnostics: PlatformAgentRunDiagnosticsData | null = null;
  reviewSummary: PlatformReviewSummaryData = {
    totals: null,
    buckets: [],
    tenants: [],
    targets: [],
    throughput: null,
  };
  backlog: PlatformReviewBacklogRow[] = [];
  usage: PlatformUsageGroupRow[] = [];
  systemDetail: PlatformSystemDetailData = { outboxByType: [], tenantImpact: [] };
  audit: PlatformAuditRow[] = [];

  tenantFailure: unknown = null;
  lastRunFilter: PlatformAgentRunFilter | null = null;
  lastBacklogFilter: PlatformReviewBacklogFilter | null = null;
  lastAuditFilter: PlatformAuditFilter | null = null;
  lastUsageInput: { tenantId: string | null; agentType: string | null; groupBy: string } | null =
    null;

  async queryTenantList(
    _range: PlatformDrilldownRange,
    input: { search: string | null; tenantId: string | null },
  ) {
    this.calls.push("tenants");
    if (this.tenantFailure !== null) throw this.tenantFailure;
    const filtered =
      input.tenantId === null
        ? this.tenants
        : this.tenants.filter((row) => row.tenantId === input.tenantId);
    return liveQuery(
      input.search === null
        ? filtered
        : filtered.filter((row) => row.name.toLowerCase().includes(input.search!.toLowerCase())),
    );
  }

  async queryTenantAgents(_range: PlatformDrilldownRange, _tenantId: string) {
    this.calls.push("tenantAgents");
    return liveQuery(this.tenantAgents);
  }

  async queryAgentList(_range: PlatformDrilldownRange, _tenantId: string | null) {
    this.calls.push("agents");
    return liveQuery(this.agents);
  }

  async queryAgentDetail(
    _range: PlatformDrilldownRange,
    _agentType: string,
    _tenantId: string | null,
  ) {
    this.calls.push("agentDetail");
    return liveQuery(this.agentDetail);
  }

  async queryAgentRuns(_range: PlatformDrilldownRange, filter: PlatformAgentRunFilter) {
    this.calls.push("agentRuns");
    this.lastRunFilter = filter;
    return liveQuery(this.runs.slice(0, filter.limit));
  }

  async queryAgentRunDiagnostics(_range: PlatformDrilldownRange, _runId: string) {
    this.calls.push("diagnostics");
    return liveQuery(this.diagnostics);
  }

  async queryReviewSummary(_range: PlatformDrilldownRange, _tenantId: string | null) {
    this.calls.push("reviewSummary");
    return liveQuery(this.reviewSummary);
  }

  async queryReviewBacklog(_range: PlatformDrilldownRange, filter: PlatformReviewBacklogFilter) {
    this.calls.push("reviewBacklog");
    this.lastBacklogFilter = filter;
    return liveQuery(this.backlog.slice(0, filter.limit));
  }

  async queryUsage(
    _range: PlatformDrilldownRange,
    input: {
      tenantId: string | null;
      agentType: string | null;
      groupBy: "TENANT" | "AGENT_TYPE" | "MODEL";
    },
  ) {
    this.calls.push("usage");
    this.lastUsageInput = input;
    return liveQuery(this.usage);
  }

  async querySystemDetail(_range: PlatformDrilldownRange, _tenantId: string | null) {
    this.calls.push("systemDetail");
    return liveQuery(this.systemDetail);
  }

  async queryAuditLogs(_range: PlatformDrilldownRange, filter: PlatformAuditFilter) {
    this.calls.push("audit");
    this.lastAuditFilter = filter;
    return liveQuery(this.audit.slice(0, filter.limit));
  }
}

class FakeOverviewReadModel implements PlatformOverviewReadModel {
  system: PlatformSystemAggregateRow[] = [];
  postgres: PlatformPostgresProbeData = { latencyMs: 3, checkedAt: new Date(AS_OF) };

  async queryAgentMetrics() {
    return liveQuery({ aggregates: [], stuck: [] });
  }
  async queryReviewMetrics() {
    return liveQuery([]);
  }
  async queryTenantBase() {
    return liveQuery([]);
  }
  async querySystemAggregates() {
    return liveQuery(this.system);
  }
  async probePostgres() {
    return {
      data: this.postgres,
      source: "LIVE_PROBE" as const,
      freshAt: new Date(AS_OF),
    };
  }
  async queryRecentAudit() {
    return liveQuery([]);
  }
}

function serviceFor(drilldown: FakeDrilldownReadModel, overview = new FakeOverviewReadModel()) {
  return new PlatformDrilldownService({ drilldown, overview }, () => new Date(AS_OF));
}

describe("platform tenant drill-down", () => {
  it("classifies health with the overview rules and orders critical work first", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.tenants = [
      tenantRow({ tenantId: "tenant-healthy", name: "Healthy" }),
      tenantRow({
        tenantId: "tenant-inactive",
        name: "Inactive",
        lastActivityAt: new Date("2026-06-01T00:00:00.000Z"),
      }),
      tenantRow({
        tenantId: "tenant-breached",
        name: "Breached",
        reviewWaiting: 4,
        reviewBreached: 2,
        oldestBreachedDueAt: new Date("2026-08-11T01:00:00.000Z"),
      }),
    ];

    const response = await serviceFor(readModel).tenants({});

    expect(response.items.map((item) => [item.tenantId, item.health])).toEqual([
      ["tenant-breached", "WARNING"],
      ["tenant-healthy", "HEALTHY"],
      ["tenant-inactive", "INACTIVE"],
    ]);
    expect(response.totals).toMatchObject({
      matched: 3,
      warning: 1,
      healthy: 1,
      inactive: 1,
      critical: 0,
    });
    expect(response.items[0]?.reasons[0]).toMatchObject({
      severity: "HIGH",
      title: "Review SLA is breached",
      diagnosticsHref:
        "/platform/review-quality?view=backlog&sla=BREACHED&tenantId=tenant-breached",
    });
    expect(response.items[0]?.detailHref).toBe("/platform/tenants/tenant-breached/health");
  });

  it("pages with a keyset cursor that never repeats or skips a tenant", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.tenants = ["alpha", "bravo", "charlie", "delta"].map((name, index) =>
      tenantRow({ tenantId: `tenant-${index}`, name }),
    );

    const service = serviceFor(readModel);
    const first = await service.tenants({ sort: "NAME", order: "ASC", limit: "2" });
    expect(first.items.map((item) => item.name)).toEqual(["alpha", "bravo"]);
    expect(first.page).toMatchObject({ limit: 2, hasMore: true, sort: "NAME", order: "ASC" });

    const second = await service.tenants({
      sort: "NAME",
      order: "ASC",
      limit: "2",
      cursor: first.page.nextCursor!,
    });
    expect(second.items.map((item) => item.name)).toEqual(["charlie", "delta"]);
    expect(second.page.hasMore).toBe(false);
    expect(second.page.nextCursor).toBeNull();
  });

  it("reports the health sort direction it actually applied and honours a reversal", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.tenants = [
      tenantRow({ tenantId: "tenant-healthy", name: "Healthy" }),
      tenantRow({ tenantId: "tenant-stuck", name: "Stuck", stuck: 1 }),
    ];

    const service = serviceFor(readModel);
    const natural = await service.tenants({});
    expect(natural.page.order).toBe("ASC");
    expect(natural.items.map((item) => item.tenantId)).toEqual(["tenant-stuck", "tenant-healthy"]);

    const reversed = await service.tenants({ sort: "HEALTH", order: "DESC" });
    expect(reversed.page.order).toBe("DESC");
    expect(reversed.items.map((item) => item.tenantId)).toEqual(["tenant-healthy", "tenant-stuck"]);
  });

  it("filters by health and reports the filtered count separately from the population", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.tenants = [
      tenantRow({ tenantId: "tenant-healthy", name: "Healthy" }),
      tenantRow({ tenantId: "tenant-stuck", name: "Stuck", stuck: 2 }),
    ];

    const response = await serviceFor(readModel).tenants({ health: "WARNING" });

    expect(response.items.map((item) => item.tenantId)).toEqual(["tenant-stuck"]);
    expect(response.totals).toMatchObject({ matched: 1, healthy: 1, warning: 1 });
    expect(response.filters).toEqual({ search: null, health: "WARNING" });
  });

  it("rejects a tampered cursor instead of silently returning the first page", async () => {
    const service = serviceFor(new FakeDrilldownReadModel());

    await expect(service.tenants({ cursor: "not-a-cursor" })).rejects.toMatchObject({
      code: "CURSOR_INVALID",
      status: 400,
    });
  });

  it("marks every tenant section UNKNOWN and sanitizes the error when the source rejects", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.tenantFailure = new Error(`database password=${SECRET_SENTINEL}`);

    const response = await serviceFor(readModel).tenants({});
    const serialized = JSON.stringify(response);

    expect(response.partial).toBe(true);
    expect(response.problems).toEqual([
      {
        section: "TENANTS",
        code: "SOURCE_UNAVAILABLE",
        message: "Tenant data is temporarily unavailable.",
        retryable: true,
      },
    ]);
    expect(response.items).toEqual([]);
    expect(response.freshness.state).toBe("UNKNOWN");
    expect(serialized).not.toContain(SECRET_SENTINEL);
    expect(serialized).not.toContain("database password");
  });

  it("returns a tenant health detail with delivery components and 404s an unknown tenant", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.tenants = [
      tenantRow({ tenantId: "tenant-alpha", quarantinedFiles: 2, outboxDeadLetter: 1 }),
    ];
    readModel.tenantAgents = [
      {
        agentType: "A1_PROGRESS",
        runs: 30,
        terminal: 30,
        completed: 24,
        failed: 4,
        degraded: 2,
        rejected: 0,
        stuck: 0,
        lastSuccessAt: new Date("2026-08-11T03:00:00.000Z"),
        costMicroUsd: 900,
      },
    ];

    const service = serviceFor(readModel);
    const response = await service.tenantHealth("tenant-alpha", {});

    expect(response.tenant).toMatchObject({ tenantId: "tenant-alpha", health: "WARNING" });
    expect(response.users).toMatchObject({ activeAccounts: 5, loggedIn24h: 2, neverLoggedIn: 1 });
    expect(response.agents.items[0]).toMatchObject({
      agentType: "A1_PROGRESS",
      completionPercent: 80,
      runsHref: "/platform/agent-runs?tenantId=tenant-alpha&agentType=A1_PROGRESS",
    });
    expect(
      response.delivery.components.map((component) => [component.component, component.state]),
    ).toEqual([
      ["OUTBOX", "DEGRADED"],
      ["NOTIFICATION", "HEALTHY"],
      ["ARTIFACT_METADATA", "DEGRADED"],
    ]);
    expect(response.storage).toMatchObject({ totalBytes: 2_048, quarantinedCount: 2 });

    await expect(service.tenantHealth("tenant-missing", {})).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      status: 404,
    });
  });
});

describe("platform agent drill-down", () => {
  it("withholds a completion percentage below the minimum sample", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.agents = [
      agentRow({ agentType: "A1_PROGRESS", runs: 30, terminal: 30, completed: 27 }),
      agentRow({ agentType: "A2_FORECAST", runs: 5, terminal: 5, completed: 4, retriedRuns: 0 }),
    ];

    const response = await serviceFor(readModel).agents({});

    const bySample = new Map(response.items.map((item) => [item.agentType, item]));
    expect(bySample.get("A1_PROGRESS")).toMatchObject({
      completionPercent: 90,
      minimumSample: 20,
      state: "ACTIVE",
    });
    expect(bySample.get("A2_FORECAST")).toMatchObject({
      completionPercent: null,
      minimumSample: 20,
    });
    expect(response.totals).toMatchObject({ matched: 2, active: 2, degraded: 0 });
  });

  it("marks an agent DEGRADED on stuck runs and surfaces its diagnostics link", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.agents = [
      agentRow({ stuck: 2, oldestStuckAt: new Date("2026-08-11T03:10:00.000Z") }),
    ];

    const response = await serviceFor(readModel).agents({});

    expect(response.items[0]).toMatchObject({ state: "DEGRADED", stuck: 2 });
    expect(response.items[0]?.reasons[0]).toMatchObject({
      severity: "HIGH",
      title: "Agent runs are stuck",
      diagnosticsHref: "/platform/agent-runs?stuck=true&agentType=A1_PROGRESS",
    });
  });

  it("breaks an agent down by failure category, tenant and model", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.agentDetail = {
      failures: [
        {
          failureCategory: "PROVIDER",
          count: 3,
          lastObservedAt: new Date("2026-08-11T03:40:00.000Z"),
        },
        { failureCategory: "TIMEOUT", count: 1, lastObservedAt: null },
      ],
      tenants: [
        {
          tenantId: "tenant-alpha",
          tenantName: "Alpha",
          runs: 30,
          terminal: 30,
          completed: 27,
          failed: 2,
          degraded: 1,
          rejected: 0,
          costMicroUsd: 4_200,
        },
      ],
      models: [
        {
          provider: "anthropic",
          modelId: "claude-sonnet-5",
          runs: 30,
          costMicroUsd: 4_200,
          inputTokens: 1_000,
          outputTokens: 500,
        },
      ],
    };

    const service = serviceFor(readModel);
    const response = await service.agentDetail("A1_PROGRESS", {});

    expect(response.agent).toMatchObject({ agentType: "A1_PROGRESS", completionPercent: 90 });
    expect(response.failureBreakdown.items).toEqual([
      {
        failureCategory: "PROVIDER",
        count: 3,
        sharePercent: 75,
        lastObservedAt: "2026-08-11T03:40:00.000Z",
      },
      { failureCategory: "TIMEOUT", count: 1, sharePercent: 25, lastObservedAt: null },
    ]);
    expect(response.tenantBreakdown.items[0]).toMatchObject({
      tenantId: "tenant-alpha",
      completionPercent: 90,
      healthHref: "/platform/tenants/tenant-alpha/health",
    });
    expect(response.models.items[0]).toMatchObject({ modelId: "claude-sonnet-5", runs: 30 });

    await expect(service.agentDetail("A9_UNKNOWN", {})).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      status: 404,
    });
  });

  it("lists runs with the cost basis, stuck flag and a keyset cursor", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.runs = [
      runRow({ runId: "run-1", actualCostMicroUsd: 1_100 }),
      runRow({
        runId: "run-2",
        status: "RUNNING",
        completedAt: null,
        actualCostMicroUsd: null,
        startedAt: new Date("2026-08-11T03:00:00.000Z"),
      }),
      runRow({ runId: "run-3", startedAt: new Date("2026-08-11T02:00:00.000Z") }),
    ];

    const response = await serviceFor(readModel).agentRuns({ limit: "2" });

    expect(response.items.map((item) => [item.runId, item.costBasis, item.stuck])).toEqual([
      ["run-1", "ACTUAL", false],
      ["run-2", "ESTIMATED", true],
    ]);
    expect(response.items[0]?.costMicroUsd).toBe(1_100);
    expect(response.items[1]?.costMicroUsd).toBe(900);
    expect(response.page).toMatchObject({ limit: 2, hasMore: true, sort: "STARTED_AT" });
    expect(readModel.lastRunFilter).toMatchObject({ limit: 3, order: "DESC" });
    expect(response.items[0]?.diagnosticsHref).toBe("/platform/agent-runs/run-1/diagnostics");
  });

  it("passes server-side run filters straight through to the query", async () => {
    const readModel = new FakeDrilldownReadModel();

    await serviceFor(readModel).agentRuns({
      tenantId: "tenant-alpha",
      agentType: "A1_PROGRESS",
      outcome: "NON_COMPLETION",
      failureCategory: "PROVIDER",
      stuck: "true",
      order: "ASC",
    });

    expect(readModel.lastRunFilter).toMatchObject({
      tenantId: "tenant-alpha",
      agentType: "A1_PROGRESS",
      outcome: "NON_COMPLETION",
      failureCategory: "PROVIDER",
      stuck: true,
      order: "ASC",
    });
  });

  it("returns run diagnostics without any prompt, output or tool payload", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.diagnostics = {
      run: {
        ...runRow({ status: "FAILED", failureCategory: "PROVIDER" }),
        requestId: "request-1",
        eventId: null,
        traceId: "trace-1",
        toolBundleVersion: "tools.v2",
        outputSchemaVersion: 3,
        dataSnapshotVersion: "snapshot.v9",
        outputSha256: "a".repeat(64),
        contentLoggingEnabled: false,
        asOf: new Date("2026-08-11T03:29:00.000Z"),
        inputTokens: 1_200,
        outputTokens: 400,
        cachedInputTokens: 100,
        reasoningTokens: 50,
        validationState: "FAILED",
        validationIssueCount: 2,
      },
      toolCalls: [
        {
          id: "call-1",
          toolName: "read_progress",
          status: "SUCCEEDED",
          stepNumber: 1,
          durationMs: 120,
          occurredAt: new Date("2026-08-11T03:30:30.000Z"),
        },
      ],
      toolCallTotal: 4,
    };
    Object.assign(readModel.diagnostics.run, {
      request: SECRET_SENTINEL,
      output: SECRET_SENTINEL,
      researchText: SECRET_SENTINEL,
      errorMessage: SECRET_SENTINEL,
    });
    Object.assign(readModel.diagnostics.toolCalls[0]!, {
      input: SECRET_SENTINEL,
      output: SECRET_SENTINEL,
    });

    const response = await serviceFor(readModel).agentRunDiagnostics("run-1");
    const serialized = JSON.stringify(response);

    expect(response.run).toMatchObject({ runId: "run-1", status: "FAILED" });
    expect(response.usage).toMatchObject({ inputTokens: 1_200, actualCostMicroUsd: 1_100 });
    expect(response.validation).toEqual({ state: "FAILED", issueCount: 2 });
    expect(response.toolCalls).toMatchObject({ total: 4, truncated: true });
    expect(response.toolCalls.items[0]).toEqual({
      id: "call-1",
      toolName: "read_progress",
      status: "SUCCEEDED",
      sequence: 1,
      latencyMs: 120,
      retryCount: 0,
      startedAt: "2026-08-11T03:30:30.000Z",
    });
    expect(response.redaction.redactedFields).toEqual(
      expect.arrayContaining(["request", "output", "researchText", "errorMessage"]),
    );
    expect(serialized).not.toContain(SECRET_SENTINEL);
  });

  it("404s diagnostics for a run that does not exist", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.diagnostics = null;

    await expect(serviceFor(readModel).agentRunDiagnostics("run-missing")).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      status: 404,
    });
  });
});

describe("platform review drill-down", () => {
  it("summarises the backlog, ageing buckets and correction rate", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.reviewSummary = {
      totals: {
        waiting: 9,
        breached: 3,
        withoutDueAt: 1,
        draft: 4,
        oldestWaitingAt: new Date("2026-08-04T00:00:00.000Z"),
        oldestBreachedDueAt: new Date("2026-08-10T00:00:00.000Z"),
      },
      buckets: [
        { bucket: "UNDER_24H", waiting: 5, breached: 0 },
        { bucket: "OVER_7D", waiting: 4, breached: 3 },
      ],
      tenants: [
        {
          tenantId: "tenant-alpha",
          tenantName: "Alpha",
          waiting: 9,
          breached: 3,
          oldestWaitingAt: new Date("2026-08-04T00:00:00.000Z"),
        },
      ],
      targets: [{ targetType: "DAILY_REPORT", waiting: 9, breached: 3 }],
      throughput: { decided: 20, approved: 16, rejected: 4, emergencyOverrides: 1, corrected: 5 },
    };

    const response = await serviceFor(readModel).reviewSummary({});

    expect(response.backlog).toMatchObject({ waiting: 9, breached: 3, draft: 4 });
    expect(response.ageBuckets.items).toEqual([
      { bucket: "UNDER_24H", waiting: 5, breached: 0 },
      { bucket: "H24_TO_72H", waiting: 0, breached: 0 },
      { bucket: "D3_TO_D7", waiting: 0, breached: 0 },
      { bucket: "OVER_7D", waiting: 4, breached: 3 },
    ]);
    expect(response.throughput).toMatchObject({
      decided: 20,
      corrected: 5,
      correctionRatePercent: 25,
      emergencyOverrides: 1,
    });
    expect(response.byTenant.items[0]?.backlogHref).toBe(
      "/platform/review-quality?view=backlog&tenantId=tenant-alpha",
    );
  });

  it("classifies backlog SLA state and never exposes review content", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.backlog = [
      {
        reviewTaskId: "review-breached",
        tenantId: "tenant-alpha",
        tenantName: "Alpha",
        projectId: "project-1",
        targetType: "DAILY_REPORT",
        targetVersion: 2,
        assignedRole: "SITE_ENGINEER",
        assignedUserId: "user-1",
        status: "REVIEW_REQUIRED",
        createdAt: new Date("2026-08-09T00:00:00.000Z"),
        dueAt: new Date("2026-08-10T00:00:00.000Z"),
      },
      {
        reviewTaskId: "review-due-soon",
        tenantId: "tenant-alpha",
        tenantName: "Alpha",
        projectId: "project-1",
        targetType: "DAILY_REPORT",
        targetVersion: 3,
        assignedRole: "SITE_ENGINEER",
        assignedUserId: null,
        status: "REVIEW_REQUIRED",
        createdAt: new Date("2026-08-11T00:00:00.000Z"),
        dueAt: new Date("2026-08-11T12:00:00.000Z"),
      },
      {
        reviewTaskId: "review-no-due",
        tenantId: "tenant-alpha",
        tenantName: "Alpha",
        projectId: "project-1",
        targetType: "DAILY_REPORT",
        targetVersion: 4,
        assignedRole: "SITE_ENGINEER",
        assignedUserId: null,
        status: "REVIEW_REQUIRED",
        createdAt: new Date("2026-08-11T02:00:00.000Z"),
        dueAt: null,
      },
    ];
    Object.assign(readModel.backlog[0]!, { payload: SECRET_SENTINEL });

    const response = await serviceFor(readModel).reviewBacklog({});

    expect(response.items.map((item) => [item.reviewTaskId, item.sla])).toEqual([
      ["review-breached", "BREACHED"],
      ["review-due-soon", "DUE_SOON"],
      ["review-no-due", "NO_DUE_DATE"],
    ]);
    expect(response.items[0]?.waitingSeconds).toBe(2 * 24 * 60 * 60 + 4 * 60 * 60);
    expect(response.items[1]?.assigned).toBe(false);
    expect(response.filters).toMatchObject({ sla: "ALL" });
    expect(readModel.lastBacklogFilter).toMatchObject({ order: "ASC", sla: "ALL" });
    expect(JSON.stringify(response)).not.toContain(SECRET_SENTINEL);
  });
});

describe("platform usage, system health and audit drill-down", () => {
  it("reports actual/estimated coverage and no budget progress model", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.usage = [
      {
        key: "tenant-alpha",
        label: "Alpha",
        runs: 8,
        costMicroUsd: 3_000,
        actualMicroUsd: 2_000,
        estimatedMicroUsd: 1_000,
        actualRunCount: 6,
        estimatedRunCount: 2,
        inputTokens: 900,
        outputTokens: 300,
        cachedInputTokens: 100,
        reasoningTokens: 50,
      },
      {
        key: "tenant-bravo",
        label: "Bravo",
        runs: 2,
        costMicroUsd: 1_000,
        actualMicroUsd: 0,
        estimatedMicroUsd: 1_000,
        actualRunCount: 0,
        estimatedRunCount: 2,
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
    ];

    const response = await serviceFor(readModel).usage({ groupBy: "TENANT" });

    expect(response.totals).toMatchObject({
      runs: 10,
      costMicroUsd: 4_000,
      actualCoveragePercent: 60,
      budgetModel: "NOT_CONFIGURED",
    });
    expect(response.groups.items[0]).toMatchObject({
      key: "tenant-alpha",
      costSharePercent: 75,
      actualCoveragePercent: 75,
      href: "/platform/tenants/tenant-alpha/health",
    });
    expect(response.groups.items[1]?.actualCoveragePercent).toBe(0);
    expect(readModel.lastUsageInput).toMatchObject({ groupBy: "TENANT" });
  });

  it("derives the system state from component evidence and lists tenant impact", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.systemDetail = {
      outboxByType: [
        {
          eventType: "REPORT_SUBMITTED",
          pending: 4,
          stalled: 2,
          failed: 0,
          deadLetter: 1,
          oldestEvidenceAt: new Date("2026-08-11T03:00:00.000Z"),
        },
      ],
      tenantImpact: [
        {
          tenantId: "tenant-alpha",
          tenantName: "Alpha",
          outboxStalled: 2,
          outboxDeadLetter: 1,
          notificationFailed: 0,
          artifactQuarantined: 0,
        },
      ],
    };
    const overview = new FakeOverviewReadModel();
    overview.system = [
      {
        kind: "OUTBOX",
        scopeKind: "GLOBAL",
        tenantId: null,
        pendingCount: 4,
        stalledCount: 2,
        failedCount: 0,
        deadLetterCount: 1,
        quarantinedCount: 0,
        oldestEvidenceAt: new Date("2026-08-11T03:00:00.000Z"),
      },
      {
        kind: "NOTIFICATION",
        scopeKind: "GLOBAL",
        tenantId: null,
        pendingCount: 0,
        stalledCount: 0,
        failedCount: 0,
        deadLetterCount: 0,
        quarantinedCount: 0,
        oldestEvidenceAt: null,
      },
      {
        kind: "FILE",
        scopeKind: "GLOBAL",
        tenantId: null,
        pendingCount: 0,
        stalledCount: 0,
        failedCount: 0,
        deadLetterCount: 0,
        quarantinedCount: 0,
        oldestEvidenceAt: null,
      },
    ];

    const response = await serviceFor(readModel, overview).systemHealth({});

    expect(response.state).toBe("DEGRADED");
    expect(response.components.map((item) => [item.component, item.state])).toEqual([
      ["API", "HEALTHY"],
      ["POSTGRES", "HEALTHY"],
      ["OUTBOX", "DEGRADED"],
      ["ARTIFACT_METADATA", "HEALTHY"],
      ["NOTIFICATION", "HEALTHY"],
      ["AI_PROVIDER", "UNKNOWN"],
    ]);
    expect(response.components.at(-1)).toMatchObject({
      component: "AI_PROVIDER",
      required: false,
      diagnosticsHref: "/platform/system-health?component=AI_PROVIDER",
    });
    expect(response.outboxByType.items[0]).toMatchObject({
      eventType: "REPORT_SUBMITTED",
      deadLetter: 1,
    });
    expect(response.tenantImpact.items[0]?.healthHref).toBe(
      "/platform/tenants/tenant-alpha/health",
    );
    expect(response.window.kind).toBe("SNAPSHOT");
  });

  it("pages the audit trail and keeps only hash evidence, never payloads", async () => {
    const readModel = new FakeDrilldownReadModel();
    readModel.audit = [
      {
        id: "audit-2",
        actorPrincipalId: "platform-admin",
        actorDisplayName: "Platform Admin",
        actorRole: "PLATFORM_SUPER_ADMIN",
        tenantId: "tenant-alpha",
        action: "PLATFORM_TENANT_HEALTH_READ",
        entityType: "PLATFORM_TENANT",
        entityId: "tenant-alpha",
        result: "SUCCESS",
        reason: "Investigated with Bearer secret-token-value",
        correlationId: "correlation-2",
        beforeHash: "b".repeat(64),
        afterHash: "c".repeat(64),
        occurredAt: new Date("2026-08-11T03:59:00.000Z"),
      },
      {
        id: "audit-1",
        actorPrincipalId: null,
        actorDisplayName: null,
        actorRole: null,
        tenantId: null,
        action: "PLATFORM_OVERVIEW_READ",
        entityType: "PLATFORM_OVERVIEW",
        entityId: "overview-1",
        result: "DENIED",
        reason: "Missing permission; Bearer secret-token-value",
        correlationId: "correlation-1",
        beforeHash: null,
        afterHash: null,
        occurredAt: new Date("2026-08-11T03:58:00.000Z"),
      },
    ];
    Object.assign(readModel.audit[0]!, { metadata: SECRET_SENTINEL });

    const response = await serviceFor(readModel).auditLogs({ limit: "1", result: "SUCCESS" });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      id: "audit-2",
      result: "SUCCESS",
      beforeHash: "b".repeat(64),
      reason: "Investigated with Bearer [redacted]",
    });
    expect(response.page).toMatchObject({ hasMore: true, sort: "OCCURRED_AT", order: "DESC" });
    expect(response.page.nextCursor).not.toBeNull();
    expect(readModel.lastAuditFilter).toMatchObject({
      source: "ALL",
      actorRole: null,
      result: "SUCCESS",
      limit: 2,
    });
    expect(JSON.stringify(response)).not.toContain(SECRET_SENTINEL);
    expect(JSON.stringify(response)).not.toContain("secret-token-value");
  });
});

describe("platform drill-down boundary", () => {
  const drilldownPaths = [
    "/platform/v1/tenants",
    "/platform/v1/tenants/tenant-alpha/health",
    "/platform/v1/agents",
    "/platform/v1/agents/A1_PROGRESS",
    "/platform/v1/agent-runs",
    "/platform/v1/agent-runs/run-1/diagnostics",
    "/platform/v1/reviews/summary",
    "/platform/v1/reviews/backlog",
    "/platform/v1/usage",
    "/platform/v1/system-health",
    "/platform/v1/audit-logs",
  ] as const;

  it("denies every drill-down route to a Company Admin and serves them to a platform principal", async () => {
    const fixture = await buildPlatformTestFixture();
    const readModel = new FakeDrilldownReadModel();
    readModel.diagnostics = {
      run: {
        ...runRow(),
        requestId: null,
        eventId: null,
        traceId: null,
        toolBundleVersion: "tools.v1",
        outputSchemaVersion: 1,
        dataSnapshotVersion: "snapshot.v1",
        outputSha256: null,
        contentLoggingEnabled: false,
        asOf: new Date("2026-08-11T03:29:00.000Z"),
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        validationState: "UNKNOWN",
        validationIssueCount: null,
      },
      toolCalls: [],
      toolCallTotal: 0,
    };
    const app = createPhase9Api({
      auth: fixture.tenant.auth,
      platformAuth: fixture.platformAuth,
      platformDrilldown: serviceFor(readModel),
      projects: fixture.tenant.projects,
      commands: fixture.tenant.commands,
      reviews: fixture.tenant.reviews,
      artifacts: fixture.tenant.artifacts,
      objectStore: fixture.tenant.objectStore,
    });
    const runtime = await startPhase9TestServer(app);
    try {
      const companyAdmin = await loginPhase9(runtime.baseUrl, "alpha", "admin@alpha.test");
      for (const path of drilldownPaths) {
        const denied = await fetch(`${runtime.baseUrl}${path}`, {
          headers: { authorization: `Bearer ${companyAdmin.accessToken}` },
        });
        expect(denied.status, path).toBe(403);
        expect(await denied.json()).toMatchObject({ error: { code: "AUTH_FORBIDDEN" } });
      }
      expect(readModel.calls).toHaveLength(0);

      const platform = await loginPlatform(runtime.baseUrl);
      for (const path of drilldownPaths) {
        const allowed = await fetch(`${runtime.baseUrl}${path}`, {
          headers: { authorization: `Bearer ${platform.accessToken}` },
        });
        expect(allowed.status, path).toBe(200);
      }
      expect(readModel.calls.length).toBeGreaterThan(0);
    } finally {
      await runtime.close();
    }
  });

  it("publishes every drill-down path in the OpenAPI document", async () => {
    const fixture = await buildPlatformTestFixture();
    const app = createPhase9Api({
      auth: fixture.tenant.auth,
      platformAuth: fixture.platformAuth,
      platformDrilldown: serviceFor(new FakeDrilldownReadModel()),
      projects: fixture.tenant.projects,
      commands: fixture.tenant.commands,
      reviews: fixture.tenant.reviews,
      artifacts: fixture.tenant.artifacts,
      objectStore: fixture.tenant.objectStore,
    });
    const runtime = await startPhase9TestServer(app);
    try {
      const document = (await (await fetch(`${runtime.baseUrl}/openapi.json`)).json()) as {
        paths: Record<string, unknown>;
      };
      expect(Object.keys(document.paths)).toEqual(
        expect.arrayContaining([
          "/platform/v1/tenants",
          "/platform/v1/tenants/{tenantId}/health",
          "/platform/v1/agents",
          "/platform/v1/agents/{agentType}",
          "/platform/v1/agent-runs",
          "/platform/v1/agent-runs/{runId}/diagnostics",
          "/platform/v1/reviews/summary",
          "/platform/v1/reviews/backlog",
          "/platform/v1/usage",
          "/platform/v1/system-health",
          "/platform/v1/audit-logs",
        ]),
      );
    } finally {
      await runtime.close();
    }
  });

  it("keeps drill-down queries parameterized and free of tenant content columns", () => {
    const source = readFileSync(
      new URL("../../src/backend/platform-drilldown-read-model.ts", import.meta.url),
      "utf8",
    );
    const queryFragments = source.split("this.client.$queryRaw").slice(1);

    expect(queryFragments.length).toBeGreaterThan(0);
    expect(source).not.toMatch(/\$(?:queryRaw|executeRaw)Unsafe/u);
    for (const fragment of queryFragments) {
      expect(fragment.slice(0, 180).replace(/\s+/gu, "")).toMatch(/^(?:<[^>]+>)?\(Prisma\.sql`/u);
    }
    for (const forbiddenColumn of [
      'ar."request"',
      "ar.request",
      'ar."output"',
      'ar."researchText"',
      'ar."errorMessage"',
      'tc."input"',
      'tc."output"',
      'tc."errorMessage"',
      'oe."payload"',
      'oe."headers"',
      'n."payload"',
      'pal."metadata"',
      'rt."sourceHash"',
    ]) {
      expect(source, forbiddenColumn).not.toContain(forbiddenColumn);
    }
    // `validation` is read for its shape only: an `ok` flag and an issue count.
    expect(source).not.toMatch(/ar\.validation(?!\s*(?:IS NULL|\)))/u);
  });

  it.each([
    [
      "preset mixed with custom range",
      { window: "24h", from: "2026-08-10T04:00:00Z", to: "2026-08-11T04:00:00Z" },
    ],
    ["only one custom boundary", { from: "2026-08-10T04:00:00Z" }],
    ["empty custom range", { from: "2026-08-11T04:00:00Z", to: "2026-08-11T04:00:00Z" }],
    ["range longer than 90 days", { from: "2026-01-01T00:00:00Z", to: "2026-08-11T04:00:00Z" }],
  ])("rejects an invalid %s on every list endpoint", async (_label, query) => {
    const service = serviceFor(new FakeDrilldownReadModel());

    await expect(service.tenants(query)).rejects.toMatchObject({ status: 400 });
    await expect(service.agents(query)).rejects.toMatchObject({ status: 400 });
    await expect(service.agentRuns(query)).rejects.toMatchObject({ status: 400 });
    await expect(service.reviewBacklog(query)).rejects.toMatchObject({ status: 400 });
    await expect(service.auditLogs(query)).rejects.toMatchObject({ status: 400 });
  });
});
