import { z } from "zod";
import {
  buildWatchSourceBackedQuantitySchema,
  buildWatchSourceReferenceSchema,
  dailyWorkPlanDraftV1Schema,
  operationalPlanningSnapshotV1Schema,
  sourceReferenceMatchesScope,
} from "../contracts/index.js";
import {
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
} from "../contracts/common.js";

export const a5PlanningTriggerSchema = z.enum(["SCHEDULED_05_00", "MANAGER_REQUEST", "REPLAY"]);

export const a5SelectionModeSchema = z.enum(["AUTO", "VALIDATE_REQUESTED"]);

export const a5PlanningWindowSchema = z
  .object({
    startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((window, context) => {
    if (window.endTime <= window.startTime) {
      context.addIssue({
        code: "custom",
        message: "Planning window end must be after its start",
        path: ["endTime"],
      });
    }
  });

export const a5ProductivityFactorSchema = z
  .object({
    crewId: contractIdentifierSchema,
    crewFactor: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/),
    shiftFactor: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((factor, context) => {
    if (Number(factor.crewFactor) <= 0 || Number(factor.shiftFactor) <= 0) {
      context.addIssue({
        code: "custom",
        message: "Crew and shift factors must be positive",
        path: ["crewFactor"],
      });
    }
  });

export const a5SafetyClearanceSchema = z
  .object({
    code: z.string().trim().min(1).max(500),
    satisfied: z.boolean(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const a5DailyPlanRequestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestType: z.literal("A5_DAILY_PLAN"),
    requestId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    planDate: contractIsoDateSchema,
    timezone: z.string().trim().min(1).max(100),
    trigger: a5PlanningTriggerSchema,
    selectionMode: a5SelectionModeSchema,
    requestedWorkItemIds: z.array(contractIdentifierSchema).max(100_000),
    maxItems: z.number().int().positive().max(100_000),
    minimumExecutableQuantity: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/),
    planningWindow: a5PlanningWindowSchema,
    productivityFactors: z.array(a5ProductivityFactorSchema).max(100_000),
    safetyClearances: z.array(a5SafetyClearanceSchema).max(10_000),
    bookedWorkItemIds: z.array(contractIdentifierSchema).max(100_000),
    evidenceRuleIdsByWorkClass: z.record(
      z.string().trim().min(1).max(200),
      contractIdentifierSchema,
    ),
    operationalSnapshot: operationalPlanningSnapshotV1Schema,
    generatedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const uniqueLists = [
      request.requestedWorkItemIds,
      request.bookedWorkItemIds,
      request.productivityFactors.map((factor) => factor.crewId),
      request.safetyClearances.map((clearance) => clearance.code),
    ];
    if (uniqueLists.some((values) => new Set(values).size !== values.length)) {
      context.addIssue({
        code: "custom",
        message: "A5 request identifiers must be unique within each collection",
        path: ["requestedWorkItemIds"],
      });
    }

    if (
      request.operationalSnapshot.tenantId !== request.tenantId ||
      request.operationalSnapshot.projectId !== request.projectId
    ) {
      context.addIssue({
        code: "custom",
        message: "A5 request and operational snapshot scope must match",
        path: ["operationalSnapshot"],
      });
    }

    if (request.operationalSnapshot.calendar.timezone !== request.timezone) {
      context.addIssue({
        code: "custom",
        message: "A5 request timezone must match the approved calendar",
        path: ["timezone"],
      });
    }

    if (Number(request.minimumExecutableQuantity) <= 0) {
      context.addIssue({
        code: "custom",
        message: "Minimum executable quantity must be positive",
        path: ["minimumExecutableQuantity"],
      });
    }

    const knownWorkItemIds = new Set(
      request.operationalSnapshot.workItems.map((item) => item.workItemId),
    );
    for (const [index, workItemId] of request.requestedWorkItemIds.entries()) {
      if (!knownWorkItemIds.has(workItemId)) {
        context.addIssue({
          code: "custom",
          message: "Requested work item is outside the operational snapshot",
          path: ["requestedWorkItemIds", index],
        });
      }
    }

    const knownCrewIds = new Set(request.operationalSnapshot.crews.map((crew) => crew.crewId));
    request.productivityFactors.forEach((factor, index) => {
      if (!knownCrewIds.has(factor.crewId)) {
        context.addIssue({
          code: "custom",
          message: "Productivity factor references an unknown crew",
          path: ["productivityFactors", index, "crewId"],
        });
      }
    });

    const workClassCodes = new Set(
      request.operationalSnapshot.workItems.map((item) => item.workClassCode),
    );
    for (const workClassCode of workClassCodes) {
      if (request.evidenceRuleIdsByWorkClass[workClassCode] === undefined) {
        context.addIssue({
          code: "custom",
          message: "Every work class requires an approved evidence rule",
          path: ["evidenceRuleIdsByWorkClass", workClassCode],
        });
      }
    }

    const requestSources = [
      ...request.planningWindow.sourceRefs,
      ...request.productivityFactors.flatMap((factor) => factor.sourceRefs),
      ...request.safetyClearances.flatMap((clearance) => clearance.sourceRefs),
    ];
    requestSources.forEach((source, index) => {
      if (!sourceReferenceMatchesScope(source, request.tenantId, request.projectId)) {
        context.addIssue({
          code: "custom",
          message: "A5 request source is outside the request scope",
          path: ["sources", index],
        });
      }
    });
  });

export const a5EligibilityCheckCodeSchema = z.enum([
  "WORK_STATUS",
  "ACTIVITY_DATE_WINDOW",
  "CALENDAR",
  "PREDECESSOR",
  "INSPECTION",
  "MATERIAL_COVERAGE",
  "CREW_AVAILABILITY",
  "EQUIPMENT_AVAILABILITY",
  "ZONE_AVAILABILITY",
  "WEATHER",
  "OPEN_BLOCKER",
  "SAFETY_RESTRICTION",
]);

export const a5EligibilityCheckSchema = z
  .object({
    code: a5EligibilityCheckCodeSchema,
    status: z.enum(["PASS", "FAIL", "UNKNOWN"]),
    reasonCode: z.string().trim().min(1).max(100).nullable(),
    message: z.string().trim().min(1).max(1_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const a5EligibilityResultSchema = z
  .object({
    eligible: z.boolean(),
    checks: z.array(a5EligibilityCheckSchema).min(12).max(12),
    reasonCodes: z.array(z.string().trim().min(1).max(100)).max(100),
    selectedCrewId: contractIdentifierSchema.nullable(),
  })
  .strict();

export const a5PriorityResultSchema = z
  .object({
    rank: z.number().int().positive().nullable(),
    tuple: z
      .object({
        criticalPath: z.number().int().min(0).max(1),
        totalFloatWorkingDays: z.number().int(),
        milestoneDependency: z.number().int().min(0).max(1),
        downstreamUnlockCount: z.number().int().nonnegative(),
        bookedResourceOrMaterial: z.number().int().min(0).max(1),
        baselineSequence: z.number().int().nonnegative(),
        workItemId: contractIdentifierSchema,
      })
      .strict(),
  })
  .strict();

export const a5TargetBreakdownSchema = z
  .object({
    remainingQuantity: buildWatchSourceBackedQuantitySchema,
    crewCapacity: buildWatchSourceBackedQuantitySchema.nullable(),
    materialCapacity: buildWatchSourceBackedQuantitySchema.nullable(),
    equipmentCapacity: buildWatchSourceBackedQuantitySchema.nullable(),
    zoneCapacity: buildWatchSourceBackedQuantitySchema.nullable(),
  })
  .strict();

export const a5DailyTargetResultSchema = z
  .object({
    feasible: z.boolean(),
    targetQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    limitingFactor: z.enum([
      "REMAINING_QUANTITY",
      "CREW_PRODUCTIVITY",
      "MATERIAL_AVAILABILITY",
      "EQUIPMENT_CAPACITY",
      "ZONE_CAPACITY",
      "INSUFFICIENT_INFORMATION",
    ]),
    reasonCodes: z.array(z.string().trim().min(1).max(100)).max(100),
    breakdown: a5TargetBreakdownSchema,
  })
  .strict();

export const a5WorkItemDecisionSchema = z
  .object({
    workItemId: contractIdentifierSchema,
    selected: z.boolean(),
    eligibility: a5EligibilityResultSchema,
    priority: a5PriorityResultSchema,
    dailyTarget: a5DailyTargetResultSchema,
    diagnosticCodes: z.array(z.string().trim().min(1).max(100)).max(100),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const a5DailyPlanResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    resultType: z.literal("A5_DAILY_PLAN_RESULT"),
    requestId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    planDate: contractIsoDateSchema,
    deterministic: z.literal(true),
    llmRequired: z.literal(false),
    draft: dailyWorkPlanDraftV1Schema.nullable(),
    decisions: z.array(a5WorkItemDecisionSchema).min(1).max(100_000),
    omittedCriticalWorkItemIds: z.array(contractIdentifierSchema).max(100_000),
    generatedAt: contractIsoDateTimeSchema,
  })
  .strict();

export type A5DailyPlanRequestV1 = z.infer<typeof a5DailyPlanRequestV1Schema>;
export type A5DailyPlanRequestV1Input = z.input<typeof a5DailyPlanRequestV1Schema>;
export type A5EligibilityCheck = z.infer<typeof a5EligibilityCheckSchema>;
export type A5EligibilityResult = z.infer<typeof a5EligibilityResultSchema>;
export type A5PriorityResult = z.infer<typeof a5PriorityResultSchema>;
export type A5DailyTargetResult = z.infer<typeof a5DailyTargetResultSchema>;
export type A5WorkItemDecision = z.infer<typeof a5WorkItemDecisionSchema>;
export type A5DailyPlanResultV1 = z.infer<typeof a5DailyPlanResultV1Schema>;
