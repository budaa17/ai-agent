import { z } from "zod";
import {
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
} from "./common.js";
import {
  buildWatchSourceReferenceSchema,
  hasUniqueContractIds,
  sourceReferenceMatchesScope,
} from "./buildwatch-v2-common.js";
import { operationalPlanningSnapshotV1Schema } from "./schedule/index.js";
import { photoEvidenceCheckCodeSchema, photoEvidenceCheckSchema } from "./verification/index.js";

export const photoEvidenceMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const photoEvidenceInspectionErrorCodeSchema = z.enum([
  "IMAGE_DECODE_FAILED",
  "MEDIA_TYPE_MISMATCH",
]);

export const photoEvidenceByteInspectionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    inspectionType: z.literal("PHOTO_BYTE_INSPECTION"),
    expectedMediaType: photoEvidenceMediaTypeSchema,
    actualMediaType: photoEvidenceMediaTypeSchema.nullable(),
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(100 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    decoded: z.boolean(),
    widthPixels: z.number().int().positive().max(100_000).nullable(),
    heightPixels: z.number().int().positive().max(100_000).nullable(),
    sharpnessScore: z.number().finite().min(0).max(1).nullable(),
    brightnessScore: z.number().finite().min(0).max(1).nullable(),
    perceptualHash: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .nullable(),
    errorCode: photoEvidenceInspectionErrorCodeSchema.nullable(),
    methodVersion: z.literal("buildwatch-photo-inspection-v1"),
    deterministic: z.literal(true),
  })
  .strict()
  .superRefine((inspection, context) => {
    const decodedMetrics = [
      inspection.widthPixels,
      inspection.heightPixels,
      inspection.sharpnessScore,
      inspection.brightnessScore,
      inspection.perceptualHash,
    ];
    if (
      inspection.decoded &&
      (inspection.actualMediaType === null ||
        decodedMetrics.some((value) => value === null) ||
        inspection.errorCode !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Decoded photo inspection requires complete metrics",
        path: ["decoded"],
      });
    }
    if (
      !inspection.decoded &&
      (decodedMetrics.some((value) => value !== null) || inspection.errorCode === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Failed photo inspection cannot contain decoded metrics",
        path: ["errorCode"],
      });
    }
    if (inspection.errorCode === "MEDIA_TYPE_MISMATCH" && inspection.actualMediaType === null) {
      context.addIssue({
        code: "custom",
        message: "Media-type mismatch requires the detected media type",
        path: ["actualMediaType"],
      });
    }
  });

export const photoEvidencePrivacyStatusSchema = z.enum(["CLEARED", "REDACTED", "RESTRICTED"]);

export const photoEvidencePrivacySignalSchema = z.enum([
  "FACE",
  "LICENSE_PLATE",
  "IDENTITY_DOCUMENT",
  "SENSITIVE_TEXT",
]);

export const photoEvidenceContradictionSignalSchema = z.enum([
  "SUPPORTS",
  "CONTRADICTS",
  "UNCERTAIN",
  "NOT_ASSESSED",
]);

export const photoEvidenceAngleSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/);

export const photoEvidenceSubmissionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    submissionType: z.literal("PHOTO_EVIDENCE_SUBMISSION"),
    photoId: contractIdentifierSchema,
    artifactId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    capturedAt: contractIsoDateTimeSchema,
    uploadedAt: contractIsoDateTimeSchema,
    reportedWorkItemId: contractIdentifierSchema,
    detectedWorkItemId: contractIdentifierSchema.nullable(),
    observedAngles: z.array(photoEvidenceAngleSchema).max(20),
    referenceMarkerPresent: z.boolean().nullable(),
    contradictionSignal: photoEvidenceContradictionSignalSchema,
    privacyStatus: photoEvidencePrivacyStatusSchema,
    privacySignals: z.array(photoEvidencePrivacySignalSchema).max(20),
    inspection: photoEvidenceByteInspectionV1Schema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(10),
  })
  .strict()
  .superRefine((photo, context) => {
    if (!hasUniqueContractIds(photo.observedAngles)) {
      context.addIssue({
        code: "custom",
        message: "Observed photo angles must be unique",
        path: ["observedAngles"],
      });
    }
    if (photo.privacyStatus === "CLEARED" && photo.privacySignals.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Cleared photo cannot retain privacy signals",
        path: ["privacyStatus"],
      });
    }
    if (
      !photo.sourceRefs.every((source) =>
        sourceReferenceMatchesScope(source, photo.tenantId, photo.projectId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo submission source is outside its scope",
        path: ["sourceRefs"],
      });
    }
    if (
      !photo.sourceRefs.some(
        (source) =>
          source.sourceType === "PHOTO_EVIDENCE" &&
          source.artifactId === photo.artifactId &&
          source.sha256 === photo.inspection.sha256 &&
          source.asOf !== null,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo submission requires checksum-backed artifact lineage",
        path: ["sourceRefs"],
      });
    }
  });

