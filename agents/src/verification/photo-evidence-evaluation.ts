import { z } from "zod";
import type {
  PhotoEvidenceEvaluationRequestV1,
  PhotoEvidenceHistoryEntryV1,
} from "../contracts/index.js";
import {
  BUILDWATCH_OPERATIONAL_POLICY_APPROVED_AT,
  type BuildWatchOperationalSimulationV1,
} from "../simulation/index.js";
import { evaluatePhotoEvidence } from "./photo-evidence.js";

export const photoEvidenceEvaluationCaseSchema = z
  .object({
    photoId: z.string().min(1),
    reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    workItemId: z.string().min(1),
    expectedDuplicate: z.boolean(),
    predictedDuplicate: z.boolean(),
    expectedAccepted: z.boolean(),
    predictedAccepted: z.boolean(),
    exactQuantityDerived: z.literal(false),
    pass: z.boolean(),
  })
  .strict();

export const photoEvidenceEvaluationReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    evaluationType: z.literal("BUILDWATCH_V22_PHOTO_EVIDENCE"),
    generatedAt: z.string().datetime({ offset: true }),
    caseCount: z.number().int().positive(),
    metrics: z
      .object({
        duplicatePrecision: z.number().finite().min(0).max(1),
        duplicateRecall: z.number().finite().min(0).max(1),
        acceptanceAccuracy: z.number().finite().min(0).max(1),
        exactQuantityViolationCount: z.number().int().nonnegative(),
      })
      .strict(),
    cases: z.array(photoEvidenceEvaluationCaseSchema).min(1),
    pass: z.boolean(),
  })
  .strict();

export type PhotoEvidenceEvaluationReport = z.infer<typeof photoEvidenceEvaluationReportSchema>;

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function toHistory(
  photo: BuildWatchOperationalSimulationV1["agentDataset"]["photoMetadata"][number],
): PhotoEvidenceHistoryEntryV1 {
  return {
    schemaVersion: 1,
    historyType: "PHOTO_EVIDENCE_HISTORY",
    photoId: photo.photoId,
    artifactId: photo.artifactId,
    tenantId: photo.tenantId,
    projectId: photo.projectId,
    reportDate: photo.reportDate,
    capturedAt: photo.capturedAt,
    reportedWorkItemId: photo.reportedWorkItemId,
    sha256: photo.sha256,
    perceptualHash: photo.perceptualHash,
    sourceRefs: photo.sourceRefs,
  };
}

