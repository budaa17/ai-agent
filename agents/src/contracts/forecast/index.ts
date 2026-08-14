import { z } from "zod";
import {
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
} from "../common.js";
import {
  buildWatchPolicyVersionSchema,
  buildWatchSourceBackedQuantitySchema,
  buildWatchSourceReferenceSchema,
  hasUniqueContractIds,
  sourceReferenceMatchesScope,
} from "../buildwatch-v2-common.js";
import { sourceBackedMoneyMntSchema } from "../estimate/index.js";

export const forecastSourceBackedIntegerSchema = z
  .object({
    value: z.number().int().min(-100_000).max(100_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const forecastConfidenceFactorSchema = z
  .object({
    factor: z.enum([
      "APPROVED_REPORT_COVERAGE",
      "VALID_QUANTITY_COVERAGE",
      "PHOTO_EVIDENCE_COVERAGE",
      "PRODUCTIVITY_HISTORY_LENGTH",
      "UNRESOLVED_BLOCKERS",
      "CATALOG_COMPLETENESS",
      "DEPENDENCY_COMPLETENESS",
      "RESOURCE_DATA_QUALITY",
    ]),
    score: z.number().finite().min(0).max(1),
    weight: z.number().finite().min(0).max(1),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const forecastDriverSchema = z
  .object({
    driverId: contractIdentifierSchema,
    type: z.enum([
      "PRODUCTIVITY",
      "MATERIAL",
      "CREW",
      "EQUIPMENT",
      "BLOCKER",
      "WEATHER",
      "DEPENDENCY",
      "DATA_QUALITY",
    ]),
    workItemId: contractIdentifierSchema.nullable(),
    summary: z.string().trim().min(1).max(1_000),
    impactWorkingDays: forecastSourceBackedIntegerSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const productivitySampleSchema = z
  .object({
    sampleId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    approvedVerificationId: contractIdentifierSchema,
    quantity: buildWatchSourceBackedQuantitySchema.nullable(),
    included: z.boolean(),
    exclusionReason: z
      .enum([
        "REJECTED",
        "UNVERIFIABLE",
        "WRONG_UNIT",
        "DUPLICATE_EVIDENCE_ONLY",
        "REVIEWER_EXCLUDED_OUTLIER",
        "BLOCKED_DAY_POLICY",
        "ZERO_QUANTITY",
        "NO_VERIFIED_QUANTITY",
      ])
      .nullable(),
    outlierCandidate: z.boolean(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((sample, context) => {
    if (sample.included && sample.exclusionReason !== null) {
      context.addIssue({
        code: "custom",
        message: "Included productivity samples cannot have an exclusion reason",
        path: ["exclusionReason"],
      });
    }

    if (sample.included && sample.quantity === null) {
      context.addIssue({
        code: "custom",
        message: "Included productivity samples require a quantity",
        path: ["quantity"],
      });
    }

    if (!sample.included && sample.exclusionReason === null) {
      context.addIssue({
        code: "custom",
        message: "Excluded productivity samples require a reason",
        path: ["exclusionReason"],
      });
    }
  });

export const rollingProductivityWindowSchema = z
  .object({
    windowWorkingDays: z.union([z.literal(3), z.literal(7), z.literal(14)]),
    method: z.enum([
      "ROLLING_ACTUAL",
      "COLD_START_NORM",
      "BASELINE_RATE_FALLBACK",
      "INSUFFICIENT_DATA",
    ]),
    sampleIds: z.array(contractIdentifierSchema).max(1_000),
    validSampleCount: z.number().int().nonnegative().max(1_000),
    coveragePercent: z.number().finite().min(0).max(100),
    productivityPerWorkingDay: buildWatchSourceBackedQuantitySchema.nullable(),
    confidence: z.number().finite().min(0).max(1),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((window, context) => {
    if (!hasUniqueContractIds(window.sampleIds)) {
      context.addIssue({
        code: "custom",
        message: "Productivity-window sample references must be unique",
        path: ["sampleIds"],
      });
    }

    if (window.validSampleCount !== window.sampleIds.length) {
      context.addIssue({
        code: "custom",
        message: "Valid sample count must match the included sample references",
        path: ["validSampleCount"],
      });
    }

    if (window.method === "INSUFFICIENT_DATA" && window.productivityPerWorkingDay !== null) {
      context.addIssue({
        code: "custom",
        message: "Insufficient-data windows cannot report productivity",
        path: ["productivityPerWorkingDay"],
      });
    }

    if (window.method !== "INSUFFICIENT_DATA" && window.productivityPerWorkingDay === null) {
      context.addIssue({
        code: "custom",
        message: "Actual and cold-start windows require productivity",
        path: ["productivityPerWorkingDay"],
      });
    }

    if (window.method === "COLD_START_NORM" && window.confidence > 0.6) {
      context.addIssue({
        code: "custom",
        message: "Cold-start productivity confidence cannot exceed 0.60",
        path: ["confidence"],
      });
    }

    if (window.method === "BASELINE_RATE_FALLBACK" && window.confidence > 0.5) {
      context.addIssue({
        code: "custom",
        message: "Baseline-rate fallback confidence cannot exceed 0.50",
        path: ["confidence"],
      });
    }
  });

export const rollingProductivityWorkItemSchema = z
  .object({
    workItemId: contractIdentifierSchema,
    unit: z.string().trim().min(1).max(50),
    samples: z.array(productivitySampleSchema).max(10_000),
    windows: z.array(rollingProductivityWindowSchema).length(3),
    selectedWindowWorkingDays: z.union([z.literal(3), z.literal(7), z.literal(14)]).nullable(),
    selectedProductivity: buildWatchSourceBackedQuantitySchema.nullable(),
  })
  .strict()
  .superRefine((workItem, context) => {
    if (
      !hasUniqueContractIds(workItem.samples.map((sample) => sample.sampleId)) ||
      !hasUniqueContractIds(workItem.windows.map((window) => String(window.windowWorkingDays)))
    ) {
      context.addIssue({
        code: "custom",
        message: "Productivity sample identifiers and windows must be unique",
        path: ["samples"],
      });
    }

    const includedSampleIds = new Set(
      workItem.samples.filter((sample) => sample.included).map((sample) => sample.sampleId),
    );
    workItem.windows.forEach((window, windowIndex) => {
      window.sampleIds.forEach((sampleId, sampleIndex) => {
        if (!includedSampleIds.has(sampleId)) {
          context.addIssue({
            code: "custom",
            message: "Productivity window references a missing or excluded sample",
            path: ["windows", windowIndex, "sampleIds", sampleIndex],
          });
        }
      });
    });

    if (workItem.selectedWindowWorkingDays === null && workItem.selectedProductivity !== null) {
      context.addIssue({
        code: "custom",
        message: "Selected productivity requires a selected window",
        path: ["selectedWindowWorkingDays"],
      });
    }

    if (
      workItem.selectedProductivity !== null &&
      workItem.selectedProductivity.unit !== workItem.unit
    ) {
      context.addIssue({
        code: "custom",
        message: "Selected productivity must use the work-item unit",
        path: ["selectedProductivity", "unit"],
      });
    }
  });

export const rollingProductivitySnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotType: z.literal("ROLLING_PRODUCTIVITY"),
    snapshotId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    asOf: contractIsoDateTimeSchema,
    policyVersion: buildWatchPolicyVersionSchema,
    workItems: z.array(rollingProductivityWorkItemSchema).min(1).max(100_000),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (!hasUniqueContractIds(snapshot.workItems.map((item) => item.workItemId))) {
      context.addIssue({
        code: "custom",
        message: "Rolling-productivity work-item identifiers must be unique",
        path: ["workItems"],
      });
    }

    const sources = snapshot.workItems.flatMap((workItem) => [
      ...workItem.samples.flatMap((sample) => [
        ...(sample.quantity?.sourceRefs ?? []),
        ...sample.sourceRefs,
      ]),
      ...workItem.windows.flatMap((window) => [
        ...(window.productivityPerWorkingDay?.sourceRefs ?? []),
        ...window.sourceRefs,
      ]),
      ...(workItem.selectedProductivity?.sourceRefs ?? []),
    ]);
    sources.forEach((source, index) => {
      if (!sourceReferenceMatchesScope(source, snapshot.tenantId, snapshot.projectId)) {
        context.addIssue({
          code: "custom",
          message: "Productivity source is outside the snapshot scope",
          path: ["sources", index],
        });
      }
    });
  });

export const forecastOnTimeStatusSchema = z.enum([
  "ON_TRACK",
  "AT_RISK",
  "LIKELY_LATE",
  "CRITICAL_LATE",
  "INSUFFICIENT_DATA",
]);

export const forecastThresholdSchema = z
  .object({
    warningWorkingDays: z.number().int().positive().max(10_000),
    criticalWorkingDays: z.number().int().positive().max(10_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((threshold, context) => {
    if (threshold.criticalWorkingDays <= threshold.warningWorkingDays) {
      context.addIssue({
        code: "custom",
        message: "Critical threshold must exceed the warning threshold",
        path: ["criticalWorkingDays"],
      });
    }
  });

export const forecastWorkItemSchema = z
  .object({
    workItemId: contractIdentifierSchema,
    remainingQuantity: buildWatchSourceBackedQuantitySchema,
    adjustedDailyProductivity: buildWatchSourceBackedQuantitySchema.nullable(),
    remainingDurationWorkingDays: forecastSourceBackedIntegerSchema.nullable(),
    projectedFinish: contractIsoDateSchema.nullable(),
    delayWorkingDays: forecastSourceBackedIntegerSchema.nullable(),
    status: forecastOnTimeStatusSchema,
    confidence: z.number().finite().min(0).max(1),
    confidenceFactors: z.array(forecastConfidenceFactorSchema).min(1).max(20),
    drivers: z.array(forecastDriverSchema).max(100),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((workItem, context) => {
    if (
      workItem.adjustedDailyProductivity !== null &&
      workItem.adjustedDailyProductivity.unit !== workItem.remainingQuantity.unit
    ) {
      context.addIssue({
        code: "custom",
        message: "Forecast productivity must use the remaining-quantity unit",
        path: ["adjustedDailyProductivity", "unit"],
      });
    }

    const insufficient = workItem.status === "INSUFFICIENT_DATA";
    if (
      insufficient &&
      (workItem.adjustedDailyProductivity !== null ||
        workItem.remainingDurationWorkingDays !== null ||
        workItem.projectedFinish !== null ||
        workItem.delayWorkingDays !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Insufficient-data forecast cannot contain computed finish metrics",
        path: ["status"],
      });
    }

    if (
      !insufficient &&
      (workItem.adjustedDailyProductivity === null ||
        workItem.remainingDurationWorkingDays === null ||
        workItem.projectedFinish === null ||
        workItem.delayWorkingDays === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Computed forecast requires productivity, duration, finish, and delay",
        path: ["status"],
      });
    }
  });

export const operationalForecastSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotType: z.literal("OPERATIONAL_FORECAST"),
    snapshotId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    asOf: contractIsoDateTimeSchema,
    baselineVersionId: contractIdentifierSchema,
    scheduleVersionId: contractIdentifierSchema,
    rollingProductivitySnapshotId: contractIdentifierSchema,
    policyVersion: buildWatchPolicyVersionSchema,
    thresholds: forecastThresholdSchema,
    baselineFinish: contractIsoDateSchema,
    projectedFinish: contractIsoDateSchema.nullable(),
    delayWorkingDays: forecastSourceBackedIntegerSchema.nullable(),
    status: forecastOnTimeStatusSchema,
    confidence: z.number().finite().min(0).max(1),
    confidenceFactors: z.array(forecastConfidenceFactorSchema).min(1).max(20),
    workItems: z.array(forecastWorkItemSchema).min(1).max(100_000),
    projectedCriticalPathWorkItemIds: z
      .array(contractIdentifierSchema)
      .min(1)
      .max(100_000)
      .optional(),
    drivers: z.array(forecastDriverSchema).max(1_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(1_000),
    deterministic: z.literal(true),
    baselineChanged: z.literal(false),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      !hasUniqueContractIds(snapshot.workItems.map((item) => item.workItemId)) ||
      !hasUniqueContractIds(snapshot.drivers.map((driver) => driver.driverId)) ||
      (snapshot.projectedCriticalPathWorkItemIds !== undefined &&
        !hasUniqueContractIds(snapshot.projectedCriticalPathWorkItemIds))
    ) {
      context.addIssue({
        code: "custom",
        message: "Forecast work-item and driver identifiers must be unique",
        path: ["workItems"],
      });
    }

    if (
      snapshot.projectedCriticalPathWorkItemIds?.some(
        (workItemId) => !snapshot.workItems.some((workItem) => workItem.workItemId === workItemId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Projected critical path references an unknown forecast work item",
        path: ["projectedCriticalPathWorkItemIds"],
      });
    }

    const insufficient = snapshot.status === "INSUFFICIENT_DATA";
    if (insufficient && (snapshot.projectedFinish !== null || snapshot.delayWorkingDays !== null)) {
      context.addIssue({
        code: "custom",
        message: "Insufficient-data project forecast cannot contain finish metrics",
        path: ["status"],
      });
    }

    if (
      !insufficient &&
      (snapshot.projectedFinish === null || snapshot.delayWorkingDays === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Computed project forecast requires projected finish and delay",
        path: ["status"],
      });
    }

    if (snapshot.delayWorkingDays !== null) {
      const delay = snapshot.delayWorkingDays.value;
      const warning = snapshot.thresholds.warningWorkingDays;
      const critical = snapshot.thresholds.criticalWorkingDays;
      const statusMatches =
        (snapshot.status === "ON_TRACK" && delay <= 0) ||
        (snapshot.status === "AT_RISK" && delay > 0 && delay <= warning) ||
        (snapshot.status === "LIKELY_LATE" && delay > warning && delay <= critical) ||
        (snapshot.status === "CRITICAL_LATE" && delay > critical);
      if (!statusMatches) {
        context.addIssue({
          code: "custom",
          message: "Forecast status conflicts with delay thresholds",
          path: ["status"],
        });
      }
    }

    const sources = [
      ...snapshot.thresholds.sourceRefs,
      ...(snapshot.delayWorkingDays?.sourceRefs ?? []),
      ...snapshot.confidenceFactors.flatMap((factor) => factor.sourceRefs),
      ...snapshot.workItems.flatMap((workItem) => [
        ...workItem.remainingQuantity.sourceRefs,
        ...(workItem.adjustedDailyProductivity?.sourceRefs ?? []),
        ...(workItem.remainingDurationWorkingDays?.sourceRefs ?? []),
        ...(workItem.delayWorkingDays?.sourceRefs ?? []),
        ...workItem.confidenceFactors.flatMap((factor) => factor.sourceRefs),
        ...workItem.drivers.flatMap((driver) => [
          ...driver.impactWorkingDays.sourceRefs,
          ...driver.sourceRefs,
        ]),
        ...workItem.sourceRefs,
      ]),
      ...snapshot.drivers.flatMap((driver) => [
        ...driver.impactWorkingDays.sourceRefs,
        ...driver.sourceRefs,
      ]),
      ...snapshot.sourceRefs,
    ];
    sources.forEach((source, index) => {
      if (!sourceReferenceMatchesScope(source, snapshot.tenantId, snapshot.projectId)) {
        context.addIssue({
          code: "custom",
          message: "Forecast source is outside the snapshot scope",
          path: ["sources", index],
        });
      }
    });
  });

export const recoveryActionSchema = z
  .object({
    actionId: contractIdentifierSchema,
    type: z.enum([
      "ADD_CREW",
      "ADD_SHIFT",
      "ADD_EQUIPMENT",
      "MOVE_RESOURCE",
      "PARALLELIZE_WORK",
      "EXPEDITE_MATERIAL",
      "CHANGE_ZONE_SEQUENCE",
      "INCREASE_SUBCONTRACTOR_CAPACITY",
    ]),
    workItemIds: z.array(contractIdentifierSchema).min(1).max(1_000),
    description: z.string().trim().min(1).max(2_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const recoveryProposalDraftV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    draftType: z.literal("RECOVERY_PROPOSAL"),
    draftId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    operationalForecastSnapshotId: contractIdentifierSchema,
    status: z.enum(["DRAFT", "REVIEW_REQUIRED"]),
    proposal: z.string().trim().min(1).max(2_000),
    actions: z.array(recoveryActionSchema).min(1).max(100),
    estimatedScheduleImpactWorkingDays: forecastSourceBackedIntegerSchema,
    additionalCostMnt: sourceBackedMoneyMntSchema,
    requiredResourceIds: z.array(contractIdentifierSchema).max(10_000),
    dependencyConflictIds: z.array(contractIdentifierSchema).max(10_000),
    risks: z.array(z.string().trim().min(1).max(1_000)).max(100),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(1_000),
    calculatedBy: z.literal("DETERMINISTIC_SCENARIO_ENGINE"),
    baselineChanged: z.literal(false),
    requiresHumanReview: z.literal(true),
    createdAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    if (
      !hasUniqueContractIds(draft.actions.map((action) => action.actionId)) ||
      !hasUniqueContractIds(draft.requiredResourceIds) ||
      !hasUniqueContractIds(draft.dependencyConflictIds)
    ) {
      context.addIssue({
        code: "custom",
        message: "Recovery action, resource, and conflict identifiers must be unique",
        path: ["actions"],
      });
    }

    const sources = [
      ...draft.actions.flatMap((action) => action.sourceRefs),
      ...draft.estimatedScheduleImpactWorkingDays.sourceRefs,
      ...draft.additionalCostMnt.sourceRefs,
      ...draft.sourceRefs,
    ];
    sources.forEach((source, index) => {
      if (!sourceReferenceMatchesScope(source, draft.tenantId, draft.projectId)) {
        context.addIssue({
          code: "custom",
          message: "Recovery-proposal source is outside the draft scope",
          path: ["sources", index],
        });
      }
    });
  });

export type RollingProductivitySnapshotV1 = z.infer<typeof rollingProductivitySnapshotV1Schema>;
export type OperationalForecastSnapshotV1 = z.infer<typeof operationalForecastSnapshotV1Schema>;
export type RecoveryProposalDraftV1 = z.infer<typeof recoveryProposalDraftV1Schema>;
