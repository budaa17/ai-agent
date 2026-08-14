import { createHash } from "node:crypto";
import {
  approvedProgressVerificationCommandV1Schema,
  progressVerificationContentSchema,
  progressVerificationDraftV1Schema,
  type ApprovedProgressVerificationCommandV1,
  type BuildWatchCanonicalUnit,
  type BuildWatchSourceReference,
  type ProgressVerificationDraftV1,
} from "../contracts/index.js";
import { DECIMAL_SCALE, decimalToScaledInteger } from "../production-analysis/decimal.js";
import { dedupeSourceRefs, stableStringify } from "../planning/deterministic.js";
import type { ApprovedA1ActualBundleV1 } from "./a1-approved-actual.js";
import {
  appliedProgressVerificationV1Schema,
  progressVerificationApplyRequestV1Schema,
  progressVerificationApprovalRequestV1Schema,
  progressVerificationRequestV1Schema,
  progressVerificationResultV1Schema,
  type AppliedProgressVerificationV1,
  type ProgressVerificationApplyRequestV1,
  type ProgressVerificationRequestV1,
  type ProgressVerificationResultV1,
} from "./progress-verification-contracts.js";

type VerificationItem = ProgressVerificationDraftV1["content"]["items"][number];
type VerificationIssue = VerificationItem["issues"][number];
type VerificationStatus = VerificationItem["completionStatus"];
type SourceBackedQuantity = NonNullable<VerificationItem["verifiedQuantity"]>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedId(prefix: string, value: string): string {
  const candidate = `${prefix}-${value}`;
  return candidate.length <= 200 ? candidate : `${prefix}-${sha256(candidate).slice(0, 32)}`;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error("Cannot divide by zero in progress verification");
  }
  const negative = numerator < 0n !== denominator < 0n;
  const unsignedNumerator = absolute(numerator);
  const unsignedDenominator = absolute(denominator);
  const quotient = unsignedNumerator / unsignedDenominator;
  const remainder = unsignedNumerator % unsignedDenominator;
  const rounded = remainder * 2n >= unsignedDenominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function scaledIntegerToDecimal(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const unsigned = absolute(value);
  const whole = unsigned / DECIMAL_SCALE;
  const fraction = String(unsigned % DECIMAL_SCALE)
    .padStart(6, "0")
    .replace(/0+$/u, "");
  return fraction.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

function numberToDecimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Progress-verification decimal must be finite");
  }
  return scaledIntegerToDecimal(BigInt(Math.round(value * Number(DECIMAL_SCALE))));
}

function quantityFromScaled(
  value: bigint,
  unit: BuildWatchCanonicalUnit,
  sources: readonly BuildWatchSourceReference[],
): SourceBackedQuantity {
  return {
    value: scaledIntegerToDecimal(value),
    unit,
    sourceRefs: dedupeSourceRefs(sources),
  };
}

function completionRate(verified: bigint | null, planned: bigint): string | null {
  if (verified === null || planned <= 0n) {
    return null;
  }
  const scaledPercent = divideRoundHalfUp(verified * 100n * DECIMAL_SCALE, planned);
  return scaledIntegerToDecimal(
    scaledPercent < 0n
      ? 0n
      : scaledPercent > 100n * DECIMAL_SCALE
        ? 100n * DECIMAL_SCALE
        : scaledPercent,
  );
}

function variancePercentage(variance: bigint, planned: bigint): string {
  if (planned <= 0n) {
    return "0";
  }
  const scaledPercent = divideRoundHalfUp(variance * 100n * DECIMAL_SCALE, planned);
  const bounded =
    scaledPercent < -100n * DECIMAL_SCALE
      ? -100n * DECIMAL_SCALE
      : scaledPercent > 100n * DECIMAL_SCALE
        ? 100n * DECIMAL_SCALE
        : scaledPercent;
  return scaledIntegerToDecimal(bounded);
}

function canonicalRequest(request: ProgressVerificationRequestV1) {
  return {
    ...request,
    approvedPlan: {
      ...request.approvedPlan,
      content: {
        ...request.approvedPlan.content,
        items: [...request.approvedPlan.content.items].sort((left, right) =>
          left.planItemId.localeCompare(right.planItemId),
        ),
        conflicts: [...request.approvedPlan.content.conflicts].sort((left, right) =>
          left.conflictId.localeCompare(right.conflictId),
        ),
      },
    },
    approvedActual: {
      ...request.approvedActual,
      workItemActuals: [...request.approvedActual.workItemActuals].sort((left, right) =>
        left.actualInputId.localeCompare(right.actualInputId),
      ),
      attendanceInputs: [...request.approvedActual.attendanceInputs].sort((left, right) =>
        left.attendanceInputId.localeCompare(right.attendanceInputId),
      ),
      materialInputs: [...request.approvedActual.materialInputs].sort((left, right) =>
        left.materialInputId.localeCompare(right.materialInputId),
      ),
      equipmentInputs: [...request.approvedActual.equipmentInputs].sort((left, right) =>
        left.equipmentInputId.localeCompare(right.equipmentInputId),
      ),
    },
    photoEvaluations: [...request.photoEvaluations].sort((left, right) =>
      left.workItemId.localeCompare(right.workItemId),
    ),
    measurementConfigurations: [...request.measurementConfigurations].sort((left, right) =>
      left.dailyPlanItemId.localeCompare(right.dailyPlanItemId),
    ),
    checklists: [...request.checklists].sort((left, right) =>
      left.dailyPlanItemId.localeCompare(right.dailyPlanItemId),
    ),
    engineerDecisions: [...request.engineerDecisions].sort((left, right) =>
      left.dailyPlanItemId.localeCompare(right.dailyPlanItemId),
    ),
  };
}