export function evaluateBuildWatchPhotoEvidence(
  simulation: BuildWatchOperationalSimulationV1,
): PhotoEvidenceEvaluationReport {
  const dataset = simulation.agentDataset;
  const history: PhotoEvidenceHistoryEntryV1[] = [];
  const cases = dataset.photoMetadata.map((photo) => {
    const operationalSnapshot = dataset.operationalSnapshots.find(
      (snapshot) => snapshot.asOf.slice(0, 10) === photo.reportDate,
    );
    if (operationalSnapshot === undefined) {
      throw new Error(`Missing operational snapshot for ${photo.reportDate}`);
    }
    const workItem = operationalSnapshot.workItems.find(
      (candidate) => candidate.workItemId === photo.reportedWorkItemId,
    );
    if (workItem === undefined) {
      throw new Error(`Missing photo work item ${photo.reportedWorkItemId}`);
    }
    const evidenceRule = dataset.evidenceRules.find(
      (rule) => rule.workClassCode === workItem.workClassCode,
    );
    if (evidenceRule === undefined) {
      throw new Error(`Missing evidence rule for ${workItem.workClassCode}`);
    }
    const request: PhotoEvidenceEvaluationRequestV1 = {
      schemaVersion: 1,
      requestType: "PHOTO_EVIDENCE_EVALUATION",
      requestId: `photo-evaluation-${photo.photoId}`,
      idempotencyKey: `photo-evaluation-${photo.photoId}`,
      tenantId: photo.tenantId,
      projectId: photo.projectId,
      reportDate: photo.reportDate,
      workItemId: photo.reportedWorkItemId,
      generatedAt: `${photo.reportDate}T13:00:00.000Z`,
      operationalSnapshot,
      policy: {
        schemaVersion: 1,
        policyType: "PHOTO_EVIDENCE_POLICY",
        policyId: evidenceRule.ruleId,
        policyVersionId: `${evidenceRule.ruleId}-v1`,
        version: 1,
        tenantId: photo.tenantId,
        projectId: photo.projectId,
        workClassCode: evidenceRule.workClassCode,
        effectiveFrom: simulation.windowStart,
        approvedBy: "user-project-manager",
        approvedAt: BUILDWATCH_OPERATIONAL_POLICY_APPROVED_AT,
        requiredPhotoCount: Math.min(5, evidenceRule.requiredPhotoCount),
        requiredAngles: evidenceRule.requiredAngles,
        referenceMarkerRequired: evidenceRule.referenceMarkerRequired,
        maxPhotoAgeMinutes: evidenceRule.maxPhotoAgeMinutes,
        minimumSharpnessScore: 0.25,
        minimumBrightnessScore: 0.2,
        maximumBrightnessScore: 0.95,
        nearDuplicateHammingDistanceThreshold: Math.min(
          64,
          evidenceRule.duplicateHammingDistanceThreshold,
        ),
        sourceRefs: evidenceRule.sourceRefs,
      },
      photos: [
        {
          schemaVersion: 1,
          submissionType: "PHOTO_EVIDENCE_SUBMISSION",
          photoId: photo.photoId,
          artifactId: photo.artifactId,
          tenantId: photo.tenantId,
          projectId: photo.projectId,
          reportDate: photo.reportDate,
          capturedAt: photo.capturedAt,
          uploadedAt: photo.uploadedAt,
          reportedWorkItemId: photo.reportedWorkItemId,
          detectedWorkItemId: photo.detectedWorkItemId,
          observedAngles: ["OVERVIEW"],
          referenceMarkerPresent: true,
          contradictionSignal: "NOT_ASSESSED",
          privacyStatus: photo.privacyStatus,
          privacySignals: [],
          inspection: {
            schemaVersion: 1,
            inspectionType: "PHOTO_BYTE_INSPECTION",
            expectedMediaType: "image/jpeg",
            actualMediaType: "image/jpeg",
            sizeBytes: Math.max(1, photo.widthPixels * photo.heightPixels),
            sha256: photo.sha256,
            decoded: true,
            widthPixels: photo.widthPixels,
            heightPixels: photo.heightPixels,
            sharpnessScore: photo.sharpnessScore,
            brightnessScore: photo.brightnessScore,
            perceptualHash: photo.perceptualHash,
            errorCode: null,
            methodVersion: "buildwatch-photo-inspection-v1",
            deterministic: true,
          },
          sourceRefs: photo.sourceRefs,
        },
      ],
      history,
    };
    const evaluation = evaluatePhotoEvidence(request);
    const checkByCode = new Map(
      evaluation.photoResults[0]!.checks.map((check) => [check.code, check]),
    );
    const expectedDuplicate =
      photo.duplicateOfPhotoId !== null || photo.reusedFromReportDate !== null;
    const predictedDuplicate =
      checkByCode.get("PE-03")?.result === "FAIL" || checkByCode.get("PE-04")?.result === "FAIL";
    const predictedAccepted = evaluation.photoResults[0]!.acceptedForVerification;
    const currentCase = photoEvidenceEvaluationCaseSchema.parse({
      photoId: photo.photoId,
      reportDate: photo.reportDate,
      workItemId: photo.reportedWorkItemId,
      expectedDuplicate,
      predictedDuplicate,
      expectedAccepted: photo.acceptedForVerification,
      predictedAccepted,
      exactQuantityDerived: evaluation.exactQuantityDerived,
      pass:
        expectedDuplicate === predictedDuplicate &&
        photo.acceptedForVerification === predictedAccepted &&
        !evaluation.exactQuantityDerived,
    });
    history.push(toHistory(photo));
    return currentCase;
  });

  const truePositive = cases.filter(
    (item) => item.expectedDuplicate && item.predictedDuplicate,
  ).length;
  const falsePositive = cases.filter(
    (item) => !item.expectedDuplicate && item.predictedDuplicate,
  ).length;
  const falseNegative = cases.filter(
    (item) => item.expectedDuplicate && !item.predictedDuplicate,
  ).length;
  const correctAcceptance = cases.filter(
    (item) => item.expectedAccepted === item.predictedAccepted,
  ).length;
  const exactQuantityViolationCount = cases.filter((item) => item.exactQuantityDerived).length;
  const metrics = {
    duplicatePrecision: ratio(truePositive, truePositive + falsePositive),
    duplicateRecall: ratio(truePositive, truePositive + falseNegative),
    acceptanceAccuracy: ratio(correctAcceptance, cases.length),
    exactQuantityViolationCount,
  };
  return photoEvidenceEvaluationReportSchema.parse({
    schemaVersion: 1,
    evaluationType: "BUILDWATCH_V22_PHOTO_EVIDENCE",
    generatedAt: simulation.generatedAt,
    caseCount: cases.length,
    metrics,
    cases,
    pass:
      metrics.duplicatePrecision >= 0.9 &&
      metrics.duplicateRecall >= 0.9 &&
      metrics.acceptanceAccuracy >= 0.9 &&
      exactQuantityViolationCount === 0,
  });
}

export function renderPhotoEvidenceEvaluationMarkdown(
  report: PhotoEvidenceEvaluationReport,
): string {
  const percentage = (value: number) => `${(value * 100).toFixed(2)}%`;
  return [
    "# BuildWatch v2.2 Photo Evidence Evaluation",
    "",
    `- Result: **${report.pass ? "PASS" : "FAIL"}**`,
    `- Cases: ${report.caseCount}`,
    `- Duplicate precision: ${percentage(report.metrics.duplicatePrecision)}`,
    `- Duplicate recall: ${percentage(report.metrics.duplicateRecall)}`,
    `- Acceptance accuracy: ${percentage(report.metrics.acceptanceAccuracy)}`,
    `- Exact quantity violations: ${report.metrics.exactQuantityViolationCount}`,
    "",
    "| Photo | Expected duplicate | Predicted duplicate | Expected accepted | Predicted accepted | Pass |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.cases.map(
      (item) =>
        `| ${item.photoId} | ${item.expectedDuplicate} | ${item.predictedDuplicate} | ${item.expectedAccepted} | ${item.predictedAccepted} | ${item.pass ? "PASS" : "FAIL"} |`,
    ),
    "",
  ].join("\n");
}
