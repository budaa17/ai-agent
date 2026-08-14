import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReferenceToolsContext, referenceTools } from "../../src/agent/tools.js";
import { prisma } from "../../src/prisma.js";
import { getCostLedgerResultSchema } from "../../src/tools/cost-ledger.js";
import { getDependenciesResultSchema } from "../../src/tools/dependencies.js";
import { getProgressHistoryResultSchema } from "../../src/tools/progress-history.js";
import { getWorkItemsResultSchema } from "../../src/tools/work-items.js";

const context = {
  tenantId: "tenant-demo",
  projectIds: ["project-atlas"],
};

const executionOptions = {
  toolCallId: "test-tool-call",
  messages: [],
  context,
};

beforeAll(async () => {
  const seededWorkItems = await prisma.workItem.count({
    where: { tenantId: "tenant-demo" },
  });

  if (seededWorkItems === 0) {
    throw new Error("Seed data is missing. Run `pnpm.cmd run seed` before the agent tests.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("referenceTools", () => {
  it("exposes A4's four read-only Part 2 wrappers", () => {
    expect(Object.keys(referenceTools)).toEqual([
      "lookupWorkItems",
      "lookupDependencies",
      "lookupProgressHistory",
      "lookupCostLedger",
    ]);
    expect(createReferenceToolsContext(context)).toEqual({
      lookupWorkItems: context,
      lookupDependencies: context,
      lookupProgressHistory: context,
      lookupCostLedger: context,
    });
  });

  it("executes the work-item wrapper with aggregate and sample output", async () => {
    const result = getWorkItemsResultSchema.parse(
      await referenceTools.lookupWorkItems.execute(
        { includeCompleted: true, limit: 2 },
        executionOptions,
      ),
    );

    expect(result.total).toBe(9);
    expect(result.items).toHaveLength(2);
    expect(result.summary.averageProgressPercent).toBe(48.89);
  });

  it("executes the dependency wrapper", async () => {
    const result = getDependenciesResultSchema.parse(
      await referenceTools.lookupDependencies.execute({ limit: 2 }, executionOptions),
    );

    expect(result.total).toBe(9);
    expect(result.summary.unfinishedPredecessorCount).toBe(5);
  });

  it("executes the progress-history wrapper", async () => {
    const result = getProgressHistoryResultSchema.parse(
      await referenceTools.lookupProgressHistory.execute({ limit: 2 }, executionOptions),
    );

    expect(result.totalSnapshots).toBe(8);
    expect(result.summary.stalledWorkItemCount).toBe(1);
  });

  it("executes the cost-ledger wrapper", async () => {
    const result = getCostLedgerResultSchema.parse(
      await referenceTools.lookupCostLedger.execute({ limit: 2 }, executionOptions),
    );

    expect(result.totalWorkItems).toBe(9);
    expect(result.summary.overBudgetCount).toBe(1);
    expect(result.summary.ledgerMismatchCount).toBe(1);
  });
});
