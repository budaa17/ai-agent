import { describe, expect, it } from "vitest";
import type { A5PriorityResult } from "../../src/planning/contracts.js";
import {
  A5_PLANNING_EVALUATION_SCENARIOS,
  buildA5SimulationRequest,
  compareA5Priority,
  evaluateA5Planning,
  generateA5DailyPlan,
  stableStringify,
} from "../../src/planning/index.js";
import { buildBuildWatchOperationalSimulation } from "../../src/simulation/index.js";

const simulation = buildBuildWatchOperationalSimulation();
const planningCases = simulation.answerKey.cases.filter((answerCase) =>
  new Set<string>(A5_PLANNING_EVALUATION_SCENARIOS).has(answerCase.scenario),
);

function answerCase(scenario: string) {
  const value = planningCases.find((candidate) => candidate.scenario === scenario);
  if (value === undefined) {
    throw new Error(`Missing planning case ${scenario}`);
  }
  return value;
}

describe("A5 deterministic daily planning", () => {
  it.each(planningCases)("matches eligibility for $scenario", (currentCase) => {
    const result = generateA5DailyPlan(buildA5SimulationRequest(simulation, currentCase));
    const decision = result.decisions.find(
      (candidate) => candidate.workItemId === currentCase.workItemIds[0],
    );
    expect(decision?.eligibility.eligible).toBe(currentCase.expectedEligible);
  });

  it("does not invent a target when an approved factor is missing", () => {
    const currentCase = answerCase("HEALTHY_CONTROL");
    const request = buildA5SimulationRequest(simulation, currentCase);
    const workItem = request.operationalSnapshot.workItems.find(
      (candidate) => candidate.workItemId === currentCase.workItemIds[0],
    )!;
    const crew = request.operationalSnapshot.crews.find(
      (candidate) => candidate.crewType === workItem.requiredCrewType,
    )!;
    const result = generateA5DailyPlan({
      ...request,
      productivityFactors: request.productivityFactors.filter(
        (factor) => factor.crewId !== crew.crewId,
      ),
    });
    const decision = result.decisions.find(
      (candidate) => candidate.workItemId === workItem.workItemId,
    )!;
    expect(decision.dailyTarget.targetQuantity).toBeNull();
    expect(decision.dailyTarget.reasonCodes).toContain("CREW_PRODUCTIVITY_INPUT_MISSING");
  });

  it("rejects an activity outside its approved date window", () => {
    const currentCase = answerCase("HEALTHY_CONTROL");
    const request = buildA5SimulationRequest(simulation, currentCase);
    const subjectId = currentCase.workItemIds[0]!;
    const result = generateA5DailyPlan({
      ...request,
      operationalSnapshot: {
        ...request.operationalSnapshot,
        workItems: request.operationalSnapshot.workItems.map((workItem) =>
          workItem.workItemId === subjectId
            ? { ...workItem, plannedStart: "2026-02-11" }
            : workItem,
        ),
      },
    });
    const decision = result.decisions.find((candidate) => candidate.workItemId === subjectId)!;
    expect(decision.eligibility.eligible).toBe(false);
    expect(decision.eligibility.reasonCodes).toContain("ACTIVITY_OUTSIDE_DATE_WINDOW");
  });

  it("reduces a target to public material capacity", () => {
    const currentCase = answerCase("PLANNED_TARGET_PARTIAL");
    const result = generateA5DailyPlan(buildA5SimulationRequest(simulation, currentCase));
    const decision = result.decisions.find(
      (candidate) => candidate.workItemId === currentCase.workItemIds[0],
    )!;
    expect(Number(decision.dailyTarget.targetQuantity?.value)).toBeCloseTo(4, 5);
    expect(decision.dailyTarget.limitingFactor).toBe("MATERIAL_AVAILABILITY");
    expect(decision.diagnosticCodes).toContain("PARTIAL_TARGET");
  });

  it.each([
    ["EQUIPMENT_DOUBLE_BOOKING", "EQUIPMENT_DOUBLE_BOOKING"],
    ["ZONE_CONFLICT", "ZONE_OVER_CAPACITY"],
  ])("detects %s", (scenario, conflictType) => {
    const currentCase = answerCase(scenario);
    const result = generateA5DailyPlan(buildA5SimulationRequest(simulation, currentCase));
    expect(result.draft?.content.conflicts.map((conflict) => conflict.type)).toContain(
      conflictType,
    );
  });

  it("produces byte-stable output for the same input", () => {
    const request = buildA5SimulationRequest(simulation, answerCase("HEALTHY_CONTROL"));
    expect(stableStringify(generateA5DailyPlan(request))).toBe(
      stableStringify(generateA5DailyPlan(request)),
    );
  });

  it("runs a deterministic 50-work-item benchmark", () => {
    const currentCase = answerCase("HEALTHY_CONTROL");
    const request = buildA5SimulationRequest(simulation, currentCase, "AUTO");
    const template = request.operationalSnapshot.workItems.at(-1)!;
    const clones = [49, 50].map((number) => ({
      ...template,
      workItemId: `benchmark-work-item-${number}`,
      activityId: `benchmark-activity-${number}`,
      code: `BENCH-${number}`,
      predecessorWorkItemIds: [],
      requiredInspectionIds: [],
      safetyRestrictions: [],
    }));
    const benchmarkRequest = {
      ...request,
      requestId: "a5-benchmark-50",
      idempotencyKey: "a5-benchmark-50",
      operationalSnapshot: {
        ...request.operationalSnapshot,
        workItems: [...request.operationalSnapshot.workItems, ...clones],
      },
    };
    const first = generateA5DailyPlan(benchmarkRequest);
    const second = generateA5DailyPlan(benchmarkRequest);
    expect(first.decisions).toHaveLength(50);
    expect(stableStringify(first)).toBe(stableStringify(second));
  }, 10_000);

  it("passes the complete answer-key gate", () => {
    const report = evaluateA5Planning(simulation);
    expect(report.pass).toBe(true);
    expect(report.metrics.eligiblePrecision).toBe(1);
    expect(report.metrics.eligibleRecall).toBe(1);
    expect(report.metrics.autoCriticalOmissionCount).toBe(0);
    expect(report.metrics.undetectedResourceConflictCount).toBe(0);
    expect(report.metrics.shortageClassifiedFeasibleCount).toBe(0);
  }, 60_000);
});

describe("A5 stable priority tie-breakers", () => {
  const base: A5PriorityResult = {
    rank: null,
    tuple: {
      criticalPath: 0,
      totalFloatWorkingDays: 0,
      milestoneDependency: 0,
      downstreamUnlockCount: 5,
      bookedResourceOrMaterial: 0,
      baselineSequence: 1,
      workItemId: "work-a",
    },
  };

  it.each([
    ["critical path", { criticalPath: 1 }],
    ["total float", { totalFloatWorkingDays: 1 }],
    ["milestone dependency", { milestoneDependency: 1 }],
    ["downstream unlock", { downstreamUnlockCount: 4 }],
    ["booked resource/material", { bookedResourceOrMaterial: 1 }],
    ["baseline sequence", { baselineSequence: 2 }],
    ["work-item ID", { workItemId: "work-b" }],
  ])("applies %s before later keys", (_label, rightChange) => {
    const right: A5PriorityResult = {
      rank: null,
      tuple: { ...base.tuple, ...rightChange },
    };
    expect(compareA5Priority(base, right)).toBeLessThan(0);
  });
});
