import { describe, expect, it } from "vitest";
import {
  approvedDailyWorkPlanCommandV1Schema,
  approvedProgressVerificationCommandV1Schema,
  dailyWorkPlanDraftV1Schema,
  dailyWorkPlanStateTransitionV1Schema,
  operationalForecastSnapshotV1Schema,
  progressVerificationDraftV1Schema,
  recoveryProposalDraftV1Schema,
  rollingProductivitySnapshotV1Schema,
} from "../../src/contracts/index.js";
import {
  buildApprovedDailyWorkPlanCommand,
  buildApprovedProgressVerificationCommand,
  buildDailyWorkPlanDraft,
  buildOperationalForecastSnapshot,
  buildProgressVerificationDraft,
  buildRecoveryProposalDraft,
  buildRollingProductivitySnapshot,
} from "./buildwatch-v22-fixtures.js";

describe("BuildWatch v2.2 daily planning contracts", () => {
  it("accepts a feasible plan and its idempotent approval", () => {
    expect(
      dailyWorkPlanDraftV1Schema.parse(buildDailyWorkPlanDraft()).content.items[0]?.feasibility
        .feasible,
    ).toBe(true);
    expect(
      approvedDailyWorkPlanCommandV1Schema.parse(buildApprovedDailyWorkPlanCommand())
        .approvedVersion.status,
    ).toBe("APPROVED");
  });

  it("rejects invalid state transitions", () => {
    const result = dailyWorkPlanStateTransitionV1Schema.safeParse({
      schemaVersion: 1,
      transitionType: "DAILY_WORK_PLAN_STATE",
      transitionId: "transition-001",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      dailyWorkPlanVersionId: "daily-plan-version-001",
      fromStatus: "DRAFT",
      toStatus: "CLOSED",
      actorId: "user-manager",
      actorRole: "PROJECT_MANAGER",
      reason: "Invalid direct close",
      transitionedAt: "2026-08-01T06:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("rejects approval submission with infeasible work", () => {
    const draft = buildDailyWorkPlanDraft();
    draft.content.items[0]!.feasibility = {
      eligible: true,
      feasible: false,
      targetQuantity: null,
      limitingFactor: "INSUFFICIENT_INFORMATION",
      reasonCodes: ["MATERIAL_DATA_MISSING"],
      sourceRefs: draft.content.items[0]!.feasibility.sourceRefs,
    };

    expect(dailyWorkPlanDraftV1Schema.safeParse(draft).success).toBe(false);
  });

  it("rejects cross-tenant plan evidence", () => {
    const draft = buildDailyWorkPlanDraft();
    draft.content.items[0]!.sourceRefs[0]!.tenantId = "tenant-private";

    expect(dailyWorkPlanDraftV1Schema.safeParse(draft).success).toBe(false);
  });
});

describe("BuildWatch v2.2 progress verification contracts", () => {
  it("accepts completed evidence and an approval command", () => {
    expect(
      progressVerificationDraftV1Schema.parse(buildProgressVerificationDraft()).content.items[0]
        ?.completionStatus,
    ).toBe("COMPLETED");
    expect(
      approvedProgressVerificationCommandV1Schema.parse(buildApprovedProgressVerificationCommand())
        .approvedVersion.status,
    ).toBe("APPROVED");
  });

  it("rejects a photo-only verified quantity", () => {
    const draft = buildProgressVerificationDraft();
    const item = draft.content.items[0]!;
    item.verifiedQuantity!.sourceRefs = [structuredClone(item.photoChecks[0]!.sourceRefs[0]!)];

    expect(progressVerificationDraftV1Schema.safeParse(draft).success).toBe(false);
  });

  it("rejects completed work with incomplete evidence", () => {
    const draft = buildProgressVerificationDraft();
    draft.content.items[0]!.evidenceCoverage.acceptedCount = 0;
    draft.content.items[0]!.evidenceCoverage.coveragePercent = 0;

    expect(progressVerificationDraftV1Schema.safeParse(draft).success).toBe(false);
  });
});

describe("BuildWatch v2.2 productivity, forecast, and recovery contracts", () => {
  it("accepts rolling windows, a threshold-consistent forecast, and recovery", () => {
    expect(
      rollingProductivitySnapshotV1Schema.parse(buildRollingProductivitySnapshot()).workItems[0]
        ?.windows,
    ).toHaveLength(3);
    expect(
      operationalForecastSnapshotV1Schema.parse(buildOperationalForecastSnapshot()).status,
    ).toBe("AT_RISK");
    expect(recoveryProposalDraftV1Schema.parse(buildRecoveryProposalDraft()).baselineChanged).toBe(
      false,
    );
  });

  it("caps cold-start confidence at 0.60", () => {
    const snapshot = buildRollingProductivitySnapshot();
    snapshot.workItems[0]!.windows[1]!.confidence = 0.61;

    expect(rollingProductivitySnapshotV1Schema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects a forecast status that conflicts with thresholds", () => {
    const forecast = buildOperationalForecastSnapshot();
    forecast.status = "ON_TRACK";

    expect(operationalForecastSnapshotV1Schema.safeParse(forecast).success).toBe(false);
  });

  it("rejects cross-tenant recovery evidence", () => {
    const recovery = buildRecoveryProposalDraft();
    recovery.sourceRefs[0]!.tenantId = "tenant-private";

    expect(recoveryProposalDraftV1Schema.safeParse(recovery).success).toBe(false);
  });
});
