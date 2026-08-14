import { DependencyType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculateCriticalPath } from "../../src/analysis/cpm.js";
import { DependencyCycleError } from "../../src/analysis/graph.js";

function date(day: number) {
  return new Date(Date.UTC(2026, 0, day)).toISOString();
}

function task(id: string, durationDays: number) {
  return {
    id,
    code: id,
    name: `Task ${id}`,
    plannedStart: date(1),
    plannedEnd: date(durationDays),
  };
}

function finishToStart(predecessorId: string, successorId: string) {
  return {
    id: `${predecessorId}-${successorId}`,
    predecessorId,
    successorId,
    type: DependencyType.FINISH_TO_START,
    lagDays: 0,
  };
}

describe("calculateCriticalPath", () => {
  it("matches a hand-calculated six-task forward and backward pass", () => {
    const result = calculateCriticalPath({
      projectStart: date(1),
      workItems: [
        task("A", 3),
        task("B", 2),
        task("C", 4),
        task("D", 3),
        task("E", 2),
        task("F", 1),
      ],
      dependencies: [
        finishToStart("A", "B"),
        finishToStart("A", "C"),
        finishToStart("A", "D"),
        finishToStart("B", "E"),
        finishToStart("C", "E"),
        finishToStart("D", "E"),
        finishToStart("E", "F"),
      ],
    });
    const tasks = new Map(result.tasks.map((resultTask) => [resultTask.workItemId, resultTask]));

    expect(result.projectDurationDays).toBe(10);
    expect(result.projectFinish).toBe(date(10));
    expect(result.criticalWorkItemIds).toEqual(["A", "C", "E", "F"]);
    expect(result.criticalPaths).toEqual([["A", "C", "E", "F"]]);
    expect(tasks.get("A")).toMatchObject({
      earliestStartOffset: 0,
      earliestFinishOffset: 3,
      latestStartOffset: 0,
      totalFloatDays: 0,
      freeFloatDays: 0,
      isCritical: true,
    });
    expect(tasks.get("B")).toMatchObject({
      earliestStartOffset: 3,
      earliestFinishOffset: 5,
      latestStartOffset: 5,
      totalFloatDays: 2,
      freeFloatDays: 2,
      isCritical: false,
    });
    expect(tasks.get("D")).toMatchObject({
      earliestStartOffset: 3,
      earliestFinishOffset: 6,
      latestStartOffset: 4,
      totalFloatDays: 1,
      freeFloatDays: 1,
      isCritical: false,
    });
    expect(tasks.get("F")).toMatchObject({
      earliestStartOffset: 9,
      earliestFinishOffset: 10,
      latestStartOffset: 9,
      latestFinishOffset: 10,
      totalFloatDays: 0,
      isCritical: true,
    });
  });

  it("converts all four dependency types into start constraints", () => {
    const result = calculateCriticalPath({
      projectStart: date(1),
      workItems: [task("A", 4), task("B", 2), task("C", 2), task("D", 2), task("E", 1)],
      dependencies: [
        {
          id: "A-B-SS",
          predecessorId: "A",
          successorId: "B",
          type: DependencyType.START_TO_START,
          lagDays: 1,
        },
        {
          id: "A-C-FF",
          predecessorId: "A",
          successorId: "C",
          type: DependencyType.FINISH_TO_FINISH,
          lagDays: 1,
        },
        {
          id: "A-D-SF",
          predecessorId: "A",
          successorId: "D",
          type: DependencyType.START_TO_FINISH,
          lagDays: 3,
        },
        finishToStart("C", "E"),
      ],
    });
    const startOffsets = Object.fromEntries(
      result.tasks.map((resultTask) => [resultTask.workItemId, resultTask.earliestStartOffset]),
    );

    expect(startOffsets).toEqual({
      A: 0,
      B: 1,
      C: 3,
      D: 1,
      E: 5,
    });
    expect(result.projectDurationDays).toBe(6);
    expect(result.criticalPaths).toEqual([["A", "C", "E"]]);
  });

  it("stops when the dependency graph has a cycle", () => {
    expect(() =>
      calculateCriticalPath({
        workItems: [task("A", 1), task("B", 1)],
        dependencies: [finishToStart("A", "B"), finishToStart("B", "A")],
      }),
    ).toThrowError(DependencyCycleError);
  });
});
