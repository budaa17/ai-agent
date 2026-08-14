import { createHash } from "node:crypto";
import type {
  BuildWatchSourceReference,
  PhotoEvidenceEvaluationV1,
  ProgressEngineerDecision,
} from "../../src/contracts/index.js";
import {
  approvedA1ActualBundleV1Schema,
  type ApprovedA1ActualBundleV1,
  type ProgressVerificationRequestV1,
} from "../../src/verification/index.js";
import {
  buildApprovedDailyWorkPlanCommand,
  buildV22Source,
  buildWatchV22ProjectId,
  buildWatchV22TenantId,
} from "../contracts/buildwatch-v22-fixtures.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function source(
  sourceRefId: string,
  sourceType: BuildWatchSourceReference["sourceType"],
  sourceId: string,
  asOf: string,
  overrides: Partial<BuildWatchSourceReference> = {},
): BuildWatchSourceReference {
  return buildV22Source(sourceRefId, {
    sourceType,
    sourceId,
    asOf,
    sourceVersionId: null,
    ...overrides,
  });
}

function buildApprovedActual(): ApprovedA1ActualBundleV1 {
  const reportSource = source(
    "phase4-report",
    "DAILY_REPORT",
    "daily-report-001",
    "2026-08-01T12:00:00.000Z",
  );
  const approvalSource = source(
    "phase4-report-approval",
    "HUMAN_DECISION",
    "daily-report-approval-001",
    "2026-08-01T12:05:00.000Z",
  );
  const quantitySources = [reportSource, approvalSource];
  return approvedA1ActualBundleV1Schema.parse({
    schemaVersion: 1,
    bundleType: "APPROVED_A1_ACTUAL",
    bundleId: "phase4-approved-actual-001",
    idempotencyKey: "phase4-approved-actual-idempotency-001",
    commandId: "phase4-approved-actual-command-001",
    commandHash: hash("phase4-approved-actual-command-001"),
    draftId: "phase4-daily-report-draft-001",
    dailyReportId: "daily-report-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    reportDate: "2026-08-01",
    reviewedBy: "user-site-engineer",
    reviewedAt: "2026-08-01T12:05:00.000Z",
    approvalStatus: "APPROVED",
    approvalBoundary: "APPROVED_COMMAND_ONLY",
    workItemActuals: [
      {
        actualInputId: "phase4-actual-work-item-001",
        dailyProgressEntryId: "phase4-progress-entry-001",
        workItemId: "work-item-001",
        workItemCode: "WALL-AAC-200",
        progressMode: "INCREMENTAL",
        declaredActualQuantity: {
          value: "10",
          unit: "m2",
          sourceRefs: quantitySources,
        },
        declaredCumulativeQuantity: {
          value: "60",
          unit: "m2",
          sourceRefs: quantitySources,
        },
        declaredProgressPercent: 100,
        reportedStatus: "COMPLETED",
        blockerCandidate: null,
        sourceRefs: quantitySources,
      },
    ],
    attendanceInputs: [
      {
        attendanceInputId: "phase4-attendance-001",
        sourceAttendanceEntryId: "attendance-entry-001",
        workItemIds: ["work-item-001"],
        teamType: "OWN",
        teamRef: "crew-001",
        teamName: "Өрлөгийн баг",
        headcount: 6,
        hoursPerPerson: 8,
        totalHours: 48,
        sourceRefs: quantitySources,
      },
    ],
    materialInputs: [
      {
        materialInputId: "phase4-material-001",
        sourceMaterialSignalId: "material-signal-001",
        signalType: "CONSUMED",
        materialId: "material-001",
        workItemIds: ["work-item-001"],
        quantity: {
          value: "100",
          unit: "kg",
          sourceRefs: quantitySources,
        },
        supplierName: null,
        note: "Өдрийн баталгаат зарцуулалт",
        sourceRefs: quantitySources,
      },
    ],
    equipmentInputs: [
      {
        equipmentInputId: "phase4-equipment-001",
        sourceEquipmentEntryId: "equipment-entry-001",
        equipmentId: "equipment-001",
        workItemIds: ["work-item-001"],
        hoursUsed: 8,
        usageQuantity: null,
        status: "USED",
        note: null,
        sourceRefs: quantitySources,
      },
    ],
    sourceArtifacts: [],
    sourceRefs: quantitySources,
    eligibleForVerification: true,
    eligibleForForecast: false,
    forecastExclusionReason: "REQUIRES_APPROVED_PROGRESS_VERIFICATION",
    deterministic: true,
  });
}

function photoChecks(photoSource: BuildWatchSourceReference) {
  return (
    [
      "PE-01",
      "PE-02",
      "PE-03",
      "PE-04",
      "PE-05",
      "PE-06",
      "PE-07",
      "PE-08",
      "PE-09",
      "PE-10",
    ] as const
  ).map((code) => ({
    checkId: `phase4-photo-check-${code.toLowerCase()}`,
    photoArtifactId: "phase4-photo-artifact-001",
    code,
    result: "PASS" as const,
    score: 1,
    message: `${code} passed`,
    deterministic: true,
    sourceRefs: [photoSource],
  }));
}

