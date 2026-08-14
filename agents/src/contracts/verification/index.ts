import { z } from "zod";
import {
  contractDecimalSchema,
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
  contractValidationIssueSchema,
} from "../common.js";
import {
  buildWatchCanonicalUnitSchema,
  buildWatchDraftStatusSchema,
  buildWatchImmutableVersionMetadataSchema,
  buildWatchReviewDecisionSchema,
  buildWatchSignedPercentageDecimalSchema,
  buildWatchSourceBackedQuantitySchema,
  buildWatchSourceReferenceSchema,
  hasUniqueContractIds,
  sourceReferenceMatchesScope,
} from "../buildwatch-v2-common.js";

export const photoEvidenceCheckCodeSchema = z.enum([
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
]);

export const photoEvidenceCheckSchema = z
  .object({
    checkId: contractIdentifierSchema,
    photoArtifactId: contractIdentifierSchema,
    code: photoEvidenceCheckCodeSchema,
    result: z.enum(["PASS", "FAIL", "WARNING", "NOT_APPLICABLE"]),
    score: z.number().finite().min(0).max(1).nullable(),
    message: z.string().trim().min(1).max(1_000),
    deterministic: z.boolean(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const progressCompletionStatusSchema = z.enum([
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "NOT_COMPLETED",
  "NOT_STARTED",
  "BLOCKED",
  "UNVERIFIABLE",
]);

export const progressMeasurementModeSchema = z.enum([
  "QUANTITY",
  "CHECKLIST",
  "WEIGHTED_MILESTONE",
]);

export const progressCompletionRateDecimalSchema = contractDecimalSchema.refine((value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100;
}, "Completion rate must be between zero and 100");

export const progressEngineerDecisionActionSchema = z.enum([
  "ACCEPT_DECLARED",
  "OVERRIDE_QUANTITY",
  "REJECT",
  "REQUEST_CLARIFICATION",
]);

export const progressEngineerDecisionSchema = z
  .object({
    decisionId: contractIdentifierSchema,
    dailyPlanItemId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    action: progressEngineerDecisionActionSchema,
    reviewerId: contractIdentifierSchema,
    reviewerRole: z.literal("SITE_ENGINEER"),
    decidedAt: contractIsoDateTimeSchema,
    reason: z.string().trim().min(1).max(2_000).nullable(),
    overrideQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((decision, context) => {
    if (
      ["OVERRIDE_QUANTITY", "REJECT", "REQUEST_CLARIFICATION"].includes(decision.action) &&
      decision.reason === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Engineer override, rejection, and clarification require a reason",
        path: ["reason"],
      });
    }
    if ((decision.action === "OVERRIDE_QUANTITY") !== (decision.overrideQuantity !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only an engineer quantity override may carry an override quantity",
        path: ["overrideQuantity"],
      });
    }
    if (!decision.sourceRefs.some((source) => source.sourceType === "HUMAN_DECISION")) {
      context.addIssue({
        code: "custom",
        message: "Engineer decisions require human-decision lineage",
        path: ["sourceRefs"],
      });
    }
  });

export const progressEvidenceCoverageSchema = z
  .object({
    requiredCount: z.number().int().nonnegative().max(1_000),
    acceptedCount: z.number().int().nonnegative().max(1_000),
    coveragePercent: z.number().finite().min(0).max(100),
    requiredAnglesComplete: z.boolean(),
    referenceMarkerPresent: z.boolean().nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (coverage.acceptedCount > coverage.requiredCount) {
      context.addIssue({
        code: "custom",
        message: "Accepted evidence count cannot exceed required count",
        path: ["acceptedCount"],
      });
    }

    const expected =
      coverage.requiredCount === 0 ? 100 : (coverage.acceptedCount / coverage.requiredCount) * 100;
    if (Math.abs(expected - coverage.coveragePercent) > 0.01) {
      context.addIssue({
        code: "custom",
        message: "Evidence coverage percentage conflicts with its counts",
        path: ["coveragePercent"],
      });
    }
  });

export const progressVerificationIssueSchema = z
  .object({
    issueId: contractIdentifierSchema,
    code: z.string().trim().min(1).max(100),
    severity: z.enum(["ERROR", "WARNING", "INFO"]),
    message: z.string().trim().min(1).max(2_000),
    clarificationQuestion: z.string().trim().min(1).max(2_000).nullable(),
    blocksApproval: z.boolean(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((issue, context) => {
    if (issue.blocksApproval && issue.clarificationQuestion === null) {
      context.addIssue({
        code: "custom",
        message: "Blocking verification issues require a clarification question",
        path: ["clarificationQuestion"],
      });
    }
  });

export const progressVarianceSchema = z
  .object({
    quantity: buildWatchSourceBackedQuantitySchema,
    percentage: buildWatchSignedPercentageDecimalSchema,
    percentageSourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const progressVerificationItemSchema = z
  .object({
    verificationItemId: contractIdentifierSchema,
    dailyPlanItemId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    dailyProgressEntryId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    unit: buildWatchCanonicalUnitSchema,
    measurementMode: progressMeasurementModeSchema,
    plannedQuantity: buildWatchSourceBackedQuantitySchema,
    declaredQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    verifiedQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    cumulativeQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    completionRatePercent: progressCompletionRateDecimalSchema.nullable(),
    workStarted: z.boolean(),
    crewOrEquipmentAssigned: z.boolean(),
    approvedBlockerId: contractIdentifierSchema.nullable(),
    mandatoryChecklistStatus: z.enum(["PASSED", "FAILED", "NOT_REQUIRED", "MISSING"]),
    engineerDecision: progressEngineerDecisionSchema.nullable(),
    evidenceCoverage: progressEvidenceCoverageSchema,
    photoChecks: z.array(photoEvidenceCheckSchema).max(1_000),
    completionStatus: progressCompletionStatusSchema,
    variance: progressVarianceSchema.nullable(),
    confidence: z.number().finite().min(0).max(1),
    issues: z.array(progressVerificationIssueSchema).max(1_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((item, context) => {
    const quantities = [
      item.plannedQuantity,
      ...(item.declaredQuantity === null ? [] : [item.declaredQuantity]),
      ...(item.verifiedQuantity === null ? [] : [item.verifiedQuantity]),
      ...(item.cumulativeQuantity === null ? [] : [item.cumulativeQuantity]),
      ...(item.variance === null ? [] : [item.variance.quantity]),
    ];
    if (quantities.some((quantity) => quantity.unit !== item.unit)) {
      context.addIssue({
        code: "custom",
        message: "Verification quantities must use the work-item unit",
        path: ["unit"],
      });
    }

    if (item.measurementMode !== "QUANTITY" && item.unit !== "percent") {
      context.addIssue({
        code: "custom",
        message: "Checklist and weighted-milestone verification use percent units",
        path: ["measurementMode"],
      });
    }

    if (
      item.engineerDecision?.overrideQuantity !== null &&
      item.engineerDecision?.overrideQuantity.unit !== item.unit
    ) {
      context.addIssue({
        code: "custom",
        message: "Engineer override quantity must use the work-item unit",
        path: ["engineerDecision", "overrideQuantity", "unit"],
      });
    }

    if (
      item.engineerDecision !== null &&
      (item.engineerDecision.dailyPlanItemId !== item.dailyPlanItemId ||
        item.engineerDecision.workItemId !== item.workItemId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Engineer decision must reference its verification item",
        path: ["engineerDecision"],
      });
    }

    if (
      item.verifiedQuantity !== null &&
      item.verifiedQuantity.sourceRefs.every((source) => source.sourceType === "PHOTO_EVIDENCE")
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo evidence cannot be the only source of a verified quantity",
        path: ["verifiedQuantity", "sourceRefs"],
      });
    }

    const verifiedValue =
      item.verifiedQuantity === null ? null : Number(item.verifiedQuantity.value);
    const plannedValue = Number(item.plannedQuantity.value);
    const hasBlockingIssue = item.issues.some((issue) => issue.blocksApproval);
    const evidenceComplete =
      item.evidenceCoverage.coveragePercent === 100 && item.evidenceCoverage.requiredAnglesComplete;

    const expectedCompletionRate =
      verifiedValue === null || plannedValue <= 0
        ? null
        : Math.min(100, Math.max(0, (verifiedValue / plannedValue) * 100));
    if (
      (expectedCompletionRate === null) !== (item.completionRatePercent === null) ||
      (expectedCompletionRate !== null &&
        item.completionRatePercent !== null &&
        Math.abs(Number(item.completionRatePercent) - expectedCompletionRate) > 0.0001)
    ) {
      context.addIssue({
        code: "custom",
        message: "Completion rate conflicts with verified and planned quantities",
        path: ["completionRatePercent"],
      });
    }

    const acceptedEngineerDecision =
      item.engineerDecision !== null &&
      ["ACCEPT_DECLARED", "OVERRIDE_QUANTITY"].includes(item.engineerDecision.action);
    if (
      ["COMPLETED", "PARTIALLY_COMPLETED"].includes(item.completionStatus) &&
      !acceptedEngineerDecision
    ) {
      context.addIssue({
        code: "custom",
        message: "Positive verified progress requires an engineer acceptance decision",
        path: ["engineerDecision"],
      });
    }

    if (
      item.engineerDecision?.action === "OVERRIDE_QUANTITY" &&
      item.completionStatus !== "UNVERIFIABLE" &&
      (verifiedValue === null ||
        Number(item.engineerDecision.overrideQuantity!.value) !== verifiedValue)
    ) {
      context.addIssue({
        code: "custom",
        message: "Verified quantity must match the engineer override",
        path: ["verifiedQuantity"],
      });
    }

    if (
      item.engineerDecision !== null &&
      ["REJECT", "REQUEST_CLARIFICATION"].includes(item.engineerDecision.action) &&
      item.verifiedQuantity !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Rejected or unresolved work cannot carry a verified quantity",
        path: ["verifiedQuantity"],
      });
    }

    if (
      item.completionStatus === "COMPLETED" &&
      (verifiedValue === null ||
        verifiedValue < plannedValue ||
        !evidenceComplete ||
        !["PASSED", "NOT_REQUIRED"].includes(item.mandatoryChecklistStatus) ||
        hasBlockingIssue)
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed work requires verified target, complete evidence, and checklist",
        path: ["completionStatus"],
      });
    }

    if (
      item.completionStatus === "PARTIALLY_COMPLETED" &&
      (verifiedValue === null || verifiedValue <= 0 || verifiedValue >= plannedValue)
    ) {
      context.addIssue({
        code: "custom",
        message: "Partial completion requires a verified quantity between zero and target",
        path: ["completionStatus"],
      });
    }

    if (item.completionStatus === "BLOCKED" && item.approvedBlockerId === null) {
      context.addIssue({
        code: "custom",
        message: "Blocked completion requires an approved blocker",
        path: ["approvedBlockerId"],
      });
    }

    if (
      item.completionStatus === "UNVERIFIABLE" &&
      (item.verifiedQuantity !== null || item.issues.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Unverifiable work requires no verified quantity and at least one issue",
        path: ["completionStatus"],
      });
    }

    if (item.completionStatus === "NOT_STARTED" && (item.workStarted || verifiedValue !== 0)) {
      context.addIssue({
        code: "custom",
        message: "Not-started work cannot have a started flag or nonzero quantity",
        path: ["completionStatus"],
      });
    }

    if (
      item.completionStatus === "NOT_COMPLETED" &&
      (!item.workStarted || !item.crewOrEquipmentAssigned || verifiedValue !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Not-completed work requires started work, assigned resource, and zero quantity",
        path: ["completionStatus"],
      });
    }

    if (
      !hasUniqueContractIds(item.photoChecks.map((check) => check.checkId)) ||
      !hasUniqueContractIds(item.issues.map((issue) => issue.issueId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Photo-check and verification-issue identifiers must be unique",
        path: ["photoChecks"],
      });
    }
  });

export const progressVerificationContentSchema = z
  .object({
    dailyWorkPlanVersionId: contractIdentifierSchema,
    dailyReportId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    items: z.array(progressVerificationItemSchema).min(1).max(100_000),
  })
  .strict()
  .superRefine((content, context) => {
    if (
      !hasUniqueContractIds(content.items.map((item) => item.verificationItemId)) ||
      !hasUniqueContractIds(content.items.map((item) => item.dailyPlanItemId)) ||
      !hasUniqueContractIds(content.items.map((item) => item.dailyProgressEntryId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Verification item, plan-item, and progress-entry identifiers must be unique",
        path: ["items"],
      });
    }

    content.items.forEach((item, index) => {
      if (item.reportDate !== content.reportDate) {
        context.addIssue({
          code: "custom",
          message: "Verification item date must match its aggregate date",
          path: ["items", index, "reportDate"],
        });
      }
    });
  });

function verificationSources(content: z.infer<typeof progressVerificationContentSchema>) {
  return content.items.flatMap((item) => [
    ...item.plannedQuantity.sourceRefs,
    ...(item.declaredQuantity?.sourceRefs ?? []),
    ...(item.verifiedQuantity?.sourceRefs ?? []),
    ...(item.cumulativeQuantity?.sourceRefs ?? []),
    ...(item.engineerDecision?.overrideQuantity?.sourceRefs ?? []),
    ...(item.engineerDecision?.sourceRefs ?? []),
    ...item.evidenceCoverage.sourceRefs,
    ...item.photoChecks.flatMap((check) => check.sourceRefs),
    ...(item.variance?.quantity.sourceRefs ?? []),
    ...(item.variance?.percentageSourceRefs ?? []),
    ...item.issues.flatMap((issue) => issue.sourceRefs),
    ...item.sourceRefs,
  ]);
}

function addVerificationScopeIssues(
  content: z.infer<typeof progressVerificationContentSchema>,
  tenantId: string,
  projectId: string,
  context: z.RefinementCtx,
) {
  verificationSources(content).forEach((source, index) => {
    if (!sourceReferenceMatchesScope(source, tenantId, projectId)) {
      context.addIssue({
        code: "custom",
        message: "Progress-verification source is outside the aggregate scope",
        path: ["content", "sources", index],
      });
    }
  });
}

export const progressVerificationDraftV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    draftType: z.literal("PROGRESS_VERIFICATION"),
    draftId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    status: buildWatchDraftStatusSchema,
    content: progressVerificationContentSchema,
    validationIssues: z.array(contractValidationIssueSchema).max(1_000),
    requiresHumanReview: z.literal(true),
    createdAt: contractIsoDateTimeSchema,
    createdBy: z.literal("A5"),
  })
  .strict()
  .superRefine((draft, context) => {
    addVerificationScopeIssues(draft.content, draft.tenantId, draft.projectId, context);

    const hasBlockingIssue =
      draft.validationIssues.some((issue) => issue.severity === "ERROR") ||
      draft.content.items.some((item) => item.issues.some((issue) => issue.blocksApproval));
    if (hasBlockingIssue && draft.status === "REVIEW_REQUIRED") {
      context.addIssue({
        code: "custom",
        message: "Verification with blocking issues cannot be submitted for approval",
        path: ["status"],
      });
    }
  });

export const approvedProgressVerificationVersionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    versionType: z.literal("APPROVED_PROGRESS_VERIFICATION"),
    progressVerificationVersionId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    status: z.literal("APPROVED"),
    content: progressVerificationContentSchema,
    metadata: buildWatchImmutableVersionMetadataSchema,
  })
  .strict()
  .superRefine((version, context) => {
    addVerificationScopeIssues(version.content, version.tenantId, version.projectId, context);

    if (version.content.items.some((item) => item.issues.some((issue) => issue.blocksApproval))) {
      context.addIssue({
        code: "custom",
        message: "Approved verification cannot contain blocking issues",
        path: ["content", "items"],
      });
    }
  });

export const approvedProgressVerificationCommandV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    commandType: z.literal("APPROVE_PROGRESS_VERIFICATION"),
    commandId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    draftId: contractIdentifierSchema,
    approvedVersion: approvedProgressVerificationVersionV1Schema,
    decision: buildWatchReviewDecisionSchema,
  })
  .strict()
  .superRefine((command, context) => {
    if (
      command.approvedVersion.tenantId !== command.tenantId ||
      command.approvedVersion.projectId !== command.projectId
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved verification scope must match command scope",
        path: ["approvedVersion"],
      });
    }

    if (
      command.decision.action !== "APPROVE" ||
      command.decision.reviewerRole !== "PROJECT_MANAGER"
    ) {
      context.addIssue({
        code: "custom",
        message: "Progress verification approval requires a project-manager decision",
        path: ["decision"],
      });
    }
  });

export type ProgressVerificationDraftV1 = z.infer<typeof progressVerificationDraftV1Schema>;
export type ProgressEngineerDecision = z.infer<typeof progressEngineerDecisionSchema>;
export type ApprovedProgressVerificationVersionV1 = z.infer<
  typeof approvedProgressVerificationVersionV1Schema
>;
export type ApprovedProgressVerificationCommandV1 = z.infer<
  typeof approvedProgressVerificationCommandV1Schema
>;
