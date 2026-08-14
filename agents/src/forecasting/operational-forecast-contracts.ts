import { z } from "zod";
import {
  approvedBaselineVersionV1Schema,
  buildWatchCanonicalUnitSchema,
  buildWatchSourceBackedQuantitySchema,
  buildWatchSourceReferenceSchema,
  contractDecimalSchema,
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
  operationalForecastSnapshotV1Schema,
  operationalPlanningSnapshotV1Schema,
  recoveryActionSchema,
  recoveryProposalDraftV1Schema,
  rollingProductivitySnapshotV1Schema,
  sourceBackedMoneyMntSchema,
  sourceReferenceMatchesScope,
} from "../contracts/index.js";
import { appliedProgressVerificationV1Schema } from "../verification/progress-verification-contracts.js";

const positiveDecimalSchema = contractDecimalSchema.refine(
  (value) => Number(value) > 0,
  "Value must be greater than zero",
);

const factorDecimalSchema = contractDecimalSchema.refine(
  (value) => Number(value) >= 0 && Number(value) <= 3,
  "Factor must be between zero and three",
);

const boundedPolicyFactorSchema = contractDecimalSchema.refine(
  (value) => Number(value) >= 0 && Number(value) <= 1,
  "Policy factor must be between zero and one",
);

export const productivityWindowWeightsV1Schema = z
  .object({
    threeDay: z.number().finite().min(0).max(1),
    sevenDay: z.number().finite().min(0).max(1),
    fourteenDay: z.number().finite().min(0).max(1),
  })
  .strict()
  .superRefine((weights, context) => {
    const total = weights.threeDay + weights.sevenDay + weights.fourteenDay;
    if (Math.abs(total - 1) > 0.000001) {
      context.addIssue({
        code: "custom",
        message: "Rolling-productivity window weights must total one",
        path: ["threeDay"],
      });
    }
  });

export const forecastConfidenceWeightsV1Schema = z
  .object({
    approvedReportCoverage: z.number().finite().min(0).max(1),
    validQuantityCoverage: z.number().finite().min(0).max(1),
    photoEvidenceCoverage: z.number().finite().min(0).max(1),
    productivityHistoryLength: z.number().finite().min(0).max(1),
    unresolvedBlockers: z.number().finite().min(0).max(1),
    catalogCompleteness: z.number().finite().min(0).max(1),
    dependencyCompleteness: z.number().finite().min(0).max(1),
    resourceDataQuality: z.number().finite().min(0).max(1),
  })
  .strict()
  .superRefine((weights, context) => {
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - 1) > 0.000001) {
      context.addIssue({
        code: "custom",
        message: "Forecast confidence weights must total one",
        path: ["approvedReportCoverage"],
      });
    }
  });

export const operationalForecastPolicyV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    policyType: z.literal("OPERATIONAL_FORECAST_POLICY"),
    policyId: contractIdentifierSchema,
    policyVersionId: contractIdentifierSchema,
    version: z.number().int().positive(),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    effectiveFrom: contractIsoDateSchema,
    approvedBy: contractIdentifierSchema,
    approvedAt: contractIsoDateTimeSchema,
    minimumValidSamples: z.number().int().min(1).max(14),
    outlierMethod: z.literal("MAD_REVIEW_ONLY"),
    outlierThresholdMad: positiveDecimalSchema,
    blockedDayHandling: z.enum(["EXCLUDE", "INCLUDE_AS_ZERO"]),
    fallbackMethod: z.enum(["APPROVED_NORM_ONLY", "APPROVED_NORM_THEN_BASELINE_RATE"]),
    windowWeights: productivityWindowWeightsV1Schema,
    weatherRestrictedFactor: boundedPolicyFactorSchema,
    unavailableEquipmentFactor: boundedPolicyFactorSchema,
    materialShortageFloorFactor: boundedPolicyFactorSchema,
    openBlockerFactor: boundedPolicyFactorSchema,
    minimumAdjustedProductivityFactor: positiveDecimalSchema.refine(
      (value) => Number(value) <= 1,
      "Minimum productivity factor cannot exceed one",
    ),
    maximumAdjustedProductivityFactor: positiveDecimalSchema.refine(
      (value) => Number(value) >= 1 && Number(value) <= 3,
      "Maximum productivity factor must be between one and three",
    ),
    warningWorkingDays: z.number().int().positive().max(10_000),
    criticalWorkingDays: z.number().int().positive().max(10_000),
    confidenceWeights: forecastConfidenceWeightsV1Schema,
    maximumRecoveryScenarios: z.number().int().min(1).max(20),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.criticalWorkingDays <= policy.warningWorkingDays) {
      context.addIssue({
        code: "custom",
        message: "Critical threshold must exceed warning threshold",
        path: ["criticalWorkingDays"],
      });
    }
    if (
      Number(policy.maximumAdjustedProductivityFactor) <
      Number(policy.minimumAdjustedProductivityFactor)
    ) {
      context.addIssue({
        code: "custom",
        message: "Maximum productivity factor cannot be below minimum",
        path: ["maximumAdjustedProductivityFactor"],
      });
    }
  });