export const photoEvidenceHistoryEntryV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    historyType: z.literal("PHOTO_EVIDENCE_HISTORY"),
    photoId: contractIdentifierSchema,
    artifactId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    capturedAt: contractIsoDateTimeSchema,
    reportedWorkItemId: contractIdentifierSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    perceptualHash: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(10),
  })
  .strict()
  .superRefine((photo, context) => {
    if (
      !photo.sourceRefs.every((source) =>
        sourceReferenceMatchesScope(source, photo.tenantId, photo.projectId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo history source is outside its scope",
        path: ["sourceRefs"],
      });
    }
    if (
      !photo.sourceRefs.some(
        (source) =>
          source.sourceType === "PHOTO_EVIDENCE" &&
          source.artifactId === photo.artifactId &&
          source.sha256 === photo.sha256 &&
          source.asOf !== null,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo history requires checksum-backed artifact lineage",
        path: ["sourceRefs"],
      });
    }
    if (photo.capturedAt.slice(0, 10) > photo.reportDate) {
      context.addIssue({
        code: "custom",
        message: "Photo history capture cannot be after its report date",
        path: ["capturedAt"],
      });
    }
  });

export const photoEvidencePolicyV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    policyType: z.literal("PHOTO_EVIDENCE_POLICY"),
    policyId: contractIdentifierSchema,
    policyVersionId: contractIdentifierSchema,
    version: z.number().int().positive(),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    workClassCode: z.string().trim().min(1).max(200),
    effectiveFrom: contractIsoDateSchema,
    approvedBy: contractIdentifierSchema,
    approvedAt: contractIsoDateTimeSchema,
    requiredPhotoCount: z.number().int().nonnegative().max(5),
    requiredAngles: z.array(photoEvidenceAngleSchema).max(20),
    referenceMarkerRequired: z.boolean(),
    maxPhotoAgeMinutes: z.number().int().positive().max(100_000),
    minimumSharpnessScore: z.number().finite().min(0).max(1),
    minimumBrightnessScore: z.number().finite().min(0).max(1),
    maximumBrightnessScore: z.number().finite().min(0).max(1),
    nearDuplicateHammingDistanceThreshold: z.number().int().nonnegative().max(64),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(10),
  })
  .strict()
  .superRefine((policy, context) => {
    if (!hasUniqueContractIds(policy.requiredAngles)) {
      context.addIssue({
        code: "custom",
        message: "Required photo angles must be unique",
        path: ["requiredAngles"],
      });
    }
    if (policy.maximumBrightnessScore <= policy.minimumBrightnessScore) {
      context.addIssue({
        code: "custom",
        message: "Maximum brightness must exceed minimum brightness",
        path: ["maximumBrightnessScore"],
      });
    }
    if (policy.approvedAt.slice(0, 10) > policy.effectiveFrom) {
      context.addIssue({
        code: "custom",
        message: "Photo policy must be approved before becoming effective",
        path: ["approvedAt"],
      });
    }
    if (
      !policy.sourceRefs.every((source) =>
        sourceReferenceMatchesScope(source, policy.tenantId, policy.projectId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo policy source is outside its scope",
        path: ["sourceRefs"],
      });
    }
  });

export const photoEvidenceEvaluationRequestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestType: z.literal("PHOTO_EVIDENCE_EVALUATION"),
    requestId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    workItemId: contractIdentifierSchema,
    generatedAt: contractIsoDateTimeSchema,
    operationalSnapshot: operationalPlanningSnapshotV1Schema,
    policy: photoEvidencePolicyV1Schema,
    photos: z.array(photoEvidenceSubmissionV1Schema).max(5),
    history: z.array(photoEvidenceHistoryEntryV1Schema).max(10_000),
  })
  .strict()
  .superRefine((request, context) => {
    const scopeMatches =
      request.operationalSnapshot.tenantId === request.tenantId &&
      request.operationalSnapshot.projectId === request.projectId &&
      request.policy.tenantId === request.tenantId &&
      request.policy.projectId === request.projectId &&
      request.photos.every(
        (photo) => photo.tenantId === request.tenantId && photo.projectId === request.projectId,
      ) &&
      request.history.every(
        (photo) => photo.tenantId === request.tenantId && photo.projectId === request.projectId,
      );
    if (!scopeMatches) {
      context.addIssue({
        code: "custom",
        message: "Photo evaluation input is outside request scope",
        path: ["tenantId"],
      });
    }
    const workItem = request.operationalSnapshot.workItems.find(
      (candidate) => candidate.workItemId === request.workItemId,
    );
    if (workItem === undefined) {
      context.addIssue({
        code: "custom",
        message: "Photo evaluation work item is outside snapshot",
        path: ["workItemId"],
      });
    } else if (workItem.workClassCode !== request.policy.workClassCode) {
      context.addIssue({
        code: "custom",
        message: "Photo policy work class does not match the work item",
        path: ["policy", "workClassCode"],
      });
    }
    if (
      request.operationalSnapshot.asOf > request.generatedAt ||
      request.operationalSnapshot.asOf.slice(0, 10) > request.reportDate
    ) {
      context.addIssue({
        code: "custom",
        message: "Operational snapshot cannot be from the future",
        path: ["operationalSnapshot", "asOf"],
      });
    }
    if (
      request.policy.effectiveFrom > request.reportDate ||
      request.policy.approvedAt > request.generatedAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo policy is not effective for this evaluation",
        path: ["policy", "effectiveFrom"],
      });
    }
    if (request.photos.some((photo) => photo.uploadedAt > request.generatedAt)) {
      context.addIssue({
        code: "custom",
        message: "Photo upload cannot occur after evaluation",
        path: ["photos"],
      });
    }
    const inputSources = [
      ...request.policy.sourceRefs,
      ...request.photos.flatMap((photo) => photo.sourceRefs),
      ...request.history.flatMap((photo) => photo.sourceRefs),
    ];
    if (inputSources.some((source) => source.asOf !== null && source.asOf > request.generatedAt)) {
      context.addIssue({
        code: "custom",
        message: "Photo evaluation source cannot be from the future",
        path: ["photos", "sourceRefs"],
      });
    }
    if (request.history.some((photo) => photo.reportDate > request.reportDate)) {
      context.addIssue({
        code: "custom",
        message: "Photo history cannot contain a future report",
        path: ["history"],
      });
    }
    const currentIds = request.photos.map((photo) => photo.photoId);
    const currentArtifactIds = request.photos.map((photo) => photo.artifactId);
    const historyIds = request.history.map((photo) => photo.photoId);
    if (
      !hasUniqueContractIds(currentIds) ||
      !hasUniqueContractIds(currentArtifactIds) ||
      !hasUniqueContractIds(historyIds) ||
      currentIds.some((id) => historyIds.includes(id))
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo evaluation identifiers must be unique",
        path: ["photos"],
      });
    }
  });

