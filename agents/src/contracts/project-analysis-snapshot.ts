import { z } from "zod";
import {
  contractDecimalSchema,
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
  contractMoneySchema,
  contractPercentageSchema,
} from "./common.js";
import { dailyReportBlockerCategorySchema, dailyReportWorkStatusSchema } from "./daily-report.js";

export const snapshotProjectStatusSchema = z.enum([
  "PLANNED",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
]);

export const snapshotWorkPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const snapshotDependencyTypeSchema = z.enum([
  "FINISH_TO_START",
  "START_TO_START",
  "FINISH_TO_FINISH",
  "START_TO_FINISH",
]);

export const snapshotDailyReportStatusSchema = z.enum([
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
]);

export const snapshotStockMovementKindSchema = z.enum([
  "RECEIPT",
  "ISSUE",
  "REVERSAL",
  "ADJUSTMENT",
]);

export const snapshotCostCategorySchema = z.enum([
  "MATERIAL",
  "LABOR",
  "EQUIPMENT",
  "SUBCONTRACTOR",
  "TRAVEL",
  "SOFTWARE",
  "OTHER",
]);

export const snapshotAlertSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const snapshotAlertStatusSchema = z.enum(["NEW", "ACKNOWLEDGED", "ACTION_TAKEN", "CLOSED"]);

export const snapshotRecommendationDecisionSchema = z.enum([
  "PENDING_REVIEW",
  "APPROVED",
  "EDITED",
  "DISCARDED",
]);

export const snapshotCalendarSchema = z
  .object({
    timezone: z.string().trim().min(1).max(100),
    workingWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    workHoursPerDay: z.number().finite().positive().max(24),
    holidays: z.array(contractIsoDateSchema).max(366),
  })
  .strict()
  .superRefine((calendar, context) => {
    if (new Set(calendar.workingWeekdays).size !== calendar.workingWeekdays.length) {
      context.addIssue({
        code: "custom",
        message: "Calendar working weekdays must be unique",
        path: ["workingWeekdays"],
      });
    }
  });

export const snapshotBaselineSchema = z
  .object({
    baselineVersionId: contractIdentifierSchema,
    version: z.number().int().positive(),
    approvedBy: contractIdentifierSchema,
    approvedAt: contractIsoDateTimeSchema,
    changeReason: z.string().trim().min(1).max(2_000),
    plannedStart: contractIsoDateSchema,
    plannedEnd: contractIsoDateSchema,
    budgetMnt: contractMoneySchema,
    calendar: snapshotCalendarSchema,
  })
  .strict();

