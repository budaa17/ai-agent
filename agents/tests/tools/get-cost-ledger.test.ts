import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/prisma.js";
import { ToolAccessError } from "../../src/tools/context.js";
import { getCostLedgerCore } from "../../src/tools/cost-ledger.js";

beforeAll(async () => {
  // Scoped to the projects `prisma/seed.ts` owns: other projects may share the
  // tenant (for example the demo project from `seed:demo:project`).
  const seededCostEntries = await prisma.costEntry.count({
    where: {
      tenantId: { in: ["tenant-demo", "tenant-isolation"] },
      projectId: { in: ["project-atlas", "project-river", "project-private"] },
    },
  });

  if (seededCostEntries !== 12) {
    throw new Error("Seed data is outdated. Run `pnpm.cmd run seed` before the tool tests.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getCostLedgerCore", () => {
  it("returns only work-item ledgers inside the authorized scope", async () => {
    const result = await getCostLedgerCore({
      tenantId: "tenant-demo",
      projectIds: ["project-atlas"],
    });

    expect(result.totalWorkItems).toBe(9);
    expect(result.workItems).toHaveLength(9);
    expect(result.workItems.every((workItem) => workItem.projectId === "project-atlas")).toBe(true);
    expect(result.workItems.some((workItem) => workItem.id === "wi-private-analysis")).toBe(false);
  });

  it("detects the software-license budget overrun without a ledger mismatch", async () => {
    const result = await getCostLedgerCore(
      {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      {
        workItemIds: ["wi-atlas-license"],
      },
    );
    const license = result.workItems[0];

    expect(license?.budget).toBe("20000000.00");
    expect(license?.recordedActualCost).toBe("27000000.00");
    expect(license?.ledgerTotal).toBe("27000000.00");
    expect(license?.budgetVariance).toBe("7000000.00");
    expect(license?.ledgerVariance).toBe("0.00");
    expect(license?.isOverBudget).toBe(true);
    expect(license?.hasLedgerMismatch).toBe(false);
  });

  it("detects the procurement ledger mismatch without a budget overrun", async () => {
    const result = await getCostLedgerCore(
      {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      {
        workItemIds: ["wi-atlas-procurement"],
      },
    );
    const procurement = result.workItems[0];

    expect(procurement?.budget).toBe("80000000.00");
    expect(procurement?.recordedActualCost).toBe("72000000.00");
    expect(procurement?.ledgerTotal).toBe("70000000.00");
    expect(procurement?.budgetVariance).toBe("-8000000.00");
    expect(procurement?.ledgerVariance).toBe("2000000.00");
    expect(procurement?.entries).toHaveLength(2);
    expect(procurement?.isOverBudget).toBe(false);
    expect(procurement?.hasLedgerMismatch).toBe(true);
  });

  it("keeps a reconciled, under-budget work item anomaly-free", async () => {
    const result = await getCostLedgerCore(
      {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      {
        workItemIds: ["wi-atlas-discovery"],
      },
    );
    const discovery = result.workItems[0];

    expect(discovery?.budgetVariance).toBe("-1000000.00");
    expect(discovery?.ledgerVariance).toBe("0.00");
    expect(discovery?.isOverBudget).toBe(false);
    expect(discovery?.hasLedgerMismatch).toBe(false);
  });

  it("does not leak the ledger stored under another tenant", async () => {
    const privateResult = await getCostLedgerCore({
      tenantId: "tenant-isolation",
      projectIds: ["project-private"],
    });
    const spoofedResult = await getCostLedgerCore({
      tenantId: "tenant-demo",
      projectIds: ["project-private"],
    });

    expect(privateResult.totalWorkItems).toBe(1);
    expect(privateResult.workItems[0]?.ledgerTotal).toBe("40000000.00");
    expect(spoofedResult.totalWorkItems).toBe(0);
    expect(spoofedResult.workItems).toEqual([]);
  });

  it("rejects a requested project outside the authorized project list", async () => {
    await expect(
      getCostLedgerCore(
        {
          tenantId: "tenant-demo",
          projectIds: ["project-atlas"],
        },
        {
          projectIds: ["project-private"],
        },
      ),
    ).rejects.toBeInstanceOf(ToolAccessError);
  });

  it("reports when work-item ledger results are truncated", async () => {
    const result = await getCostLedgerCore(
      {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      {
        limit: 2,
      },
    );

    expect(result.totalWorkItems).toBe(9);
    expect(result.workItems).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.summary).toEqual({
      totalBudget: "480000000.00",
      recordedActualCost: "216000000.00",
      ledgerTotal: "214000000.00",
      overBudgetCount: 1,
      ledgerMismatchCount: 1,
    });
  });
});
