import { describe, expect, it } from "vitest";
import {
  buildPhase7Decision,
  buildPhase7ScheduleRequest,
} from "../../src/baseline-generation/fixtures.js";
import { runPhase7GoldenPipeline } from "../../src/baseline-generation/pipeline.js";
import {
  approveBaseline,
  approveSchedule,
  calculateCpmSchedule,
  createCommercialReviewTransition,
  generateScheduleDraft,
} from "../../src/baseline-generation/schedule.js";

describe("Phase 7 WBS, schedule, and CPM", () => {
  it("derives duration, resources, WBS, calendar dates, and critical path", () => {
    const pipeline = runPhase7GoldenPipeline();
    const schedule = pipeline.approvedSchedule.content;
    expect(pipeline.scheduleResult.complete).toBe(true);
    expect(schedule.activities).toHaveLength(5);
    expect(schedule.dependencies).toHaveLength(4);
    expect(schedule.plannedStart).toBe("2026-08-03");
    expect(schedule.plannedFinish).toBe("2026-08-13");
    expect(
      Object.fromEntries(
        schedule.activities.map((activity) => [
          activity.code,
          {
            duration: activity.durationWorkingDays,
            start: activity.plannedStart,
            end: activity.plannedEnd,
            critical: activity.isCritical,
          },
        ]),
      ),
    ).toMatchObject({
      "WALL-AAC-200": {
        duration: 3,
        start: "2026-08-03",
        end: "2026-08-06",
        critical: true,
      },
      "FLOOR-TILE": { duration: 3, start: "2026-08-07", end: "2026-08-10" },
      "SLAB-CONCRETE": { duration: 2, start: "2026-08-11", end: "2026-08-12" },
      "BEAM-FORMWORK": { duration: 2, start: "2026-08-12", end: "2026-08-13" },
      "DOOR-INSTALL": { duration: 1, start: "2026-08-07", end: "2026-08-07" },
    });
    expect(
      schedule.activities.every(
        (activity) =>
          (activity.wbsCode?.length ?? 0) > 0 &&
          activity.productivityVersion?.catalogType === "PRODUCTIVITY" &&
          activity.resourceRequirements.length > 0,
      ),
    ).toBe(true);
  });

  it("supports FS, SS, FF, and SF constraints and rejects cycles", () => {
    const activities = [
      { activityId: "A", durationWorkingDays: 3 },
      { activityId: "B", durationWorkingDays: 2 },
    ];
    const dependency = (
      type: "FINISH_TO_START" | "START_TO_START" | "FINISH_TO_FINISH" | "START_TO_FINISH",
    ) => [
      {
        predecessorActivityId: "A",
        successorActivityId: "B",
        type,
        lagWorkingDays: 0,
      },
    ];
    expect(
      calculateCpmSchedule(activities, dependency("FINISH_TO_START")).activities.find(
        (item) => item.activityId === "B",
      )?.earliestStartOffset,
    ).toBe(3);
    expect(
      calculateCpmSchedule(activities, dependency("START_TO_START")).activities.find(
        (item) => item.activityId === "B",
      )?.earliestStartOffset,
    ).toBe(0);
    expect(
      calculateCpmSchedule(activities, dependency("FINISH_TO_FINISH")).activities.find(
        (item) => item.activityId === "B",
      )?.earliestStartOffset,
    ).toBe(1);
    expect(
      calculateCpmSchedule(activities, dependency("START_TO_FINISH")).activities.find(
        (item) => item.activityId === "B",
      )?.earliestStartOffset,
    ).toBe(0);
    expect(() =>
      calculateCpmSchedule(activities, [
        ...dependency("FINISH_TO_START"),
        {
          predecessorActivityId: "B",
          successorActivityId: "A",
          type: "FINISH_TO_START",
          lagWorkingDays: 0,
        },
      ]),
    ).toThrow("cycle");
  });

  it("blocks approval when productivity or work-template inputs are missing", () => {
    const pipeline = runPhase7GoldenPipeline();
    const request = buildPhase7ScheduleRequest({
      approvedQuantity: pipeline.quantityCommand.approvedVersion,
      approvedEstimate: pipeline.estimateCommand.approvedVersion,
    });
    request.productivityRates = request.productivityRates.filter(
      (rate) => rate.workCode !== "WALL-AAC-200",
    );
    const result = generateScheduleDraft({
      request,
      approvedQuantity: pipeline.quantityCommand.approvedVersion,
      approvedEstimate: pipeline.estimateCommand.approvedVersion,
    });
    expect(result.complete).toBe(false);
    expect(result.draft?.status).toBe("NEEDS_CORRECTION");
    expect(
      result.issues.some((issue) => issue.code === "SCHEDULE_PRODUCTIVITY_MISSING_OR_AMBIGUOUS"),
    ).toBe(true);
    expect(() =>
      approveSchedule({
        draft: result.draft!,
        decision: buildPhase7Decision("SCHEDULE_APPROVAL"),
      }),
    ).toThrow("error-free schedule");
  });

  it("supports explicit reject and request-changes lifecycle transitions", () => {
    const pipeline = runPhase7GoldenPipeline();
    const rejectionDecision = {
      ...buildPhase7Decision("SCHEDULE_APPROVAL"),
      action: "REJECT" as const,
      reason: "Dependency source requires correction",
    };
    const transition = createCommercialReviewTransition({
      transitionId: "schedule-reject-transition",
      tenantId: pipeline.approvedSchedule.tenantId,
      projectId: pipeline.approvedSchedule.projectId,
      targetType: "SCHEDULE",
      targetId: pipeline.approvedSchedule.scheduleVersionId,
      fromStatus: "REVIEW_REQUIRED",
      toStatus: "REJECTED",
      decision: rejectionDecision,
    });
    expect(transition).toMatchObject({
      targetType: "SCHEDULE",
      toStatus: "REJECTED",
      reason: "Dependency source requires correction",
    });
  });
});