function calculationSource(
  request: ProgressVerificationRequestV1,
  planItemId: string,
  fieldPath: string,
): BuildWatchSourceReference {
  return {
    sourceRefId: boundedId(
      "source-progress-verification",
      `${request.requestId}-${planItemId}-${fieldPath}`,
    ),
    tenantId: request.tenantId,
    projectId: request.projectId,
    sourceType: "SYSTEM_CALCULATION",
    sourceId: boundedId("progress-verification", request.requestId),
    sourceVersionId: request.policy.policyVersionId,
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath,
    region: null,
    asOf: request.generatedAt,
    sha256: null,
  };
}

function issue(input: {
  request: ProgressVerificationRequestV1;
  planItemId: string;
  code: string;
  severity: "ERROR" | "WARNING" | "INFO";
  message: string;
  blocksApproval: boolean;
  sources: readonly BuildWatchSourceReference[];
}): VerificationIssue {
  return {
    issueId: boundedId(
      "verification-issue",
      `${input.request.requestId}-${input.planItemId}-${input.code}`,
    ),
    code: input.code,
    severity: input.severity,
    message: input.message,
    clarificationQuestion: input.blocksApproval
      ? "Эх сурвалжтай засвар эсвэл баталгаат хэмжилт оруулна уу."
      : null,
    blocksApproval: input.blocksApproval,
    sourceRefs: dedupeSourceRefs(input.sources),
  };
}

function photoIssueCode(checks: readonly VerificationItem["photoChecks"][number][]): string {
  const failedCodes = new Set(
    checks.filter((check) => ["FAIL", "WARNING"].includes(check.result)).map((check) => check.code),
  );
  if (failedCodes.has("PE-03")) {
    return "PHOTO_DUPLICATE_OR_NEAR_DUPLICATE";
  }
  if (failedCodes.has("PE-04")) {
    return "PHOTO_PREVIOUS_DAY_REUSE";
  }
  if (failedCodes.has("PE-06") || failedCodes.has("PE-09")) {
    return "REPORT_PHOTO_MISMATCH";
  }
  return "PHOTO_EVIDENCE_INCOMPLETE";
}

function materialMismatch(consumed: bigint, expected: bigint, tolerancePercent: bigint): boolean {
  if (expected === 0n) {
    return consumed !== 0n;
  }
  return (
    absolute(consumed - expected) * 100n * DECIMAL_SCALE > absolute(expected) * tolerancePercent
  );
}

function verifiedCumulativeQuantity(input: {
  actual: ApprovedA1ActualBundleV1["workItemActuals"][number] | undefined;
  verified: bigint | null;
  engineerAction: VerificationItem["engineerDecision"] extends infer Decision
    ? Decision extends { action: infer Action }
      ? Action
      : never
    : never;
  unit: BuildWatchCanonicalUnit;
  sources: readonly BuildWatchSourceReference[];
}): SourceBackedQuantity | null {
  if (input.verified === null || input.actual === undefined) {
    return null;
  }
  const cumulative = input.actual.declaredCumulativeQuantity;
  if (cumulative === null || cumulative.unit !== input.unit) {
    return null;
  }
  if (input.engineerAction !== "OVERRIDE_QUANTITY") {
    return cumulative;
  }
  const declared = input.actual.declaredActualQuantity;
  if (declared === null || declared.unit !== input.unit) {
    return null;
  }
  const previous =
    decimalToScaledInteger(cumulative.value) - decimalToScaledInteger(declared.value);
  if (previous < 0n) {
    return null;
  }
  return quantityFromScaled(previous + input.verified, input.unit, input.sources);
}

