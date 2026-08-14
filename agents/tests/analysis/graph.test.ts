import { describe, expect, it } from "vitest";
import {
  DependencyCycleError,
  DependencyGraphError,
  topologicalSortWorkItems,
} from "../../src/analysis/graph.js";

describe("topologicalSortWorkItems", () => {
  it("returns a stable dependency-safe order", () => {
    const result = topologicalSortWorkItems(
      ["A", "B", "C", "D", "E", "F"],
      [
        { id: "A-B", predecessorId: "A", successorId: "B" },
        { id: "A-C", predecessorId: "A", successorId: "C" },
        { id: "B-D", predecessorId: "B", successorId: "D" },
        { id: "C-E", predecessorId: "C", successorId: "E" },
        { id: "D-F", predecessorId: "D", successorId: "F" },
        { id: "E-F", predecessorId: "E", successorId: "F" },
      ],
    );

    expect(result).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("reports the concrete cycle before CPM calculation", () => {
    expect(() =>
      topologicalSortWorkItems(
        ["A", "B", "C"],
        [
          { id: "A-B", predecessorId: "A", successorId: "B" },
          { id: "B-C", predecessorId: "B", successorId: "C" },
          { id: "C-A", predecessorId: "C", successorId: "A" },
        ],
      ),
    ).toThrowError(DependencyCycleError);

    try {
      topologicalSortWorkItems(
        ["A", "B", "C"],
        [
          { id: "A-B", predecessorId: "A", successorId: "B" },
          { id: "B-C", predecessorId: "B", successorId: "C" },
          { id: "C-A", predecessorId: "C", successorId: "A" },
        ],
      );
    } catch (error) {
      expect(error).toBeInstanceOf(DependencyCycleError);
      expect((error as DependencyCycleError).cycleWorkItemIds).toEqual(["A", "B", "C", "A"]);
    }
  });

  it("rejects dependencies outside the graph", () => {
    expect(() =>
      topologicalSortWorkItems(["A"], [{ id: "A-X", predecessorId: "A", successorId: "X" }]),
    ).toThrowError(DependencyGraphError);
  });
});
