import { createHash } from "node:crypto";
import type { BuildWatchSourceReference, ProgressVerificationDraftV1 } from "../contracts/index.js";
import {
  BUILDWATCH_OPERATIONAL_POLICY_APPROVED_AT,
  type BuildWatchOperationalSimulationV1,
} from "../simulation/index.js";
import {
  approvedA1ActualBundleV1Schema,
  type ApprovedA1ActualBundleV1,
} from "./a1-approved-actual.js";
import {
  type ProgressVerificationRequestV1,
  progressVerificationRequestV1Schema,
} from "./progress-verification-contracts.js";
import {
  applyApprovedProgressVerification,
  approveProgressVerificationDraft,
  generateProgressVerification,
} from "./progress-verification.js";

type SimulationDataset = BuildWatchOperationalSimulationV1["agentDataset"];
type SimulationPlan = SimulationDataset["dailyPlans"][number];
type SimulationPlanItem = SimulationPlan["content"]["items"][number];
type VerificationItem = ProgressVerificationDraftV1["content"]["items"][number];
type CompletionStatus = VerificationItem["completionStatus"];

type InternalEvaluationCase = {
  caseId: string;
  scenario: string;
  expectedStatus: CompletionStatus;
  expectedDuplicate: boolean;
  request: ProgressVerificationRequestV1;
};

export type ProgressVerificationEvaluationCase = {
  caseId: string;
  scenario: string;
  reportDate: string;
  workItemId: string;
  expectedStatus: CompletionStatus;
  predictedStatus: CompletionStatus;
  expectedDuplicate: boolean;
  predictedDuplicate: boolean;
  verifiedQuantity: string | null;
  deterministicReplay: boolean;
  unverifiableWithoutGuessing: boolean;
  unapprovedForecastProjectionCreated: boolean;
  pass: boolean;
};