function buildVerificationItem(
  request: ProgressVerificationRequestV1,
  planItem: ProgressVerificationRequestV1["approvedPlan"]["content"]["items"][number],
): { item: VerificationItem; ruleCodes: string[] } {
  const configuration = request.measurementConfigurations.find(
    (candidate) => candidate.dailyPlanItemId === planItem.planItemId,
  )!;
  const checklist = request.checklists.find(
    (candidate) => candidate.dailyPlanItemId === planItem.planItemId,
  )!;
  const engineerDecision = request.engineerDecisions.find(
    (candidate) => candidate.dailyPlanItemId === planItem.planItemId,
  )!;
  const photoEvaluation = request.photoEvaluations.find(
    (candidate) => candidate.workItemId === planItem.workItemId,
  )!;
  const actual = request.approvedActual.workItemActuals.find(
    (candidate) => candidate.workItemId === planItem.workItemId,
  );
  const calculation = calculationSource(
    request,
    planItem.planItemId,
    "content.items.verifiedQuantity",
  );
  const commonSources = dedupeSourceRefs([
    ...planItem.sourceRefs,
    ...configuration.sourceRefs,
    ...checklist.sourceRefs,
    ...engineerDecision.sourceRefs,
    ...photoEvaluation.sourceRefs,
    ...(actual?.sourceRefs ?? []),
    calculation,
  ]);
  const issues: VerificationIssue[] = [];
  const planned = decimalToScaledInteger(planItem.plannedQuantity.value);
  const declaredQuantity = actual?.declaredActualQuantity ?? null;
  let verified: bigint | null = null;

  if (planned <= 0n) {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "INVALID_PLANNED_QUANTITY",
        severity: "ERROR",
        message: "Daily plan item-ийн planned quantity тэгээс их байх ёстой.",
        blocksApproval: true,
        sources: planItem.plannedQuantity.sourceRefs,
      }),
    );
  }

  if (actual === undefined) {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "MISSING_APPROVED_ACTUAL",
        severity: "ERROR",
        message: "Approved A1 actual энэ plan item-д байхгүй.",
        blocksApproval: true,
        sources: commonSources,
      }),
    );
  } else if (declaredQuantity !== null && declaredQuantity.unit !== planItem.unit) {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "ACTUAL_UNIT_MISMATCH",
        severity: "ERROR",
        message: "Declared actual болон plan unit хоорондоо зөрсөн.",
        blocksApproval: true,
        sources: commonSources,
      }),
    );
  }

  if (engineerDecision.action === "REJECT") {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "ENGINEER_REJECTED",
        severity: "ERROR",
        message: engineerDecision.reason!,
        blocksApproval: true,
        sources: engineerDecision.sourceRefs,
      }),
    );
  } else if (engineerDecision.action === "REQUEST_CLARIFICATION") {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "ENGINEER_CLARIFICATION_REQUIRED",
        severity: "ERROR",
        message: engineerDecision.reason!,
        blocksApproval: true,
        sources: engineerDecision.sourceRefs,
      }),
    );
  } else if (engineerDecision.action === "OVERRIDE_QUANTITY") {
    verified = decimalToScaledInteger(engineerDecision.overrideQuantity!.value);
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "ENGINEER_QUANTITY_OVERRIDE",
        severity: "WARNING",
        message: engineerDecision.reason!,
        blocksApproval: false,
        sources: [...engineerDecision.sourceRefs, ...engineerDecision.overrideQuantity!.sourceRefs],
      }),
    );
  } else if (configuration.mode === "QUANTITY") {
    if (declaredQuantity === null) {
      issues.push(
        issue({
          request,
          planItemId: planItem.planItemId,
          code: "MISSING_DECLARED_QUANTITY",
          severity: "ERROR",
          message: "Quantity-mode ажилд approved declared quantity байхгүй.",
          blocksApproval: true,
          sources: commonSources,
        }),
      );
    } else if (declaredQuantity.unit === planItem.unit) {
      verified = decimalToScaledInteger(declaredQuantity.value);
    }
  } else if (configuration.mode === "CHECKLIST") {
    if (checklist.status === "PASSED") {
      verified = planned;
    } else {
      issues.push(
        issue({
          request,
          planItemId: planItem.planItemId,
          code: "CHECKLIST_MEASUREMENT_UNRESOLVED",
          severity: "ERROR",
          message: "Checklist-mode ажлын approved checklist амжилттай биш.",
          blocksApproval: true,
          sources: checklist.sourceRefs,
        }),
      );
    }
  } else if (checklist.status === "PASSED" && checklist.completionPercent !== null) {
    verified = divideRoundHalfUp(
      planned * decimalToScaledInteger(checklist.completionPercent),
      100n * DECIMAL_SCALE,
    );
  } else {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "MILESTONE_MEASUREMENT_UNRESOLVED",
        severity: "ERROR",
        message: "Weighted milestone-д approved completion percent байхгүй.",
        blocksApproval: true,
        sources: checklist.sourceRefs,
      }),
    );
  }

  if (verified !== null && verified < 0n) {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "NEGATIVE_VERIFIED_QUANTITY",
        severity: "ERROR",
        message: "Verified quantity сөрөг байж болохгүй.",
        blocksApproval: true,
        sources: commonSources,
      }),
    );
  }

  const linkedAttendance = request.approvedActual.attendanceInputs.filter((input) =>
    input.workItemIds.includes(planItem.workItemId),
  );
  const linkedEquipment = request.approvedActual.equipmentInputs.filter(
    (input) => input.workItemIds.includes(planItem.workItemId) && input.status === "USED",
  );
  const linkedConsumedMaterials = request.approvedActual.materialInputs.filter(
    (input) =>
      input.workItemIds.includes(planItem.workItemId) &&
      input.signalType === "CONSUMED" &&
      input.materialId !== null &&
      input.quantity !== null,
  );
  const reportedStarted =
    actual !== undefined &&
    ["IN_PROGRESS", "BLOCKED", "COMPLETED"].includes(actual.reportedStatus ?? "");
  const workStarted =
    reportedStarted ||
    (declaredQuantity !== null && decimalToScaledInteger(declaredQuantity.value) > 0n) ||
    linkedAttendance.length > 0 ||
    linkedEquipment.length > 0 ||
    linkedConsumedMaterials.length > 0;
  const claimedPositiveProgress =
    (declaredQuantity !== null && decimalToScaledInteger(declaredQuantity.value) > 0n) ||
    actual?.reportedStatus === "COMPLETED";
  const crewRequired = planItem.resources.some((resource) => resource.resourceType === "CREW");
  const equipmentRequired = planItem.resources.filter(
    (resource) => resource.resourceType === "EQUIPMENT",
  );
  const crewSatisfied =
    !request.policy.requireAttendanceForCrew || !crewRequired || linkedAttendance.length > 0;
  const equipmentSatisfied =
    !request.policy.requireUsageForEquipment ||
    equipmentRequired.every((resource) =>
      linkedEquipment.some((input) => input.equipmentId === resource.resourceId),
    );
  const crewOrEquipmentAssigned = crewSatisfied && equipmentSatisfied;

  const positiveProgress = verified !== null && verified > 0n;
  if (positiveProgress && !crewSatisfied) {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "ATTENDANCE_MISMATCH",
        severity: "ERROR",
        message: "Positive progress байгаа боловч linked approved attendance алга.",
        blocksApproval: true,
        sources: commonSources,
      }),
    );
  }
  if (positiveProgress && !equipmentSatisfied) {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "EQUIPMENT_USAGE_MISMATCH",
        severity: "ERROR",
        message: "Positive progress байгаа боловч required equipment usage алга.",
        blocksApproval: true,
        sources: commonSources,
      }),
    );
  }

  if (
    positiveProgress &&
    planned > 0n &&
    request.policy.requireMaterialConsumptionEvidence &&
    planItem.materials.length > 0
  ) {
    const tolerance = decimalToScaledInteger(request.policy.materialVarianceTolerancePercent);
    for (const material of planItem.materials) {
      const matches = linkedConsumedMaterials.filter(
        (input) => input.materialId === material.materialId,
      );
      if (matches.length === 0) {
        issues.push(
          issue({
            request,
            planItemId: planItem.planItemId,
            code: `MATERIAL_MOVEMENT_MISSING_${material.materialId}`,
            severity: "ERROR",
            message: `Positive progress-д ${material.materialId} consumed movement алга.`,
            blocksApproval: true,
            sources: [...material.sourceRefs, calculation],
          }),
        );
        continue;
      }
      const unitMismatch = matches.some(
        (input) => input.quantity!.unit !== material.requiredQuantity.unit,
      );
      if (unitMismatch) {
        issues.push(
          issue({
            request,
            planItemId: planItem.planItemId,
            code: `MATERIAL_UNIT_MISMATCH_${material.materialId}`,
            severity: "ERROR",
            message: `Material ${material.materialId} movement unit зөрсөн.`,
            blocksApproval: true,
            sources: matches.flatMap((input) => input.sourceRefs),
          }),
        );
        continue;
      }
      const consumed = matches.reduce(
        (total, input) => total + decimalToScaledInteger(input.quantity!.value),
        0n,
      );
      const expected = divideRoundHalfUp(
        decimalToScaledInteger(material.requiredQuantity.value) * verified!,
        planned,
      );
      if (materialMismatch(consumed, expected, tolerance)) {
        issues.push(
          issue({
            request,
            planItemId: planItem.planItemId,
            code: `MATERIAL_PROGRESS_MISMATCH_${material.materialId}`,
            severity: "ERROR",
            message: `Material ${material.materialId} consumption нь verified progress-тэй зөрсөн.`,
            blocksApproval: true,
            sources: [
              ...material.sourceRefs,
              ...matches.flatMap((input) => input.sourceRefs),
              calculation,
            ],
          }),
        );
      }
    }
  }

  const acceptedPhotoCount = Math.min(
    photoEvaluation.coverage.requiredCount,
    photoEvaluation.photoResults.filter((photo) => photo.acceptedForVerification).length,
  );
  const evidenceCoverage: VerificationItem["evidenceCoverage"] = {
    requiredCount: photoEvaluation.coverage.requiredCount,
    acceptedCount: acceptedPhotoCount,
    coveragePercent:
      photoEvaluation.coverage.requiredCount === 0
        ? 100
        : (acceptedPhotoCount / photoEvaluation.coverage.requiredCount) * 100,
    requiredAnglesComplete: photoEvaluation.coverage.requiredAnglesComplete,
    referenceMarkerPresent: photoEvaluation.coverage.referenceMarkerPresent,
    sourceRefs: photoEvaluation.coverage.sourceRefs,
  };
  const photoChecks = photoEvaluation.photoResults.flatMap((photo) => photo.checks);
  const unresolvedPhotoChecks = photoChecks.filter((check) =>
    ["FAIL", "WARNING"].includes(check.result),
  );
  const photoContradictionResolvedByEngineer =
    engineerDecision.action === "OVERRIDE_QUANTITY" &&
    photoEvaluation.coverage.evidenceComplete &&
    unresolvedPhotoChecks.length > 0 &&
    unresolvedPhotoChecks.every((check) => check.code === "PE-09" && check.result === "WARNING");
  if (claimedPositiveProgress && !photoEvaluation.automaticEvidenceAcceptanceAllowed) {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: photoContradictionResolvedByEngineer
          ? "PHOTO_CONTRADICTION_RESOLVED_BY_ENGINEER"
          : photoIssueCode(photoChecks),
        severity: photoContradictionResolvedByEngineer ? "WARNING" : "ERROR",
        message: photoContradictionResolvedByEngineer
          ? "PE-09 contradiction-ийг site engineer баталгаат хэмжилт, reason-оор шийдвэрлэсэн."
          : "Photo evidence automatic verification requirement хангаагүй.",
        blocksApproval: !photoContradictionResolvedByEngineer,
        sources: photoContradictionResolvedByEngineer
          ? [...photoEvaluation.sourceRefs, ...engineerDecision.sourceRefs]
          : photoEvaluation.sourceRefs,
      }),
    );
  }

  if (positiveProgress && !["PASSED", "NOT_REQUIRED"].includes(checklist.status)) {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: checklist.status === "FAILED" ? "CHECKLIST_FAILED" : "CHECKLIST_MISSING",
        severity: "ERROR",
        message: "Positive progress-д mandatory checklist хангагдаагүй.",
        blocksApproval: true,
        sources: checklist.sourceRefs,
      }),
    );
  }

  const approvedBlockerId = actual?.blockerCandidate?.approvedOperationalBlockerId ?? null;
  if (actual?.reportedStatus === "BLOCKED" && approvedBlockerId === null) {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "UNAPPROVED_BLOCKER",
        severity: "ERROR",
        message: "BLOCKED status зөвхөн approved operational blocker-той байна.",
        blocksApproval: true,
        sources: actual.sourceRefs,
      }),
    );
  }
  if (actual?.reportedStatus === "CANCELLED") {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "CANCELLED_PLAN_ITEM_REQUIRES_REVIEW",
        severity: "ERROR",
        message: "Approved plan item cancelled гэж тайлагнагдсан тул manager review шаардлагатай.",
        blocksApproval: true,
        sources: actual.sourceRefs,
      }),
    );
  }
  if (actual?.reportedStatus === "COMPLETED" && verified !== null && verified < planned) {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "FALSE_COMPLETED_CLAIM",
        severity: "WARNING",
        message: "Declared COMPLETED status verified target-тэй тэнцээгүй.",
        blocksApproval: false,
        sources: [...actual.sourceRefs, calculation],
      }),
    );
  }

  const hasBlockingIssue = issues.some((candidate) => candidate.blocksApproval);
  let completionStatus: VerificationStatus;
  if (hasBlockingIssue || verified === null) {
    completionStatus = "UNVERIFIABLE";
    verified = null;
  } else if (approvedBlockerId !== null) {
    completionStatus = "BLOCKED";
  } else if (verified >= planned) {
    completionStatus = "COMPLETED";
  } else if (verified > 0n) {
    completionStatus = "PARTIALLY_COMPLETED";
  } else if (workStarted && crewOrEquipmentAssigned) {
    completionStatus = "NOT_COMPLETED";
  } else {
    completionStatus = "NOT_STARTED";
  }

  if (completionStatus === "UNVERIFIABLE" && issues.length === 0) {
    issues.push(
      issue({
        request,
        planItemId: planItem.planItemId,
        code: "INSUFFICIENT_VERIFICATION_INPUT",
        severity: "ERROR",
        message: "Verified quantity тодорхойлох эх сурвалж хүрэлцэхгүй.",
        blocksApproval: true,
        sources: commonSources,
      }),
    );
  }

  const verifiedQuantity =
    verified === null
      ? null
      : quantityFromScaled(verified, planItem.unit, [
          ...(engineerDecision.overrideQuantity?.sourceRefs ?? []),
          ...(declaredQuantity?.sourceRefs ?? []),
          ...checklist.sourceRefs,
          calculation,
        ]);
  const cumulativeQuantity =
    completionStatus === "UNVERIFIABLE"
      ? null
      : verifiedCumulativeQuantity({
          actual,
          verified,
          engineerAction: engineerDecision.action,
          unit: planItem.unit,
          sources: commonSources,
        });
  const rate = completionRate(verified, planned);
  const variance =
    verified === null
      ? null
      : {
          quantity: quantityFromScaled(verified - planned, planItem.unit, [
            ...planItem.plannedQuantity.sourceRefs,
            ...(verifiedQuantity?.sourceRefs ?? []),
            calculation,
          ]),
          percentage: variancePercentage(verified - planned, planned),
          percentageSourceRefs: dedupeSourceRefs([
            ...planItem.plannedQuantity.sourceRefs,
            ...(verifiedQuantity?.sourceRefs ?? []),
            calculation,
          ]),
        };
  const sortedIssues = [...issues].sort((left, right) => left.code.localeCompare(right.code));
  const confidence = Math.max(
    0.05,
    Math.min(
      0.99,
      0.99 -
        sortedIssues.filter((candidate) => candidate.severity === "ERROR").length * 0.3 -
        sortedIssues.filter((candidate) => candidate.severity === "WARNING").length * 0.05,
    ),
  );
  const item = progressVerificationContentSchema.shape.items.element.parse({
    verificationItemId: boundedId(
      "verification-item",
      `${request.requestId}-${planItem.planItemId}`,
    ),
    dailyPlanItemId: planItem.planItemId,
    workItemId: planItem.workItemId,
    dailyProgressEntryId:
      actual?.dailyProgressEntryId ??
      boundedId("missing-progress-entry", `${request.requestId}-${planItem.planItemId}`),
    reportDate: request.reportDate,
    unit: planItem.unit,
    measurementMode: configuration.mode,
    plannedQuantity: planItem.plannedQuantity,
    declaredQuantity,
    verifiedQuantity,
    cumulativeQuantity,
    completionRatePercent: rate,
    workStarted,
    crewOrEquipmentAssigned,
    approvedBlockerId,
    mandatoryChecklistStatus: checklist.status,
    engineerDecision,
    evidenceCoverage,
    photoChecks,
    completionStatus,
    variance,
    confidence,
    issues: sortedIssues,
    sourceRefs: commonSources,
  });
  return {
    item,
    ruleCodes: [
      ...new Set([
        ...sortedIssues.map((candidate) => candidate.code),
        `STATUS_${completionStatus}`,
      ]),
    ].sort(),
  };
}

