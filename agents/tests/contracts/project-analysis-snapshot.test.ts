import { describe, expect, it } from "vitest";
import { projectAnalysisSnapshotV1Schema } from "../../src/contracts/index.js";
import { buildProjectAnalysisSnapshot } from "./fixtures.js";

describe("ProjectAnalysisSnapshotV1", () => {
  it("accepts a tenant-scoped analysis snapshot", () => {
    const result = projectAnalysisSnapshotV1Schema.parse(buildProjectAnalysisSnapshot());

    expect(result.tenantId).toBe("tenant-demo");
    expect(result.workItems).toHaveLength(1);
    expect(result.progressEntries[0]?.workItemId).toBe("work-item-001");
  });

  it("rejects a dependency with a dangling work item reference", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    snapshot.dependencies.push({
      dependencyId: "dependency-001",
      predecessorWorkItemId: "work-item-001",
      successorWorkItemId: "missing-work-item",
      type: "FINISH_TO_START",
      lagDays: 0,
    });

    const result = projectAnalysisSnapshotV1Schema.safeParse(snapshot);

    expect(result.success).toBe(false);
  });

  it("rejects a stock reversal with an unknown source movement", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    snapshot.stockMovements.push({
      stockMovementId: "stock-reversal-001",
      materialId: "material-001",
      kind: "REVERSAL",
      quantity: "-100",
      unitPriceMnt: null,
      workItemId: null,
      supplierName: null,
      documentArtifactId: null,
      occurredAt: "2026-03-02T02:00:00.000Z",
      recordedBy: "user-storekeeper",
      reversesMovementId: "missing-movement",
      reference: "БУЦ-001",
    });

    const result = projectAnalysisSnapshotV1Schema.safeParse(snapshot);

    expect(result.success).toBe(false);
  });
});
