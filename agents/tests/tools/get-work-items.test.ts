import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/prisma.js";
import { ToolAccessError } from "../../src/tools/context.js";
import { getWorkItemsCore } from "../../src/tools/work-items.js";

beforeAll(async () => {
  const seededWorkItems = await prisma.workItem.count({
    where: { tenantId: "tenant-demo" },
  });

  if (seededWorkItems === 0) {
    throw new Error("Seed data is missing. Run `pnpm.cmd run seed` before the tool tests.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getWorkItemsCore", () => {
  it("returns only work items inside the authorized tenant and project scope", async () => {
    const result = await getWorkItemsCore({
      tenantId: "tenant-demo",
      projectIds: ["project-atlas"],
    });

    expect(result.total).toBe(9);
    expect(result.items).toHaveLength(9);
    expect(result.items.every((workItem) => workItem.projectId === "project-atlas")).toBe(true);
    expect(result.items.some((workItem) => workItem.id === "wi-private-analysis")).toBe(false);
  });

  it("does not leak another tenant even when its project ID is present in context", async () => {
    const result = await getWorkItemsCore({
      tenantId: "tenant-demo",
      projectIds: ["project-private"],
    });

    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("rejects a requested project outside the authorized project list", async () => {
    await expect(
      getWorkItemsCore(
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

  it("filters completed work and reports truncation", async () => {
    const result = await getWorkItemsCore(
      {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      {
        includeCompleted: false,
        limit: 2,
      },
    );

    expect(result.total).toBe(6);
    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.items.every((workItem) => workItem.status !== "COMPLETED")).toBe(true);
    expect(result.summary).toEqual({
      byStatus: {
        PLANNED: 3,
        IN_PROGRESS: 3,
        BLOCKED: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      },
      criticalCount: 6,
      averageProgressPercent: 23.33,
      totalBudget: "425000000.00",
      totalActualCost: "157000000.00",
    });
  });
});
