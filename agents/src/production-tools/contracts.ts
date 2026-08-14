import { z } from "zod";
import {
  agentSourceRefV1Schema,
  forecastConfidenceSchema,
  workItemForecastV1Schema,
} from "../contracts/deterministic-analysis.js";
import {
  contractDecimalSchema,
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
  contractMoneySchema,
} from "../contracts/common.js";
import {
  dailyReportBlockerCategorySchema,
  dailyReportWorkStatusSchema,
} from "../contracts/daily-report.js";
import {
  snapshotAlertSeveritySchema,
  snapshotAlertStatusSchema,
  snapshotProjectStatusSchema,
  snapshotWorkPrioritySchema,
} from "../contracts/project-analysis-snapshot.js";

export const productionToolNameSchema = z.enum([
  "getProjectSummary",
  "getWorkItems",
  "getProgressHistory",
  "getStockStatus",
  "getConsumptionVsNorm",
  "getAttendanceStats",
  "getBlockerHistory",
  "getAlerts",
  "getScheduleForecast",
  "getSubcontractorPerformance",
  "searchDailyReports",
]);

export const productionToolPermissionSchema = z.enum([
  "AGENT_READ",
  "COST_READ",
  "REPORT_TEXT_READ",
]);

export const authorizationContextSchema = z
  .object({
    principalId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    allowedProjectIds: z.array(contractIdentifierSchema).min(1).max(500),
    permissions: z.array(productionToolPermissionSchema).min(1),
  })
  .strict();

export const productionToolMetaSchema = z
  .object({
    schemaVersion: z.literal(1),
    toolName: productionToolNameSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    asOf: contractIsoDateTimeSchema,
    rowCount: z.number().int().nonnegative(),
    returnedRowCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    durationMs: z.number().finite().nonnegative(),
    dataClassification: z.literal("AUTHORIZED_PROJECT_READ_ONLY"),
    sourceCatalog: z.array(agentSourceRefV1Schema).max(2_000),
  })
  .strict()
  .superRefine((meta, context) => {
    if (meta.returnedRowCount > meta.rowCount) {
      context.addIssue({
        code: "custom",
        message: "returnedRowCount cannot exceed rowCount",
        path: ["returnedRowCount"],
      });
    }

    if (meta.truncated !== meta.returnedRowCount < meta.rowCount) {
      context.addIssue({
        code: "custom",
        message: "truncated must match returned and total row counts",
        path: ["truncated"],
      });
    }
  });

const projectInputShape = {
  projectId: contractIdentifierSchema,
  asOf: contractIsoDateTimeSchema.optional(),
};

const limitSchema = z.number().int().min(1).max(200).default(50);

export const getProjectSummaryInputSchema = z.object(projectInputShape).strict();

const statusCountsSchema = z
  .object({
    PLANNED: z.number().int().nonnegative(),
    IN_PROGRESS: z.number().int().nonnegative(),
    BLOCKED: z.number().int().nonnegative(),
    COMPLETED: z.number().int().nonnegative(),
    CANCELLED: z.number().int().nonnegative(),
  })
  .strict();

export const projectSummaryViewSchema = z
  .object({
    projectCode: z.string().trim().min(1).max(200),
    projectName: z.string().trim().min(1).max(500),
    projectStatus: snapshotProjectStatusSchema,
    baselineVersion: z.number().int().positive(),
    plannedStart: contractIsoDateSchema,
    plannedEnd: contractIsoDateSchema,
    workItemCount: z.number().int().nonnegative(),
    criticalWorkItemCount: z.number().int().nonnegative(),
    byStatus: statusCountsSchema,
    averageProgressPercent: z.number().finite().min(0).max(100),
    plannedBudgetMnt: contractMoneySchema,
    actualCostMnt: contractMoneySchema,
    openAlertCount: z.number().int().nonnegative(),
    projectedEndDate: contractIsoDateSchema,
    projectedDelayWorkingDays: z.number().int(),
    forecastConfidence: forecastConfidenceSchema,
  })
  .strict();

export const getProjectSummaryOutputSchema = z
  .object({
    meta: productionToolMetaSchema,
    summary: projectSummaryViewSchema,
  })
  .strict();

export const getWorkItemsInputSchema = z
  .object({
    ...projectInputShape,
    statuses: z.array(dailyReportWorkStatusSchema).min(1).max(5).optional(),
    priorities: z.array(snapshotWorkPrioritySchema).min(1).max(4).optional(),
    includeCompleted: z.boolean().default(true),
    stage: z.string().trim().min(1).max(200).optional(),
    limit: limitSchema,
  })
  .strict();

