import { describe, expect, it } from "vitest";
import {
  calculateCalendarCriticalPath,
  ProductionGraphError,
  topologicalSort,
} from "../../src/production-analysis/index.js";
import { buildProjectAnalysisSnapshot } from "../contracts/fixtures.js";

describe("calendar-aware critical path", () => {
  it("supports FS, SS, FF, and SF dependencies", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    const template = snapshot.workItems[0]!;
    snapshot.workItems = ["a", "b", "c", "d"].map((id, index) => ({
      ...template,
      workItemId: `work-item-${id}`,
      code: id.toUpperCase(),
      name: `Task ${id.toUpperCase()}`,
      plannedStart: "2026-03-02",
      plannedEnd: "2026-03-07",
      displayOrder: index,
    }));
    snapshot.dependencies = [
      {
        dependencyId: "dependency-fs",
        predecessorWorkItemId: "work-item-a",
        successorWorkItemId: "work-item-b",
        type: "FINISH_TO_START",
        lagDays: 0,
      },
      {
        dependencyId: "dependency-ss",
        predecessorWorkItemId: "work-item-a",
        successorWorkItemId: "work-item-c",
        type: "START_TO_START",
        lagDays: 2,
      },
      {
        dependencyId: "dependency-ff",
        predecessorWorkItemId: "work-item-b",
        successorWorkItemId: "work-item-d",
        type: "FINISH_TO_FINISH",
        lagDays: 1,
      },
      {
        dependencyId: "dependency-sf",
        predecessorWorkItemId: "work-item-c",
        successorWorkItemId: "work-item-d",
        type: "START_TO_FINISH",
        lagDays: 8,
      },
    ];
    snapshot.materialNorms = [];
    snapshot.dailyReports = [];
    snapshot.progressEntries = [];
    snapshot.attendanceEntries = [];
    snapshot.stockMovements = [];
    snapshot.costEntries = [];

    const result = calculateCalendarCriticalPath(snapshot);

    expect(result.tasks).toHaveLength(4);
    expect(result.topologicalOrder[0]).toBe("work-item-a");
    expect(result.projectDurationWorkingDays).toBeGreaterThan(6);
    expect(
      result.tasks.every((task) => !["2026-03-08", "2026-03-15"].includes(task.earliestFinish)),
    ).toBe(true);
  });

  it("rejects a dependency cycle", () => {
    expect(() =>
      topologicalSort(
        ["a", "b"],
        [
          {
            dependencyId: "a-to-b",
            predecessorWorkItemId: "a",
            successorWorkItemId: "b",
            type: "FINISH_TO_START",
            lagDays: 0,
          },
          {
            dependencyId: "b-to-a",
            predecessorWorkItemId: "b",
            successorWorkItemId: "a",
            type: "FINISH_TO_START",
            lagDays: 0,
          },
        ],
      ),
    ).toThrow(ProductionGraphError);
  });

  it("rejects a dependency outside the graph", () => {
    expect(() =>
      topologicalSort(
        ["a"],
        [
          {
            dependencyId: "outside",
            predecessorWorkItemId: "a",
            successorWorkItemId: "missing",
            type: "FINISH_TO_START",
            lagDays: 0,
          },
        ],
      ),
    ).toThrow(/outside the executable/);
  });
});
