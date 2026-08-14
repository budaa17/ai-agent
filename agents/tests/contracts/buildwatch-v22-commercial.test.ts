import { describe, expect, it } from "vitest";
import {
  approvedBaselineCommandV1Schema,
  approvedEstimateCommandV1Schema,
  approvedQuantityTakeoffCommandV1Schema,
  baselineDraftV1Schema,
  buildWatchReviewStateTransitionV1Schema,
  estimateDraftV1Schema,
  operationalPlanningSnapshotV1Schema,
  quantityTakeoffDraftV1Schema,
} from "../../src/contracts/index.js";
import {
  buildApprovedBaselineCommand,
  buildApprovedEstimateCommand,
  buildApprovedQuantityCommand,
  buildBaselineDraft,
  buildEstimateDraft,
  buildOperationalPlanningSnapshot,
  buildQuantityTakeoffDraft,
} from "./buildwatch-v22-fixtures.js";

describe("BuildWatch v2.2 quantity and estimate contracts", () => {
  it("accepts source-backed drafts and immutable approval commands", () => {
    expect(
      quantityTakeoffDraftV1Schema.parse(buildQuantityTakeoffDraft()).content.items,
    ).toHaveLength(1);
    expect(
      approvedQuantityTakeoffCommandV1Schema.parse(buildApprovedQuantityCommand()).approvedVersion
        .status,
    ).toBe("APPROVED");
    expect(estimateDraftV1Schema.parse(buildEstimateDraft()).content.totalMnt.value).toBe(
      "1150.00",
    );
    expect(
      approvedEstimateCommandV1Schema.parse(buildApprovedEstimateCommand()).idempotencyKey,
    ).toBe("approve-estimate-001");
  });

  it("rejects quantity without a verified scale", () => {
    const draft = buildQuantityTakeoffDraft();
    (
      draft.content as unknown as {
        scaleStatus: string;
      }
    ).scaleStatus = "CANDIDATE";

    expect(quantityTakeoffDraftV1Schema.safeParse(draft).success).toBe(false);
  });

  it("rejects source-less and cross-tenant quantity", () => {
    const sourceLess = buildQuantityTakeoffDraft();
    sourceLess.content.items[0]!.finalQuantity.sourceRefs = [];
    expect(quantityTakeoffDraftV1Schema.safeParse(sourceLess).success).toBe(false);

    const crossTenant = buildQuantityTakeoffDraft();
    crossTenant.content.items[0]!.baseQuantity.sourceRefs[0]!.tenantId = "tenant-private";
    expect(quantityTakeoffDraftV1Schema.safeParse(crossTenant).success).toBe(false);
  });

  it("rejects duplicate takeoff IDs and inconsistent units", () => {
    const duplicate = buildQuantityTakeoffDraft();
    duplicate.content.items.push(structuredClone(duplicate.content.items[0]!));
    expect(quantityTakeoffDraftV1Schema.safeParse(duplicate).success).toBe(false);

    const wrongUnit = buildQuantityTakeoffDraft();
    wrongUnit.content.items[0]!.finalQuantity.unit = "kg";
    expect(quantityTakeoffDraftV1Schema.safeParse(wrongUnit).success).toBe(false);
  });

  it("rejects malformed money and inconsistent estimate totals", () => {
    const malformed = buildEstimateDraft();
    malformed.content.lines[0]!.unitPriceMnt.value = "100";
    expect(estimateDraftV1Schema.safeParse(malformed).success).toBe(false);

    const inconsistent = buildEstimateDraft();
    inconsistent.content.totalMnt.value = "1149.00";
    expect(estimateDraftV1Schema.safeParse(inconsistent).success).toBe(false);
  });

  it("rejects an invalid generic review lifecycle transition", () => {
    expect(
      buildWatchReviewStateTransitionV1Schema.safeParse({
        schemaVersion: 1,
        transitionType: "REVIEW_LIFECYCLE",
        transitionId: "review-transition-001",
        tenantId: "tenant-demo",
        projectId: "project-atlas",
        targetType: "QUANTITY_TAKEOFF",
        targetId: "quantity-draft-001",
        fromStatus: "DRAFT",
        toStatus: "APPLIED",
        actorId: "user-estimator",
        actorRole: "ESTIMATOR",
        reason: null,
        transitionedAt: "2026-08-01T03:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("BuildWatch v2.2 baseline and operational snapshot", () => {
  it("accepts a reviewed baseline and minimal operational read model", () => {
    expect(baselineDraftV1Schema.parse(buildBaselineDraft()).content.activities).toHaveLength(1);
    expect(
      approvedBaselineCommandV1Schema.parse(buildApprovedBaselineCommand()).approvedVersion.status,
    ).toBe("APPROVED");
    expect(
      operationalPlanningSnapshotV1Schema.parse(buildOperationalPlanningSnapshot()).workItems[0]
        ?.remainingQuantity.value,
    ).toBe("50");
  });

  it("rejects dangling resources and cross-tenant sources", () => {
    const dangling = buildOperationalPlanningSnapshot();
    dangling.workItems[0]!.requiredEquipmentIds = ["equipment-missing"];
    expect(operationalPlanningSnapshotV1Schema.safeParse(dangling).success).toBe(false);

    const crossTenant = buildBaselineDraft();
    crossTenant.content.calendar.sourceRefs[0]!.projectId = "project-private";
    expect(baselineDraftV1Schema.safeParse(crossTenant).success).toBe(false);
  });
});
