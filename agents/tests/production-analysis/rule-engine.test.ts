import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_RULE_GRAPHS,
  evaluateRuleThreshold,
  invalidateTenantRuleGraphs,
  loadTenantRuleGraphs,
  type JdmRuleGraph,
} from "../../src/production-analysis/rule-engine.js";

const THRESHOLD_RULE_IDS = [
  "COST_AHEAD_OF_PROGRESS",
  "MATERIAL_OVERUSE",
  "MISSING_DAILY_REPORT",
  "OVERDUE_WORK_ITEM",
  "PRODUCTIVITY_DECLINE",
  "STOCK_SHORTAGE",
  "SUBCONTRACTOR_DEVIATION",
] as const;

function tenantGraph(severity: string): JdmRuleGraph {
  const graph = structuredClone(DEFAULT_RULE_GRAPHS.MATERIAL_OVERUSE);
  graph.nodes[1].content.rules = [{ _id: "row-1", match: "true", severity }];
  return graph;
}

function fakePrisma(rows: Array<{ ruleId: string; jdmGraph: JdmRuleGraph }>): {
  prisma: PrismaClient;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn(async () =>
    rows.map((row, index) => ({
      id: `version-${index}`,
      jdmGraph: row.jdmGraph,
      catalog: { ruleId: row.ruleId },
    })),
  );
  return {
    findMany,
    prisma: { ruleCatalogVersion: { findMany } } as unknown as PrismaClient,
  };
}

describe("DET-14 JDM rule engine", () => {
  beforeEach(() => {
    for (const tenantId of ["tenant-alpha", "tenant-beta"]) {
      invalidateTenantRuleGraphs(tenantId);
    }
  });

  it("ships a decision table for every threshold rule", () => {
    expect(Object.keys(DEFAULT_RULE_GRAPHS).sort()).toEqual([...THRESHOLD_RULE_IDS]);
    for (const ruleId of THRESHOLD_RULE_IDS) {
      const graph = DEFAULT_RULE_GRAPHS[ruleId];
      expect(graph.nodes[0].type).toBe("inputNode");
      expect(graph.nodes[1].type).toBe("decisionTableNode");
      expect(graph.nodes[2].type).toBe("outputNode");
      expect(graph.nodes[1].content.hitPolicy).toBe("first");
      expect(graph.nodes[1].content.rules.length).toBeGreaterThan(0);
    }
  });

  it("returns the first matching row, not the most severe one", () => {
    const result = evaluateRuleThreshold(DEFAULT_RULE_GRAPHS.OVERDUE_WORK_ITEM, {
      isCritical: true,
      delayWorkingDays: 12,
    });

    // Row 1 (critical and >= 5 days) matches before row 2 (critical or >= 10).
    expect(result).toEqual({ severity: "CRITICAL" });
  });

  it("evaluates later rows when earlier ones do not match", () => {
    expect(
      evaluateRuleThreshold(DEFAULT_RULE_GRAPHS.OVERDUE_WORK_ITEM, {
        isCritical: false,
        delayWorkingDays: 6,
      }),
    ).toEqual({ severity: "MEDIUM" });
  });

  it("returns null when no row matches, mirroring the pre-migration skip", () => {
    expect(evaluateRuleThreshold(DEFAULT_RULE_GRAPHS.MATERIAL_OVERUSE, { ratio: 0.5 })).toBeNull();
  });

  it("falls back to the default graph for a tenant that published nothing", async () => {
    const { prisma } = fakePrisma([]);

    const graphs = await loadTenantRuleGraphs(prisma, "tenant-alpha");

    expect(graphs).toEqual(DEFAULT_RULE_GRAPHS);
  });

  it("overrides only the rules a tenant published", async () => {
    const { prisma } = fakePrisma([
      { ruleId: "MATERIAL_OVERUSE", jdmGraph: tenantGraph("CRITICAL") },
    ]);

    const graphs = await loadTenantRuleGraphs(prisma, "tenant-alpha");

    expect(evaluateRuleThreshold(graphs.MATERIAL_OVERUSE, { ratio: 0 })).toEqual({
      severity: "CRITICAL",
    });
    expect(graphs.STOCK_SHORTAGE).toEqual(DEFAULT_RULE_GRAPHS.STOCK_SHORTAGE);
  });

  it("ignores a published rule id the engine does not know", async () => {
    const { prisma } = fakePrisma([{ ruleId: "NOT_A_RULE", jdmGraph: tenantGraph("HIGH") }]);

    expect(await loadTenantRuleGraphs(prisma, "tenant-alpha")).toEqual(DEFAULT_RULE_GRAPHS);
  });

  it("caches per tenant instead of reloading on every analysis", async () => {
    const { prisma, findMany } = fakePrisma([]);

    await loadTenantRuleGraphs(prisma, "tenant-alpha");
    await loadTenantRuleGraphs(prisma, "tenant-alpha");

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("reloads after a publish invalidates the tenant cache", async () => {
    const { prisma, findMany } = fakePrisma([]);
    await loadTenantRuleGraphs(prisma, "tenant-alpha");

    invalidateTenantRuleGraphs("tenant-alpha");
    await loadTenantRuleGraphs(prisma, "tenant-alpha");

    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("keeps one tenant's published rules out of another tenant's cache entry", async () => {
    const alpha = fakePrisma([{ ruleId: "MATERIAL_OVERUSE", jdmGraph: tenantGraph("CRITICAL") }]);
    const beta = fakePrisma([]);

    const alphaGraphs = await loadTenantRuleGraphs(alpha.prisma, "tenant-alpha");
    const betaGraphs = await loadTenantRuleGraphs(beta.prisma, "tenant-beta");

    expect(evaluateRuleThreshold(alphaGraphs.MATERIAL_OVERUSE, { ratio: 0 })).toEqual({
      severity: "CRITICAL",
    });
    expect(evaluateRuleThreshold(betaGraphs.MATERIAL_OVERUSE, { ratio: 0 })).toBeNull();
  });
});
