import { z } from "zod";
import {
  approvedDailyWorkPlanVersionV1Schema,
  approvedProgressVerificationCommandV1Schema,
  buildWatchReviewDecisionSchema,
  buildWatchSourceBackedQuantitySchema,
  buildWatchSourceReferenceSchema,
  contractDecimalSchema,
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
  photoEvidenceEvaluationV1Schema,
  progressCompletionRateDecimalSchema,
  progressCompletionStatusSchema,
  progressEngineerDecisionSchema,
  progressMeasurementModeSchema,
  progressVerificationContentSchema,
  progressVerificationDraftV1Schema,
  sourceReferenceMatchesScope,
} from "../contracts/index.js";
import { approvedA1ActualBundleV1Schema } from "./a1-approved-actual.js";

const percentageDecimalSchema = contractDecimalSchema.refine((value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100;
}, "Percentage must be between zero and 100");

const positiveDecimalSchema = contractDecimalSchema.refine((value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}, "Quantity must be positive");

export const progressVerificationPolicyV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    policyType: z.literal("PROGRESS_VERIFICATION_POLICY"),
    policyId: contractIdentifierSchema,
    policyVersionId: contractIdentifierSchema,
    version: z.number().int().positive(),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    effectiveFrom: contractIsoDateSchema,
    approvedBy: contractIdentifierSchema,
    approvedAt: contractIsoDateTimeSchema,
    materialVarianceTolerancePercent: percentageDecimalSchema,
    requireAttendanceForCrew: z.boolean(),
    requireUsageForEquipment: z.boolean(),
    requireMaterialConsumptionEvidence: z.boolean(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      !policy.sourceRefs.every((source) =>
        sourceReferenceMatchesScope(source, policy.tenantId, policy.projectId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Progress-verification policy source is outside its scope",
        path: ["sourceRefs"],
      });
    }
  });