export type ProgressVerificationEvaluationReport = {
  schemaVersion: 1;
  evaluationType: "BUILDWATCH_V22_PROGRESS_VERIFICATION";
  generatedAt: string;
  seed: string;
  caseCount: number;
  metrics: {
    classificationAccuracy: number;
    falseCompletedRate: number;
    duplicatePrecision: number;
    duplicateRecall: number;
    unverifiableNoGuessRate: number;
    deterministicReplayRate: number;
    unapprovedForecastViolationCount: number;
    approvedApplyProjectionPass: boolean;
  };
  thresholds: {
    minimumCaseCount: 60;
    minimumClassificationAccuracy: 0.9;
    maximumFalseCompletedRate: 0.03;
    minimumDuplicatePrecision: 0.9;
    minimumDuplicateRecall: 0.9;
    requiredUnverifiableNoGuessRate: 1;
    requiredDeterministicReplayRate: 1;
    maximumUnapprovedForecastViolationCount: 0;
  };
  cases: ProgressVerificationEvaluationCase[];
  pass: boolean;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function dateTime(date: string, hour: number, minute = 0): string {
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}

function decimal(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  if (Object.is(rounded, -0)) {
    return "0";
  }
  return String(rounded);
}

function source(
  tenantId: string,
  projectId: string,
  sourceRefId: string,
  sourceType: BuildWatchSourceReference["sourceType"],
  sourceId: string,
  asOf: string,
): BuildWatchSourceReference {
  return {
    sourceRefId,
    tenantId,
    projectId,
    sourceType,
    sourceId,
    sourceVersionId: null,
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: null,
    region: null,
    asOf,
    sha256: null,
  };
}

function statusToReportedStatus(
  item: VerificationItem,
): "PLANNED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" {
  if (item.completionStatus === "BLOCKED") {
    return "BLOCKED";
  }
  if (item.completionStatus === "NOT_STARTED") {
    return "PLANNED";
  }
  if (item.completionStatus === "NOT_COMPLETED") {
    return "IN_PROGRESS";
  }
  if (
    item.engineerDecision?.action === "OVERRIDE_QUANTITY" ||
    item.completionStatus === "COMPLETED" ||
    item.completionStatus === "UNVERIFIABLE"
  ) {
    return "COMPLETED";
  }
  return "IN_PROGRESS";
}

function buildApprovedActual(
  simulation: BuildWatchOperationalSimulationV1,
  planItem: SimulationPlanItem,
  expected: VerificationItem,
): ApprovedA1ActualBundleV1 {
  const tenantId = simulation.agentDataset.tenantId;
  const projectId = simulation.agentDataset.projectId;
  const date = expected.reportDate;
  const reportSource = source(
    tenantId,
    projectId,
    `evaluation-report-source-${date}-${planItem.workItemId}`,
    "DAILY_REPORT",
    `evaluation-report-${date}`,
    dateTime(date, 12),
  );
  const approvalSource = source(
    tenantId,
    projectId,
    `evaluation-report-approval-${date}-${planItem.workItemId}`,
    "HUMAN_DECISION",
    `evaluation-report-approval-${date}-${planItem.workItemId}`,
    dateTime(date, 12, 5),
  );
  const sourceRefs = [reportSource, approvalSource];
  const planned = Number(planItem.plannedQuantity.value);
  const declared = expected.declaredQuantity;
  const verified = Number(expected.verifiedQuantity?.value ?? 0);
  const positiveVerified = expected.verifiedQuantity !== null && verified > 0;
  const attendanceInputs =
    positiveVerified && planItem.resources.some((resource) => resource.resourceType === "CREW")
      ? [
          {
            attendanceInputId: `evaluation-attendance-${date}-${planItem.workItemId}`,
            sourceAttendanceEntryId: `attendance-${date}-${planItem.workItemId}`,
            workItemIds: [planItem.workItemId],
            teamType: "OWN" as const,
            teamRef: "simulation-crew",
            teamName: "Simulation crew",
            headcount: 5,
            hoursPerPerson: 8,
            totalHours: 40,
            sourceRefs,
          },
        ]
      : [];
  const equipmentInputs = positiveVerified
    ? planItem.resources
        .filter((resource) => resource.resourceType === "EQUIPMENT")
        .map((resource) => ({
          equipmentInputId: `evaluation-equipment-${date}-${resource.resourceId}`,
          sourceEquipmentEntryId: `equipment-entry-${date}-${resource.resourceId}`,
          equipmentId: resource.resourceId,
          workItemIds: [planItem.workItemId],
          hoursUsed: 8,
          usageQuantity: null,
          status: "USED" as const,
          note: null,
          sourceRefs,
        }))
    : [];
  const materialInputs = positiveVerified
    ? planItem.materials.map((material) => ({
        materialInputId: `evaluation-material-${date}-${material.materialId}`,
        sourceMaterialSignalId: `material-signal-${date}-${material.materialId}`,
        signalType: "CONSUMED" as const,
        materialId: material.materialId,
        workItemIds: [planItem.workItemId],
        quantity: {
          value: decimal(
            Number(material.requiredQuantity.value) * (planned <= 0 ? 0 : verified / planned),
          ),
          unit: material.requiredQuantity.unit,
          sourceRefs,
        },
        supplierName: null,
        note: "Simulation verification input",
        sourceRefs,
      }))
    : [];
  const blockerCandidate =
    expected.approvedBlockerId === null
      ? null
      : {
          blockerCandidateId: `evaluation-blocker-${date}-${planItem.workItemId}`,
          category: "MATERIAL" as const,
          description: "Approved simulation blocker",
          isBlocking: true,
          startedOn: date,
          responsibleParty: "Simulation supplier",
          approvedOperationalBlockerId: expected.approvedBlockerId,
          sourceRefs,
        };

  return approvedA1ActualBundleV1Schema.parse({
    schemaVersion: 1,
    bundleType: "APPROVED_A1_ACTUAL",
    bundleId: `evaluation-actual-${date}-${planItem.workItemId}`,
    idempotencyKey: `evaluation-actual-idempotency-${date}-${planItem.workItemId}`,
    commandId: `evaluation-actual-command-${date}-${planItem.workItemId}`,
    commandHash: sha256(`evaluation-actual-command-${date}-${planItem.workItemId}`),
    draftId: `evaluation-report-draft-${date}-${planItem.workItemId}`,
    dailyReportId: `evaluation-report-${date}-${planItem.workItemId}`,
    tenantId,
    projectId,
    reportDate: date,
    reviewedBy: "user-site-engineer",
    reviewedAt: dateTime(date, 12, 5),
    approvalStatus: "APPROVED",
    approvalBoundary: "APPROVED_COMMAND_ONLY",
    workItemActuals: [
      {
        actualInputId: `evaluation-actual-item-${date}-${planItem.workItemId}`,
        dailyProgressEntryId: `evaluation-progress-${date}-${planItem.workItemId}`,
        workItemId: planItem.workItemId,
        workItemCode: planItem.workCode,
        progressMode: "INCREMENTAL",
        declaredActualQuantity:
          declared === null
            ? null
            : {
                value: declared.value,
                unit: declared.unit,
                sourceRefs,
              },
        declaredCumulativeQuantity:
          expected.cumulativeQuantity === null
            ? declared === null
              ? null
              : { value: declared.value, unit: declared.unit, sourceRefs }
            : {
                value: expected.cumulativeQuantity.value,
                unit: expected.cumulativeQuantity.unit,
                sourceRefs,
              },
        declaredProgressPercent:
          declared === null || planned <= 0
            ? null
            : Math.max(0, Math.min(100, (Number(declared.value) / planned) * 100)),
        reportedStatus: statusToReportedStatus(expected),
        blockerCandidate,
        sourceRefs,
      },
    ],
    attendanceInputs,
    materialInputs,
    equipmentInputs,
    sourceArtifacts: [],
    sourceRefs,
    eligibleForVerification: true,
    eligibleForForecast: false,
    forecastExclusionReason: "REQUIRES_APPROVED_PROGRESS_VERIFICATION",
    deterministic: true,
  });
}

function buildPhotoEvaluation(
  simulation: BuildWatchOperationalSimulationV1,
  planItem: SimulationPlanItem,
  expected: VerificationItem,
) {
  const dataset = simulation.agentDataset;
  const photo = dataset.photoMetadata.find(
    (candidate) =>
      candidate.reportDate === expected.reportDate &&
      candidate.reportedWorkItemId === planItem.workItemId,
  );
  if (photo === undefined) {
    throw new Error(`Missing simulation photo for ${expected.verificationItemId}`);
  }
  const intrinsicCodes = new Set([
    "PE-01",
    "PE-02",
    "PE-03",
    "PE-04",
    "PE-05",
    "PE-06",
    "PE-09",
    "PE-10",
  ]);
  const intrinsicFailure = expected.photoChecks.some(
    (check) => intrinsicCodes.has(check.code) && check.result === "FAIL",
  );
  const unresolved = expected.photoChecks.some((check) =>
    ["FAIL", "WARNING"].includes(check.result),
  );
  const usable = !intrinsicFailure;
  const accepted = !unresolved;
  const calculationSource = source(
    dataset.tenantId,
    dataset.projectId,
    `evaluation-photo-calculation-${photo.photoId}`,
    "SYSTEM_CALCULATION",
    `evaluation-photo-${photo.photoId}`,
    dateTime(expected.reportDate, 12, 30),
  );
  const photoResult = {
    photoId: photo.photoId,
    artifactId: photo.artifactId,
    exactDuplicateOfPhotoId: photo.duplicateOfPhotoId,
    nearDuplicateOfPhotoId: null,
    nearDuplicateHammingDistance: null,
    reusedFromReportDate: photo.reusedFromReportDate,
    usableForEvidence: usable,
    acceptedForVerification: accepted,
    requiresHumanReview: true as const,
    checks: expected.photoChecks,
    sourceRefs: photo.sourceRefs,
  };
  const credited = usable ? 1 : 0;
  const evidenceComplete = credited === 1;
  return {
    schemaVersion: 1 as const,
    evaluationType: "PHOTO_EVIDENCE_EVALUATION" as const,
    evaluationId: `evaluation-photo-result-${photo.photoId}`,
    requestId: `evaluation-photo-request-${photo.photoId}`,
    idempotencyKey: `evaluation-photo-idempotency-${photo.photoId}`,
    requestHash: sha256(`evaluation-photo-request-${photo.photoId}`),
    tenantId: dataset.tenantId,
    projectId: dataset.projectId,
    reportDate: expected.reportDate,
    workItemId: planItem.workItemId,
    policyId: planItem.evidenceRuleId,
    policyVersionId: `${planItem.evidenceRuleId}-v1`,
    photoResults: [photoResult],
    coverage: {
      requiredCount: 1,
      submittedCount: 1,
      usableCount: credited,
      creditedCount: credited,
      coveragePercent: credited * 100,
      requiredAngles: ["OVERVIEW" as const],
      observedAngles: ["OVERVIEW" as const],
      missingAngles: [],
      requiredAnglesComplete: true,
      referenceMarkerRequired: true,
      referenceMarkerPresent: true,
      evidenceComplete,
      sourceRefs: [...photo.sourceRefs, calculationSource],
    },
    automaticEvidenceAcceptanceAllowed: evidenceComplete && accepted,
    requiresHumanReview: true as const,
    eligibleForProgressVerification: true as const,
    exactQuantityDerived: false as const,
    deterministic: true as const,
    generatedAt: dateTime(expected.reportDate, 12, 30),
    sourceRefs: [...photo.sourceRefs, calculationSource],
  };
}

function toEvaluationRequest(
  simulation: BuildWatchOperationalSimulationV1,
  plan: SimulationPlan,
  planItem: SimulationPlanItem,
  expected: VerificationItem,
): ProgressVerificationRequestV1 {
  const dataset = simulation.agentDataset;
  const date = expected.reportDate;
  const policySource = source(
    dataset.tenantId,
    dataset.projectId,
    `evaluation-verification-policy-${planItem.workItemId}`,
    "SYSTEM_CALCULATION",
    "evaluation-verification-policy-v1",
    BUILDWATCH_OPERATIONAL_POLICY_APPROVED_AT,
  );
  const approvedPlanContent = {
    ...structuredClone(plan.content),
    items: [structuredClone(planItem)],
    conflicts: [],
  };
  const approvedActual = buildApprovedActual(simulation, planItem, expected);
  return progressVerificationRequestV1Schema.parse({
    schemaVersion: 1,
    requestType: "A5_PROGRESS_VERIFICATION",
    requestId: `evaluation-verification-${date}-${planItem.workItemId}`,
    idempotencyKey: `evaluation-verification-${date}-${planItem.workItemId}`,
    tenantId: dataset.tenantId,
    projectId: dataset.projectId,
    reportDate: date,
    approvedPlan: {
      schemaVersion: 1,
      versionType: "APPROVED_DAILY_WORK_PLAN",
      dailyWorkPlanVersionId: `evaluation-plan-version-${date}-${planItem.workItemId}`,
      tenantId: dataset.tenantId,
      projectId: dataset.projectId,
      status: "APPROVED",
      content: approvedPlanContent,
      metadata: {
        version: 1,
        approvedBy: "user-project-manager",
        approvedAt: dateTime(date, 6),
        sourceHash: sha256(JSON.stringify(approvedPlanContent)),
        supersedesVersionId: null,
      },
    },
    approvedActual,
    photoEvaluations: [buildPhotoEvaluation(simulation, planItem, expected)],
    measurementConfigurations: [
      {
        configurationId: `evaluation-measurement-${date}-${planItem.workItemId}`,
        dailyPlanItemId: planItem.planItemId,
        workItemId: planItem.workItemId,
        mode: expected.measurementMode,
        sourceRefs: [policySource],
      },
    ],
    checklists: [
      {
        checklistId: `evaluation-checklist-${date}-${planItem.workItemId}`,
        dailyPlanItemId: planItem.planItemId,
        workItemId: planItem.workItemId,
        status: expected.mandatoryChecklistStatus,
        completionPercent:
          expected.measurementMode === "WEIGHTED_MILESTONE" ? expected.completionRatePercent : null,
        approvedBy: ["PASSED", "FAILED"].includes(expected.mandatoryChecklistStatus)
          ? "user-site-engineer"
          : null,
        approvedAt: ["PASSED", "FAILED"].includes(expected.mandatoryChecklistStatus)
          ? dateTime(date, 12, 15)
          : null,
        sourceRefs:
          expected.mandatoryChecklistStatus === "PASSED"
            ? [
                source(
                  dataset.tenantId,
                  dataset.projectId,
                  `evaluation-checklist-source-${date}-${planItem.workItemId}`,
                  "HUMAN_DECISION",
                  `evaluation-checklist-${date}-${planItem.workItemId}`,
                  dateTime(date, 12, 15),
                ),
              ]
            : [policySource],
      },
    ],
    engineerDecisions: [expected.engineerDecision],
    policy: {
      schemaVersion: 1,
      policyType: "PROGRESS_VERIFICATION_POLICY",
      policyId: "evaluation-verification-policy",
      policyVersionId: "evaluation-verification-policy-v1",
      version: 1,
      tenantId: dataset.tenantId,
      projectId: dataset.projectId,
      effectiveFrom: simulation.windowStart,
      approvedBy: "user-project-manager",
      approvedAt: BUILDWATCH_OPERATIONAL_POLICY_APPROVED_AT,
      materialVarianceTolerancePercent: "10",
      requireAttendanceForCrew: true,
      requireUsageForEquipment: true,
      requireMaterialConsumptionEvidence: true,
      sourceRefs: [policySource],
    },
    generatedAt: dateTime(date, 13),
  });
}

function baseCases(simulation: BuildWatchOperationalSimulationV1): InternalEvaluationCase[] {
  const dataset = simulation.agentDataset;
  const draftByDate = new Map(
    dataset.verificationDrafts.map((draft) => [draft.content.reportDate, draft]),
  );
  const cases: InternalEvaluationCase[] = [];
  for (const plan of dataset.dailyPlans) {
    const draft = draftByDate.get(plan.content.planDate);
    if (draft === undefined) {
      continue;
    }
    for (const planItem of plan.content.items) {
      const hasErrorConflict = plan.content.conflicts.some(
        (conflict) =>
          conflict.severity === "ERROR" && conflict.planItemIds.includes(planItem.planItemId),
      );
      if (!planItem.feasibility.feasible || hasErrorConflict) {
        continue;
      }
      const expected = draft.content.items.find(
        (item) => item.dailyPlanItemId === planItem.planItemId,
      );
      if (expected === undefined) {
        continue;
      }
      const photo = dataset.photoMetadata.find(
        (candidate) =>
          candidate.reportDate === plan.content.planDate &&
          candidate.reportedWorkItemId === planItem.workItemId,
      );
      cases.push({
        caseId: `simulation-${plan.content.planDate}-${planItem.workItemId}`,
        scenario: "SIMULATION_REPLAY",
        expectedStatus: expected.completionStatus,
        expectedDuplicate:
          photo?.duplicateOfPhotoId !== null || photo?.reusedFromReportDate !== null,
        request: toEvaluationRequest(simulation, plan, planItem, expected),
      });
    }
  }
  return cases;
}

function identify(
  request: ProgressVerificationRequestV1,
  label: string,
): ProgressVerificationRequestV1 {
  request.requestId = `evaluation-adversarial-${label}`;
  request.idempotencyKey = `evaluation-adversarial-${label}`;
  return request;
}

function zeroActual(
  request: ProgressVerificationRequestV1,
  reportedStatus: "PLANNED" | "IN_PROGRESS" | "BLOCKED",
): void {
  const actual = request.approvedActual.workItemActuals[0]!;
  actual.declaredActualQuantity!.value = "0";
  actual.declaredCumulativeQuantity!.value = "0";
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
    photo.exactDuplicateOfPhotoId = `previous-${photo.photoId}`;
  }
  if (code === "PE-04") {
    photo.reusedFromReportDate = "2026-01-01";
  }
  evaluation.coverage.usableCount = 0;
  evaluation.coverage.creditedCount = 0;
  evaluation.coverage.coveragePercent = 0;
  evaluation.coverage.evidenceComplete = false;
  evaluation.automaticEvidenceAcceptanceAllowed = false;
}

