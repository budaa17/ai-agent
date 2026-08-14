import { z } from "zod";
import {
  contractDecimalSchema,
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
} from "./common.js";

export const deterministicRuleIdSchema = z.enum([
  "OVERDUE_WORK_ITEM",
  "MATERIAL_OVERUSE",
  "STOCK_SHORTAGE",
  "PRODUCTIVITY_DECLINE",
  "COST_AHEAD_OF_PROGRESS",
  "SUBCONTRACTOR_DEVIATION",
  "MISSING_DAILY_REPORT",
  "STALLED_PROGRESS",
  "DEPENDENCY_VIOLATION",
  "BUDGET_OVERRUN",
  "LEDGER_MISMATCH",
]);

export const deterministicSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const forecastConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW", "INSUFFICIENT_DATA"]);

const evidenceScalarSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const agentSourceRefV1Schema = z
  .object({
    sourceId: contractIdentifierSchema,
    catalog: z.enum([
      "BASELINE",
      "WORK_ITEM",
      "DEPENDENCY",
      "SUBCONTRACTOR",
      "DAILY_REPORT",
      "PROGRESS",
      "ATTENDANCE",
      "STOCK",
      "COST",
      "BLOCKER",
      "ALERT",
      "FORECAST",
      "RECOMMENDATION",
    ]),
    entityId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    observedAt: contractIsoDateTimeSchema,
    fieldPaths: z.array(z.string().trim().min(1).max(300)).min(1).max(50),
  })
  .strict();

export const deterministicDeviationV1Schema = z
  .object({
    deviationId: contractIdentifierSchema,
    ruleId: deterministicRuleIdSchema,
    ruleVersion: z.number().int().positive(),
    severity: deterministicSeveritySchema,
    effectiveDate: contractIsoDateSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema.nullable(),
    materialId: contractIdentifierSchema.nullable(),
    subcontractorId: contractIdentifierSchema.nullable(),
    title: z.string().trim().min(1).max(500),
    explanation: z.string().trim().min(1).max(2_000),
    actual: z.record(z.string().trim().min(1).max(200), evidenceScalarSchema),
    threshold: z.record(z.string().trim().min(1).max(200), evidenceScalarSchema),
    delta: z.record(z.string().trim().min(1).max(200), evidenceScalarSchema),
    sourceIds: z.array(contractIdentifierSchema).min(1).max(500),
    dedupeKey: z.string().trim().min(1).max(500),
    rootCauseGroupId: contractIdentifierSchema.nullable(),
  })
  .strict();

export const deterministicRuleEvaluationV1Schema = z
  .object({
    evaluationId: contractIdentifierSchema,
    ruleId: deterministicRuleIdSchema,
    ruleVersion: z.number().int().positive(),
    evaluatedAt: contractIsoDateTimeSchema,
    status: z.enum(["MATCHED", "NO_MATCH", "INSUFFICIENT_DATA"]),
    evaluatedSubjectCount: z.number().int().nonnegative(),
    matchedCount: z.number().int().nonnegative(),
    deviations: z.array(deterministicDeviationV1Schema),
  })
  .strict()
  .superRefine((evaluation, context) => {
    if (evaluation.matchedCount !== evaluation.deviations.length) {
      context.addIssue({
        code: "custom",
        message: "matchedCount must equal deviations length",
        path: ["matchedCount"],
      });
    }

    if (evaluation.status === "MATCHED" && evaluation.matchedCount === 0) {
      context.addIssue({
        code: "custom",
        message: "MATCHED evaluation requires at least one deviation",
        path: ["status"],
      });
    }

    if (evaluation.status !== "MATCHED" && evaluation.matchedCount > 0) {
      context.addIssue({
        code: "custom",
        message: "Non-matched evaluation cannot contain deviations",
        path: ["status"],
      });
    }
  });

export const criticalPathTaskV1Schema = z
  .object({
    workItemId: contractIdentifierSchema,
    durationWorkingDays: z.number().int().positive(),
    earliestStart: contractIsoDateSchema,
    earliestFinish: contractIsoDateSchema,
    latestStart: contractIsoDateSchema,
    latestFinish: contractIsoDateSchema,
    totalFloatWorkingDays: z.number().int().nonnegative(),
    freeFloatWorkingDays: z.number().int().nonnegative(),
    isCritical: z.boolean(),
  })
  .strict();

export const calendarCriticalPathV1Schema = z
  .object({
    projectStart: contractIsoDateSchema,
    projectFinish: contractIsoDateSchema,
    projectDurationWorkingDays: z.number().int().positive(),
    topologicalOrder: z.array(contractIdentifierSchema).min(1),
    criticalWorkItemIds: z.array(contractIdentifierSchema),
    criticalPaths: z.array(z.array(contractIdentifierSchema).min(1)).min(1),
    tasks: z.array(criticalPathTaskV1Schema).min(1),
  })
  .strict();