export const snapshotWorkItemSchema = z
  .object({
    workItemId: contractIdentifierSchema,
    parentWorkItemId: contractIdentifierSchema.nullable(),
    code: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(500),
    stage: z.string().trim().min(1).max(200).nullable(),
    location: z.string().trim().min(1).max(300).nullable(),
    unit: z.string().trim().min(1).max(100),
    plannedQuantity: contractDecimalSchema,
    unitCostMnt: contractMoneySchema,
    plannedStart: contractIsoDateSchema,
    plannedEnd: contractIsoDateSchema,
    status: dailyReportWorkStatusSchema,
    priority: snapshotWorkPrioritySchema,
    assigneeType: z.enum(["TEAM", "SUBCONTRACTOR", "UNASSIGNED"]),
    assigneeRef: contractIdentifierSchema.nullable(),
    subcontractorId: contractIdentifierSchema.nullable(),
    isCritical: z.boolean(),
    displayOrder: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((workItem, context) => {
    if (workItem.assigneeType === "SUBCONTRACTOR" && workItem.subcontractorId === null) {
      context.addIssue({
        code: "custom",
        message: "Subcontractor work requires a subcontractor reference",
        path: ["subcontractorId"],
      });
    }
  });

export const snapshotDependencySchema = z
  .object({
    dependencyId: contractIdentifierSchema,
    predecessorWorkItemId: contractIdentifierSchema,
    successorWorkItemId: contractIdentifierSchema,
    type: snapshotDependencyTypeSchema,
    lagDays: z.number().int().min(-365).max(365),
  })
  .strict()
  .superRefine((dependency, context) => {
    if (dependency.predecessorWorkItemId === dependency.successorWorkItemId) {
      context.addIssue({
        code: "custom",
        message: "A work item cannot depend on itself",
        path: ["successorWorkItemId"],
      });
    }
  });

export const snapshotMaterialSchema = z
  .object({
    materialId: contractIdentifierSchema,
    code: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(500),
    aliases: z.array(z.string().trim().min(1).max(500)).max(50),
    unit: z.string().trim().min(1).max(100),
    leadTimeDays: z.number().int().nonnegative().max(3_650),
  })
  .strict();

export const snapshotMaterialNormSchema = z
  .object({
    materialNormId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    materialId: contractIdentifierSchema,
    quantityPerWorkUnit: contractDecimalSchema,
    wastePercent: z.number().finite().min(0).max(1_000),
  })
  .strict();

export const snapshotSubcontractorSchema = z
  .object({
    subcontractorId: contractIdentifierSchema,
    code: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(500),
    contractStart: contractIsoDateSchema,
    contractEnd: contractIsoDateSchema,
    contractValueMnt: contractMoneySchema,
  })
  .strict();

export const snapshotDailyReportSchema = z
  .object({
    dailyReportId: contractIdentifierSchema,
    date: contractIsoDateSchema,
    reportedBy: contractIdentifierSchema,
    rawText: z.string().trim().min(1).max(20_000).nullable(),
    status: snapshotDailyReportStatusSchema,
    submittedAt: contractIsoDateTimeSchema.nullable(),
    approvedBy: contractIdentifierSchema.nullable(),
    approvedAt: contractIsoDateTimeSchema.nullable(),
    rejectionReason: z.string().trim().min(1).max(2_000).nullable(),
    sourceDraftId: contractIdentifierSchema.nullable(),
  })
  .strict()
  .superRefine((report, context) => {
    if (
      report.status === "APPROVED" &&
      (report.approvedBy === null || report.approvedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved daily reports require reviewer metadata",
        path: ["approvedBy"],
      });
    }

    if (report.status === "REJECTED" && report.rejectionReason === null) {
      context.addIssue({
        code: "custom",
        message: "Rejected daily reports require a reason",
        path: ["rejectionReason"],
      });
    }
  });

export const snapshotProgressEntrySchema = z
  .object({
    progressEntryId: contractIdentifierSchema,
    dailyReportId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    capturedAt: contractIsoDateTimeSchema,
    quantityDoneIncrement: contractDecimalSchema,
    cumulativeQuantityDone: contractDecimalSchema,
    progressPercent: contractPercentageSchema,
    status: dailyReportWorkStatusSchema,
    blockerReason: z.string().trim().min(1).max(1_000).nullable(),
    note: z.string().trim().min(1).max(2_000).nullable(),
    aiConfidence: z.number().finite().min(0).max(1).nullable(),
    humanEdited: z.boolean(),
  })
  .strict();

export const snapshotAttendanceEntrySchema = z
  .object({
    attendanceEntryId: contractIdentifierSchema,
    dailyReportId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema.nullable(),
    subcontractorId: contractIdentifierSchema.nullable(),
    teamName: z.string().trim().min(1).max(500),
    headcount: z.number().int().positive().max(10_000),
    hoursPerPerson: z.number().finite().positive().max(24),
    totalHours: z.number().finite().positive().max(240_000),
  })
  .strict()
  .superRefine((entry, context) => {
    if (Math.abs(entry.headcount * entry.hoursPerPerson - entry.totalHours) > 0.01) {
      context.addIssue({
        code: "custom",
        message: "Attendance total hours must equal headcount multiplied by hours per person",
        path: ["totalHours"],
      });
    }
  });

export const snapshotStockMovementSchema = z
  .object({
    stockMovementId: contractIdentifierSchema,
    materialId: contractIdentifierSchema,
    kind: snapshotStockMovementKindSchema,
    quantity: contractDecimalSchema,
    unitPriceMnt: contractMoneySchema.nullable(),
    workItemId: contractIdentifierSchema.nullable(),
    supplierName: z.string().trim().min(1).max(500).nullable(),
    documentArtifactId: contractIdentifierSchema.nullable(),
    occurredAt: contractIsoDateTimeSchema,
    recordedBy: contractIdentifierSchema,
    reversesMovementId: contractIdentifierSchema.nullable(),
    reference: z.string().trim().min(1).max(300),
  })
  .strict()
  .superRefine((movement, context) => {
    if (movement.kind === "REVERSAL" && movement.reversesMovementId === null) {
      context.addIssue({
        code: "custom",
        message: "A reversal must reference the movement it reverses",
        path: ["reversesMovementId"],
      });
    }

    if (movement.kind !== "REVERSAL" && movement.reversesMovementId !== null) {
      context.addIssue({
        code: "custom",
        message: "Only reversal movements may define reversesMovementId",
        path: ["reversesMovementId"],
      });
    }
  });

export const snapshotCostEntrySchema = z
  .object({
    costEntryId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema.nullable(),
    dailyReportId: contractIdentifierSchema.nullable(),
    category: snapshotCostCategorySchema,
    amountMnt: contractMoneySchema,
    sourceType: z.enum([
      "STOCK_MOVEMENT",
      "ATTENDANCE",
      "EQUIPMENT_LOG",
      "SUBCONTRACTOR_CLAIM",
      "MANUAL",
    ]),
    sourceId: contractIdentifierSchema,
    occurredAt: contractIsoDateTimeSchema,
    description: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const snapshotBlockerSchema = z
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
  })
  .strict();

export const snapshotAlertSchema = z
  .object({
    alertId: contractIdentifierSchema,
    ruleId: contractIdentifierSchema,
    ruleVersion: z.number().int().positive(),
    workItemId: contractIdentifierSchema.nullable(),
    materialId: contractIdentifierSchema.nullable(),
    severity: snapshotAlertSeveritySchema,
    status: snapshotAlertStatusSchema,
    title: z.string().trim().min(1).max(500),
    explanation: z
      .object({
        actual: z.union([z.string().max(1_000), z.number().finite(), z.boolean()]),
        threshold: z.union([z.string().max(1_000), z.number().finite(), z.boolean()]),
        delta: z.union([z.string().max(1_000), z.number().finite(), z.boolean(), z.null()]),
        sourceIds: z.array(contractIdentifierSchema).min(1).max(100),
      })
      .strict(),
    rootCauseGroupId: contractIdentifierSchema.nullable(),
    assigneeRef: contractIdentifierSchema.nullable(),
    createdAt: contractIsoDateTimeSchema,
    acknowledgedAt: contractIsoDateTimeSchema.nullable(),
    closedAt: contractIsoDateTimeSchema.nullable(),
    closeNote: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();

export const snapshotScheduleForecastSchema = z
  .object({
    forecastId: contractIdentifierSchema,
    calculatedAt: contractIsoDateTimeSchema,
    projectedEndDate: contractIsoDateSchema,
    delayDays: z.number().int(),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW", "INSUFFICIENT_DATA"]),
    affectedWorkItemIds: z.array(contractIdentifierSchema).max(500),
    sourceProgressEntryIds: z.array(contractIdentifierSchema).max(5_000),
  })
  .strict();

export const snapshotRecommendationDecisionRecordSchema = z
  .object({
    recommendationId: contractIdentifierSchema,
    generatedAt: contractIsoDateTimeSchema,
    status: snapshotRecommendationDecisionSchema,
    title: z.string().trim().min(1).max(500),
    action: z.string().trim().min(1).max(2_000),
    workItemIds: z.array(contractIdentifierSchema).min(1).max(100),
    estimatedImpactDays: z.number().int().nullable(),
    decidedBy: contractIdentifierSchema.nullable(),
    decidedAt: contractIsoDateTimeSchema.nullable(),
    decisionReason: z.string().trim().min(1).max(2_000).nullable(),
    sourceIds: z.array(contractIdentifierSchema).min(1).max(100),
  })
  .strict();

export const snapshotTenantProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(500),
    terminology: z.record(z.string().min(1), z.string().min(1).max(500)),
    blockerCategories: z.array(z.string().trim().min(1).max(200)).max(100),
    reportingStyle: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();

export const projectAnalysisSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotType: z.literal("PROJECT_ANALYSIS"),
    snapshotId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    projectCode: z.string().trim().min(1).max(200),
    projectName: z.string().trim().min(1).max(500),
    projectStatus: snapshotProjectStatusSchema,
    asOf: contractIsoDateTimeSchema,
    activeBaseline: snapshotBaselineSchema,
    workItems: z.array(snapshotWorkItemSchema).min(1).max(5_000),
    dependencies: z.array(snapshotDependencySchema).max(20_000),
    materials: z.array(snapshotMaterialSchema).max(10_000),
    materialNorms: z.array(snapshotMaterialNormSchema).max(100_000),
    subcontractors: z.array(snapshotSubcontractorSchema).max(10_000),
    dailyReports: z.array(snapshotDailyReportSchema).max(100_000),
    progressEntries: z.array(snapshotProgressEntrySchema).max(1_000_000),
    attendanceEntries: z.array(snapshotAttendanceEntrySchema).max(1_000_000),
    stockMovements: z.array(snapshotStockMovementSchema).max(1_000_000),
    costEntries: z.array(snapshotCostEntrySchema).max(1_000_000),
    blockers: z.array(snapshotBlockerSchema).max(1_000_000),
    alerts: z.array(snapshotAlertSchema).max(1_000_000),
    forecasts: z.array(snapshotScheduleForecastSchema).max(100_000),
    recommendationDecisions: z.array(snapshotRecommendationDecisionRecordSchema).max(100_000),
    tenantProfile: snapshotTenantProfileSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const unique = <T>(values: readonly T[], path: string, message: string) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message,
          path: [path],
        });
      }
    };
    const requireReference = (
      value: string | null,
      allowed: ReadonlySet<string>,
      path: [string, number, string],
      message: string,
    ) => {
      if (value !== null && !allowed.has(value)) {
        context.addIssue({ code: "custom", message, path });
      }
    };
    const workItemIds = new Set(snapshot.workItems.map((workItem) => workItem.workItemId));
    const materialIds = new Set(snapshot.materials.map((material) => material.materialId));
    const subcontractorIds = new Set(
      snapshot.subcontractors.map((subcontractor) => subcontractor.subcontractorId),
    );
    const dailyReportIds = new Set(snapshot.dailyReports.map((report) => report.dailyReportId));
    const progressEntryIds = new Set(
      snapshot.progressEntries.map((entry) => entry.progressEntryId),
    );
    const stockMovementIds = new Set(
      snapshot.stockMovements.map((movement) => movement.stockMovementId),
    );

    unique(
      snapshot.workItems.map((workItem) => workItem.workItemId),
      "workItems",
      "Work item identifiers must be unique",
    );
    unique(
      snapshot.workItems.map((workItem) => workItem.code),
      "workItems",
      "Work item codes must be unique",
    );
    unique(
      snapshot.dependencies.map((dependency) => dependency.dependencyId),
      "dependencies",
      "Dependency identifiers must be unique",
    );
    unique(
      snapshot.materials.map((material) => material.materialId),
      "materials",
      "Material identifiers must be unique",
    );
    unique(
      snapshot.dailyReports.map((report) => report.dailyReportId),
      "dailyReports",
      "Daily report identifiers must be unique",
    );

    snapshot.workItems.forEach((workItem, index) => {
      requireReference(
        workItem.parentWorkItemId,
        workItemIds,
        ["workItems", index, "parentWorkItemId"],
        "Work item parent is outside the snapshot",
      );
      requireReference(
        workItem.subcontractorId,
        subcontractorIds,
        ["workItems", index, "subcontractorId"],
        "Work item subcontractor is outside the snapshot",
      );
    });

    snapshot.dependencies.forEach((dependency, index) => {
      requireReference(
        dependency.predecessorWorkItemId,
        workItemIds,
        ["dependencies", index, "predecessorWorkItemId"],
        "Dependency predecessor is outside the snapshot",
      );
      requireReference(
        dependency.successorWorkItemId,
        workItemIds,
        ["dependencies", index, "successorWorkItemId"],
        "Dependency successor is outside the snapshot",
      );
    });

    snapshot.materialNorms.forEach((norm, index) => {
      requireReference(
        norm.workItemId,
        workItemIds,
        ["materialNorms", index, "workItemId"],
        "Material norm work item is outside the snapshot",
      );
      requireReference(
        norm.materialId,
        materialIds,
        ["materialNorms", index, "materialId"],
        "Material norm material is outside the snapshot",
      );
    });

    snapshot.progressEntries.forEach((entry, index) => {
      requireReference(
        entry.dailyReportId,
        dailyReportIds,
        ["progressEntries", index, "dailyReportId"],
        "Progress entry report is outside the snapshot",
      );
      requireReference(
        entry.workItemId,
        workItemIds,
        ["progressEntries", index, "workItemId"],
        "Progress entry work item is outside the snapshot",
      );
    });

    snapshot.attendanceEntries.forEach((entry, index) => {
      requireReference(
        entry.dailyReportId,
        dailyReportIds,
        ["attendanceEntries", index, "dailyReportId"],
        "Attendance report is outside the snapshot",
      );
      requireReference(
        entry.workItemId,
        workItemIds,
        ["attendanceEntries", index, "workItemId"],
        "Attendance work item is outside the snapshot",
      );
      requireReference(
        entry.subcontractorId,
        subcontractorIds,
        ["attendanceEntries", index, "subcontractorId"],
        "Attendance subcontractor is outside the snapshot",
      );
    });

    snapshot.stockMovements.forEach((movement, index) => {
      requireReference(
        movement.materialId,
        materialIds,
        ["stockMovements", index, "materialId"],
        "Stock movement material is outside the snapshot",
      );
      requireReference(
        movement.workItemId,
        workItemIds,
        ["stockMovements", index, "workItemId"],
        "Stock movement work item is outside the snapshot",
      );
      requireReference(
        movement.reversesMovementId,
        stockMovementIds,
        ["stockMovements", index, "reversesMovementId"],
        "Reversed movement is outside the snapshot",
      );
    });

    snapshot.costEntries.forEach((entry, index) => {
      requireReference(
        entry.workItemId,
        workItemIds,
        ["costEntries", index, "workItemId"],
        "Cost entry work item is outside the snapshot",
      );
      requireReference(
        entry.dailyReportId,
        dailyReportIds,
        ["costEntries", index, "dailyReportId"],
        "Cost entry report is outside the snapshot",
      );
    });

    snapshot.blockers.forEach((blocker, index) => {
      requireReference(
        blocker.dailyReportId,
        dailyReportIds,
        ["blockers", index, "dailyReportId"],
        "Blocker report is outside the snapshot",
      );
      requireReference(
        blocker.workItemId,
        workItemIds,
        ["blockers", index, "workItemId"],
        "Blocker work item is outside the snapshot",
      );
    });

    snapshot.alerts.forEach((alert, index) => {
      requireReference(
        alert.workItemId,
        workItemIds,
        ["alerts", index, "workItemId"],
        "Alert work item is outside the snapshot",
      );
      requireReference(
        alert.materialId,
        materialIds,
        ["alerts", index, "materialId"],
        "Alert material is outside the snapshot",
      );
    });

    snapshot.forecasts.forEach((forecast, index) => {
      forecast.affectedWorkItemIds.forEach((workItemId) => {
        requireReference(
          workItemId,
          workItemIds,
          ["forecasts", index, "affectedWorkItemIds"],
          "Forecast work item is outside the snapshot",
        );
      });
      forecast.sourceProgressEntryIds.forEach((entryId) => {
        requireReference(
          entryId,
          progressEntryIds,
          ["forecasts", index, "sourceProgressEntryIds"],
          "Forecast source progress entry is outside the snapshot",
        );
      });
    });

    snapshot.recommendationDecisions.forEach((recommendation, index) => {
      recommendation.workItemIds.forEach((workItemId) => {
        requireReference(
          workItemId,
          workItemIds,
          ["recommendationDecisions", index, "workItemIds"],
          "Recommendation work item is outside the snapshot",
        );
      });
    });

    if (
      Date.parse(`${snapshot.activeBaseline.plannedStart}T00:00:00Z`) >
      Date.parse(`${snapshot.activeBaseline.plannedEnd}T00:00:00Z`)
    ) {
      context.addIssue({
        code: "custom",
        message: "Baseline start must not be after baseline end",
        path: ["activeBaseline", "plannedStart"],
      });
    }
  });

export type ProjectAnalysisSnapshotV1 = z.infer<typeof projectAnalysisSnapshotV1Schema>;
export type SnapshotWorkItem = z.infer<typeof snapshotWorkItemSchema>;
export type SnapshotProgressEntry = z.infer<typeof snapshotProgressEntrySchema>;
export type SnapshotStockMovement = z.infer<typeof snapshotStockMovementSchema>;
export type SnapshotAlert = z.infer<typeof snapshotAlertSchema>;
