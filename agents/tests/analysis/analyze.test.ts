import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AnalysisProjectNotFoundError,
  analyzeProjectData,
  analyzeProjectFromDatabase,
  loadProjectAnalysisData,
} from "../../src/analysis/analyze.js";
import { prisma } from "../../src/prisma.js";
import { buildProjectAnalysisFixture } from "./fixtures.js";

beforeAll(async () => {
  const projectCount = await prisma.project.count({
    where: { tenantId: "tenant-demo" },
  });

  if (projectCount === 0) {
    throw new Error("Seed data is missing. Run `pnpm.cmd run seed` before analysis tests.");
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("project analysis", () => {
  it("calculates the expected Atlas critical path without an LLM", () => {
    const result = analyzeProjectData(buildProjectAnalysisFixture("project-atlas"));

    expect(result.cpm.projectDurationDays).toBe(125);
    expect(result.cpm.projectFinish).toBe("2026-05-09T00:00:00.000Z");
    expect(result.cpm.criticalPaths).toEqual([
      [
        "wi-atlas-discovery",
        "wi-atlas-design",
        "wi-atlas-integration",
        "wi-atlas-migration",
        "wi-atlas-training",
        "wi-atlas-pilot",
        "wi-atlas-rollout",
      ],
    ]);
    expect(result.summary).toMatchObject({
      workItemCount: 9,
      dependencyCount: 9,
      projectDurationDays: 125,
      criticalWorkItemCount: 7,
      criticalPathCount: 1,
      issueCount: 5,
    });
  });

  it("loads a project by code inside the tenant scope", async () => {
    const data = await loadProjectAnalysisData({
      tenantId: "tenant-demo",
      projectRef: "ATLAS",
      asOf: "2026-03-01T00:00:00.000Z",
    });

    expect(data.projectId).toBe("project-atlas");
    expect(data.workItems).toHaveLength(9);
    expect(data.dependencies).toHaveLength(9);
    expect(data.workItems.flatMap((workItem) => workItem.snapshots)).toHaveLength(8);
  });

  it("runs all DB-backed rules for Atlas", async () => {
    const result = await analyzeProjectFromDatabase({
      tenantId: "tenant-demo",
      projectRef: "project-atlas",
      asOf: "2026-03-01T00:00:00.000Z",
    });

    expect(result.summary.issueCount).toBe(5);
    expect(result.summary.issuesByType).toEqual({
      OVERDUE_WORK_ITEM: 1,
      STALLED_PROGRESS: 1,
      DEPENDENCY_VIOLATION: 1,
      BUDGET_OVERRUN: 1,
      LEDGER_MISMATCH: 1,
    });
  });

  it("does not reveal a project from another tenant", async () => {
    await expect(
      loadProjectAnalysisData({
        tenantId: "tenant-demo",
        projectRef: "project-private",
        asOf: "2026-03-01T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(AnalysisProjectNotFoundError);
  });
});
