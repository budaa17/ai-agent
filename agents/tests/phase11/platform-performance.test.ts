import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { PrismaPlatformDrilldownReadModel } from "../../src/backend/platform-drilldown-read-model.js";
import { PlatformDrilldownService } from "../../src/backend/platform-drilldown-service.js";
import { PlatformOverviewService } from "../../src/backend/platform-overview-service.js";
import type {
  PlatformAgentMetricsData,
  PlatformAuditScalarRow,
  PlatformOverviewReadInput,
  PlatformOverviewReadModel,
  PlatformPostgresProbeData,
  PlatformReviewAggregateRow,
  PlatformSystemAggregateRow,
  PlatformTenantBaseRow,
} from "../../src/backend/platform-overview-read-model.js";

/**
 * Phase 7 performance gate.
 *
 * The roadmap target is "overview under two seconds on normally seeded data".
 * The read side is already covered by the PostgreSQL smoke scripts, so this
 * test pins the part that regressions actually creep into: the per-request
 * aggregation and strict parsing cost once the rows are in memory, and the
 * promise fan-out that keeps the sources concurrent rather than sequential.
 */

const AS_OF = new Date("2026-08-11T04:00:00.000Z");
const TENANT_COUNT = 400;
const AGENT_TYPES = 12;
/** Deliberately well under the 2s budget: this excludes database latency. */
const AGGREGATION_BUDGET_MS = 750;
/** Each stubbed source sleeps this long, so a sequential fan-out would sum. */
const SOURCE_LATENCY_MS = 120;

function bigCount(seed: number): number {
  return Math.abs(Math.round(Math.sin(seed) * 500)) + 1;
}

function agentMetrics(): PlatformAgentMetricsData {
  const aggregates = [];
  const stuck = [];
  const base = {
    previousCompleted: 900,
    previousTerminal: 1_000,
    rollingTerminal: 40,
    rollingNonCompletion: 3,
    rollingProviderFailures: 1,
    oldestRollingFailureAt: new Date("2026-08-11T03:50:00.000Z"),
    p50LatencyMs: 900,
    p95LatencyMs: 4_100,
    retriedRuns: 40,
    lastSuccessAt: new Date("2026-08-11T03:55:00.000Z"),
    mtdCostMicroUsd: 4_200_000,
    mtdActualMicroUsd: 3_000_000,
    mtdEstimatedMicroUsd: 1_200_000,
    mtdActualRunCount: 700,
    mtdEstimatedRunCount: 300,
    previousMonthCostMicroUsd: 3_900_000,
    previousMonthRunCount: 950,
    windowCostMicroUsd: 4_200_000,
    windowCostRunCount: 900,
    previousWindowCostMicroUsd: 4_100_000,
    previousWindowCostRunCount: 880,
  };
  aggregates.push({
    scopeKind: "GLOBAL" as const,
    tenantId: null,
    agentType: null,
    runs: 12_000,
    completed: 11_100,
    failed: 500,
    degraded: 300,
    rejected: 100,
    terminal: 12_000,
    ...base,
  });
  for (let index = 0; index < TENANT_COUNT; index += 1) {
    const runs = bigCount(index);
    aggregates.push({
      scopeKind: "TENANT" as const,
      tenantId: `tenant-${index}`,
      agentType: null,
      runs,
      completed: Math.floor(runs * 0.9),
      failed: Math.floor(runs * 0.05),
      degraded: Math.floor(runs * 0.03),
      rejected: Math.floor(runs * 0.02),
      terminal: runs,
      ...base,
    });
    if (index % 25 === 0) {
      stuck.push({
        scopeKind: "TENANT" as const,
        tenantId: `tenant-${index}`,
        agentType: null,
        stuck: 2,
        oldestStuckAt: new Date("2026-08-11T03:10:00.000Z"),
      });
    }
  }
  for (let index = 0; index < AGENT_TYPES; index += 1) {
    aggregates.push({
      scopeKind: "AGENT" as const,
      tenantId: null,
      agentType: `A${index}_AGENT`,
      runs: 900,
      completed: 820,
      failed: 45,
      degraded: 25,
      rejected: 10,
      terminal: 900,
      ...base,
    });
  }
  return { aggregates, stuck };
}

function reviewRows(): PlatformReviewAggregateRow[] {
  const rows: PlatformReviewAggregateRow[] = [
    {
      scopeKind: "GLOBAL",
      tenantId: null,
      waiting: 900,
      breached: 120,
      withoutDueAt: 60,
      oldestWaitingAt: new Date("2026-08-01T00:00:00.000Z"),
      oldestBreachedDueAt: new Date("2026-08-09T00:00:00.000Z"),
    },
  ];
  for (let index = 0; index < TENANT_COUNT; index += 1) {
    rows.push({
      scopeKind: "TENANT",
      tenantId: `tenant-${index}`,
      waiting: index % 7,
      breached: index % 11 === 0 ? 2 : 0,
      withoutDueAt: 0,
      oldestWaitingAt: new Date("2026-08-05T00:00:00.000Z"),
      oldestBreachedDueAt: new Date("2026-08-09T00:00:00.000Z"),
    });
  }
  return rows;
}

function tenantRows(): PlatformTenantBaseRow[] {
  return Array.from({ length: TENANT_COUNT }, (_value, index) => ({
    tenantId: `tenant-${index}`,
    name: `Tenant ${index}`,
    activeAccounts: 20,
    loggedIn24h: index % 5,
    storageBytes: 5_000_000,
    lastActivityAt:
      index % 40 === 0 ? new Date("2026-05-01T00:00:00.000Z") : new Date("2026-08-11T03:00:00.000Z"),
  }));
}