export const progressMeasurementConfigurationV1Schema = z
  .object({
    configurationId: contractIdentifierSchema,
    dailyPlanItemId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    mode: progressMeasurementModeSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const progressChecklistInputV1Schema = z
  .object({
    checklistId: contractIdentifierSchema,
    dailyPlanItemId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    status: z.enum(["PASSED", "FAILED", "NOT_REQUIRED", "MISSING"]),
    completionPercent: percentageDecimalSchema.nullable(),
    approvedBy: contractIdentifierSchema.nullable(),
    approvedAt: contractIsoDateTimeSchema.nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((checklist, context) => {
    const decided = ["PASSED", "FAILED"].includes(checklist.status);
    if (decided !== (checklist.approvedBy !== null && checklist.approvedAt !== null)) {
      context.addIssue({
        code: "custom",
        message: "Passed or failed checklists require an approval identity and time",
        path: ["approvedBy"],
      });
    }
    if (decided && !checklist.sourceRefs.some((source) => source.sourceType === "HUMAN_DECISION")) {
      context.addIssue({
        code: "custom",
        message: "Approved checklist status requires human-decision lineage",
        path: ["sourceRefs"],
      });
    }
    if (checklist.status !== "PASSED" && checklist.completionPercent !== null) {
      context.addIssue({
        code: "custom",
        message: "Only a passed checklist may carry milestone completion",
        path: ["completionPercent"],
      });
    }
  });

export const progressVerificationRequestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestType: z.literal("A5_PROGRESS_VERIFICATION"),
    requestId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    approvedPlan: approvedDailyWorkPlanVersionV1Schema,
    approvedActual: approvedA1ActualBundleV1Schema,
    photoEvaluations: z.array(photoEvidenceEvaluationV1Schema).max(100_000),
    measurementConfigurations: z.array(progressMeasurementConfigurationV1Schema).max(100_000),
    checklists: z.array(progressChecklistInputV1Schema).max(100_000),
    engineerDecisions: z.array(progressEngineerDecisionSchema).max(100_000),
    policy: progressVerificationPolicyV1Schema,
    generatedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const scopeMatches =
      request.approvedPlan.tenantId === request.tenantId &&
      request.approvedPlan.projectId === request.projectId &&
      request.approvedActual.tenantId === request.tenantId &&
      request.approvedActual.projectId === request.projectId &&
      request.policy.tenantId === request.tenantId &&
      request.policy.projectId === request.projectId;
    if (!scopeMatches) {
      context.addIssue({
        code: "custom",
        message: "Progress-verification inputs must share one tenant/project scope",
        path: ["tenantId"],
      });
    }
    if (
      request.approvedPlan.content.planDate !== request.reportDate ||
      request.approvedActual.reportDate !== request.reportDate
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved plan and actual dates must match the verification date",
        path: ["reportDate"],
      });
    }
    if (
      request.policy.effectiveFrom > request.reportDate ||
      request.policy.approvedAt > request.generatedAt ||
      request.approvedPlan.metadata.approvedAt > request.generatedAt ||
      request.approvedActual.reviewedAt > request.generatedAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Progress-verification inputs cannot come from the future",
        path: ["generatedAt"],
      });
    }

    const planItems = request.approvedPlan.content.items;
    const planItemIds = planItems.map((item) => item.planItemId);
    const workItemIds = planItems.map((item) => item.workItemId);
    const expectedPlanIds = [...planItemIds].sort();
    const expectedWorkIds = [...workItemIds].sort();
    const exactPlanCoverage = (values: readonly string[]) =>
      values.length === expectedPlanIds.length &&
      [...values].sort().every((value, index) => value === expectedPlanIds[index]);
    const exactWorkCoverage = (values: readonly string[]) =>
      values.length === expectedWorkIds.length &&
      [...values].sort().every((value, index) => value === expectedWorkIds[index]);

    if (
      !exactPlanCoverage(request.measurementConfigurations.map((item) => item.dailyPlanItemId)) ||
      !exactPlanCoverage(request.checklists.map((item) => item.dailyPlanItemId)) ||
      !exactPlanCoverage(request.engineerDecisions.map((item) => item.dailyPlanItemId)) ||
      !exactWorkCoverage(request.photoEvaluations.map((item) => item.workItemId))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Every approved plan item requires one measurement, checklist, photo evaluation, and engineer decision",
        path: ["measurementConfigurations"],
      });
    }

    const planById = new Map(planItems.map((item) => [item.planItemId, item]));
    for (const input of [
      ...request.measurementConfigurations,
      ...request.checklists,
      ...request.engineerDecisions,
    ]) {
      const planItem = planById.get(input.dailyPlanItemId);
      if (planItem === undefined || planItem.workItemId !== input.workItemId) {
        context.addIssue({
          code: "custom",
          message: "Verification input does not match its approved plan item",
          path: ["measurementConfigurations"],
        });
      }
    }

    for (const configuration of request.measurementConfigurations) {
      const planItem = planById.get(configuration.dailyPlanItemId);
      const checklist = request.checklists.find(
        (candidate) => candidate.dailyPlanItemId === configuration.dailyPlanItemId,
      );
      if (configuration.mode !== "QUANTITY" && planItem?.unit !== "percent") {
        context.addIssue({
          code: "custom",
          message: "Checklist and weighted milestones require a percent plan item",
          path: ["measurementConfigurations", "mode"],
        });
      }
      if (configuration.mode === "WEIGHTED_MILESTONE" && checklist?.completionPercent === null) {
        context.addIssue({
          code: "custom",
          message: "Weighted milestones require approved completion percent",
          path: ["checklists", "completionPercent"],
        });
      }
      if (configuration.mode !== "WEIGHTED_MILESTONE" && checklist?.completionPercent !== null) {
        context.addIssue({
          code: "custom",
          message: "Only weighted milestones accept checklist completion percent",
          path: ["checklists", "completionPercent"],
        });
      }
    }

    const evidenceRuleByWorkItem = new Map(
      planItems.map((item) => [item.workItemId, item.evidenceRuleId]),
    );
    for (const evaluation of request.photoEvaluations) {
      if (
        evaluation.tenantId !== request.tenantId ||
        evaluation.projectId !== request.projectId ||
        evaluation.reportDate !== request.reportDate ||
        evidenceRuleByWorkItem.get(evaluation.workItemId) !== evaluation.policyId ||
        !evaluation.eligibleForProgressVerification ||
        evaluation.generatedAt > request.generatedAt
      ) {
        context.addIssue({
          code: "custom",
          message: "Photo evaluation is not eligible for this approved plan item",
          path: ["photoEvaluations"],
        });
      }
    }

    const additionalSources = [
      ...request.policy.sourceRefs,
      ...request.measurementConfigurations.flatMap((item) => item.sourceRefs),
      ...request.checklists.flatMap((item) => item.sourceRefs),
      ...request.engineerDecisions.flatMap((item) => [
        ...item.sourceRefs,
        ...(item.overrideQuantity?.sourceRefs ?? []),
      ]),
    ];
    if (
      additionalSources.some(
        (source) =>
          !sourceReferenceMatchesScope(source, request.tenantId, request.projectId) ||
          (source.asOf !== null && source.asOf > request.generatedAt),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Verification source is outside scope or from the future",
        path: ["policy", "sourceRefs"],
      });
    }
  });

