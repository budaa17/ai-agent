import { describe, expect, it } from "vitest";
import { answerKeySchema } from "../src/answer-key.js";
import { buildSeedData } from "../prisma/seed-data.js";

describe("deterministic seed data", () => {
  it("rebuilds exactly the same dataset", () => {
    expect(buildSeedData()).toEqual(buildSeedData());
  });

  it("contains valid answer-key issues that reference seeded work items", () => {
    const seedData = buildSeedData();
    const answerKey = answerKeySchema.parse(seedData.answerKey);
    const workItemsById = new Map(seedData.workItems.map((workItem) => [workItem.id, workItem]));

    expect(answerKey.issues).toHaveLength(5);
    expect(new Set(answerKey.issues.map((issue) => issue.type))).toEqual(
      new Set([
        "OVERDUE_WORK_ITEM",
        "STALLED_PROGRESS",
        "DEPENDENCY_VIOLATION",
        "BUDGET_OVERRUN",
        "LEDGER_MISMATCH",
      ]),
    );
    expect(answerKey.projectOutcomes).toEqual([
      {
        tenantId: "tenant-demo",
        projectId: "project-atlas",
        actualFinish: "2026-05-12T00:00:00.000Z",
      },
    ]);

    for (const issue of answerKey.issues) {
      const workItem = workItemsById.get(issue.workItemId);
      expect(workItem).toBeDefined();
      expect(workItem?.tenantId).toBe(issue.tenantId);
      expect(workItem?.projectId).toBe(issue.projectId);
    }
  });

  it("keeps dependency and tenant boundaries internally consistent", () => {
    const seedData = buildSeedData();
    const workItemsById = new Map(seedData.workItems.map((workItem) => [workItem.id, workItem]));

    for (const dependency of seedData.dependencies) {
      const predecessor = workItemsById.get(dependency.predecessorId);
      const successor = workItemsById.get(dependency.successorId);

      expect(predecessor?.tenantId).toBe(dependency.tenantId);
      expect(successor?.tenantId).toBe(dependency.tenantId);
      expect(predecessor?.projectId).toBe(dependency.projectId);
      expect(successor?.projectId).toBe(dependency.projectId);
    }

    expect(seedData.tenants.map((tenant) => tenant.id)).toContain("tenant-isolation");
    expect(seedData.workItems.some((workItem) => workItem.tenantId === "tenant-isolation")).toBe(
      true,
    );
  });

  it("stores monetary values as fixed decimal strings", () => {
    const seedData = buildSeedData();
    const moneyPattern = /^\d+\.\d{2}$/;

    for (const project of seedData.projects) {
      expect(project.budget).toMatch(moneyPattern);
      expect(project.actualCost).toMatch(moneyPattern);
    }

    for (const workItem of seedData.workItems) {
      expect(workItem.budget).toMatch(moneyPattern);
      expect(workItem.actualCost).toMatch(moneyPattern);
      expect(workItem.progressPercent).toBeGreaterThanOrEqual(0);
      expect(workItem.progressPercent).toBeLessThanOrEqual(100);
    }
  });
});