export function generateProgressVerification(requestInput: unknown): ProgressVerificationResultV1 {
  const request = progressVerificationRequestV1Schema.parse(requestInput);
  const canonical = canonicalRequest(request);
  const requestHash = sha256(stableStringify(canonical));
  const builds = canonical.approvedPlan.content.items.map((planItem) =>
    buildVerificationItem(canonical, planItem),
  );
  const plannedWorkItemIds = new Set(
    canonical.approvedPlan.content.items.map((item) => item.workItemId),
  );
  const unplannedActuals = canonical.approvedActual.workItemActuals.filter(
    (actual) => !plannedWorkItemIds.has(actual.workItemId),
  );
  const validationIssues = unplannedActuals.map((actual) => ({
    code: "UNPLANNED_APPROVED_ACTUAL",
    severity: "ERROR" as const,
    fieldPaths: ["approvedActual.workItemActuals"],
    message: `Approved actual ${actual.workItemCode} нь approved daily plan-д алга.`,
    deterministic: true,
  }));
  const blocking =
    validationIssues.length > 0 ||
    builds.some((build) => build.item.issues.some((candidate) => candidate.blocksApproval));
  const draft = progressVerificationDraftV1Schema.parse({
    schemaVersion: 1,
    draftType: "PROGRESS_VERIFICATION",
    draftId: boundedId("progress-verification-draft", request.requestId),
    tenantId: request.tenantId,
    projectId: request.projectId,
    status: blocking ? "DRAFT" : "REVIEW_REQUIRED",
    content: {
      dailyWorkPlanVersionId: request.approvedPlan.dailyWorkPlanVersionId,
      dailyReportId: request.approvedActual.dailyReportId,
      reportDate: request.reportDate,
      items: builds.map((build) => build.item),
    },
    validationIssues,
    requiresHumanReview: true,
    createdAt: request.generatedAt,
    createdBy: "A5",
  });
  return progressVerificationResultV1Schema.parse({
    schemaVersion: 1,
    resultType: "A5_PROGRESS_VERIFICATION_RESULT",
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    requestHash,
    tenantId: request.tenantId,
    projectId: request.projectId,
    reportDate: request.reportDate,
    draft,
    decisions: builds.map((build) => ({
      verificationItemId: build.item.verificationItemId,
      dailyPlanItemId: build.item.dailyPlanItemId,
      workItemId: build.item.workItemId,
      measurementMode: build.item.measurementMode,
      completionStatus: build.item.completionStatus,
      completionRatePercent: build.item.completionRatePercent,
      ruleCodes: build.ruleCodes,
      automaticApprovalAllowed: false,
      sourceRefs: build.item.sourceRefs,
    })),
    deterministic: true,
    llmRequired: false,
    generatedAt: request.generatedAt,
  });
}