export const productionWorkItemViewSchema = z
  .object({
    workItemId: contractIdentifierSchema,
    parentWorkItemId: contractIdentifierSchema.nullable(),
    code: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(500),
    stage: z.string().trim().min(1).max(200).nullable(),
    location: z.string().trim().min(1).max(300).nullable(),
    status: dailyReportWorkStatusSchema,
    priority: snapshotWorkPrioritySchema,
    plannedStart: contractIsoDateSchema,
    plannedEnd: contractIsoDateSchema,
    progressPercent: z.number().finite().min(0).max(100),
    plannedQuantity: contractDecimalSchema,
    unit: z.string().trim().min(1).max(100),
    plannedCostMnt: contractMoneySchema,
    isCritical: z.boolean(),
    subcontractorId: contractIdentifierSchema.nullable(),
  })
  .strict();

export const getWorkItemsOutputSchema = z
  .object({
    meta: productionToolMetaSchema,
    summary: z
      .object({
        byStatus: statusCountsSchema,
        averageProgressPercent: z.number().finite().min(0).max(100),
        criticalCount: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(productionWorkItemViewSchema),
  })
  .strict();

export const getProgressHistoryInputSchema = z
  .object({
    ...projectInputShape,
    workItemIds: z.array(contractIdentifierSchema).min(1).max(50).optional(),
    dateFrom: contractIsoDateSchema.optional(),
    dateTo: contractIsoDateSchema.optional(),
    limit: limitSchema,
  })
  .strict();

export const progressHistoryViewSchema = z
  .object({
    progressEntryId: contractIdentifierSchema,
    dailyReportId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    capturedAt: contractIsoDateTimeSchema,
    quantityDoneIncrement: contractDecimalSchema,
    cumulativeQuantityDone: contractDecimalSchema,
    progressPercent: z.number().finite().min(0).max(100),
    status: dailyReportWorkStatusSchema,
    blockerPresent: z.boolean(),
    humanEdited: z.boolean(),
  })
  .strict();

export const getProgressHistoryOutputSchema = z
  .object({
    meta: productionToolMetaSchema,
    summary: z
      .object({
        workItemCount: z.number().int().nonnegative(),
        firstCapturedAt: contractIsoDateTimeSchema.nullable(),
        latestCapturedAt: contractIsoDateTimeSchema.nullable(),
        averageProgressPercent: z.number().finite().min(0).max(100),
      })
      .strict(),
    items: z.array(progressHistoryViewSchema),
  })
  .strict();

export const getStockStatusInputSchema = z
  .object({
    ...projectInputShape,
    materialIds: z.array(contractIdentifierSchema).min(1).max(100).optional(),
    coverageWindowDays: z.union([z.literal(7), z.literal(14)]).default(14),
    limit: limitSchema,
  })
  .strict();

export const stockStatusViewSchema = z
  .object({
    materialId: contractIdentifierSchema,
    code: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(500),
    unit: z.string().trim().min(1).max(100),
    balance: contractDecimalSchema,
    recentConsumption: contractDecimalSchema,
    averageDailyConsumption: contractDecimalSchema,
    coverageWorkingDays: z.number().finite().nonnegative().nullable(),
    status: z.enum(["HEALTHY", "WATCH", "CRITICAL"]),
  })
  .strict();

export const getStockStatusOutputSchema = z
  .object({
    meta: productionToolMetaSchema,
    summary: z
      .object({
        criticalCount: z.number().int().nonnegative(),
        watchCount: z.number().int().nonnegative(),
        healthyCount: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(stockStatusViewSchema),
  })
  .strict();

export const getConsumptionVsNormInputSchema = z
  .object({
    ...projectInputShape,
    workItemIds: z.array(contractIdentifierSchema).min(1).max(100).optional(),
    materialIds: z.array(contractIdentifierSchema).min(1).max(100).optional(),
    limit: limitSchema,
  })
  .strict();

export const consumptionVsNormViewSchema = z
  .object({
    materialNormId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    materialId: contractIdentifierSchema,
    cumulativeWorkQuantity: contractDecimalSchema,
    expectedConsumption: contractDecimalSchema,
    actualConsumption: contractDecimalSchema,
    variance: contractDecimalSchema,
    consumptionRatioPercent: z.number().finite().nonnegative().nullable(),
    status: z.enum(["NO_DATA", "WITHIN_NORM", "OVER_NORM"]),
  })
  .strict();

export const getConsumptionVsNormOutputSchema = z
  .object({
    meta: productionToolMetaSchema,
    summary: z
      .object({
        overNormCount: z.number().int().nonnegative(),
        withinNormCount: z.number().int().nonnegative(),
        noDataCount: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(consumptionVsNormViewSchema),
  })
  .strict();

export const getAttendanceStatsInputSchema = z
  .object({
    ...projectInputShape,
    workItemIds: z.array(contractIdentifierSchema).min(1).max(100).optional(),
    subcontractorIds: z.array(contractIdentifierSchema).min(1).max(100).optional(),
    dateFrom: contractIsoDateSchema.optional(),
    dateTo: contractIsoDateSchema.optional(),
    limit: limitSchema,
  })
  .strict();

export const attendanceStatsViewSchema = z
  .object({
    groupKey: z.string().trim().min(1).max(500),
    workItemId: contractIdentifierSchema.nullable(),
    subcontractorId: contractIdentifierSchema.nullable(),
    teamName: z.string().trim().min(1).max(500),
    reportDays: z.number().int().nonnegative(),
    personDays: z.number().int().nonnegative(),
    totalHours: z.number().finite().nonnegative(),
    averageHeadcount: z.number().finite().nonnegative(),
  })
  .strict();

export const getAttendanceStatsOutputSchema = z
  .object({
    meta: productionToolMetaSchema,
    summary: z
      .object({
        totalPersonDays: z.number().int().nonnegative(),
        totalHours: z.number().finite().nonnegative(),
        averageDailyHeadcount: z.number().finite().nonnegative(),
      })
      .strict(),
    items: z.array(attendanceStatsViewSchema),
  })
  .strict();

export const getBlockerHistoryInputSchema = z
  .object({
    ...projectInputShape,
    workItemIds: z.array(contractIdentifierSchema).min(1).max(100).optional(),
    categories: z.array(dailyReportBlockerCategorySchema).min(1).max(20).optional(),
    supplierName: z.string().trim().min(1).max(500).optional(),
    unresolvedOnly: z.boolean().default(false),
    limit: limitSchema,
  })
  .strict();

export const blockerHistoryViewSchema = z
  .object({
    blockerId: contractIdentifierSchema,
    dailyReportId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    category: dailyReportBlockerCategorySchema,
    description: z.string().trim().min(1).max(1_000),
    responsibleParty: z.string().trim().min(1).max(500).nullable(),
    supplierName: z.string().trim().min(1).max(500).nullable(),
    openedAt: contractIsoDateTimeSchema,
    resolvedAt: contractIsoDateTimeSchema.nullable(),
    openDurationDays: z.number().int().nonnegative(),
  })
  .strict();

export const getBlockerHistoryOutputSchema = z
  .object({
    meta: productionToolMetaSchema,
    summary: z
      .object({
        openCount: z.number().int().nonnegative(),
        resolvedCount: z.number().int().nonnegative(),
        repeatedSupplierCount: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(blockerHistoryViewSchema),
  })
  .strict();

export const getAlertsInputSchema = z
  .object({
    ...projectInputShape,
    severities: z.array(snapshotAlertSeveritySchema).min(1).max(4).optional(),
    statuses: z.array(snapshotAlertStatusSchema).min(1).max(4).optional(),
    ruleIds: z.array(contractIdentifierSchema).min(1).max(100).optional(),
    limit: limitSchema,
  })
  .strict();

const alertEvidenceValueSchema = z.union([
  z.string().max(1_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const alertViewSchema = z
  .object({
    alertId: contractIdentifierSchema,
    ruleId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema.nullable(),
    materialId: contractIdentifierSchema.nullable(),
    severity: snapshotAlertSeveritySchema,
    status: snapshotAlertStatusSchema,
    title: z.string().trim().min(1).max(500),
    actual: alertEvidenceValueSchema,
    threshold: alertEvidenceValueSchema,
    delta: alertEvidenceValueSchema,
    rootCauseGroupId: contractIdentifierSchema.nullable(),
    createdAt: contractIsoDateTimeSchema,
  })
  .strict();

export const getAlertsOutputSchema = z
  .object({
    meta: productionToolMetaSchema,
    summary: z
      .object({
        bySeverity: z
          .object({
            LOW: z.number().int().nonnegative(),
            MEDIUM: z.number().int().nonnegative(),
            HIGH: z.number().int().nonnegative(),
            CRITICAL: z.number().int().nonnegative(),
          })
          .strict(),
        openCount: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(alertViewSchema),
  })
  .strict();

export const getScheduleForecastInputSchema = z
  .object({
    ...projectInputShape,
    includeCompleted: z.boolean().default(false),
    limit: limitSchema,
  })
  .strict();

export const getScheduleForecastOutputSchema = z
  .object({
    meta: productionToolMetaSchema,
    summary: z
      .object({
        baselineEndDate: contractIsoDateSchema,
        projectedEndDate: contractIsoDateSchema,
        delayWorkingDays: z.number().int(),
        confidence: forecastConfidenceSchema,
        criticalWorkItemIds: z.array(contractIdentifierSchema),
        affectedWorkItemCount: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(workItemForecastV1Schema),
  })
  .strict();

export const getSubcontractorPerformanceInputSchema = z
  .object({
    ...projectInputShape,
    subcontractorIds: z.array(contractIdentifierSchema).min(1).max(100).optional(),
    limit: limitSchema,
  })
  .strict();

export const subcontractorPerformanceViewSchema = z
  .object({
    subcontractorId: contractIdentifierSchema,
    code: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(500),
    assignedWorkItemCount: z.number().int().nonnegative(),
    completedWorkItemCount: z.number().int().nonnegative(),
    plannedProgressPercent: z.number().finite().min(0).max(100),
    actualProgressPercent: z.number().finite().min(0).max(100),
    scheduleDeviationPercentagePoints: z.number().finite(),
    attendanceHours: z.number().finite().nonnegative(),
    actualCostMnt: contractMoneySchema,
    openBlockerCount: z.number().int().nonnegative(),
    performanceStatus: z.enum(["ON_TRACK", "WATCH", "DELAYED"]),
  })
  .strict();

export const getSubcontractorPerformanceOutputSchema = z
  .object({
    meta: productionToolMetaSchema,
    summary: z
      .object({
        onTrackCount: z.number().int().nonnegative(),
        watchCount: z.number().int().nonnegative(),
        delayedCount: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(subcontractorPerformanceViewSchema),
  })
  .strict();

export const searchDailyReportsInputSchema = z
  .object({
    ...projectInputShape,
    query: z.string().trim().min(1).max(500),
    dateFrom: contractIsoDateSchema.optional(),
    dateTo: contractIsoDateSchema.optional(),
    limit: limitSchema,
  })
  .strict();

export const dailyReportSearchViewSchema = z
  .object({
    dailyReportId: contractIdentifierSchema,
    date: contractIsoDateSchema,
    status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]),
    excerpt: z.string().max(600),
    matchedTerms: z.array(z.string().trim().min(1).max(100)).max(20),
  })
  .strict();

export const searchDailyReportsOutputSchema = z
  .object({
    meta: productionToolMetaSchema,
    summary: z
      .object({
        query: z.string().trim().min(1).max(500),
        matchedReportCount: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(dailyReportSearchViewSchema),
  })
  .strict();

export type AuthorizationContext = z.infer<typeof authorizationContextSchema>;
export type ProductionToolMeta = z.infer<typeof productionToolMetaSchema>;
export type GetProjectSummaryInput = z.input<typeof getProjectSummaryInputSchema>;
export type GetWorkItemsInput = z.input<typeof getWorkItemsInputSchema>;
export type GetProgressHistoryInput = z.input<typeof getProgressHistoryInputSchema>;
export type GetStockStatusInput = z.input<typeof getStockStatusInputSchema>;
export type GetConsumptionVsNormInput = z.input<typeof getConsumptionVsNormInputSchema>;
export type GetAttendanceStatsInput = z.input<typeof getAttendanceStatsInputSchema>;
export type GetBlockerHistoryInput = z.input<typeof getBlockerHistoryInputSchema>;
export type GetAlertsInput = z.input<typeof getAlertsInputSchema>;
export type GetScheduleForecastInput = z.input<typeof getScheduleForecastInputSchema>;
export type GetSubcontractorPerformanceInput = z.input<
  typeof getSubcontractorPerformanceInputSchema
>;
export type SearchDailyReportsInput = z.input<typeof searchDailyReportsInputSchema>;
