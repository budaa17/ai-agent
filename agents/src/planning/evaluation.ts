import { z } from "zod";
import type {
  BuildWatchOperationalSimulationV1,
  OperationalSimulationAnswerCaseV1,
} from "../simulation/index.js";
import {
  a5DailyPlanRequestV1Schema,
  type A5DailyPlanRequestV1,
  type A5DailyPlanResultV1,
} from "./contracts.js";
import { stableStringify } from "./deterministic.js";
import { generateA5DailyPlan } from "./plan.js";

export const A5_PLANNING_EVALUATION_SCENARIOS = [
  "HEALTHY_CONTROL",
  "PREDECESSOR_UNFINISHED",
  "MATERIAL_SHORTAGE",
  "CREW_UNAVAILABLE",
  "EQUIPMENT_DOUBLE_BOOKING",
  "ZONE_CONFLICT",
  "HEAVY_RAIN_RESTRICTION",
  "INSPECTION_PENDING",
  "CRITICAL_WORK_OMITTED",
  "PLANNED_TARGET_PARTIAL",
  "APPROVED_BLOCKER",
] as const;

const a5EvaluationCaseSchema = z
  .object({
    caseId: z.string().min(1),
    scenario: z.enum(A5_PLANNING_EVALUATION_SCENARIOS),
    eligibleMatch: z.boolean(),
    priorityMatch: z.boolean(),
    targetMatch: z.boolean(),
    conflictMatch: z.boolean(),
    deterministicReplayMatch: z.boolean(),
    expectedEligible: z.boolean(),
    actualEligible: z.boolean(),
    expectedPriority: z.number().int().positive(),
    actualPriority: z.number().int().positive().nullable(),
    expectedTarget: z.string().nullable(),
    actualTarget: z.string().nullable(),
    expectedConflicts: z.array(z.string()),
    actualConflicts: z.array(z.string()),
    pass: z.boolean(),
  })
  .strict();

export const a5PlanningEvaluationReportV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    reportType: z.literal("A5_PLANNING_EVALUATION"),
    seed: z.string().min(1),
    generatedAt: z.string().datetime({ offset: true }),
    deterministic: z.literal(true),
    llmRequired: z.literal(false),
    cases: z.array(a5EvaluationCaseSchema).length(A5_PLANNING_EVALUATION_SCENARIOS.length),
    metrics: z
      .object({
        casePassRate: z.number().min(0).max(1),
        eligiblePrecision: z.number().min(0).max(1),
        eligibleRecall: z.number().min(0).max(1),
        priorityAccuracy: z.number().min(0).max(1),
        targetAccuracy: z.number().min(0).max(1),
        conflictPrecision: z.number().min(0).max(1),
        conflictRecall: z.number().min(0).max(1),
        autoCriticalOmissionCount: z.number().int().nonnegative(),
        criticalOmissionDetectionFailures: z.number().int().nonnegative(),
        undetectedResourceConflictCount: z.number().int().nonnegative(),
        shortageClassifiedFeasibleCount: z.number().int().nonnegative(),
        deterministicReplayFailures: z.number().int().nonnegative(),
      })
      .strict(),
    pass: z.boolean(),
  })
  .strict();

export type A5PlanningEvaluationReportV1 = z.infer<typeof a5PlanningEvaluationReportV1Schema>;

function planningCases(simulation: BuildWatchOperationalSimulationV1) {
  const scenarios = new Set<string>(A5_PLANNING_EVALUATION_SCENARIOS);
  return simulation.answerKey.cases.filter((answerCase) =>
    scenarios.has(answerCase.scenario),
  ) as Array<
    OperationalSimulationAnswerCaseV1 & {
      scenario: (typeof A5_PLANNING_EVALUATION_SCENARIOS)[number];
      expectedEligible: boolean;
      expectedPriority: number;
    }
  >;
}