export function approveProgressVerificationDraft(
  input: unknown,
): ApprovedProgressVerificationCommandV1 {
  const request = progressVerificationApprovalRequestV1Schema.parse(input);
  const draftContent = stableStringify(request.draft.content);
  const approvedContent = stableStringify(request.approvedContent);
  const changed = draftContent !== approvedContent;
  if (
    changed &&
    (request.decision.correctedFieldPaths.length === 0 || request.decision.reason === null)
  ) {
    throw new Error("Changed verification content requires corrected paths and reason");
  }
  const sourceHash = sha256(approvedContent);
  return approvedProgressVerificationCommandV1Schema.parse({
    schemaVersion: 1,
    commandType: "APPROVE_PROGRESS_VERIFICATION",
    commandId: request.commandId,
    idempotencyKey: request.idempotencyKey,
    tenantId: request.draft.tenantId,
    projectId: request.draft.projectId,
    draftId: request.draft.draftId,
    approvedVersion: {
      schemaVersion: 1,
      versionType: "APPROVED_PROGRESS_VERIFICATION",
      progressVerificationVersionId: request.progressVerificationVersionId,
      tenantId: request.draft.tenantId,
      projectId: request.draft.projectId,
      status: "APPROVED",
      content: request.approvedContent,
      metadata: {
        version: request.version,
        approvedBy: request.decision.reviewerId,
        approvedAt: request.decision.decidedAt,
        sourceHash,
        supersedesVersionId: request.supersedesVersionId,
      },
    },
    decision: request.decision,
  });
}