export const photoEvidencePhotoResultV1Schema = z
  .object({
    photoId: contractIdentifierSchema,
    artifactId: contractIdentifierSchema,
    exactDuplicateOfPhotoId: contractIdentifierSchema.nullable(),
    nearDuplicateOfPhotoId: contractIdentifierSchema.nullable(),
    nearDuplicateHammingDistance: z.number().int().min(0).max(64).nullable(),
    reusedFromReportDate: contractIsoDateSchema.nullable(),
    usableForEvidence: z.boolean(),
    acceptedForVerification: z.boolean(),
    requiresHumanReview: z.literal(true),
    checks: z.array(photoEvidenceCheckSchema).length(10),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((photo, context) => {
    const codes = photo.checks.map((check) => check.code);
    if (
      !hasUniqueContractIds(photo.checks.map((check) => check.checkId)) ||
      !hasUniqueContractIds(codes) ||
      photoEvidenceCheckCodeSchema.options.some((code) => !codes.includes(code))
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo result requires one check for each PE-01..PE-10 code",
        path: ["checks"],
      });
    }
    const hasUnresolvedCheck = photo.checks.some((check) =>
      ["FAIL", "WARNING"].includes(check.result),
    );
    if (photo.acceptedForVerification === hasUnresolvedCheck) {
      context.addIssue({
        code: "custom",
        message: "Photo acceptance conflicts with its check results",
        path: ["acceptedForVerification"],
      });
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
    const intrinsicFailure = photo.checks.some(
      (check) => intrinsicCodes.has(check.code) && check.result === "FAIL",
    );
    if (photo.usableForEvidence === intrinsicFailure) {
      context.addIssue({
        code: "custom",
        message: "Photo usability conflicts with intrinsic check failures",
        path: ["usableForEvidence"],
      });
    }
    if (photo.exactDuplicateOfPhotoId !== null && photo.nearDuplicateOfPhotoId !== null) {
      context.addIssue({
        code: "custom",
        message: "Exact and near duplicate lineage are mutually exclusive",
        path: ["nearDuplicateOfPhotoId"],
      });
    }
    if ((photo.nearDuplicateOfPhotoId === null) !== (photo.nearDuplicateHammingDistance === null)) {
      context.addIssue({
        code: "custom",
        message: "Near-duplicate lineage requires a Hamming distance",
        path: ["nearDuplicateHammingDistance"],
      });
    }
    const duplicateCheck = photo.checks.find((check) => check.code === "PE-03");
    if (
      (photo.exactDuplicateOfPhotoId !== null && duplicateCheck?.result !== "FAIL") ||
      (photo.nearDuplicateOfPhotoId !== null && duplicateCheck?.result !== "WARNING")
    ) {
      context.addIssue({
        code: "custom",
        message: "Duplicate lineage conflicts with PE-03",
        path: ["exactDuplicateOfPhotoId"],
      });
    }
  });

export const photoEvidenceCoverageV1Schema = z
  .object({
    requiredCount: z.number().int().nonnegative().max(5),
    submittedCount: z.number().int().nonnegative().max(5),
    usableCount: z.number().int().nonnegative().max(5),
    creditedCount: z.number().int().nonnegative().max(5),
    coveragePercent: z.number().finite().min(0).max(100),
    requiredAngles: z.array(photoEvidenceAngleSchema).max(20),
    observedAngles: z.array(photoEvidenceAngleSchema).max(100),
    missingAngles: z.array(photoEvidenceAngleSchema).max(20),
    requiredAnglesComplete: z.boolean(),
    referenceMarkerRequired: z.boolean(),
    referenceMarkerPresent: z.boolean().nullable(),
    evidenceComplete: z.boolean(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (
      coverage.usableCount > coverage.submittedCount ||
      coverage.creditedCount > coverage.usableCount ||
      coverage.creditedCount > coverage.requiredCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo evidence counts are inconsistent",
        path: ["creditedCount"],
      });
    }
    const expectedCredited = Math.min(coverage.usableCount, coverage.requiredCount);
    const expectedPercentage =
      coverage.requiredCount === 0 ? 100 : (expectedCredited / coverage.requiredCount) * 100;
    if (
      coverage.creditedCount !== expectedCredited ||
      Math.abs(coverage.coveragePercent - expectedPercentage) > 0.000001
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo evidence coverage conflicts with its counts",
        path: ["coveragePercent"],
      });
    }
    if (
      !hasUniqueContractIds(coverage.requiredAngles) ||
      !hasUniqueContractIds(coverage.observedAngles) ||
      !hasUniqueContractIds(coverage.missingAngles)
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo evidence angle sets must be unique",
        path: ["requiredAngles"],
      });
    }
    const expectedMissing = coverage.requiredAngles
      .filter((angle) => !coverage.observedAngles.includes(angle))
      .sort();
    if (
      JSON.stringify([...coverage.missingAngles].sort()) !== JSON.stringify(expectedMissing) ||
      coverage.requiredAnglesComplete !== (expectedMissing.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo evidence angle coverage is inconsistent",
        path: ["missingAngles"],
      });
    }
    if (
      (!coverage.referenceMarkerRequired && coverage.referenceMarkerPresent !== null) ||
      (coverage.referenceMarkerRequired && coverage.referenceMarkerPresent === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Reference-marker result conflicts with policy",
        path: ["referenceMarkerPresent"],
      });
    }
    const expectedComplete =
      coverage.coveragePercent === 100 &&
      coverage.requiredAnglesComplete &&
      (!coverage.referenceMarkerRequired || coverage.referenceMarkerPresent === true);
    if (coverage.evidenceComplete !== expectedComplete) {
      context.addIssue({
        code: "custom",
        message: "Evidence-complete flag conflicts with coverage",
        path: ["evidenceComplete"],
      });
    }
  });

