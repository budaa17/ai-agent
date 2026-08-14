import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/prisma.js";
import { ToolAccessError } from "../../src/tools/context.js";
import { getDependenciesCore } from "../../src/tools/dependencies.js";

beforeAll(async () => {
  const seededDependencies = await prisma.workItemDependency.count({
    where: { tenantId: "tenant-demo" },
  });

  if (seededDependencies === 0) {
    throw new Error("Seed data is missing. Run `pnpm.cmd run seed` before the tool tests.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getDependenciesCore", () => {
  it("returns only dependencies inside the authorized scope", async () => {
    const result = await getDependenciesCore({
      tenantId: "tenant-demo",
      projectIds: ["project-atlas"],
    });

    expect(result.total).toBe(9);
    expect(result.dependencies).toHaveLength(9);
    expect(
      result.dependencies.every((dependency) => dependency.projectId === "project-atlas"),
    ).toBe(true);
    expect(
      result.dependencies.some(
        (dependency) =>
          dependency.predecessor.id === "wi-private-analysis" ||
          dependency.successor.id === "wi-private-analysis",
      ),
    ).toBe(false);
  });

  it("finds incoming and outgoing dependencies for one work item", async () => {
    const result = await getDependenciesCore(
      {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      {
        workItemIds: ["wi-atlas-migration"],
      },
    );

    expect(result.total).toBe(3);
    expect(result.dependencies.map((dependency) => dependency.id).sort()).toEqual([
      "dep-atlas-005",
      "dep-atlas-006",
      "dep-atlas-007",
    ]);

    const violatedDependency = result.dependencies.find(
      (dependency) => dependency.id === "dep-atlas-006",
    );
    expect(violatedDependency?.predecessor.status).toBe("IN_PROGRESS");
    expect(violatedDependency?.predecessor.actualEnd).toBeNull();
    expect(violatedDependency?.successor.actualStart).toBe("2026-02-18T00:00:00.000Z");
  });

  it("does not leak another tenant when its project ID is supplied by context", async () => {
    const result = await getDependenciesCore({
      tenantId: "tenant-demo",
      projectIds: ["project-private"],
    });

    expect(result.total).toBe(0);
    expect(result.dependencies).toEqual([]);
  });

  it("rejects a requested project outside the authorized project list", async () => {
    await expect(
      getDependenciesCore(
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

  it("reports when the dependency result is truncated", async () => {
    const result = await getDependenciesCore(
      {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      {
        limit: 2,
      },
    );

    expect(result.total).toBe(9);
    expect(result.dependencies).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.summary).toEqual({
      byType: {
        FINISH_TO_START: 9,
        START_TO_START: 0,
        FINISH_TO_FINISH: 0,
        START_TO_FINISH: 0,
      },
      criticalDependencyCount: 9,
      unfinishedPredecessorCount: 5,
    });
  });
});