function approvalSource(command: ApprovedProgressVerificationCommandV1): BuildWatchSourceReference {
  return {
    sourceRefId: boundedId(
      "source-approved-verification",
      command.approvedVersion.progressVerificationVersionId,
    ),
    tenantId: command.tenantId,
    projectId: command.projectId,
    sourceType: "HUMAN_DECISION",
    sourceId: command.approvedVersion.progressVerificationVersionId,
    sourceVersionId: command.approvedVersion.progressVerificationVersionId,
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: "approvedVersion.content",
    region: null,
    asOf: command.decision.decidedAt,
    sha256: command.approvedVersion.metadata.sourceHash,
  };
}

function applyCalculationSource(
  request: ProgressVerificationApplyRequestV1,
): BuildWatchSourceReference {
  return {
    sourceRefId: boundedId("source-verification-apply", request.command.commandId),
    tenantId: request.command.tenantId,
    projectId: request.command.projectId,
    sourceType: "SYSTEM_CALCULATION",
    sourceId: boundedId("verification-apply", request.command.commandId),
    sourceVersionId: request.command.approvedVersion.progressVerificationVersionId,
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: "apply",
    region: null,
    asOf: request.appliedAt,
    sha256: null,
  };
}

function laborHoursForWorkItem(
  actual: ApprovedA1ActualBundleV1,
  workItemId: string,
): { value: string | null; sources: BuildWatchSourceReference[] } {
  const entries = actual.attendanceInputs.filter((input) => input.workItemIds.includes(workItemId));
  let total = 0;
  for (const entry of entries) {
    total +=
      entry.totalHours ??
      (entry.hoursPerPerson === null ? 0 : entry.headcount * entry.hoursPerPerson);
  }
  return {
    value: total > 0 ? numberToDecimal(total) : null,
    sources: dedupeSourceRefs(entries.flatMap((entry) => entry.sourceRefs)),
  };
}

