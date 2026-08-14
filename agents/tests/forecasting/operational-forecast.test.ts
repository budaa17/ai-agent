import {
  calculateOperationalForecast,
  OperationalForecastGateway,
} from "../../src/forecasting/index.js";
import { buildV22Source } from "../contracts/buildwatch-v22-fixtures.js";
import {
  buildAppliedProgressSample,
  buildOperationalForecastRequest,
} from "./operational-forecast-fixtures.js";

function workItemCalculation(
  result: ReturnType<typeof calculateOperationalForecast>,
  workItemId = "work-item-001",
) {
  return result.workItemCalculations.find((calculation) => calculation.workItemId === workItemId)!;
}

function factorValue(
  result: ReturnType<typeof calculateOperationalForecast>,
  factorName: ReturnType<typeof workItemCalculation>["factors"][number]["factor"],
) {
  return Number(
    workItemCalculation(result).factors.find((factor) => factor.factor === factorName)!.value,
  );
}

function addDependentWorkItem(request: ReturnType<typeof buildOperationalForecastRequest>): void {
  const sourceWorkItem = request.operationalSnapshot.workItems[0]!;
  request.operationalSnapshot.workItems.push({
    ...structuredClone(sourceWorkItem),
    workItemId: "work-item-002",
    activityId: "activity-002",
    code: "WALL-AAC-201",
    name: "Dependent AAC wall construction",
    plannedQuantity: {
      ...structuredClone(sourceWorkItem.plannedQuantity),
      value: "20",
    },
    remainingQuantity: {
      ...structuredClone(sourceWorkItem.remainingQuantity),
      value: "20",
    },
    plannedStart: "2026-08-13",
    plannedFinish: "2026-08-20",
    predecessorWorkItemIds: ["work-item-001"],
    requiredInspectionIds: [],
  });
  const sourceActivity = request.approvedBaseline.content.activities[0]!;
  request.approvedBaseline.content.activities.push({
    ...structuredClone(sourceActivity),
    activityId: "activity-002",
    workItemId: "work-item-002",
    code: "WALL-AAC-201",
    name: "Dependent AAC wall construction",
    plannedQuantity: {
      ...structuredClone(sourceActivity.plannedQuantity),
      value: "20",
    },
    durationWorkingDays: 2,
    plannedStart: "2026-08-13",
    plannedEnd: "2026-08-20",
  });
  request.approvedBaseline.content.dependencies.push({
    dependencyId: "dependency-001-002",
    predecessorActivityId: "activity-001",
    successorActivityId: "activity-002",
    type: "FINISH_TO_START",
    lagWorkingDays: 0,
    sourceRefs: sourceActivity.sourceRefs,
  });
}

