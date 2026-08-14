import { describe, expect, it } from "vitest";
import type { ProgressVerificationRequestV1 } from "../../src/verification/index.js";
import {
  applyApprovedProgressVerification,
  approveProgressVerificationDraft,
  generateProgressVerification,
  ProgressVerificationApplyGateway,
  ProgressVerificationApprovalGateway,
  ProgressVerificationGateway,
} from "../../src/verification/index.js";
import {
  buildProgressVerificationRequest,
  setZeroActual,
} from "./progress-verification-fixtures.js";

function firstItem(request: ProgressVerificationRequestV1) {
  const result = generateProgressVerification(request);
  return { result, item: result.draft.content.items[0]! };
}

function setPartialActual(
  request: ProgressVerificationRequestV1,
  reportedStatus: "IN_PROGRESS" | "COMPLETED" = "IN_PROGRESS",
): void {
  const actual = request.approvedActual.workItemActuals[0]!;
  actual.declaredActualQuantity!.value = "5";
  actual.declaredCumulativeQuantity!.value = "55";
  actual.declaredProgressPercent = 50;
  actual.reportedStatus = reportedStatus;
  request.approvedActual.materialInputs[0]!.quantity!.value = "50";
}

function invalidatePhoto(
  request: ProgressVerificationRequestV1,
  code: "PE-03" | "PE-04" | "PE-06",
): void {
  const evaluation = request.photoEvaluations[0]!;
  const photo = evaluation.photoResults[0]!;
  const check = photo.checks.find((candidate) => candidate.code === code)!;
  check.result = "FAIL";
  check.score = 0;
  photo.usableForEvidence = false;
  photo.acceptedForVerification = false;
  if (code === "PE-03") {
    photo.exactDuplicateOfPhotoId = "phase4-photo-previous-001";
  }
  if (code === "PE-04") {
    photo.reusedFromReportDate = "2026-07-31";
  }
  evaluation.coverage.usableCount = 0;
  evaluation.coverage.creditedCount = 0;
  evaluation.coverage.coveragePercent = 0;
  evaluation.coverage.evidenceComplete = false;
  evaluation.automaticEvidenceAcceptanceAllowed = false;
}

function removePhotoEvidence(request: ProgressVerificationRequestV1): void {
  const evaluation = request.photoEvaluations[0]!;
  evaluation.photoResults = [];
  evaluation.coverage.submittedCount = 0;
  evaluation.coverage.usableCount = 0;
  evaluation.coverage.creditedCount = 0;
  evaluation.coverage.coveragePercent = 0;
  evaluation.coverage.observedAngles = [];
  evaluation.coverage.missingAngles = ["OVERVIEW"];
  evaluation.coverage.requiredAnglesComplete = false;
  evaluation.coverage.referenceMarkerPresent = false;
  evaluation.coverage.evidenceComplete = false;
  evaluation.automaticEvidenceAcceptanceAllowed = false;
}

function setBlocker(
  request: ProgressVerificationRequestV1,
  approvedOperationalBlockerId: string | null,
): void {
  const actual = request.approvedActual.workItemActuals[0]!;
  actual.blockerCandidate = {
    blockerCandidateId: "phase4-blocker-candidate-001",
    category: "MATERIAL",
    description: "Баталгаат материалын саатал",
    isBlocking: true,
    startedOn: request.reportDate,
    responsibleParty: "Нийлүүлэгч",
    approvedOperationalBlockerId,
    sourceRefs: actual.sourceRefs,
  };
}

function usePercentMeasurement(
  request: ProgressVerificationRequestV1,
  mode: "CHECKLIST" | "WEIGHTED_MILESTONE",
  completionPercent: number,
): void {
  const planItem = request.approvedPlan.content.items[0]!;
  planItem.unit = "percent";
  planItem.plannedQuantity.value = "100";
  planItem.plannedQuantity.unit = "percent";
  const targetQuantity = planItem.feasibility.targetQuantity;
  if (targetQuantity === null) {
    throw new Error("Fixture requires a target quantity");
  }
  targetQuantity.value = "100";
  targetQuantity.unit = "percent";
  for (const resource of planItem.resources) {
    if (resource.capacity !== null) {
      resource.capacity.value = "100";
      resource.capacity.unit = "percent";
    }
  }
  planItem.materials = [];

  const actual = request.approvedActual.workItemActuals[0]!;
  actual.declaredActualQuantity!.value = String(completionPercent);
  actual.declaredActualQuantity!.unit = "percent";
  actual.declaredCumulativeQuantity!.value = String(completionPercent);
  actual.declaredCumulativeQuantity!.unit = "percent";
  actual.declaredProgressPercent = completionPercent;
  actual.reportedStatus = completionPercent === 100 ? "COMPLETED" : "IN_PROGRESS";
  request.approvedActual.materialInputs = [];
  request.measurementConfigurations[0]!.mode = mode;
  request.checklists[0]!.status = "PASSED";
  request.checklists[0]!.completionPercent =
    mode === "WEIGHTED_MILESTONE" ? String(completionPercent) : null;
}