function adversarialCases(base: readonly InternalEvaluationCase[]): InternalEvaluationCase[] {
  const completed = base.filter((item) => item.expectedStatus === "COMPLETED");
  if (completed.length < 12) {
    throw new Error("Progress evaluation requires twelve completed base cases");
  }
  const build = (
    index: number,
    label: string,
    expectedStatus: CompletionStatus,
    mutate: (request: ProgressVerificationRequestV1) => void,
    expectedDuplicate = false,
  ): InternalEvaluationCase => {
    const request = identify(structuredClone(completed[index]!.request), label);
    mutate(request);
    return {
      caseId: `adversarial-${label}`,
      scenario: label.toUpperCase(),
      expectedStatus,
      expectedDuplicate,
      request,
    };
  };
  const materialIndex = completed.findIndex(
    (item) => item.request.approvedPlan.content.items[0]!.materials.length > 0,
  );
  const crewIndex = completed.findIndex((item) =>
    item.request.approvedPlan.content.items[0]!.resources.some(
      (resource) => resource.resourceType === "CREW",
    ),
  );
  const equipmentIndex = completed.findIndex((item) =>
    item.request.approvedPlan.content.items[0]!.resources.some(
      (resource) => resource.resourceType === "EQUIPMENT",
    ),
  );
  if (materialIndex < 0 || crewIndex < 0 || equipmentIndex < 0) {
    throw new Error("Simulation lacks material, crew, or equipment verification cases");
  }

  return [
    build(0, "false-completed", "PARTIALLY_COMPLETED", (request) => {
      const plan = Number(request.approvedPlan.content.items[0]!.plannedQuantity.value);
      const half = decimal(plan / 2);
      const decision = request.engineerDecisions[0]!;
      decision.action = "OVERRIDE_QUANTITY";
      decision.reason = "Evaluation verified only half of the declared target.";
      decision.overrideQuantity = {
        value: half,
        unit: request.approvedPlan.content.items[0]!.unit,
        sourceRefs: decision.sourceRefs,
      };
      request.approvedActual.workItemActuals[0]!.reportedStatus = "COMPLETED";
      for (const input of request.approvedActual.materialInputs) {
        input.quantity!.value = decimal(Number(input.quantity!.value) / 2);
      }
    }),
    build(1, "missing-quantity", "UNVERIFIABLE", (request) => {
      request.approvedActual.workItemActuals[0]!.declaredActualQuantity = null;
      request.approvedActual.workItemActuals[0]!.declaredProgressPercent = null;
    }),
    build(
      2,
      "exact-duplicate",
      "UNVERIFIABLE",
      (request) => invalidatePhoto(request, "PE-03"),
      true,
    ),
    build(
      3,
      "previous-day-reuse",
      "UNVERIFIABLE",
      (request) => invalidatePhoto(request, "PE-04"),
      true,
    ),
    build(4, "report-photo-mismatch", "UNVERIFIABLE", (request) =>
      invalidatePhoto(request, "PE-06"),
    ),
    build(materialIndex, "material-mismatch", "UNVERIFIABLE", (request) => {
      request.approvedActual.materialInputs[0]!.quantity!.value = "0.000001";
    }),
    build(crewIndex, "attendance-mismatch", "UNVERIFIABLE", (request) => {
      request.approvedActual.attendanceInputs = [];
    }),
    build(equipmentIndex, "equipment-mismatch", "UNVERIFIABLE", (request) => {
      request.approvedActual.equipmentInputs = [];
    }),
    build(8, "approved-blocker", "BLOCKED", (request) => {
      zeroActual(request, "BLOCKED");
      const actual = request.approvedActual.workItemActuals[0]!;
      actual.blockerCandidate = {
        blockerCandidateId: "evaluation-approved-blocker-candidate",
        category: "MATERIAL",
        description: "Approved evaluation blocker",
        isBlocking: true,
        startedOn: request.reportDate,
        responsibleParty: "Simulation supplier",
        approvedOperationalBlockerId: "evaluation-approved-blocker",
        sourceRefs: actual.sourceRefs,
      };
    }),
    build(9, "unapproved-blocker", "UNVERIFIABLE", (request) => {
      zeroActual(request, "BLOCKED");
      const actual = request.approvedActual.workItemActuals[0]!;
      actual.blockerCandidate = {
        blockerCandidateId: "evaluation-unapproved-blocker-candidate",
        category: "MATERIAL",
        description: "Unapproved evaluation blocker",
        isBlocking: true,
        startedOn: request.reportDate,
        responsibleParty: "Simulation supplier",
        approvedOperationalBlockerId: null,
        sourceRefs: actual.sourceRefs,
      };
    }),
    build(10, "not-completed", "NOT_COMPLETED", (request) => {
      zeroActual(request, "IN_PROGRESS");
    }),
    build(11, "not-started", "NOT_STARTED", (request) => {
      zeroActual(request, "PLANNED");
      request.approvedActual.attendanceInputs = [];
      request.approvedActual.equipmentInputs = [];
    }),
  ];
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function approvedApplyProjectionPass(internalCases: readonly InternalEvaluationCase[]): boolean {
  const healthy = internalCases.find((item) => item.expectedStatus === "COMPLETED");
  if (healthy === undefined) {
    return false;
  }
  const result = generateProgressVerification(healthy.request);
  if (result.draft.status !== "REVIEW_REQUIRED") {
    return false;
  }
  const command = approveProgressVerificationDraft({
    schemaVersion: 1,
    requestType: "APPROVE_PROGRESS_VERIFICATION_DRAFT",
    commandId: "evaluation-approve-verification",
    idempotencyKey: "evaluation-approve-verification",
    progressVerificationVersionId: "evaluation-verification-version",
    version: 1,
    supersedesVersionId: null,
    draft: result.draft,
    approvedContent: result.draft.content,
    decision: {
      decisionId: "evaluation-manager-approval",
      action: "APPROVE",
      reviewerId: "user-project-manager",
      reviewerRole: "PROJECT_MANAGER",
      decidedAt: dateTime(healthy.request.reportDate, 14),
      reason: null,
      correctedFieldPaths: [],
    },
  });
  const applied = applyApprovedProgressVerification({
    schemaVersion: 1,
    requestType: "APPLY_APPROVED_PROGRESS_VERIFICATION",
    command,
    approvedActual: healthy.request.approvedActual,
    appliedBy: "evaluation-worker",
    appliedAt: dateTime(healthy.request.reportDate, 15),
  });
  return (
    applied.transactionBoundary === "APPROVED_COMMAND_ONLY" &&
    applied.progressHistory.length === 1 &&
    applied.dailyVariances.length === 1 &&
    applied.productivitySamples.length === 1 &&
    applied.forecastInputs.length === 1 &&
    applied.forecastInputs[0]?.included === true
  );
}

export function evaluateBuildWatchProgressVerification(
  simulation: BuildWatchOperationalSimulationV1,
): ProgressVerificationEvaluationReport {
  const simulationCases = baseCases(simulation);
  const internalCases = [...simulationCases, ...adversarialCases(simulationCases)];
  const cases = internalCases.map((evaluationCase) => {
    let first: ReturnType<typeof generateProgressVerification>;
    let second: ReturnType<typeof generateProgressVerification>;
    try {
      first = generateProgressVerification(evaluationCase.request);
      second = generateProgressVerification(structuredClone(evaluationCase.request));
    } catch (error) {
      throw new Error(
        `Progress verification evaluation failed for ${evaluationCase.caseId}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const item = first.draft.content.items[0]!;
    const issueCodes = new Set(item.issues.map((issue) => issue.code));
    const predictedDuplicate =
      issueCodes.has("PHOTO_DUPLICATE_OR_NEAR_DUPLICATE") ||
      issueCodes.has("PHOTO_PREVIOUS_DAY_REUSE");
    const deterministicReplay = JSON.stringify(first) === JSON.stringify(second);
    const unverifiableWithoutGuessing =
      evaluationCase.expectedStatus !== "UNVERIFIABLE" ||
      (item.completionStatus === "UNVERIFIABLE" &&
        item.verifiedQuantity === null &&
        item.completionRatePercent === null);
    const unapprovedForecastProjectionCreated = Object.prototype.hasOwnProperty.call(
      first,
      "forecastInputs",
    );
    return {
      caseId: evaluationCase.caseId,
      scenario: evaluationCase.scenario,
      reportDate: evaluationCase.request.reportDate,
      workItemId: item.workItemId,
      expectedStatus: evaluationCase.expectedStatus,
      predictedStatus: item.completionStatus,
      expectedDuplicate: evaluationCase.expectedDuplicate,
      predictedDuplicate,
      verifiedQuantity: item.verifiedQuantity?.value ?? null,
      deterministicReplay,
      unverifiableWithoutGuessing,
      unapprovedForecastProjectionCreated,
      pass:
        item.completionStatus === evaluationCase.expectedStatus &&
        predictedDuplicate === evaluationCase.expectedDuplicate &&
        deterministicReplay &&
        unverifiableWithoutGuessing &&
        !unapprovedForecastProjectionCreated,
    } satisfies ProgressVerificationEvaluationCase;
  });

  const correctlyClassified = cases.filter(
    (item) => item.expectedStatus === item.predictedStatus,
  ).length;
  const expectedNotCompleted = cases.filter((item) => item.expectedStatus !== "COMPLETED");
  const falseCompleted = expectedNotCompleted.filter(
    (item) => item.predictedStatus === "COMPLETED",
  ).length;
  const duplicateTruePositive = cases.filter(
    (item) => item.expectedDuplicate && item.predictedDuplicate,
  ).length;
  const duplicateFalsePositive = cases.filter(
    (item) => !item.expectedDuplicate && item.predictedDuplicate,
  ).length;
  const duplicateFalseNegative = cases.filter(
    (item) => item.expectedDuplicate && !item.predictedDuplicate,
  ).length;
  const unverifiableCases = cases.filter((item) => item.expectedStatus === "UNVERIFIABLE");
  const unapprovedForecastViolationCount = cases.filter(
    (item) => item.unapprovedForecastProjectionCreated,
  ).length;
  const metrics = {
    classificationAccuracy: ratio(correctlyClassified, cases.length),
    falseCompletedRate: ratio(falseCompleted, expectedNotCompleted.length),
    duplicatePrecision: ratio(
      duplicateTruePositive,
      duplicateTruePositive + duplicateFalsePositive,
    ),
    duplicateRecall: ratio(duplicateTruePositive, duplicateTruePositive + duplicateFalseNegative),
    unverifiableNoGuessRate: ratio(
      unverifiableCases.filter((item) => item.unverifiableWithoutGuessing).length,
      unverifiableCases.length,
    ),
    deterministicReplayRate: ratio(
      cases.filter((item) => item.deterministicReplay).length,
      cases.length,
    ),
    unapprovedForecastViolationCount,
    approvedApplyProjectionPass: approvedApplyProjectionPass(internalCases),
  };
  const thresholds = {
    minimumCaseCount: 60 as const,
    minimumClassificationAccuracy: 0.9 as const,
    maximumFalseCompletedRate: 0.03 as const,
    minimumDuplicatePrecision: 0.9 as const,
    minimumDuplicateRecall: 0.9 as const,
    requiredUnverifiableNoGuessRate: 1 as const,
    requiredDeterministicReplayRate: 1 as const,
    maximumUnapprovedForecastViolationCount: 0 as const,
  };
  return {
    schemaVersion: 1,
    evaluationType: "BUILDWATCH_V22_PROGRESS_VERIFICATION",
    generatedAt: simulation.generatedAt,
    seed: simulation.seed,
    caseCount: cases.length,
    metrics,
    thresholds,
    cases,
    pass:
      cases.length >= thresholds.minimumCaseCount &&
      metrics.classificationAccuracy >= thresholds.minimumClassificationAccuracy &&
      metrics.falseCompletedRate < thresholds.maximumFalseCompletedRate &&
      metrics.duplicatePrecision >= thresholds.minimumDuplicatePrecision &&
      metrics.duplicateRecall >= thresholds.minimumDuplicateRecall &&
      metrics.unverifiableNoGuessRate === thresholds.requiredUnverifiableNoGuessRate &&
      metrics.deterministicReplayRate === thresholds.requiredDeterministicReplayRate &&
      metrics.unapprovedForecastViolationCount ===
        thresholds.maximumUnapprovedForecastViolationCount &&
      metrics.approvedApplyProjectionPass,
  };
}

export function renderProgressVerificationEvaluationMarkdown(
  report: ProgressVerificationEvaluationReport,
): string {
  const percentage = (value: number) => `${(value * 100).toFixed(2)}%`;
  return [
    "# BuildWatch v2.2 Progress Verification Evaluation",
    "",
    `- Result: **${report.pass ? "PASS" : "FAIL"}**`,
    `- Cases: ${report.caseCount}`,
    `- Classification accuracy: ${percentage(report.metrics.classificationAccuracy)}`,
    `- False COMPLETED rate: ${percentage(report.metrics.falseCompletedRate)}`,
    `- Duplicate precision/recall: ${percentage(report.metrics.duplicatePrecision)} / ${percentage(report.metrics.duplicateRecall)}`,
    `- Unverifiable without guessing: ${percentage(report.metrics.unverifiableNoGuessRate)}`,
    `- Deterministic replay: ${percentage(report.metrics.deterministicReplayRate)}`,
    `- Unapproved forecast violations: ${report.metrics.unapprovedForecastViolationCount}`,
    `- Approved apply projections: ${report.metrics.approvedApplyProjectionPass ? "PASS" : "FAIL"}`,
    "",
    "| Case | Scenario | Expected | Predicted | Duplicate E/P | No guessing | Pass |",
    "|---|---|---|---|---:|---:|---:|",
    ...report.cases.map(
      (item) =>
        `| ${item.caseId} | ${item.scenario} | ${item.expectedStatus} | ${item.predictedStatus} | ${item.expectedDuplicate}/${item.predictedDuplicate} | ${item.unverifiableWithoutGuessing} | ${item.pass ? "PASS" : "FAIL"} |`,
    ),
    "",
  ].join("\n");
}