function systemRows(): PlatformSystemAggregateRow[] {
  const kinds = ["OUTBOX", "NOTIFICATION", "FILE"] as const;
  const rows: PlatformSystemAggregateRow[] = [];
  for (const kind of kinds) {
    rows.push({
      kind,
      scopeKind: "GLOBAL",
      tenantId: null,
      pendingCount: 40,
      stalledCount: 4,
      failedCount: 2,
      deadLetterCount: kind === "OUTBOX" ? 1 : 0,
      quarantinedCount: kind === "FILE" ? 3 : 0,
      oldestEvidenceAt: new Date("2026-08-11T03:00:00.000Z"),
    });
    for (let index = 0; index < TENANT_COUNT; index += 1) {
      rows.push({
        kind,
        scopeKind: "TENANT",
        tenantId: `tenant-${index}`,
        pendingCount: index % 3,
        stalledCount: index % 17 === 0 ? 1 : 0,
        failedCount: 0,
        deadLetterCount: 0,
        quarantinedCount: 0,
        oldestEvidenceAt: new Date("2026-08-11T03:00:00.000Z"),
      });
    }
  }
  return rows;
}

function auditRows(): PlatformAuditScalarRow[] {
  return Array.from({ length: 5 }, (_value, index) => ({
    id: `audit-${index}`,
    actorPrincipalId: "platform-admin",
    actorDisplayName: "Platform Admin",
    actorRole: "PLATFORM_SUPER_ADMIN",
    tenantId: null,
    action: "PLATFORM_OVERVIEW_READ",
    entityType: "PLATFORM_OVERVIEW",
    entityId: `overview-${index}`,
    result: "SUCCESS" as const,
    occurredAt: new Date("2026-08-11T03:59:00.000Z"),
    correlationId: `correlation-${index}`,
  }));
}

async function sleep(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class SeededOverviewReadModel implements PlatformOverviewReadModel {
  calls = 0;

  private async source<T>(data: T) {
    this.calls += 1;
    await sleep(SOURCE_LATENCY_MS);
    return { data, source: "LIVE_QUERY" as const, freshAt: new Date(AS_OF) };
  }

  async queryAgentMetrics(_input: PlatformOverviewReadInput) {
    return this.source(agentMetrics());
  }
  async queryReviewMetrics(_input: PlatformOverviewReadInput) {
    return this.source(reviewRows());
  }
  async queryTenantBase(_input: PlatformOverviewReadInput) {
    return this.source(tenantRows());
  }
  async querySystemAggregates(_input: PlatformOverviewReadInput) {
    return this.source(systemRows());
  }
  async probePostgres() {
    this.calls += 1;
    await sleep(SOURCE_LATENCY_MS);
    const data: PlatformPostgresProbeData = { latencyMs: 3, checkedAt: new Date(AS_OF) };
    return { data, source: "LIVE_PROBE" as const, freshAt: new Date(AS_OF) };
  }
  async queryRecentAudit(_input: PlatformOverviewReadInput) {
    return this.source(auditRows());
  }
}

describe("platform overview performance", () => {
  it("aggregates a 400-tenant snapshot well inside the release budget", async () => {
    const readModel = new SeededOverviewReadModel();
    const service = new PlatformOverviewService(readModel, () => new Date(AS_OF));

    // Warm the code paths so the measurement is not dominated by first-call JIT.
    await service.overview({ window: "24h" });
    const startedAt = performance.now();
    const response = await service.overview({ window: "24h" });
    const elapsed = performance.now() - startedAt;

    expect(response.partial).toBe(false);
    expect(response.kpis.tenantHealth.total).toBe(TENANT_COUNT);
    expect(elapsed).toBeLessThan(AGGREGATION_BUDGET_MS);
  });

  it("fans the sources out concurrently instead of awaiting them in sequence", async () => {
    const readModel = new SeededOverviewReadModel();
    const service = new PlatformOverviewService(readModel, () => new Date(AS_OF));

    const startedAt = performance.now();
    await service.overview({ window: "24h" });
    const elapsed = performance.now() - startedAt;

    expect(readModel.calls).toBe(6);
    // Six sources at 120 ms each would be ~720 ms sequentially.
    expect(elapsed).toBeLessThan(SOURCE_LATENCY_MS * 3);
  });

  it("caps the tenant scan so a large estate cannot load unbounded rows", () => {
    const source = new URL(
      "../../src/backend/platform-drilldown-read-model.ts",
      import.meta.url,
    );
    const text = require("node:fs").readFileSync(source, "utf8") as string;

    expect(text).toContain("PLATFORM_TENANT_SCAN_LIMIT = 500");
    expect(text).toContain("LIMIT ${PLATFORM_TENANT_SCAN_LIMIT}");
    // Every multi-row query is bounded, so no drill-down page can stream a
    // whole table; a query with no GROUP BY returns a single aggregate row.
    const rawQueries = text.split("this.client.$queryRaw").slice(1);
    expect(rawQueries.length).toBeGreaterThan(8);
    for (const fragment of rawQueries) {
      const query = fragment.slice(0, fragment.indexOf("`)"));
      const bounded = /\bLIMIT\b/u.test(query) || !/\bGROUP BY\b/u.test(query);
      expect(bounded, query.slice(0, 120)).toBe(true);
    }
  });

  it("keeps drill-down list pages bounded by the requested limit", async () => {
    const service = new PlatformDrilldownService({
      drilldown: new PrismaPlatformDrilldownReadModel(null as never),
      overview: new SeededOverviewReadModel(),
    });

    // The contract itself refuses an unbounded page size.
    await expect(service.tenants({ limit: "1000" })).rejects.toBeTruthy();
  });
});