export const progressVerificationDecisionTraceV1Schema = z
  .object({
    verificationItemId: contractIdentifierSchema,
    dailyPlanItemId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    measurementMode: progressMeasurementModeSchema,
    completionStatus: progressCompletionStatusSchema,
    completionRatePercent: progressCompletionRateDecimalSchema.nullable(),
    ruleCodes: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
    automaticApprovalAllowed: z.literal(false),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const progressVerificationResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    resultType: z.literal("A5_PROGRESS_VERIFICATION_RESULT"),
    requestId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    draft: progressVerificationDraftV1Schema,
    decisions: z.array(progressVerificationDecisionTraceV1Schema).min(1).max(100_000),
    deterministic: z.literal(true),
    llmRequired: z.literal(false),
    generatedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const draftItems = result.draft.content.items;
    if (
      result.draft.tenantId !== result.tenantId ||
      result.draft.projectId !== result.projectId ||
      result.draft.content.reportDate !== result.reportDate ||
      result.decisions.length !== draftItems.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Verification result scope or decision coverage is inconsistent",
        path: ["decisions"],
      });
    }
    for (const decision of result.decisions) {
      const item = draftItems.find(
        (candidate) => candidate.verificationItemId === decision.verificationItemId,
      );
      if (
        item === undefined ||
        item.dailyPlanItemId !== decision.dailyPlanItemId ||
        item.workItemId !== decision.workItemId ||
        item.measurementMode !== decision.measurementMode ||
        item.completionStatus !== decision.completionStatus ||
        item.completionRatePercent !== decision.completionRatePercent
      ) {
        context.addIssue({
          code: "custom",
          message: "Decision trace conflicts with its verification item",
          path: ["decisions"],
        });
      }
    }
  });

export const progressVerificationApprovalRequestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestType: z.literal("APPROVE_PROGRESS_VERIFICATION_DRAFT"),
    commandId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    progressVerificationVersionId: contractIdentifierSchema,
    version: z.number().int().positive(),
    supersedesVersionId: contractIdentifierSchema.nullable(),
    draft: progressVerificationDraftV1Schema,
    approvedContent: progressVerificationContentSchema,
    decision: buildWatchReviewDecisionSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.draft.status !== "REVIEW_REQUIRED" ||
      request.decision.action !== "APPROVE" ||
      request.decision.reviewerRole !== "PROJECT_MANAGER"
    ) {
      context.addIssue({
        code: "custom",
        message: "Only a project manager may approve a review-ready verification",
        path: ["decision"],
      });
    }
    if (request.decision.decidedAt < request.draft.createdAt) {
      context.addIssue({
        code: "custom",
        message: "Approval decision cannot predate the draft",
        path: ["decision", "decidedAt"],
      });
    }
    if (request.decision.correctedFieldPaths.length > 0 && request.decision.reason === null) {
      context.addIssue({
        code: "custom",
        message: "Human corrections require an explicit override reason",
        path: ["decision", "reason"],
      });
    }
  });