export const workItemForecastV1Schema = z
  .object({
    workItemId: contractIdentifierSchema,
    currentProgressPercent: z.number().finite().min(0).max(100),
    cumulativeQuantityDone: contractDecimalSchema,
    actualStartDate: contractIsoDateSchema.nullable(),
    actualPacePerWorkingDay: contractDecimalSchema.nullable(),
    remainingDurationWorkingDays: z.number().int().nonnegative(),
    projectedStartDate: contractIsoDateSchema,
    projectedFinishDate: contractIsoDateSchema,
    delayWorkingDays: z.number().int(),
    confidence: forecastConfidenceSchema,
    isPlannedCritical: z.boolean(),
    sourceProgressEntryIds: z.array(contractIdentifierSchema).max(100),
  })
  .strict();

export const scheduleForecastV1Schema = z
  .object({
    forecastId: contractIdentifierSchema,
    calculatedAt: contractIsoDateTimeSchema,
    baselineEndDate: contractIsoDateSchema,
    projectedEndDate: contractIsoDateSchema,
    delayWorkingDays: z.number().int(),
    confidence: forecastConfidenceSchema,
    criticalPath: calendarCriticalPathV1Schema,
    workItems: z.array(workItemForecastV1Schema).min(1),
    affectedWorkItemIds: z.array(contractIdentifierSchema),
    sourceProgressEntryIds: z.array(contractIdentifierSchema).max(10_000),
  })
  .strict();

export const recoveryScenarioTypeSchema = z.enum([
  "PARALLELIZATION",
  "EXTRA_CREW",
  "RESEQUENCE",
  "SUBCONTRACTOR_OPTION",
]);

export const recoveryScenarioV1Schema = z
  .object({
    scenarioId: contractIdentifierSchema,
    type: recoveryScenarioTypeSchema,
    targetWorkItemIds: z.array(contractIdentifierSchema).min(1).max(20),
    baselineProjectedEndDate: contractIsoDateSchema,
    scenarioProjectedEndDate: contractIsoDateSchema,
    estimatedImpactDays: z.number().int().nonnegative(),
    assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    dataSufficient: z.boolean(),
    sourceIds: z.array(contractIdentifierSchema).min(1).max(100),
  })
  .strict();

export const deterministicAnalysisV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    analysisType: z.literal("DETERMINISTIC_PROJECT_ANALYSIS"),
    analysisId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    snapshotId: contractIdentifierSchema,
    asOf: contractIsoDateTimeSchema,
    ruleBundleVersion: z.string().trim().min(1).max(200),
    forecast: scheduleForecastV1Schema,
    ruleEvaluations: z.array(deterministicRuleEvaluationV1Schema).min(1),
    deviations: z.array(deterministicDeviationV1Schema),
    recoveryScenarios: z.array(recoveryScenarioV1Schema).max(20),
    sourceCatalog: z.array(agentSourceRefV1Schema).max(20_000),
  })
  .strict()
  .superRefine((analysis, context) => {
    const evaluationDeviationIds = analysis.ruleEvaluations.flatMap((evaluation) =>
      evaluation.deviations.map((deviation) => deviation.deviationId),
    );
    const topLevelDeviationIds = analysis.deviations.map((deviation) => deviation.deviationId);

    if (
      JSON.stringify([...evaluationDeviationIds].sort()) !==
      JSON.stringify([...topLevelDeviationIds].sort())
    ) {
      context.addIssue({
        code: "custom",
        message: "Top-level deviations must exactly match rule evaluation deviations",
        path: ["deviations"],
      });
    }
  });

export type AgentSourceRefV1 = z.infer<typeof agentSourceRefV1Schema>;
export type DeterministicDeviationV1 = z.infer<typeof deterministicDeviationV1Schema>;
export type DeterministicRuleEvaluationV1 = z.infer<typeof deterministicRuleEvaluationV1Schema>;
export type CalendarCriticalPathV1 = z.infer<typeof calendarCriticalPathV1Schema>;
export type WorkItemForecastV1 = z.infer<typeof workItemForecastV1Schema>;
export type ScheduleForecastV1 = z.infer<typeof scheduleForecastV1Schema>;
export type RecoveryScenarioV1 = z.infer<typeof recoveryScenarioV1Schema>;
export type DeterministicAnalysisV1 = z.infer<typeof deterministicAnalysisV1Schema>;