describe("Phase 7 immutable baseline approval", () => {
  it("composes matching approved lineage and freezes the baseline", () => {
    const pipeline = runPhase7GoldenPipeline();
    const approved = pipeline.baselineCommand.approvedVersion;
    expect(approved.content).toMatchObject({
      quantityTakeoffVersionId: "quantity-version-phase7",
      estimateVersionId: "estimate-version-phase7",
      scheduleVersionId: "schedule-version-phase7",
      budgetMnt: "7078825.00",
    });
    expect(approved.metadata).toMatchObject({
      version: 1,
      supersedesVersionId: null,
    });
    expect(pipeline.baselineCommand.changeReason).toBeNull();
    expect(Object.isFrozen(approved.content.activities)).toBe(true);
  });

  it("requires a changed draft and reason for every superseding version", () => {
    const pipeline = runPhase7GoldenPipeline();
    const previous = pipeline.baselineCommand.approvedVersion;
    const changedDraft = structuredClone(pipeline.baselineDraft);
    changedDraft.draftId = "baseline-draft-phase7-v2";
    changedDraft.content.plannedFinish = "2026-08-14";
    const decision = {
      ...buildPhase7Decision("BASELINE_APPROVAL"),
      decisionId: "decision-baseline-manager-v2",
      decidedAt: "2026-08-03T02:00:00.000Z",
    };
    expect(() =>
      approveBaseline({
        commandId: "baseline-command-v2-missing-reason",
        idempotencyKey: "baseline-v2-missing-reason",
        baselineVersionId: "baseline-version-phase7-v2",
        draft: changedDraft,
        decision,
        previousVersion: previous,
      }),
    ).toThrow("change reason");
    const superseding = approveBaseline({
      commandId: "baseline-command-v2",
      idempotencyKey: "baseline-v2",
      baselineVersionId: "baseline-version-phase7-v2",
      draft: changedDraft,
      decision,
      previousVersion: previous,
      changeReason: "Approved holiday calendar changed the forecast finish",
    });
    expect(superseding.approvedVersion.metadata).toMatchObject({
      version: 2,
      supersedesVersionId: "baseline-version-phase7",
    });
    expect(superseding.changeReason).toBe("Approved holiday calendar changed the forecast finish");
    expect(() =>
      approveBaseline({
        commandId: "baseline-command-unchanged",
        idempotencyKey: "baseline-unchanged",
        baselineVersionId: "baseline-version-unchanged",
        draft: pipeline.baselineDraft,
        decision,
        previousVersion: previous,
        changeReason: "No actual change",
      }),
    ).toThrow("unchanged baseline");
  });
});