const appliedProgressHistoryRecordV1Schema = z
  .object({
    progressHistoryId: contractIdentifierSchema,
    progressVerificationVersionId: contractIdentifierSchema,
    dailyReportId: contractIdentifierSchema,
    dailyPlanItemId: contractIdentifierSchema,
    dailyProgressEntryId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    completionStatus: progressCompletionStatusSchema,
    verifiedQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    cumulativeQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    completionRatePercent: progressCompletionRateDecimalSchema.nullable(),
    forecastEligible: z.boolean(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

const appliedDailyVarianceRecordV1Schema = z
  .object({
    dailyVarianceId: contractIdentifierSchema,
    progressVerificationVersionId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    plannedQuantity: buildWatchSourceBackedQuantitySchema,
    verifiedQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    variance: z
      .object({
        quantity: buildWatchSourceBackedQuantitySchema,
        percentage: contractDecimalSchema,
        percentageSourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
      })
      .strict()
      .nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

const appliedProductivitySampleV1Schema = z
  .object({
    productivitySampleId: contractIdentifierSchema,
    progressVerificationVersionId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    quantity: buildWatchSourceBackedQuantitySchema.nullable(),
    laborHours: positiveDecimalSchema.nullable(),
    included: z.boolean(),
    exclusionReason: z.enum(["UNVERIFIABLE", "NO_VERIFIED_QUANTITY", "ZERO_QUANTITY"]).nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((sample, context) => {
    if (sample.included === (sample.exclusionReason !== null)) {
      context.addIssue({
        code: "custom",
        message: "Productivity inclusion and exclusion reason conflict",
        path: ["included"],
      });
    }
  });

const appliedMaterialLedgerEntryV1Schema = z
  .object({
    materialLedgerEntryId: contractIdentifierSchema,
    progressVerificationVersionId: contractIdentifierSchema,
    sourceMaterialInputId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema.nullable(),
    materialId: contractIdentifierSchema,
    movementType: z.literal("CONSUMED"),
    quantity: buildWatchSourceBackedQuantitySchema,
    occurredAt: contractIsoDateTimeSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

const appliedForecastInputV1Schema = z
  .object({
    forecastInputId: contractIdentifierSchema,
    progressVerificationVersionId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    completionStatus: progressCompletionStatusSchema,
    verifiedQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    included: z.boolean(),
    exclusionReason: z.enum(["UNVERIFIABLE", "NO_VERIFIED_QUANTITY"]).nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.included === (input.exclusionReason !== null)) {
      context.addIssue({
        code: "custom",
        message: "Forecast inclusion and exclusion reason conflict",
        path: ["included"],
      });
    }
  });

const progressVerificationApplyAuditV1Schema = z
  .object({
    auditId: contractIdentifierSchema,
    action: z.literal("APPLY_PROGRESS_VERIFICATION"),
    actorId: contractIdentifierSchema,
    appliedAt: contractIsoDateTimeSchema,
    commandHash: z.string().regex(/^[a-f0-9]{64}$/),
    approvedSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    reviewerId: contractIdentifierSchema,
    reviewerRole: z.literal("PROJECT_MANAGER"),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const progressVerificationApplyRequestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestType: z.literal("APPLY_APPROVED_PROGRESS_VERIFICATION"),
    command: approvedProgressVerificationCommandV1Schema,
    approvedActual: approvedA1ActualBundleV1Schema,
    appliedBy: contractIdentifierSchema,
    appliedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const command = request.command;
    if (
      request.approvedActual.tenantId !== command.tenantId ||
      request.approvedActual.projectId !== command.projectId ||
      request.approvedActual.dailyReportId !== command.approvedVersion.content.dailyReportId ||
      request.approvedActual.reportDate !== command.approvedVersion.content.reportDate
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved actual does not match the approved verification command",
        path: ["approvedActual"],
      });
    }
    if (request.appliedAt < command.decision.decidedAt) {
      context.addIssue({
        code: "custom",
        message: "Apply cannot predate the approval decision",
        path: ["appliedAt"],
      });
    }
  });

export const appliedProgressVerificationV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    applyType: z.literal("APPLIED_PROGRESS_VERIFICATION"),
    applyId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    commandId: contractIdentifierSchema,
    commandHash: z.string().regex(/^[a-f0-9]{64}$/),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    progressVerificationVersionId: contractIdentifierSchema,
    dailyReportId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    status: z.literal("APPLIED"),
    transactionBoundary: z.literal("APPROVED_COMMAND_ONLY"),
    progressHistory: z.array(appliedProgressHistoryRecordV1Schema).min(1).max(100_000),
    dailyVariances: z.array(appliedDailyVarianceRecordV1Schema).min(1).max(100_000),
    productivitySamples: z.array(appliedProductivitySampleV1Schema).min(1).max(100_000),
    materialLedgerEntries: z.array(appliedMaterialLedgerEntryV1Schema).max(100_000),
    forecastInputs: z.array(appliedForecastInputV1Schema).min(1).max(100_000),
    audit: progressVerificationApplyAuditV1Schema,
    deterministic: z.literal(true),
    appliedBy: contractIdentifierSchema,
    appliedAt: contractIsoDateTimeSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((result, context) => {
    const itemCount = result.progressHistory.length;
    if (
      result.dailyVariances.length !== itemCount ||
      result.productivitySamples.length !== itemCount ||
      result.forecastInputs.length !== itemCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Applied verification projections must cover every verification item",
        path: ["progressHistory"],
      });
    }
    const identifierGroups = [
      result.progressHistory.map((item) => item.progressHistoryId),
      result.dailyVariances.map((item) => item.dailyVarianceId),
      result.productivitySamples.map((item) => item.productivitySampleId),
      result.materialLedgerEntries.map((item) => item.materialLedgerEntryId),
      result.forecastInputs.map((item) => item.forecastInputId),
    ];
    if (
      identifierGroups.some((ids) => new Set(ids).size !== ids.length) ||
      !result.sourceRefs.every((source) =>
        sourceReferenceMatchesScope(source, result.tenantId, result.projectId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Applied verification identifiers or source scope are invalid",
        path: ["sourceRefs"],
      });
    }
  });

export type ProgressVerificationPolicyV1 = z.infer<typeof progressVerificationPolicyV1Schema>;
export type ProgressVerificationRequestV1 = z.infer<typeof progressVerificationRequestV1Schema>;
export type ProgressVerificationResultV1 = z.infer<typeof progressVerificationResultV1Schema>;
export type ProgressVerificationApprovalRequestV1 = z.infer<
  typeof progressVerificationApprovalRequestV1Schema
>;
export type ProgressVerificationApplyRequestV1 = z.infer<
  typeof progressVerificationApplyRequestV1Schema
>;
export type AppliedProgressVerificationV1 = z.infer<typeof appliedProgressVerificationV1Schema>;