function buildApprovalInput(result: ReturnType<typeof generateProgressVerification>) {
  return {
    schemaVersion: 1 as const,
    requestType: "APPROVE_PROGRESS_VERIFICATION_DRAFT" as const,
    commandId: "phase4-approve-command-001",
    idempotencyKey: "phase4-approve-idempotency-001",
    progressVerificationVersionId: "phase4-verification-version-001",
    version: 1,
    supersedesVersionId: null,
    draft: result.draft,
    approvedContent: structuredClone(result.draft.content),
    decision: {
      decisionId: "phase4-manager-decision-001",
      action: "APPROVE" as const,
      reviewerId: "user-project-manager",
      reviewerRole: "PROJECT_MANAGER" as const,
      decidedAt: "2026-08-01T14:00:00.000Z",
      reason: null,
      correctedFieldPaths: [] as string[],
    },
  };
}

describe("BuildWatch v2.2 deterministic progress verification", () => {
  it("marks fully evidenced target quantity as COMPLETED", () => {
    const request = buildProgressVerificationRequest();
    const { result, item } = firstItem(request);

    expect(result.deterministic).toBe(true);
    expect(result.llmRequired).toBe(false);
    expect(result.draft.status).toBe("REVIEW_REQUIRED");
    expect(item.completionStatus).toBe("COMPLETED");
    expect(item.verifiedQuantity?.value).toBe("10");
    expect(item.completionRatePercent).toBe("100");
    expect(item.variance?.quantity.value).toBe("0");
    expect(item.issues).toEqual([]);
  });

  it("marks measured progress below target as PARTIALLY_COMPLETED", () => {
    const request = buildProgressVerificationRequest();
    setPartialActual(request);
    const { item } = firstItem(request);

    expect(item.completionStatus).toBe("PARTIALLY_COMPLETED");
    expect(item.verifiedQuantity?.value).toBe("5");
    expect(item.completionRatePercent).toBe("50");
    expect(item.variance?.quantity.value).toBe("-5");
    expect(item.variance?.percentage).toBe("-50");
  });

  it("does not accept a false COMPLETED declaration", () => {
    const request = buildProgressVerificationRequest();
    setPartialActual(request, "COMPLETED");
    const { item } = firstItem(request);

    expect(item.completionStatus).toBe("PARTIALLY_COMPLETED");
    expect(item.verifiedQuantity?.value).toBe("5");
    expect(item.issues.map((issue) => issue.code)).toContain("FALSE_COMPLETED_CLAIM");
  });

  it("distinguishes NOT_COMPLETED from NOT_STARTED", () => {
    const started = buildProgressVerificationRequest();
    setZeroActual(started, "IN_PROGRESS");
    expect(firstItem(started).item.completionStatus).toBe("NOT_COMPLETED");

    const notStarted = buildProgressVerificationRequest();
    setZeroActual(notStarted, "PLANNED");
    notStarted.approvedActual.attendanceInputs = [];
    notStarted.approvedActual.equipmentInputs = [];
    expect(firstItem(notStarted).item.completionStatus).toBe("NOT_STARTED");
  });

  it("uses BLOCKED only for an approved operational blocker", () => {
    const approved = buildProgressVerificationRequest();
    setZeroActual(approved, "BLOCKED");
    setBlocker(approved, "operational-blocker-001");
    expect(firstItem(approved).item.completionStatus).toBe("BLOCKED");

    const unapproved = buildProgressVerificationRequest();
    setZeroActual(unapproved, "BLOCKED");
    setBlocker(unapproved, null);
    const { item } = firstItem(unapproved);
    expect(item.completionStatus).toBe("UNVERIFIABLE");
    expect(item.verifiedQuantity).toBeNull();
    expect(item.issues.map((issue) => issue.code)).toContain("UNAPPROVED_BLOCKER");
  });

  it("never invents quantity when the approved actual is missing it", () => {
    const request = buildProgressVerificationRequest();
    const actual = request.approvedActual.workItemActuals[0]!;
    actual.declaredActualQuantity = null;
    actual.declaredProgressPercent = null;
    const { item } = firstItem(request);

    expect(item.declaredQuantity).toBeNull();
    expect(item.verifiedQuantity).toBeNull();
    expect(item.completionRatePercent).toBeNull();
    expect(item.completionStatus).toBe("UNVERIFIABLE");
    expect(item.issues.map((issue) => issue.code)).toContain("MISSING_DECLARED_QUANTITY");
  });

  it.each([
    ["PE-03", "PHOTO_DUPLICATE_OR_NEAR_DUPLICATE"],
    ["PE-04", "PHOTO_PREVIOUS_DAY_REUSE"],
    ["PE-06", "REPORT_PHOTO_MISMATCH"],
  ] as const)("turns %s evidence failure into UNVERIFIABLE", (code, issueCode) => {
    const request = buildProgressVerificationRequest();
    invalidatePhoto(request, code);
    const { item } = firstItem(request);

    expect(item.completionStatus).toBe("UNVERIFIABLE");
    expect(item.verifiedQuantity).toBeNull();
    expect(item.issues.map((issue) => issue.code)).toContain(issueCode);
  });

  it("rejects incomplete photo coverage without guessing", () => {
    const request = buildProgressVerificationRequest();
    removePhotoEvidence(request);
    const { item } = firstItem(request);

    expect(item.completionStatus).toBe("UNVERIFIABLE");
    expect(item.verifiedQuantity).toBeNull();
    expect(item.evidenceCoverage.acceptedCount).toBe(0);
    expect(item.issues.map((issue) => issue.code)).toContain("PHOTO_EVIDENCE_INCOMPLETE");
  });

  it.each([
    ["attendance", "ATTENDANCE_MISMATCH"],
    ["equipment", "EQUIPMENT_USAGE_MISMATCH"],
    ["material", "MATERIAL_PROGRESS_MISMATCH_material-001"],
  ] as const)("rejects a %s-to-progress mismatch", (kind, issueCode) => {
    const request = buildProgressVerificationRequest();
    if (kind === "attendance") {
      request.approvedActual.attendanceInputs = [];
    } else if (kind === "equipment") {
      request.approvedActual.equipmentInputs = [];
    } else {
      request.approvedActual.materialInputs[0]!.quantity!.value = "20";
    }

    const { item } = firstItem(request);
    expect(item.completionStatus).toBe("UNVERIFIABLE");
    expect(item.verifiedQuantity).toBeNull();
    expect(item.issues.map((issue) => issue.code)).toContain(issueCode);
  });

  it("rejects positive progress when a mandatory checklist failed", () => {
    const request = buildProgressVerificationRequest();
    request.checklists[0]!.status = "FAILED";
    const { item } = firstItem(request);

    expect(item.completionStatus).toBe("UNVERIFIABLE");
    expect(item.issues.map((issue) => issue.code)).toContain("CHECKLIST_FAILED");
  });

  it("preserves a site engineer rejection as an auditable unverified result", () => {
    const request = buildProgressVerificationRequest();
    const decision = request.engineerDecisions[0]!;
    decision.action = "REJECT";
    decision.reason = "Хэмжилтийн цэг баталгаажаагүй.";
    const { item } = firstItem(request);

    expect(item.completionStatus).toBe("UNVERIFIABLE");
    expect(item.engineerDecision?.action).toBe("REJECT");
    expect(item.issues.map((issue) => issue.code)).toContain("ENGINEER_REJECTED");
  });

  it("applies an engineer quantity override only with a reason and lineage", () => {
    const request = buildProgressVerificationRequest();
    const decision = request.engineerDecisions[0]!;
    decision.action = "OVERRIDE_QUANTITY";
    decision.reason = "Талбайн баталгаат хэмжилтээр 5 м2 байсан.";
    decision.overrideQuantity = {
      value: "5",
      unit: "m2",
      sourceRefs: decision.sourceRefs,
    };
    request.approvedActual.materialInputs[0]!.quantity!.value = "50";
    const { item } = firstItem(request);

    expect(item.completionStatus).toBe("PARTIALLY_COMPLETED");
    expect(item.verifiedQuantity?.value).toBe("5");
    expect(item.issues.map((issue) => issue.code)).toContain("ENGINEER_QUANTITY_OVERRIDE");
  });

  it("keeps override lineage when another mismatch makes it UNVERIFIABLE", () => {
    const request = buildProgressVerificationRequest();
    const decision = request.engineerDecisions[0]!;
    decision.action = "OVERRIDE_QUANTITY";
    decision.reason = "Талбайн баталгаат хэмжилтээр 5 м2 байсан.";
    decision.overrideQuantity = {
      value: "5",
      unit: "m2",
      sourceRefs: decision.sourceRefs,
    };
    request.approvedActual.materialInputs[0]!.quantity!.value = "10";
    const { item } = firstItem(request);

    expect(item.completionStatus).toBe("UNVERIFIABLE");
    expect(item.verifiedQuantity).toBeNull();
    expect(item.engineerDecision?.overrideQuantity?.value).toBe("5");
    expect(item.issues.map((issue) => issue.code)).toContain(
      "MATERIAL_PROGRESS_MISMATCH_material-001",
    );
  });

  it("allows a reasoned engineer override to resolve only a PE-09 warning", () => {
    const request = buildProgressVerificationRequest();
    const decision = request.engineerDecisions[0]!;
    decision.action = "OVERRIDE_QUANTITY";
    decision.reason = "Photo нь 50 хувь, талбайн хэмжилт 5 м2-г баталсан.";
    decision.overrideQuantity = {
      value: "5",
      unit: "m2",
      sourceRefs: decision.sourceRefs,
    };
    request.approvedActual.materialInputs[0]!.quantity!.value = "50";
    const evaluation = request.photoEvaluations[0]!;
    evaluation.photoResults[0]!.checks.find((check) => check.code === "PE-09")!.result = "WARNING";
    evaluation.photoResults[0]!.acceptedForVerification = false;
    evaluation.automaticEvidenceAcceptanceAllowed = false;
    const { item } = firstItem(request);

    expect(item.completionStatus).toBe("PARTIALLY_COMPLETED");
    expect(item.verifiedQuantity?.value).toBe("5");
    expect(item.issues.map((issue) => issue.code)).toContain(
      "PHOTO_CONTRADICTION_RESOLVED_BY_ENGINEER",
    );
  });

  it("supports checklist and weighted-milestone measurement modes", () => {
    const checklist = buildProgressVerificationRequest();
    usePercentMeasurement(checklist, "CHECKLIST", 100);
    const checklistItem = firstItem(checklist).item;
    expect(checklistItem.measurementMode).toBe("CHECKLIST");
    expect(checklistItem.completionStatus).toBe("COMPLETED");
    expect(checklistItem.verifiedQuantity?.value).toBe("100");

    const milestone = buildProgressVerificationRequest();
    usePercentMeasurement(milestone, "WEIGHTED_MILESTONE", 40);
    const milestoneItem = firstItem(milestone).item;
    expect(milestoneItem.measurementMode).toBe("WEIGHTED_MILESTONE");
    expect(milestoneItem.completionStatus).toBe("PARTIALLY_COMPLETED");
    expect(milestoneItem.verifiedQuantity?.value).toBe("40");
    expect(milestoneItem.completionRatePercent).toBe("40");
  });

  it("marks non-positive planned quantity as UNVERIFIABLE", () => {
    const request = buildProgressVerificationRequest();
    const planItem = request.approvedPlan.content.items[0]!;
    planItem.plannedQuantity.value = "0";
    if (planItem.feasibility.targetQuantity === null) {
      throw new Error("Fixture requires a target quantity");
    }
    planItem.feasibility.targetQuantity.value = "0";
    setZeroActual(request, "PLANNED");
    const { item } = firstItem(request);

    expect(item.completionStatus).toBe("UNVERIFIABLE");
    expect(item.issues.map((issue) => issue.code)).toContain("INVALID_PLANNED_QUANTITY");
  });

  it("is deterministic and idempotent while rejecting key reuse", () => {
    const request = buildProgressVerificationRequest();
    expect(generateProgressVerification(request)).toEqual(
      generateProgressVerification(structuredClone(request)),
    );

    const gateway = new ProgressVerificationGateway();
    const first = gateway.generate(request);
    expect(gateway.generate(structuredClone(request))).toBe(first);

    const changed = buildProgressVerificationRequest();
    changed.generatedAt = "2026-08-01T13:01:00.000Z";
    expect(() => gateway.generate(changed)).toThrow("idempotency key");
  });

  it("rejects tenant/project scope leakage before calculation", () => {
    const request = buildProgressVerificationRequest();
    request.tenantId = "tenant-private";
    expect(() => generateProgressVerification(request)).toThrow();
  });

  it("keeps unplanned approved actuals out of review-ready output", () => {
    const request = buildProgressVerificationRequest();
    const extra = structuredClone(request.approvedActual.workItemActuals[0]!);
    extra.actualInputId = "phase4-unplanned-actual-001";
    extra.dailyProgressEntryId = "phase4-unplanned-progress-001";
    extra.workItemId = "work-item-unplanned";
    extra.workItemCode = "UNPLANNED-001";
    request.approvedActual.workItemActuals.push(extra);
    const result = generateProgressVerification(request);

    expect(result.draft.status).toBe("DRAFT");
    expect(result.draft.validationIssues.map((issue) => issue.code)).toContain(
      "UNPLANNED_APPROVED_ACTUAL",
    );
  });
});