export const approvedProductivityNormV1Schema = z
  .object({
    normId: contractIdentifierSchema,
    normVersionId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    workClassCode: z.string().trim().min(1).max(200),
    unit: buildWatchCanonicalUnitSchema,
    productivityPerWorkingDay: buildWatchSourceBackedQuantitySchema,
    referenceCrewHeadcount: z.number().int().positive().max(100_000),
    referenceShiftHours: z.number().finite().positive().max(24),
    effectiveFrom: contractIsoDateSchema,
    approvedBy: contractIdentifierSchema,
    approvedAt: contractIsoDateTimeSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((norm, context) => {
    if (norm.productivityPerWorkingDay.unit !== norm.unit) {
      context.addIssue({
        code: "custom",
        message: "Productivity norm unit must match its canonical unit",
        path: ["productivityPerWorkingDay", "unit"],
      });
    }
    if (Number(norm.productivityPerWorkingDay.value) <= 0) {
      context.addIssue({
        code: "custom",
        message: "Approved productivity norm must be greater than zero",
        path: ["productivityPerWorkingDay", "value"],
      });
    }
  });

export const productivityLearningAdjustmentV1Schema = z
  .object({
    adjustmentId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    factor: factorDecimalSchema,
    reason: z.string().trim().min(1).max(1_000),
    effectiveFrom: contractIsoDateSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((adjustment, context) => {
    if (Number(adjustment.factor) <= 0) {
      context.addIssue({
        code: "custom",
        message: "Learning adjustment factor must be greater than zero",
        path: ["factor"],
      });
    }
  });

export const productivityOutlierReviewV1Schema = z
  .object({
    reviewId: contractIdentifierSchema,
    productivitySampleId: contractIdentifierSchema,
    decision: z.enum(["INCLUDE", "EXCLUDE"]),
    reviewerId: contractIdentifierSchema,
    reviewerRole: z.enum(["PROJECT_MANAGER", "SITE_ENGINEER"]),
    reviewedAt: contractIsoDateTimeSchema,
    reason: z.string().trim().min(1).max(2_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((review, context) => {
    if (!review.sourceRefs.some((source) => source.sourceType === "HUMAN_DECISION")) {
      context.addIssue({
        code: "custom",
        message: "Outlier review requires human-decision lineage",
        path: ["sourceRefs"],
      });
    }
  });

export const recoveryOptionCatalogEntryV1Schema = z
  .object({
    optionId: contractIdentifierSchema,
    optionVersionId: contractIdentifierSchema,
    actionType: recoveryActionSchema.shape.type,
    applicableWorkClassCode: z.string().trim().min(1).max(200).nullable(),
    productivityMultiplier: positiveDecimalSchema.nullable(),
    fixedWorkingDaysReduction: z.number().int().positive().max(10_000).nullable(),
    additionalCostMnt: sourceBackedMoneyMntSchema,
    requiredResourceIds: z.array(contractIdentifierSchema).max(1_000),
    risks: z.array(z.string().trim().min(1).max(1_000)).max(100),
    effectiveFrom: contractIsoDateSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((option, context) => {
    if (new Set(option.requiredResourceIds).size !== option.requiredResourceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Recovery required-resource identifiers must be unique",
        path: ["requiredResourceIds"],
      });
    }
    if (option.productivityMultiplier === null && option.fixedWorkingDaysReduction === null) {
      context.addIssue({
        code: "custom",
        message: "Recovery option requires a deterministic schedule impact rule",
        path: ["productivityMultiplier"],
      });
    }
    if (option.productivityMultiplier !== null && Number(option.productivityMultiplier) <= 1) {
      context.addIssue({
        code: "custom",
        message: "Recovery productivity multiplier must exceed one",
        path: ["productivityMultiplier"],
      });
    }
  });

export const operationalForecastRequestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestType: z.literal("A5_OPERATIONAL_FORECAST"),
    requestId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    asOfDate: contractIsoDateSchema,
    approvedBaseline: approvedBaselineVersionV1Schema,
    operationalSnapshot: operationalPlanningSnapshotV1Schema,
    appliedProgress: z.array(appliedProgressVerificationV1Schema).max(10_000),
    productivityNorms: z.array(approvedProductivityNormV1Schema).max(10_000),
    learningAdjustments: z.array(productivityLearningAdjustmentV1Schema).max(100_000),
    outlierReviews: z.array(productivityOutlierReviewV1Schema).max(100_000),
    recoveryOptions: z.array(recoveryOptionCatalogEntryV1Schema).max(1_000),
    policy: operationalForecastPolicyV1Schema,
    generatedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const scopeMatches =
      request.approvedBaseline.tenantId === request.tenantId &&
      request.approvedBaseline.projectId === request.projectId &&
      request.operationalSnapshot.tenantId === request.tenantId &&
      request.operationalSnapshot.projectId === request.projectId &&
      request.policy.tenantId === request.tenantId &&
      request.policy.projectId === request.projectId;
    if (!scopeMatches) {
      context.addIssue({
        code: "custom",
        message: "Forecast inputs must share one tenant/project scope",
        path: ["tenantId"],
      });
    }
    if (
      request.approvedBaseline.baselineVersionId !==
        request.operationalSnapshot.baselineVersionId ||
      request.approvedBaseline.content.scheduleVersionId !==
        request.operationalSnapshot.scheduleVersionId
    ) {
      context.addIssue({
        code: "custom",
        message: "Operational snapshot must reference the approved baseline and schedule",
        path: ["operationalSnapshot"],
      });
    }
    if (
      request.operationalSnapshot.asOf.slice(0, 10) > request.asOfDate ||
      request.asOfDate > request.generatedAt.slice(0, 10) ||
      request.policy.effectiveFrom > request.asOfDate ||
      request.policy.approvedAt > request.generatedAt ||
      request.approvedBaseline.metadata.approvedAt > request.generatedAt ||
      request.approvedBaseline.content.calendar.effectiveFrom > request.asOfDate ||
      request.operationalSnapshot.calendar.effectiveFrom > request.asOfDate
    ) {
      context.addIssue({
        code: "custom",
        message: "Forecast inputs cannot come from the future",
        path: ["generatedAt"],
      });
    }
    const workItemIds = new Set(
      request.operationalSnapshot.workItems.map((item) => item.workItemId),
    );
    for (const workItem of request.operationalSnapshot.workItems) {
      if (
        Number(workItem.plannedQuantity.value) < 0 ||
        Number(workItem.remainingQuantity.value) < 0
      ) {
        context.addIssue({
          code: "custom",
          message: "Forecast quantities cannot be negative",
          path: ["operationalSnapshot", "workItems"],
        });
      }
    }
    const normKeys = request.productivityNorms.map(
      (norm) => `${norm.workClassCode}\u0000${norm.unit}`,
    );
    if (
      new Set(request.productivityNorms.map((norm) => norm.normId)).size !==
        request.productivityNorms.length ||
      new Set(normKeys).size !== normKeys.length ||
      new Set(request.learningAdjustments.map((item) => item.adjustmentId)).size !==
        request.learningAdjustments.length ||
      new Set(request.outlierReviews.map((item) => item.reviewId)).size !==
        request.outlierReviews.length ||
      new Set(request.recoveryOptions.map((item) => item.optionId)).size !==
        request.recoveryOptions.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Forecast policy input identifiers must be unique",
        path: ["productivityNorms"],
      });
    }
    for (const norm of request.productivityNorms) {
      if (
        norm.tenantId !== request.tenantId ||
        norm.projectId !== request.projectId ||
        norm.effectiveFrom > request.asOfDate ||
        norm.approvedAt > request.generatedAt
      ) {
        context.addIssue({
          code: "custom",
          message: "Productivity norm is outside forecast scope or as-of boundary",
          path: ["productivityNorms"],
        });
      }
    }
    for (const adjustment of request.learningAdjustments) {
      if (!workItemIds.has(adjustment.workItemId) || adjustment.effectiveFrom > request.asOfDate) {
        context.addIssue({
          code: "custom",
          message: "Learning adjustment is unknown or from the future",
          path: ["learningAdjustments"],
        });
      }
    }
    for (const review of request.outlierReviews) {
      if (review.reviewedAt > request.generatedAt) {
        context.addIssue({
          code: "custom",
          message: "Outlier review cannot come from the future",
          path: ["outlierReviews"],
        });
      }
    }
    for (const option of request.recoveryOptions) {
      if (option.effectiveFrom > request.asOfDate) {
        context.addIssue({
          code: "custom",
          message: "Recovery option cannot come from the future",
          path: ["recoveryOptions"],
        });
      }
    }
    const appliedSampleIds = request.appliedProgress.flatMap((applied) =>
      applied.productivitySamples.map((sample) => sample.productivitySampleId),
    );
    if (
      new Set(request.appliedProgress.map((item) => item.applyId)).size !==
        request.appliedProgress.length ||
      new Set(request.appliedProgress.map((item) => item.progressVerificationVersionId)).size !==
        request.appliedProgress.length ||
      new Set(appliedSampleIds).size !== appliedSampleIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Applied-progress and productivity-sample identifiers must be unique",
        path: ["appliedProgress"],
      });
    }
    for (const review of request.outlierReviews) {
      if (!appliedSampleIds.includes(review.productivitySampleId)) {
        context.addIssue({
          code: "custom",
          message: "Outlier review references an unknown productivity sample",
          path: ["outlierReviews"],
        });
      }
    }
    for (const applied of request.appliedProgress) {
      const datedItems = [
        ...applied.progressHistory,
        ...applied.dailyVariances,
        ...applied.productivitySamples,
        ...applied.forecastInputs,
      ];
      if (
        applied.tenantId !== request.tenantId ||
        applied.projectId !== request.projectId ||
        applied.reportDate > request.asOfDate ||
        applied.appliedAt > request.generatedAt ||
        datedItems.some(
          (item) => item.reportDate !== applied.reportDate || !workItemIds.has(item.workItemId),
        ) ||
        applied.materialLedgerEntries.some(
          (item) => item.workItemId !== null && !workItemIds.has(item.workItemId),
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Applied progress is outside forecast scope or as-of boundary",
          path: ["appliedProgress"],
        });
      }
    }
    const appliedSources = request.appliedProgress.flatMap((applied) => [
      ...applied.sourceRefs,
      ...applied.audit.sourceRefs,
      ...applied.progressHistory.flatMap((item) => [
        ...item.sourceRefs,
        ...(item.verifiedQuantity?.sourceRefs ?? []),
        ...(item.cumulativeQuantity?.sourceRefs ?? []),
      ]),
      ...applied.dailyVariances.flatMap((item) => [
        ...item.sourceRefs,
        ...item.plannedQuantity.sourceRefs,
        ...(item.verifiedQuantity?.sourceRefs ?? []),
        ...(item.variance?.quantity.sourceRefs ?? []),
        ...(item.variance?.percentageSourceRefs ?? []),
      ]),
      ...applied.productivitySamples.flatMap((item) => [
        ...item.sourceRefs,
        ...(item.quantity?.sourceRefs ?? []),
      ]),
      ...applied.materialLedgerEntries.flatMap((item) => [
        ...item.sourceRefs,
        ...item.quantity.sourceRefs,
      ]),
      ...applied.forecastInputs.flatMap((item) => [
        ...item.sourceRefs,
        ...(item.verifiedQuantity?.sourceRefs ?? []),
      ]),
    ]);
    const additionalSources = [
      ...request.policy.sourceRefs,
      ...request.productivityNorms.flatMap((item) => [
        ...item.productivityPerWorkingDay.sourceRefs,
        ...item.sourceRefs,
      ]),
      ...request.learningAdjustments.flatMap((item) => item.sourceRefs),
      ...request.outlierReviews.flatMap((item) => item.sourceRefs),
      ...request.recoveryOptions.flatMap((item) => [
        ...item.additionalCostMnt.sourceRefs,
        ...item.sourceRefs,
      ]),
      ...appliedSources,
    ];
    if (
      additionalSources.some(
        (item) =>
          !sourceReferenceMatchesScope(item, request.tenantId, request.projectId) ||
          (item.asOf !== null && item.asOf > request.generatedAt),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Forecast policy/catalog source is outside scope or from the future",
        path: ["policy", "sourceRefs"],
      });
    }
  });