describe("BuildWatch v2.2 deterministic operational forecast", () => {
  it("calculates rolling productivity, finish, confidence, and recovery without an LLM", () => {
    const result = calculateOperationalForecast(buildOperationalForecastRequest());

    expect(result.rollingProductivity.workItems[0]?.selectedWindowWorkingDays).toBe(3);
    expect(result.rollingProductivity.workItems[0]?.selectedProductivity?.value).toBe("10");
    expect(result.forecast.status).toBe("LIKELY_LATE");
    expect(result.forecast.delayWorkingDays?.value).toBe(7);
    expect(result.forecast.projectedCriticalPathWorkItemIds).toEqual(["work-item-001"]);
    expect(result.forecast.confidence).toBeGreaterThan(0.7);
    expect(result.recoveryProposals).toHaveLength(3);
    expect(result.deterministic).toBe(true);
    expect(result.llmRequired).toBe(false);
    expect(result.baselineChanged).toBe(false);
  });

  it("normalizes historical productivity to the approved reference crew shift", () => {
    const request = buildOperationalForecastRequest();
    request.appliedProgress = [
      buildAppliedProgressSample("2026-08-13", 10, { laborHours: 24 }),
      buildAppliedProgressSample("2026-08-14", 10, { laborHours: 24 }),
      buildAppliedProgressSample("2026-08-15", 10, { laborHours: 24 }),
    ];

    const result = calculateOperationalForecast(request);

    expect(result.productivityCalculations[0]?.normalizationFactor).toBe("2");
    expect(result.rollingProductivity.workItems[0]?.selectedProductivity?.value).toBe("20");
    expect(factorValue(result, "RECENT_PACE")).toBe(2);
  });

  it("marks MAD outliers but keeps them until an authorized human excludes them", () => {
    const request = buildOperationalForecastRequest();
    const outlier = buildAppliedProgressSample("2026-08-12", 100);
    request.appliedProgress.push(outlier);
    const sampleId = outlier.productivitySamples[0]!.productivitySampleId;

    const unreviewed = calculateOperationalForecast(request);
    const unreviewedSample = unreviewed.rollingProductivity.workItems[0]!.samples.find(
      (sample) => sample.sampleId === sampleId,
    )!;
    expect(unreviewedSample.outlierCandidate).toBe(true);
    expect(unreviewedSample.included).toBe(true);

    request.outlierReviews.push({
      reviewId: "outlier-review-001",
      productivitySampleId: sampleId,
      decision: "EXCLUDE",
      reviewerId: "user-project-manager",
      reviewerRole: "PROJECT_MANAGER",
      reviewedAt: "2026-08-15T15:30:00.000Z",
      reason: "Confirmed one-off measurement error",
      sourceRefs: [
        buildV22Source("outlier-review-source", {
          sourceType: "HUMAN_DECISION",
          asOf: "2026-08-15T15:30:00.000Z",
        }),
      ],
    });
    const reviewed = calculateOperationalForecast(request);
    const reviewedSample = reviewed.rollingProductivity.workItems[0]!.samples.find(
      (sample) => sample.sampleId === sampleId,
    )!;
    expect(reviewedSample.included).toBe(false);
    expect(reviewedSample.exclusionReason).toBe("REVIEWER_EXCLUDED_OUTLIER");
  });

  it("applies the versioned blocked-day policy", () => {
    const request = buildOperationalForecastRequest();
    request.operationalSnapshot.blockers.push({
      blockerId: "blocker-phase5-001",
      workItemId: "work-item-001",
      category: "MATERIAL",
      isOpen: true,
      approved: true,
      startedOn: "2026-08-14",
      resolvedOn: "2026-08-15",
      sourceRefs: [
        buildV22Source("blocker-phase5-source", {
          sourceType: "BLOCKER",
          asOf: "2026-08-14T08:00:00.000Z",
        }),
      ],
    });

    const excluded = calculateOperationalForecast(request);
    expect(
      excluded.rollingProductivity.workItems[0]!.samples.find(
        (sample) => sample.reportDate === "2026-08-14",
      )?.exclusionReason,
    ).toBe("BLOCKED_DAY_POLICY");

    request.policy.blockedDayHandling = "INCLUDE_AS_ZERO";
    const included = calculateOperationalForecast(request);
    const blockedSample = included.rollingProductivity.workItems[0]!.samples.find(
      (sample) => sample.reportDate === "2026-08-14",
    )!;
    expect(blockedSample.included).toBe(true);
    expect(blockedSample.quantity?.value).toBe("0");
  });

  it("uses an approved norm for cold start and caps confidence", () => {
    const request = buildOperationalForecastRequest();
    request.appliedProgress = request.appliedProgress.slice(0, 1);

    const result = calculateOperationalForecast(request);

    expect(
      result.rollingProductivity.workItems[0]!.windows.every(
        (window) => window.method === "COLD_START_NORM",
      ),
    ).toBe(true);
    expect(
      Math.max(
        ...result.rollingProductivity.workItems[0]!.windows.map((window) => window.confidence),
      ),
    ).toBeLessThanOrEqual(0.6);
  });

  it("uses the approved baseline rate only when the fallback policy permits it", () => {
    const request = buildOperationalForecastRequest();
    request.productivityNorms = [];
    request.appliedProgress = [];

    const fallback = calculateOperationalForecast(request);
    expect(
      fallback.rollingProductivity.workItems[0]!.windows.every(
        (window) => window.method === "BASELINE_RATE_FALLBACK",
      ),
    ).toBe(true);

    request.policy.fallbackMethod = "APPROVED_NORM_ONLY";
    const insufficient = calculateOperationalForecast(request);
    expect(insufficient.forecast.status).toBe("INSUFFICIENT_DATA");
    expect(insufficient.forecast.projectedFinish).toBeNull();
    expect(insufficient.recoveryProposals).toEqual([]);
  });

  it("applies crew, equipment, material, weather, learning, blocker, and calendar factors", () => {
    const request = buildOperationalForecastRequest();
    request.operationalSnapshot.crews[0]!.headcount = 3;
    request.operationalSnapshot.crews[0]!.shiftEnd = "14:00";
    request.operationalSnapshot.equipment[0]!.available = false;
    request.operationalSnapshot.materials[0]!.availableQuantity.value = "25";
    request.operationalSnapshot.materials[0]!.reservedQuantity.value = "0";
    request.operationalSnapshot.weatherConstraints.push({
      weatherConstraintId: "weather-phase5-001",
      date: "2026-08-17",
      weatherCode: "HEAVY_RAIN",
      restrictedWorkClassCodes: ["MASONRY"],
      sourceRefs: [
        buildV22Source("weather-phase5-source", {
          sourceType: "WEATHER_LOGISTICS",
          asOf: "2026-08-15T08:00:00.000Z",
        }),
      ],
    });
    request.operationalSnapshot.blockers.push({
      blockerId: "blocker-open-phase5-001",
      workItemId: "work-item-001",
      category: "ACCESS",
      isOpen: true,
      approved: true,
      startedOn: "2026-08-15",
      resolvedOn: null,
      sourceRefs: [
        buildV22Source("blocker-open-phase5-source", {
          sourceType: "BLOCKER",
          asOf: "2026-08-15T08:00:00.000Z",
        }),
      ],
    });
    request.learningAdjustments.push({
      adjustmentId: "learning-phase5-001",
      workItemId: "work-item-001",
      factor: "1.1",
      reason: "Approved learning curve",
      effectiveFrom: "2026-08-10",
      sourceRefs: [
        buildV22Source("learning-phase5-source", {
          sourceType: "HUMAN_DECISION",
          asOf: "2026-08-10T08:00:00.000Z",
        }),
      ],
    });
    request.operationalSnapshot.calendar.workHoursPerDay = 6;

    const result = calculateOperationalForecast(request);

    expect(factorValue(result, "CREW_SIZE")).toBe(0.5);
    expect(factorValue(result, "SHIFT")).toBe(0.75);
    expect(factorValue(result, "EQUIPMENT")).toBe(0.5);
    expect(factorValue(result, "MATERIAL")).toBe(0.25);
    expect(factorValue(result, "WEATHER")).toBeLessThan(1);
    expect(factorValue(result, "LEARNING")).toBe(1.1);
    expect(factorValue(result, "BLOCKER")).toBe(0.5);
    expect(factorValue(result, "CALENDAR")).toBe(0.75);
    expect(result.forecast.drivers.map((driver) => driver.type)).toEqual(
      expect.arrayContaining(["CREW", "EQUIPMENT", "MATERIAL", "WEATHER", "BLOCKER"]),
    );
  });

  it("propagates approved finish-to-start dependencies", () => {
    const request = buildOperationalForecastRequest();
    addDependentWorkItem(request);

    const result = calculateOperationalForecast(request);
    const calculation = workItemCalculation(result, "work-item-002");
    const forecast = result.forecast.workItems.find((item) => item.workItemId === "work-item-002")!;

    expect(calculation.dependencyProjectedFinish).not.toBe(calculation.ownProjectedFinish);
    expect(result.forecast.projectedCriticalPathWorkItemIds).toEqual([
      "work-item-001",
      "work-item-002",
    ]);
    expect(forecast.drivers.map((driver) => driver.type)).toContain("DEPENDENCY");
  });

  it("rejects cyclic operational dependencies", () => {
    const request = buildOperationalForecastRequest();
    addDependentWorkItem(request);
    request.operationalSnapshot.workItems[0]!.predecessorWorkItemIds = ["work-item-002"];

    expect(() => calculateOperationalForecast(request)).toThrow(
      "dependency graph contains a cycle",
    );
  });

  it("creates review-only recovery drafts without modifying the baseline", () => {
    const result = calculateOperationalForecast(buildOperationalForecastRequest());

    expect(result.recoveryProposals.every((proposal) => proposal.requiresHumanReview)).toBe(true);
    expect(result.recoveryProposals.every((proposal) => !proposal.baselineChanged)).toBe(true);
    expect(
      result.recoveryProposals.every(
        (proposal) => proposal.estimatedScheduleImpactWorkingDays.value < 0,
      ),
    ).toBe(true);
  });

  it("marks a parallelization option as conflicted when zone capacity is one", () => {
    const request = buildOperationalForecastRequest();
    request.operationalSnapshot.zones[0]!.maxConcurrentActivities = 1;

    const result = calculateOperationalForecast(request);
    const proposal = result.recoveryProposals.find(
      (candidate) => candidate.actions[0]?.type === "PARALLELIZE_WORK",
    )!;

    expect(proposal.status).toBe("DRAFT");
    expect(proposal.dependencyConflictIds).toContain("zone-capacity-Z-01");
  });

  it("gives A2 only sourced deterministic numbers", () => {
    const result = calculateOperationalForecast(buildOperationalForecastRequest());

    expect(result.a2NarrativeInput.numericAuthority).toBe("A5_DETERMINISTIC_ONLY");
    expect(result.a2NarrativeInput.a2MayCreateNumericFacts).toBe(false);
    expect(result.a2NarrativeInput.delayWorkingDays).toBe(result.forecast.delayWorkingDays?.value);
    expect(result.a2NarrativeInput.driverIds).toEqual(
      result.forecast.drivers.map((driver) => driver.driverId),
    );
    expect(result.a2NarrativeInput.sourceRefs.length).toBeGreaterThan(0);
  });

  it("is deterministic when semantically unordered inputs arrive in a new order", () => {
    const first = buildOperationalForecastRequest();
    const second = structuredClone(first);
    second.appliedProgress.reverse();
    second.recoveryOptions.reverse();

    const firstResult = calculateOperationalForecast(first);
    const secondResult = calculateOperationalForecast(second);

    expect(secondResult.requestHash).toBe(firstResult.requestHash);
    expect(secondResult).toEqual(firstResult);
  });

  it("makes gateway replay idempotent and rejects changed content", () => {
    const request = buildOperationalForecastRequest();
    const gateway = new OperationalForecastGateway();
    const first = gateway.calculate(request);

    expect(gateway.calculate(structuredClone(request))).toBe(first);
    const changed = structuredClone(request);
    changed.operationalSnapshot.workItems[0]!.remainingQuantity.value = "45";
    expect(() => gateway.calculate(changed)).toThrow("idempotency key");
  });

  it("rejects cross-tenant and future applied evidence", () => {
    const outsideScope = buildOperationalForecastRequest();
    outsideScope.tenantId = "tenant-private";
    expect(() => calculateOperationalForecast(outsideScope)).toThrow();

    const futureEvidence = buildOperationalForecastRequest();
    futureEvidence.appliedProgress[0]!.reportDate = "2026-08-16";
    expect(() => calculateOperationalForecast(futureEvidence)).toThrow(
      "Applied progress is outside forecast scope or as-of boundary",
    );
  });
});