export function buildA5SimulationRequest(
  simulation: BuildWatchOperationalSimulationV1,
  answerCase: OperationalSimulationAnswerCaseV1,
  selectionMode: "AUTO" | "VALIDATE_REQUESTED" = "VALIDATE_REQUESTED",
): A5DailyPlanRequestV1 {
  const snapshot = simulation.agentDataset.operationalSnapshots.find(
    (candidate) => candidate.asOf.slice(0, 10) === answerCase.effectiveDate,
  );
  if (snapshot === undefined) {
    throw new Error(`Missing operational snapshot for ${answerCase.effectiveDate}`);
  }
  const requestedWorkItemIds =
    selectionMode === "AUTO" || answerCase.scenario === "CRITICAL_WORK_OMITTED"
      ? []
      : answerCase.workItemIds;
  return a5DailyPlanRequestV1Schema.parse({
    schemaVersion: 1,
    requestType: "A5_DAILY_PLAN",
    requestId: `a5-eval-${answerCase.caseId}-${selectionMode.toLowerCase()}`,
    idempotencyKey: `a5-eval-${answerCase.effectiveDate}-${selectionMode.toLowerCase()}`,
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    planDate: answerCase.effectiveDate,
    timezone: snapshot.calendar.timezone,
    trigger: "MANAGER_REQUEST",
    selectionMode,
    requestedWorkItemIds,
    maxItems: 100_000,
    minimumExecutableQuantity: "1",
    planningWindow: {
      startTime: "08:00",
      endTime: "17:00",
      sourceRefs: snapshot.calendar.sourceRefs,
    },
    productivityFactors: snapshot.crews.map((crew) => ({
      crewId: crew.crewId,
      crewFactor: "1",
      shiftFactor: "1",
      sourceRefs: crew.sourceRefs,
    })),
    safetyClearances: [
      {
        code: "ACCESS_CLEAR",
        satisfied: true,
        sourceRefs: snapshot.calendar.sourceRefs,
      },
    ],
    bookedWorkItemIds: [],
    evidenceRuleIdsByWorkClass: Object.fromEntries(
      simulation.agentDataset.evidenceRules.map((rule) => [rule.workClassCode, rule.ruleId]),
    ),
    operationalSnapshot: snapshot,
    generatedAt: `${answerCase.effectiveDate}T05:00:00.000Z`,
  });
}

function normalizedConflictCodes(
  result: A5DailyPlanResultV1,
  workItemId: string,
  expectedUniverse: ReadonlySet<string>,
): string[] {
  const decision = result.decisions.find((candidate) => candidate.workItemId === workItemId);
  const mapping: Record<string, string> = {
    PREDECESSOR_UNFINISHED: "PRECONDITION_UNSATISFIED",
    INSPECTION_NOT_PASSED: "PRECONDITION_UNSATISFIED",
    APPROVED_BLOCKER: "APPROVED_BLOCKER",
  };
  const values = [
    ...(decision?.diagnosticCodes.map((code) => mapping[code] ?? code) ?? []),
    ...(result.draft?.content.conflicts.map((conflict) => conflict.type) ?? []),
    ...(result.omittedCriticalWorkItemIds.includes(workItemId) ? ["CRITICAL_WORK_OMITTED"] : []),
  ];
  return [...new Set(values)].filter((code) => expectedUniverse.has(code)).sort();
}

