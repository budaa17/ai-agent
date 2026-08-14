import { describe, expect, it } from "vitest";
import { workspaceSchema } from "./schemas";

describe("generated workspace runtime contract", () => {
  it("Phase 10 canonical workspace shape-г strict parse хийнэ", () => {
    const parsed = workspaceSchema.parse({
      schemaVersion: 1,
      generatedAt: "2026-08-03T00:00:00.000Z",
      role: "PROJECT_MANAGER",
      permissions: ["PROJECT_READ"],
      project: {
        id: "project-1",
        code: "ATLAS",
        name: "Atlas",
        description: null,
        location: null,
        status: "ACTIVE",
        plannedStart: "2026-01-01T00:00:00.000Z",
        plannedEnd: "2026-12-31T00:00:00.000Z",
        budgetMnt: "1000000.00",
        actualCostMnt: "500000.00",
        rowVersion: 1,
      },
      dashboard: {
        plannedProgressPercent: 50,
        actualProgressPercent: 45,
        projectedFinish: null,
        projectedDelayDays: null,
        costVarianceMnt: "-500000.00",
        criticalActivityCount: 2,
        openAlertCount: 1,
      },
      workItems: [],
      dependencies: [],
      design: { documents: [], revisions: [], pages: [], scales: [], elements: [] },
      commercial: {
        quantityVersions: [],
        quantityItems: [],
        estimateVersions: [],
        estimateLines: [],
        estimateAssumptions: [],
        baselines: [],
      },
      schedule: { versions: [], activities: [], dependencies: [] },
      resources: { crews: [], equipment: [] },
      operations: {
        plans: [],
        planItems: [],
        reports: [],
        progress: [],
        attendance: [],
        photos: [],
        verifications: [],
        variances: [],
      },
      forecast: { snapshots: [], workItems: [], drivers: [], recoveryScenarios: [] },
      reviews: [],
      artifacts: [],
      assistants: { a1Drafts: [], a3Drafts: [] },
      alerts: [],
    });
    expect(parsed.project.code).toBe("ATLAS");
  });

  it("хуучин API estimateAssumptions өгөөгүй үед хоосон утгаар нөхнө", () => {
    const legacyResponse = workspaceSchema.parse({
      schemaVersion: 1,
      generatedAt: "2026-08-03T00:00:00.000Z",
      role: "PROJECT_MANAGER",
      permissions: ["PROJECT_READ"],
      project: {
        id: "project-1",
        code: "ATLAS",
        name: "Atlas",
        description: null,
        location: null,
        status: "ACTIVE",
        plannedStart: "2026-01-01T00:00:00.000Z",
        plannedEnd: "2026-12-31T00:00:00.000Z",
        budgetMnt: null,
        actualCostMnt: null,
        rowVersion: 1,
      },
      dashboard: {
        plannedProgressPercent: 0,
        actualProgressPercent: 0,
        projectedFinish: null,
        projectedDelayDays: null,
        costVarianceMnt: null,
        criticalActivityCount: 0,
        openAlertCount: 0,
      },
      workItems: [],
      dependencies: [],
      design: { documents: [], revisions: [], pages: [], scales: [], elements: [] },
      commercial: {
        quantityVersions: [],
        quantityItems: [],
        estimateVersions: [],
        estimateLines: [],
        baselines: [],
      },
      schedule: { versions: [], activities: [], dependencies: [] },
      resources: { crews: [], equipment: [] },
      operations: {
        plans: [],
        planItems: [],
        reports: [],
        progress: [],
        attendance: [],
        photos: [],
        verifications: [],
        variances: [],
      },
      forecast: { snapshots: [], workItems: [], drivers: [], recoveryScenarios: [] },
      reviews: [],
      artifacts: [],
      assistants: { a1Drafts: [], a3Drafts: [] },
      alerts: [],
    });

    expect(legacyResponse.commercial.estimateAssumptions).toEqual([]);
  });
});
