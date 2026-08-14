import { describe, expect, it } from "vitest";
import {
  analyzeProjectSnapshot,
  calculateScheduleForecast,
  simulateRecoveryScenarios,
} from "../../src/production-analysis/index.js";
import { buildBuildWatchSimulation } from "../../src/simulation/index.js";

const requiredRuleIds = [
  "OVERDUE_WORK_ITEM",
  "MATERIAL_OVERUSE",
  "STOCK_SHORTAGE",
  "PRODUCTIVITY_DECLINE",
  "COST_AHEAD_OF_PROGRESS",
  "SUBCONTRACTOR_DEVIATION",
  "MISSING_DAILY_REPORT",
] as const;

describe("production deterministic analysis", () => {
  it("calculates actual-pace projected finish for every leaf task", () => {
    const snapshot = buildBuildWatchSimulation().snapshot;
    const forecast = calculateScheduleForecast(snapshot);

    expect(forecast.workItems).toHaveLength(40);
    expect(forecast.criticalPath.tasks).toHaveLength(40);
    expect(forecast.sourceProgressEntryIds.length).toBeGreaterThan(100);
    expect(forecast.projectedEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      forecast.workItems.find((item) => item.workItemId === "work-item-017")
        ?.remainingDurationWorkingDays,
    ).toBeGreaterThan(0);
  });

  it("detects all seven required simulation deviations", () => {
    const analysis = analyzeProjectSnapshot(buildBuildWatchSimulation().snapshot);
    const evaluations = new Map(
      analysis.ruleEvaluations.map((evaluation) => [evaluation.ruleId, evaluation]),
    );

    for (const ruleId of requiredRuleIds) {
      expect(evaluations.get(ruleId)?.status, ruleId).toBe("MATCHED");
      expect(evaluations.get(ruleId)?.matchedCount, ruleId).toBeGreaterThan(0);
    }

    expect(
      evaluations
        .get("OVERDUE_WORK_ITEM")
        ?.deviations.some((deviation) => deviation.workItemId === "work-item-017"),
    ).toBe(true);
    expect(
      evaluations
        .get("MATERIAL_OVERUSE")
        ?.deviations.some((deviation) => deviation.workItemId === "work-item-023"),
    ).toBe(true);
    expect(
      evaluations
        .get("STOCK_SHORTAGE")
        ?.deviations.some((deviation) => deviation.materialId === "material-brick"),
    ).toBe(true);
    expect(
      evaluations
        .get("PRODUCTIVITY_DECLINE")
        ?.deviations.some((deviation) => deviation.workItemId === "work-item-029"),
    ).toBe(true);
    expect(
      evaluations
        .get("COST_AHEAD_OF_PROGRESS")
        ?.deviations.some((deviation) => deviation.workItemId === "work-item-035"),
    ).toBe(true);
    expect(
      evaluations
        .get("SUBCONTRACTOR_DEVIATION")
        ?.deviations.some((deviation) => deviation.workItemId === "work-item-041"),
    ).toBe(true);
    expect(
      evaluations
        .get("MISSING_DAILY_REPORT")
        ?.deviations.some((deviation) => deviation.effectiveDate === "2026-03-25"),
    ).toBe(true);
  });

  it("detects the intentional dependency and exact ledger mismatch", () => {
    const analysis = analyzeProjectSnapshot(buildBuildWatchSimulation().snapshot);
    const dependency = analysis.deviations.find(
      (deviation) =>
        deviation.ruleId === "DEPENDENCY_VIOLATION" &&
        deviation.dedupeKey.includes("dependency-intentional-violation"),
    );
    const ledger = analysis.deviations.find(
      (deviation) =>
        deviation.ruleId === "LEDGER_MISMATCH" && deviation.workItemId === "work-item-014",
    );

    expect(dependency).toBeDefined();
    expect(ledger?.delta.varianceCents).toBe("200000000");
  });

  it("returns four deterministic recovery scenarios", () => {
    const snapshot = buildBuildWatchSimulation().snapshot;
    const first = simulateRecoveryScenarios(snapshot);
    const second = simulateRecoveryScenarios(snapshot);

    expect(first).toEqual(second);
    expect(first.map((scenario) => scenario.type)).toEqual([
      "PARALLELIZATION",
      "EXTRA_CREW",
      "RESEQUENCE",
      "SUBCONTRACTOR_OPTION",
    ]);
    expect(first.every((scenario) => scenario.estimatedImpactDays >= 0)).toBe(true);
  }, 10_000);

  it("catalogs every source used by forecast, rules, and scenarios", () => {
    const analysis = analyzeProjectSnapshot(buildBuildWatchSimulation().snapshot);
    const catalogIds = new Set(analysis.sourceCatalog.map((source) => source.sourceId));
    const usedIds = new Set([
      ...analysis.forecast.sourceProgressEntryIds,
      ...analysis.deviations.flatMap((deviation) => deviation.sourceIds),
      ...analysis.recoveryScenarios.flatMap((scenario) => scenario.sourceIds),
    ]);

    expect([...usedIds].filter((sourceId) => !catalogIds.has(sourceId))).toEqual([]);
  });
});