function numericTargetsMatch(expected: string | null, actual: string | null) {
  if (expected === null || actual === null) {
    return expected === actual;
  }
  return Math.abs(Number(expected) - Number(actual)) <= 0.00001;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function evaluateA5Planning(
  simulation: BuildWatchOperationalSimulationV1,
): A5PlanningEvaluationReportV1 {
  const answers = planningCases(simulation);
  const expectedUniverse = new Set(answers.flatMap((answerCase) => answerCase.expectedConflicts));
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let expectedConflictCount = 0;
  let predictedConflictCount = 0;
  let matchedConflictCount = 0;
  let autoCriticalOmissionCount = 0;
  let criticalOmissionDetectionFailures = 0;
  let undetectedResourceConflictCount = 0;
  let shortageClassifiedFeasibleCount = 0;
  let deterministicReplayFailures = 0;

  const cases = answers.map((answerCase) => {
    const request = buildA5SimulationRequest(simulation, answerCase);
    const result = generateA5DailyPlan(request);
    const replay = generateA5DailyPlan(request);
    const deterministicReplayMatch = stableStringify(result) === stableStringify(replay);
    if (!deterministicReplayMatch) {
      deterministicReplayFailures += 1;
    }
    const decision = result.decisions.find(
      (candidate) => candidate.workItemId === answerCase.workItemIds[0],
    );
    if (decision === undefined) {
      throw new Error(`A5 result omitted decision ${answerCase.workItemIds[0]}`);
    }
    const actualEligible = decision.eligibility.eligible;
    if (actualEligible && answerCase.expectedEligible) {
      truePositive += 1;
    } else if (actualEligible) {
      falsePositive += 1;
    } else if (answerCase.expectedEligible) {
      falseNegative += 1;
    }
    const eligibleMatch = actualEligible === answerCase.expectedEligible;
    const planItem = result.draft?.content.items.find(
      (item) => item.workItemId === answerCase.workItemIds[0],
    );
    const actualPriority =
      planItem?.priorityRank ??
      (result.omittedCriticalWorkItemIds.includes(answerCase.workItemIds[0]!) ? 1 : null);
    const priorityMatch = actualPriority === answerCase.expectedPriority;
    const expectedTarget = answerCase.expectedDailyTarget?.value ?? null;
    const actualTarget = decision.dailyTarget.targetQuantity?.value ?? null;
    const targetMatch = numericTargetsMatch(expectedTarget, actualTarget);
    const expectedConflicts = [...answerCase.expectedConflicts].sort();
    const actualConflicts = normalizedConflictCodes(
      result,
      answerCase.workItemIds[0]!,
      expectedUniverse,
    );
    const expectedSet = new Set(expectedConflicts);
    const actualSet = new Set(actualConflicts);
    expectedConflictCount += expectedSet.size;
    predictedConflictCount += actualSet.size;
    matchedConflictCount += [...actualSet].filter((code) => expectedSet.has(code)).length;
    const conflictMatch =
      expectedConflicts.length === actualConflicts.length &&
      expectedConflicts.every((code, index) => code === actualConflicts[index]);

    if (
      answerCase.scenario === "CRITICAL_WORK_OMITTED" &&
      !actualSet.has("CRITICAL_WORK_OMITTED")
    ) {
      criticalOmissionDetectionFailures += 1;
    }
    if (
      ["EQUIPMENT_DOUBLE_BOOKING", "ZONE_CONFLICT"].includes(answerCase.scenario) &&
      !conflictMatch
    ) {
      undetectedResourceConflictCount += 1;
    }
    if (answerCase.scenario === "MATERIAL_SHORTAGE" && decision.dailyTarget.feasible) {
      shortageClassifiedFeasibleCount += 1;
    }

    const autoResult = generateA5DailyPlan(
      buildA5SimulationRequest(simulation, answerCase, "AUTO"),
    );
    autoCriticalOmissionCount += autoResult.omittedCriticalWorkItemIds.length;
    const pass =
      eligibleMatch && priorityMatch && targetMatch && conflictMatch && deterministicReplayMatch;
    return {
      caseId: answerCase.caseId,
      scenario: answerCase.scenario,
      eligibleMatch,
      priorityMatch,
      targetMatch,
      conflictMatch,
      deterministicReplayMatch,
      expectedEligible: answerCase.expectedEligible,
      actualEligible,
      expectedPriority: answerCase.expectedPriority,
      actualPriority,
      expectedTarget,
      actualTarget,
      expectedConflicts,
      actualConflicts,
      pass,
    };
  });

  const metrics = {
    casePassRate: ratio(cases.filter((item) => item.pass).length, cases.length),
    eligiblePrecision: ratio(truePositive, truePositive + falsePositive),
    eligibleRecall: ratio(truePositive, truePositive + falseNegative),
    priorityAccuracy: ratio(cases.filter((item) => item.priorityMatch).length, cases.length),
    targetAccuracy: ratio(cases.filter((item) => item.targetMatch).length, cases.length),
    conflictPrecision: ratio(matchedConflictCount, predictedConflictCount),
    conflictRecall: ratio(matchedConflictCount, expectedConflictCount),
    autoCriticalOmissionCount,
    criticalOmissionDetectionFailures,
    undetectedResourceConflictCount,
    shortageClassifiedFeasibleCount,
    deterministicReplayFailures,
  };
  const pass =
    Object.values(metrics)
      .slice(0, 7)
      .every((value) => value === 1) &&
    autoCriticalOmissionCount === 0 &&
    criticalOmissionDetectionFailures === 0 &&
    undetectedResourceConflictCount === 0 &&
    shortageClassifiedFeasibleCount === 0 &&
    deterministicReplayFailures === 0;
  return a5PlanningEvaluationReportV1Schema.parse({
    schemaVersion: 1,
    reportType: "A5_PLANNING_EVALUATION",
    seed: simulation.seed,
    generatedAt: simulation.generatedAt,
    deterministic: true,
    llmRequired: false,
    cases,
    metrics,
    pass,
  });
}

export function renderA5PlanningEvaluationMarkdown(report: A5PlanningEvaluationReportV1): string {
  const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
  return [
    "# A5 deterministic daily planning evaluation",
    "",
    `- Gate: **${report.pass ? "PASS" : "FAIL"}**`,
    `- Cases: ${report.cases.filter((item) => item.pass).length}/${report.cases.length}`,
    `- Eligible precision / recall: ${percent(report.metrics.eligiblePrecision)} / ${percent(report.metrics.eligibleRecall)}`,
    `- Priority / target accuracy: ${percent(report.metrics.priorityAccuracy)} / ${percent(report.metrics.targetAccuracy)}`,
    `- Conflict precision / recall: ${percent(report.metrics.conflictPrecision)} / ${percent(report.metrics.conflictRecall)}`,
    `- Auto critical omissions: ${report.metrics.autoCriticalOmissionCount}`,
    `- Undetected resource conflicts: ${report.metrics.undetectedResourceConflictCount}`,
    `- Shortage classified feasible: ${report.metrics.shortageClassifiedFeasibleCount}`,
    `- Replay failures: ${report.metrics.deterministicReplayFailures}`,
    "",
    "| Scenario | Eligibility | Priority | Target | Conflict | Replay | Result |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...report.cases.map(
      (item) =>
        `| ${item.scenario} | ${item.eligibleMatch ? "PASS" : "FAIL"} | ${item.priorityMatch ? "PASS" : "FAIL"} | ${item.targetMatch ? "PASS" : "FAIL"} | ${item.conflictMatch ? "PASS" : "FAIL"} | ${item.deterministicReplayMatch ? "PASS" : "FAIL"} | ${item.pass ? "PASS" : "FAIL"} |`,
    ),
    "",
  ].join("\n");
}