describe("BuildWatch v2.2 progress approval and projection boundary", () => {
  it("creates all five downstream projections only from an approved command", () => {
    const request = buildProgressVerificationRequest();
    const result = generateProgressVerification(request);
    expect("forecastInputs" in result).toBe(false);

    const command = approveProgressVerificationDraft(buildApprovalInput(result));
    const applied = applyApprovedProgressVerification({
      schemaVersion: 1,
      requestType: "APPLY_APPROVED_PROGRESS_VERIFICATION",
      command,
      approvedActual: request.approvedActual,
      appliedBy: "verification-worker",
      appliedAt: "2026-08-01T15:00:00.000Z",
    });

    expect(applied.transactionBoundary).toBe("APPROVED_COMMAND_ONLY");
    expect(applied.progressHistory).toHaveLength(1);
    expect(applied.dailyVariances).toHaveLength(1);
    expect(applied.productivitySamples).toHaveLength(1);
    expect(applied.materialLedgerEntries).toHaveLength(1);
    expect(applied.forecastInputs).toHaveLength(1);
    expect(applied.forecastInputs[0]?.included).toBe(true);
    expect(applied.audit.reviewerRole).toBe("PROJECT_MANAGER");
  });

  it("requires an override reason and corrected paths for human edits", () => {
    const result = generateProgressVerification(buildProgressVerificationRequest());
    const input = buildApprovalInput(result);
    input.approvedContent.items[0]!.confidence = 0.9;

    expect(() => approveProgressVerificationDraft(input)).toThrow(
      "requires corrected paths and reason",
    );
  });

  it("does not approve a blocking DRAFT or apply an unapproved draft", () => {
    const request = buildProgressVerificationRequest();
    removePhotoEvidence(request);
    const result = generateProgressVerification(request);
    expect(result.draft.status).toBe("DRAFT");
    expect(() => approveProgressVerificationDraft(buildApprovalInput(result))).toThrow();
    expect(() =>
      applyApprovedProgressVerification({
        schemaVersion: 1,
        requestType: "APPLY_APPROVED_PROGRESS_VERIFICATION",
        command: result.draft,
        approvedActual: request.approvedActual,
        appliedBy: "verification-worker",
        appliedAt: "2026-08-01T15:00:00.000Z",
      }),
    ).toThrow();
  });

  it("detects approved-content tampering before projection", () => {
    const request = buildProgressVerificationRequest();
    const result = generateProgressVerification(request);
    const command = approveProgressVerificationDraft(buildApprovalInput(result));
    command.approvedVersion.content.items[0]!.confidence = 0.9;

    expect(() =>
      applyApprovedProgressVerification({
        schemaVersion: 1,
        requestType: "APPLY_APPROVED_PROGRESS_VERIFICATION",
        command,
        approvedActual: request.approvedActual,
        appliedBy: "verification-worker",
        appliedAt: "2026-08-01T15:00:00.000Z",
      }),
    ).toThrow("source hash");
  });

  it("makes approval and apply gateways idempotent and conflict-safe", () => {
    const request = buildProgressVerificationRequest();
    const result = generateProgressVerification(request);
    const approvalInput = buildApprovalInput(result);
    const approvalGateway = new ProgressVerificationApprovalGateway();
    const command = approvalGateway.approve(approvalInput);
    expect(approvalGateway.approve(structuredClone(approvalInput))).toBe(command);

    const changedApproval = structuredClone(approvalInput);
    changedApproval.commandId = "phase4-approve-command-changed";
    expect(() => approvalGateway.approve(changedApproval)).toThrow("idempotency key");

    const applyGateway = new ProgressVerificationApplyGateway();
    const applyInput = {
      schemaVersion: 1 as const,
      requestType: "APPLY_APPROVED_PROGRESS_VERIFICATION" as const,
      command,
      approvedActual: request.approvedActual,
      appliedBy: "verification-worker",
      appliedAt: "2026-08-01T15:00:00.000Z",
    };
    const applied = applyGateway.apply(applyInput);
    expect(applyGateway.apply(structuredClone(applyInput))).toBe(applied);

    const changedApply = structuredClone(applyInput);
    changedApply.command.commandId = "phase4-approve-command-changed-for-apply";
    expect(() => applyGateway.apply(changedApply)).toThrow("idempotency key");
  });
});