function buildPhotoEvaluation(): PhotoEvidenceEvaluationV1 {
  const photoSource = source(
    "phase4-photo-source",
    "PHOTO_EVIDENCE",
    "phase4-photo-001",
    "2026-08-01T11:30:00.000Z",
    {
      artifactId: "phase4-photo-artifact-001",
      sha256: "b".repeat(64),
    },
  );
  const calculationSource = source(
    "phase4-photo-calculation",
    "SYSTEM_CALCULATION",
    "phase4-photo-evaluation-001",
    "2026-08-01T12:10:00.000Z",
  );
  const sources = [photoSource, calculationSource];
  return {
    schemaVersion: 1,
    evaluationType: "PHOTO_EVIDENCE_EVALUATION",
    evaluationId: "phase4-photo-evaluation-001",
    requestId: "phase4-photo-request-001",
    idempotencyKey: "phase4-photo-idempotency-001",
    requestHash: hash("phase4-photo-request-001"),
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    reportDate: "2026-08-01",
    workItemId: "work-item-001",
    policyId: "photo-rule-wall-001",
    policyVersionId: "photo-rule-wall-001-v1",
    photoResults: [
      {
        photoId: "phase4-photo-001",
        artifactId: "phase4-photo-artifact-001",
        exactDuplicateOfPhotoId: null,
        nearDuplicateOfPhotoId: null,
        nearDuplicateHammingDistance: null,
        reusedFromReportDate: null,
        usableForEvidence: true,
        acceptedForVerification: true,
        requiresHumanReview: true,
        checks: photoChecks(photoSource),
        sourceRefs: [photoSource],
      },
    ],
    coverage: {
      requiredCount: 1,
      submittedCount: 1,
      usableCount: 1,
      creditedCount: 1,
      coveragePercent: 100,
      requiredAngles: ["OVERVIEW"],
      observedAngles: ["OVERVIEW"],
      missingAngles: [],
      requiredAnglesComplete: true,
      referenceMarkerRequired: true,
      referenceMarkerPresent: true,
      evidenceComplete: true,
      sourceRefs: sources,
    },
    automaticEvidenceAcceptanceAllowed: true,
    requiresHumanReview: true,
    eligibleForProgressVerification: true,
    exactQuantityDerived: false,
    deterministic: true,
    generatedAt: "2026-08-01T12:10:00.000Z",
    sourceRefs: sources,
  };
}

function buildEngineerDecision(): ProgressEngineerDecision {
  const decisionSource = source(
    "phase4-engineer-decision-source",
    "HUMAN_DECISION",
    "phase4-engineer-decision-001",
    "2026-08-01T12:30:00.000Z",
  );
  return {
    decisionId: "phase4-engineer-decision-001",
    dailyPlanItemId: "plan-item-001",
    workItemId: "work-item-001",
    action: "ACCEPT_DECLARED",
    reviewerId: "user-site-engineer",
    reviewerRole: "SITE_ENGINEER",
    decidedAt: "2026-08-01T12:30:00.000Z",
    reason: null,
    overrideQuantity: null,
    sourceRefs: [decisionSource],
  };
}

export function buildProgressVerificationRequest(): ProgressVerificationRequestV1 {
  const approvedPlan = structuredClone(buildApprovedDailyWorkPlanCommand().approvedVersion);
  const policySource = source(
    "phase4-verification-policy",
    "SYSTEM_CALCULATION",
    "phase4-verification-policy-v1",
    "2026-01-02T05:00:00.000Z",
  );
  const checklistSource = source(
    "phase4-checklist-source",
    "HUMAN_DECISION",
    "phase4-checklist-001",
    "2026-08-01T12:20:00.000Z",
  );
  return {
    schemaVersion: 1,
    requestType: "A5_PROGRESS_VERIFICATION",
    requestId: "phase4-verification-request-001",
    idempotencyKey: "phase4-verification-idempotency-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    reportDate: "2026-08-01",
    approvedPlan,
    approvedActual: buildApprovedActual(),
    photoEvaluations: [buildPhotoEvaluation()],
    measurementConfigurations: [
      {
        configurationId: "phase4-measurement-001",
        dailyPlanItemId: "plan-item-001",
        workItemId: "work-item-001",
        mode: "QUANTITY",
        sourceRefs: [policySource],
      },
    ],
    checklists: [
      {
        checklistId: "phase4-checklist-001",
        dailyPlanItemId: "plan-item-001",
        workItemId: "work-item-001",
        status: "PASSED",
        completionPercent: null,
        approvedBy: "user-site-engineer",
        approvedAt: "2026-08-01T12:20:00.000Z",
        sourceRefs: [checklistSource],
      },
    ],
    engineerDecisions: [buildEngineerDecision()],
    policy: {
      schemaVersion: 1,
      policyType: "PROGRESS_VERIFICATION_POLICY",
      policyId: "phase4-verification-policy",
      policyVersionId: "phase4-verification-policy-v1",
      version: 1,
      tenantId: buildWatchV22TenantId,
      projectId: buildWatchV22ProjectId,
      effectiveFrom: "2026-01-05",
      approvedBy: "user-project-manager",
      approvedAt: "2026-01-02T05:00:00.000Z",
      materialVarianceTolerancePercent: "10",
      requireAttendanceForCrew: true,
      requireUsageForEquipment: true,
      requireMaterialConsumptionEvidence: true,
      sourceRefs: [policySource],
    },
    generatedAt: "2026-08-01T13:00:00.000Z",
  };
}

export function setZeroActual(
  request: ProgressVerificationRequestV1,
  reportedStatus: "PLANNED" | "IN_PROGRESS" | "BLOCKED",
): void {
  const actual = request.approvedActual.workItemActuals[0]!;
  actual.declaredActualQuantity!.value = "0";
  actual.declaredCumulativeQuantity!.value = "50";
  actual.declaredProgressPercent = 0;
  actual.reportedStatus = reportedStatus;
  request.approvedActual.materialInputs = [];
  request.checklists[0] = {
    ...request.checklists[0]!,
    status: "NOT_REQUIRED",
    completionPercent: null,
    approvedBy: null,
    approvedAt: null,
    sourceRefs: request.policy.sourceRefs,
  };
}