export function applyApprovedProgressVerification(input: unknown): AppliedProgressVerificationV1 {
  const request = progressVerificationApplyRequestV1Schema.parse(input);
  const command = request.command;
  const content = command.approvedVersion.content;
  const expectedSourceHash = sha256(stableStringify(content));
  if (command.approvedVersion.metadata.sourceHash !== expectedSourceHash) {
    throw new Error("Approved verification source hash does not match its content");
  }
  if (
    command.approvedVersion.metadata.approvedBy !== command.decision.reviewerId ||
    command.approvedVersion.metadata.approvedAt !== command.decision.decidedAt
  ) {
    throw new Error("Approved verification metadata conflicts with its decision");
  }
  const commandHash = sha256(stableStringify(command));
  const approvedSource = approvalSource(command);
  const calculation = applyCalculationSource(request);
  const projectionSources = (item: VerificationItem) =>
    dedupeSourceRefs([...item.sourceRefs, approvedSource, calculation]);
  const progressHistory = content.items.map((item) => ({
    progressHistoryId: boundedId(
      "progress-history",
      `${command.approvedVersion.progressVerificationVersionId}-${item.workItemId}`,
    ),
    progressVerificationVersionId: command.approvedVersion.progressVerificationVersionId,
    dailyReportId: content.dailyReportId,
    dailyPlanItemId: item.dailyPlanItemId,
    dailyProgressEntryId: item.dailyProgressEntryId,
    workItemId: item.workItemId,
    reportDate: item.reportDate,
    completionStatus: item.completionStatus,
    verifiedQuantity: item.verifiedQuantity,
    cumulativeQuantity: item.cumulativeQuantity,
    completionRatePercent: item.completionRatePercent,
    forecastEligible: item.completionStatus !== "UNVERIFIABLE" && item.verifiedQuantity !== null,
    sourceRefs: projectionSources(item),
  }));
  const dailyVariances = content.items.map((item) => ({
    dailyVarianceId: boundedId(
      "daily-variance",
      `${command.approvedVersion.progressVerificationVersionId}-${item.workItemId}`,
    ),
    progressVerificationVersionId: command.approvedVersion.progressVerificationVersionId,
    workItemId: item.workItemId,
    reportDate: item.reportDate,
    plannedQuantity: item.plannedQuantity,
    verifiedQuantity: item.verifiedQuantity,
    variance: item.variance,
    sourceRefs: projectionSources(item),
  }));
  const productivitySamples = content.items.map((item) => {
    const quantity = item.verifiedQuantity;
    const valid = item.completionStatus !== "UNVERIFIABLE" && quantity !== null;
    const positive = valid && decimalToScaledInteger(quantity.value) > 0n;
    const labor = laborHoursForWorkItem(request.approvedActual, item.workItemId);
    return {
      productivitySampleId: boundedId(
        "productivity-sample",
        `${command.approvedVersion.progressVerificationVersionId}-${item.workItemId}`,
      ),
      progressVerificationVersionId: command.approvedVersion.progressVerificationVersionId,
      workItemId: item.workItemId,
      reportDate: item.reportDate,
      quantity,
      laborHours: labor.value,
      included: positive,
      exclusionReason: !valid
        ? item.completionStatus === "UNVERIFIABLE"
          ? ("UNVERIFIABLE" as const)
          : ("NO_VERIFIED_QUANTITY" as const)
        : !positive
          ? ("ZERO_QUANTITY" as const)
          : null,
      sourceRefs: dedupeSourceRefs([...projectionSources(item), ...labor.sources]),
    };
  });
  const approvedWorkItemIds = new Set(content.items.map((item) => item.workItemId));
  const materialLedgerEntries = request.approvedActual.materialInputs
    .filter(
      (input) =>
        input.signalType === "CONSUMED" && input.materialId !== null && input.quantity !== null,
    )
    .flatMap((input) => {
      const linkedWorkItems = input.workItemIds.filter((workItemId) =>
        approvedWorkItemIds.has(workItemId),
      );
      const targets: Array<string | null> = linkedWorkItems.length === 0 ? [null] : linkedWorkItems;
      return targets.map((workItemId) => ({
        materialLedgerEntryId: boundedId(
          "material-ledger",
          `${command.approvedVersion.progressVerificationVersionId}-${input.materialInputId}-${workItemId ?? "unallocated"}`,
        ),
        progressVerificationVersionId: command.approvedVersion.progressVerificationVersionId,
        sourceMaterialInputId: input.materialInputId,
        workItemId,
        materialId: input.materialId!,
        movementType: "CONSUMED" as const,
        quantity: input.quantity!,
        occurredAt: request.approvedActual.reviewedAt,
        sourceRefs: dedupeSourceRefs([
          ...input.sourceRefs,
          ...input.quantity!.sourceRefs,
          approvedSource,
        ]),
      }));
    });
  const forecastInputs = content.items.map((item) => {
    const included = item.completionStatus !== "UNVERIFIABLE" && item.verifiedQuantity !== null;
    return {
      forecastInputId: boundedId(
        "forecast-input",
        `${command.approvedVersion.progressVerificationVersionId}-${item.workItemId}`,
      ),
      progressVerificationVersionId: command.approvedVersion.progressVerificationVersionId,
      workItemId: item.workItemId,
      reportDate: item.reportDate,
      completionStatus: item.completionStatus,
      verifiedQuantity: item.verifiedQuantity,
      included,
      exclusionReason: included
        ? null
        : item.completionStatus === "UNVERIFIABLE"
          ? ("UNVERIFIABLE" as const)
          : ("NO_VERIFIED_QUANTITY" as const),
      sourceRefs: projectionSources(item),
    };
  });
  const allSources = dedupeSourceRefs([
    approvedSource,
    calculation,
    ...content.items.flatMap((item) => item.sourceRefs),
    ...request.approvedActual.sourceRefs,
  ]);
  return appliedProgressVerificationV1Schema.parse({
    schemaVersion: 1,
    applyType: "APPLIED_PROGRESS_VERIFICATION",
    applyId: boundedId("verification-apply", command.commandId),
    idempotencyKey: command.idempotencyKey,
    commandId: command.commandId,
    commandHash,
    tenantId: command.tenantId,
    projectId: command.projectId,
    progressVerificationVersionId: command.approvedVersion.progressVerificationVersionId,
    dailyReportId: content.dailyReportId,
    reportDate: content.reportDate,
    status: "APPLIED",
    transactionBoundary: "APPROVED_COMMAND_ONLY",
    progressHistory,
    dailyVariances,
    productivitySamples,
    materialLedgerEntries,
    forecastInputs,
    audit: {
      auditId: boundedId("verification-apply-audit", command.commandId),
      action: "APPLY_PROGRESS_VERIFICATION",
      actorId: request.appliedBy,
      appliedAt: request.appliedAt,
      commandHash,
      approvedSourceHash: expectedSourceHash,
      reviewerId: command.decision.reviewerId,
      reviewerRole: "PROJECT_MANAGER",
      sourceRefs: [approvedSource, calculation],
    },
    deterministic: true,
    appliedBy: request.appliedBy,
    appliedAt: request.appliedAt,
    sourceRefs: allSources,
  });
}