export const photoEvidenceEvaluationV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    evaluationType: z.literal("PHOTO_EVIDENCE_EVALUATION"),
    evaluationId: contractIdentifierSchema,
    requestId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    workItemId: contractIdentifierSchema,
    policyId: contractIdentifierSchema,
    policyVersionId: contractIdentifierSchema,
    photoResults: z.array(photoEvidencePhotoResultV1Schema).max(5),
    coverage: photoEvidenceCoverageV1Schema,
    automaticEvidenceAcceptanceAllowed: z.boolean(),
    requiresHumanReview: z.literal(true),
    eligibleForProgressVerification: z.literal(true),
    exactQuantityDerived: z.literal(false),
    deterministic: z.literal(true),
    generatedAt: contractIsoDateTimeSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((evaluation, context) => {
    if (
      !hasUniqueContractIds(evaluation.photoResults.map((photo) => photo.photoId)) ||
      !hasUniqueContractIds(evaluation.photoResults.map((photo) => photo.artifactId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo evaluation result identifiers must be unique",
        path: ["photoResults"],
      });
    }
    if (
      evaluation.coverage.submittedCount !== evaluation.photoResults.length ||
      evaluation.coverage.usableCount !==
        evaluation.photoResults.filter((photo) => photo.usableForEvidence).length
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo evaluation coverage does not match photo results",
        path: ["coverage"],
      });
    }
    const allSources = [
      ...evaluation.sourceRefs,
      ...evaluation.coverage.sourceRefs,
      ...evaluation.photoResults.flatMap((photo) => [
        ...photo.sourceRefs,
        ...photo.checks.flatMap((check) => check.sourceRefs),
      ]),
    ];
    if (
      !allSources.every((source) =>
        sourceReferenceMatchesScope(source, evaluation.tenantId, evaluation.projectId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo evaluation source is outside aggregate scope",
        path: ["sourceRefs"],
      });
    }
    const accepted = evaluation.photoResults.every((photo) => photo.acceptedForVerification);
    const expectedAutomaticApproval = evaluation.coverage.evidenceComplete && accepted;
    if (evaluation.automaticEvidenceAcceptanceAllowed !== expectedAutomaticApproval) {
      context.addIssue({
        code: "custom",
        message: "Automatic evidence-acceptance flag conflicts with evidence checks",
        path: ["automaticEvidenceAcceptanceAllowed"],
      });
    }
  });

export type PhotoEvidenceByteInspectionV1 = z.infer<typeof photoEvidenceByteInspectionV1Schema>;
export type PhotoEvidenceSubmissionV1 = z.infer<typeof photoEvidenceSubmissionV1Schema>;
export type PhotoEvidenceHistoryEntryV1 = z.infer<typeof photoEvidenceHistoryEntryV1Schema>;
export type PhotoEvidencePolicyV1 = z.infer<typeof photoEvidencePolicyV1Schema>;
export type PhotoEvidenceEvaluationRequestV1 = z.infer<
  typeof photoEvidenceEvaluationRequestV1Schema
>;
export type PhotoEvidenceEvaluationV1 = z.infer<typeof photoEvidenceEvaluationV1Schema>;
