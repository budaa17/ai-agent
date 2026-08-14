import { describe, expect, it } from "vitest";
import { projectAnalysisSnapshotV1Schema } from "../../src/contracts/index.js";
import {
  BUILDWATCH_SIMULATION_WINDOW_END,
  BUILDWATCH_SIMULATION_WINDOW_START,
  buildBuildWatchSimulation,
  replayBuildWatchSimulation,
  simulationWeekEndDates,
  simulationWorkingDayCount,
} from "../../src/simulation/index.js";

describe("BuildWatch Phase 1 simulation", () => {
  it("builds a valid 48-work-item, 12-week dataset", () => {
    const simulation = buildBuildWatchSimulation();
    const snapshot = simulation.snapshot;
    const parentIds = new Set(
      snapshot.workItems
        .filter((workItem) => workItem.parentWorkItemId === null)
        .map((workItem) => workItem.workItemId),
    );

    expect(snapshot.workItems).toHaveLength(48);
    expect(parentIds.size).toBe(8);
    expect(
      snapshot.workItems
        .filter((workItem) => workItem.parentWorkItemId !== null)
        .every((workItem) => parentIds.has(workItem.parentWorkItemId!)),
    ).toBe(true);
    expect(snapshot.dependencies.some((dependency) => dependency.type === "FINISH_TO_START")).toBe(
      true,
    );
    expect(snapshot.dependencies.some((dependency) => dependency.type === "START_TO_START")).toBe(
      true,
    );
    expect(snapshot.activeBaseline.calendar.holidays).toContain("2026-02-17");
    expect(snapshot.dailyReports).not.toHaveLength(0);
    expect(snapshot.dailyReports.some((report) => report.date === "2026-03-25")).toBe(false);
    expect(simulation.windowStart).toBe(BUILDWATCH_SIMULATION_WINDOW_START);
    expect(simulation.windowEnd).toBe(BUILDWATCH_SIMULATION_WINDOW_END);
    expect(simulationWorkingDayCount()).toBeGreaterThanOrEqual(70);
  });

  it("is byte-for-byte deterministic for the same seed", () => {
    const first = buildBuildWatchSimulation("repeatable-seed");
    const second = buildBuildWatchSimulation("repeatable-seed");

    expect(second).toEqual(first);
  });

  it("keeps the answer key and private tenant outside the agent snapshot", () => {
    const simulation = buildBuildWatchSimulation();
    const agentContext = JSON.stringify(simulation.snapshot);

    expect(agentContext).not.toContain("answer-critical-delay");
    expect(agentContext).not.toContain("TENANT-PRIVATE-ONLY");
    expect(simulation.privateSnapshot.tenantId).toBe("tenant-private");
    expect(simulation.answerKey.issues).toHaveLength(13);
  });

  it("replays every week as a valid monotonic snapshot", () => {
    const simulation = buildBuildWatchSimulation();
    let previousReportCount = 0;
    let previousProgressCount = 0;

    for (const weekEnd of simulationWeekEndDates()) {
      const replay = replayBuildWatchSimulation(simulation, weekEnd);

      expect(projectAnalysisSnapshotV1Schema.safeParse(replay).success).toBe(true);
      expect(replay.dailyReports.length).toBeGreaterThanOrEqual(previousReportCount);
      expect(replay.progressEntries.length).toBeGreaterThanOrEqual(previousProgressCount);
      previousReportCount = replay.dailyReports.length;
      previousProgressCount = replay.progressEntries.length;
    }
  });

  it("embeds all required positive and negative control scenarios", () => {
    const simulation = buildBuildWatchSimulation();
    const issueTypes = new Set(simulation.answerKey.issues.map((issue) => issue.type));

    expect(issueTypes).toEqual(
      new Set([
        "CRITICAL_DELAY",
        "MATERIAL_OVERUSE",
        "STOCK_SHORTAGE",
        "PRODUCTIVITY_DECLINE",
        "COST_AHEAD_OF_PROGRESS",
        "SUBCONTRACTOR_DEVIATION",
        "MISSING_DAILY_REPORT",
        "REPEATED_SUPPLIER_BLOCKER",
        "LINKED_ROOT_CAUSE",
        "DEPENDENCY_VIOLATION",
        "LEDGER_MISMATCH",
        "HEALTHY_CONTROL",
        "CROSS_TENANT_SECRET",
      ]),
    );
    expect(simulation.answerKey.issues.every((issue) => issue.expectedSourceIds.length > 0)).toBe(
      true,
    );
  });
});