export class ProgressVerificationGateway {
  readonly #byIdempotencyKey = new Map<string, ProgressVerificationResultV1>();

  generate(input: unknown): ProgressVerificationResultV1 {
    const result = generateProgressVerification(input);
    const existing = this.#byIdempotencyKey.get(result.idempotencyKey);
    if (existing !== undefined) {
      if (existing.requestHash !== result.requestHash) {
        throw new Error("Progress-verification idempotency key was reused with different content");
      }
      return existing;
    }
    this.#byIdempotencyKey.set(result.idempotencyKey, result);
    return result;
  }
}

export class ProgressVerificationApprovalGateway {
  readonly #byIdempotencyKey = new Map<string, ApprovedProgressVerificationCommandV1>();

  approve(input: unknown): ApprovedProgressVerificationCommandV1 {
    const command = approveProgressVerificationDraft(input);
    const existing = this.#byIdempotencyKey.get(command.idempotencyKey);
    if (existing !== undefined) {
      if (stableStringify(existing) !== stableStringify(command)) {
        throw new Error("Verification-approval idempotency key was reused with different content");
      }
      return existing;
    }
    this.#byIdempotencyKey.set(command.idempotencyKey, command);
    return command;
  }
}

export class ProgressVerificationApplyGateway {
  readonly #byIdempotencyKey = new Map<string, AppliedProgressVerificationV1>();

  apply(input: unknown): AppliedProgressVerificationV1 {
    const request = progressVerificationApplyRequestV1Schema.parse(input);
    const result = applyApprovedProgressVerification(request);
    const existing = this.#byIdempotencyKey.get(result.idempotencyKey);
    if (existing !== undefined) {
      if (existing.commandHash !== result.commandHash) {
        throw new Error(
          "Verification-apply idempotency key was reused with different approved command",
        );
      }
      return existing;
    }
    this.#byIdempotencyKey.set(result.idempotencyKey, result);
    return result;
  }
}