export const productivitySampleCalculationV1Schema = z
  .object({
    productivitySampleId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    rawQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    normalizedQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    laborHours: contractDecimalSchema.nullable(),
    normalizationFactor: factorDecimalSchema.nullable(),
    outlierCandidate: z.boolean(),
    reviewerDecision: z.enum(["INCLUDE", "EXCLUDE"]).nullable(),
    included: z.boolean(),
    exclusionReason: z.string().trim().min(1).max(100).nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const adjustedProductivityFactorV1Schema = z
  .object({
    factor: z.enum([
      "RECENT_PACE",
      "CREW_SIZE",
      "SHIFT",
      "WEATHER",
      "LEARNING",
      "EQUIPMENT",
      "MATERIAL",
      "BLOCKER",
      "CALENDAR",
    ]),
    value: factorDecimalSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const workItemForecastCalculationV1Schema = z
  .object({
    calculationId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    approvedNorm: buildWatchSourceBackedQuantitySchema.nullable(),
    weightedCurrentProductivity: buildWatchSourceBackedQuantitySchema.nullable(),
    factors: z.array(adjustedProductivityFactorV1Schema).length(9),
    adjustedDailyProductivity: buildWatchSourceBackedQuantitySchema.nullable(),
    remainingQuantity: buildWatchSourceBackedQuantitySchema,
    remainingDurationWorkingDays: z.number().int().nonnegative().nullable(),
    ownProjectedFinish: contractIsoDateSchema.nullable(),
    dependencyProjectedFinish: contractIsoDateSchema.nullable(),
    confidence: z.number().finite().min(0).max(1),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(200),
  })
  .strict();

export const a2ForecastNarrativeInputV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    inputType: z.literal("A2_FORECAST_NARRATIVE_INPUT"),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    operationalForecastSnapshotId: contractIdentifierSchema,
    projectStatus: z.enum([
      "ON_TRACK",
      "AT_RISK",
      "LIKELY_LATE",
      "CRITICAL_LATE",
      "INSUFFICIENT_DATA",
    ]),
    projectedFinish: contractIsoDateSchema.nullable(),
    delayWorkingDays: z.number().int().nullable(),
    driverIds: z.array(contractIdentifierSchema).max(1_000),
    recoveryProposalIds: z.array(contractIdentifierSchema).max(100),
    numericAuthority: z.literal("A5_DETERMINISTIC_ONLY"),
    a2MayCreateNumericFacts: z.literal(false),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(1_000),
  })
  .strict();

export const operationalForecastResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    resultType: z.literal("A5_OPERATIONAL_FORECAST_RESULT"),
    requestId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    asOfDate: contractIsoDateSchema,
    rollingProductivity: rollingProductivitySnapshotV1Schema,
    productivityCalculations: z.array(productivitySampleCalculationV1Schema).max(1_000_000),
    forecast: operationalForecastSnapshotV1Schema,
    workItemCalculations: z.array(workItemForecastCalculationV1Schema).min(1).max(100_000),
    recoveryProposals: z.array(recoveryProposalDraftV1Schema).max(100),
    a2NarrativeInput: a2ForecastNarrativeInputV1Schema,
    deterministic: z.literal(true),
    llmRequired: z.literal(false),
    baselineChanged: z.literal(false),
    generatedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.rollingProductivity.tenantId !== result.tenantId ||
      result.forecast.tenantId !== result.tenantId ||
      result.a2NarrativeInput.tenantId !== result.tenantId ||
      result.rollingProductivity.projectId !== result.projectId ||
      result.forecast.projectId !== result.projectId ||
      result.a2NarrativeInput.projectId !== result.projectId ||
      result.forecast.snapshotId !== result.a2NarrativeInput.operationalForecastSnapshotId ||
      result.forecast.baselineChanged ||
      result.recoveryProposals.some((proposal) => proposal.baselineChanged)
    ) {
      context.addIssue({
        code: "custom",
        message: "Forecast result scope, A2 boundary, or baseline immutability is inconsistent",
        path: ["forecast"],
      });
    }
  });

export type OperationalForecastPolicyV1 = z.infer<typeof operationalForecastPolicyV1Schema>;
export type ApprovedProductivityNormV1 = z.infer<typeof approvedProductivityNormV1Schema>;
export type OperationalForecastRequestV1 = z.infer<typeof operationalForecastRequestV1Schema>;
export type ProductivitySampleCalculationV1 = z.infer<typeof productivitySampleCalculationV1Schema>;
export type WorkItemForecastCalculationV1 = z.infer<typeof workItemForecastCalculationV1Schema>;
export type OperationalForecastResultV1 = z.infer<typeof operationalForecastResultV1Schema>;
