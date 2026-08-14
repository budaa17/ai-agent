import { z } from "zod";
import {
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
  contractValidationIssueSchema,
} from "../common.js";
import {
  buildWatchCanonicalUnitSchema,
  buildWatchImmutableVersionMetadataSchema,
  buildWatchReviewDecisionSchema,
  buildWatchSourceBackedQuantitySchema,
  buildWatchSourceReferenceSchema,
  hasUniqueContractIds,
  sourceReferenceMatchesScope,
} from "../buildwatch-v2-common.js";

export const dailyWorkPlanStatusSchema = z.enum([
  "DRAFT",
  "REVIEW_REQUIRED",
  "APPROVED",
  "IN_PROGRESS",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
  "SUPERSEDED",
]);

export const dailyWorkPlanItemStatusSchema = z.enum([
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "BLOCKED",
  "UNVERIFIED",
  "CANCELLED",
]);

export const dailyPlanResourceTypeSchema = z.enum(["CREW", "EQUIPMENT", "ZONE"]);

export const dailyPlanResourceAssignmentSchema = z
  .object({
    assignmentId: contractIdentifierSchema,
    resourceType: dailyPlanResourceTypeSchema,
    resourceId: contractIdentifierSchema,
    plannedStartTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    plannedEndTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    capacity: buildWatchSourceBackedQuantitySchema.nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((assignment, context) => {
    if (assignment.plannedEndTime <= assignment.plannedStartTime) {
      context.addIssue({
        code: "custom",
        message: "Resource assignment end time must be after its start",
        path: ["plannedEndTime"],
      });
    }
  });

export const dailyPlanMaterialRequirementSchema = z
  .object({
    requirementId: contractIdentifierSchema,
    materialId: contractIdentifierSchema,
    requiredQuantity: buildWatchSourceBackedQuantitySchema,
    availableQuantity: buildWatchSourceBackedQuantitySchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((material, context) => {
    if (material.requiredQuantity.unit !== material.availableQuantity.unit) {
      context.addIssue({
        code: "custom",
        message: "Required and available material quantities must use the same unit",
        path: ["availableQuantity", "unit"],
      });
    }
  });

export const dailyPlanPreconditionTypeSchema = z.enum([
  "PREDECESSOR",
  "INSPECTION",
  "MATERIAL",
  "WEATHER",
  "BLOCKER",
  "SAFETY",
  "ACCESS",
]);

export const dailyPlanPreconditionSchema = z
  .object({
    preconditionId: contractIdentifierSchema,
    type: dailyPlanPreconditionTypeSchema,
    referenceId: contractIdentifierSchema,
    status: z.enum(["SATISFIED", "UNSATISFIED", "UNKNOWN"]),
    message: z.string().trim().min(1).max(1_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const dailyPlanLimitingFactorSchema = z.enum([
  "REMAINING_QUANTITY",
  "CREW_PRODUCTIVITY",
  "MATERIAL_AVAILABILITY",
  "EQUIPMENT_CAPACITY",
  "ZONE_CAPACITY",
  "NONE",
  "INSUFFICIENT_INFORMATION",
]);

export const dailyPlanFeasibilitySchema = z
  .object({
    eligible: z.boolean(),
    feasible: z.boolean(),
    targetQuantity: buildWatchSourceBackedQuantitySchema.nullable(),
    limitingFactor: dailyPlanLimitingFactorSchema,
    reasonCodes: z.array(z.string().trim().min(1).max(100)).max(100),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((feasibility, context) => {
    if (
      feasibility.feasible &&
      (!feasibility.eligible ||
        feasibility.targetQuantity === null ||
        feasibility.limitingFactor === "INSUFFICIENT_INFORMATION")
    ) {
      context.addIssue({
        code: "custom",
        message: "A feasible item must be eligible and have a calculated target",
        path: ["feasible"],
      });
    }

    if (!feasibility.feasible && feasibility.reasonCodes.length === 0) {
      context.addIssue({
        code: "custom",
        message: "An infeasible item requires a reason code",
        path: ["reasonCodes"],
      });
    }
  });

export const dailyPlanConflictTypeSchema = z.enum([
  "CREW_DOUBLE_BOOKING",
  "EQUIPMENT_DOUBLE_BOOKING",
  "ZONE_OVER_CAPACITY",
  "MATERIAL_SHORTAGE",
  "PRECONDITION_UNSATISFIED",
  "WEATHER_RESTRICTION",
  "SAFETY_RESTRICTION",
  "CALENDAR_CONFLICT",
  "INVALID_SHIFT",
  "INSPECTION_MISSING",
  "OPEN_BLOCKER",
]);

export const dailyPlanConflictSchema = z
  .object({
    conflictId: contractIdentifierSchema,
    type: dailyPlanConflictTypeSchema,
    severity: z.enum(["ERROR", "WARNING"]),
    planItemIds: z.array(contractIdentifierSchema).min(1).max(100),
    resourceId: contractIdentifierSchema.nullable(),
    message: z.string().trim().min(1).max(1_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((conflict, context) => {
    if (!hasUniqueContractIds(conflict.planItemIds)) {
      context.addIssue({
        code: "custom",
        message: "Conflict plan-item references must be unique",
        path: ["planItemIds"],
      });
    }

    if (
      [
        "CREW_DOUBLE_BOOKING",
        "EQUIPMENT_DOUBLE_BOOKING",
        "ZONE_OVER_CAPACITY",
        "MATERIAL_SHORTAGE",
      ].includes(conflict.type) &&
      conflict.resourceId === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Resource conflicts require a resource reference",
        path: ["resourceId"],
      });
    }
  });

export const dailyWorkPlanItemSchema = z
  .object({
    planItemId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    sourceScheduleActivityId: contractIdentifierSchema,
    workCode: z.string().trim().min(1).max(200),
    workName: z.string().trim().min(1).max(500),
    zoneCode: z.string().trim().min(1).max(200).nullable(),
    unit: buildWatchCanonicalUnitSchema,
    plannedQuantity: buildWatchSourceBackedQuantitySchema,
    plannedStartTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    plannedEndTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    priorityRank: z.number().int().positive().max(1_000_000),
    criticality: z.enum(["CRITICAL", "NEAR_CRITICAL", "NON_CRITICAL"]),
    status: z.literal("PLANNED"),
    resources: z.array(dailyPlanResourceAssignmentSchema).max(1_000),
    materials: z.array(dailyPlanMaterialRequirementSchema).max(10_000),
    preconditions: z.array(dailyPlanPreconditionSchema).max(1_000),
    evidenceRuleId: contractIdentifierSchema,
    feasibility: dailyPlanFeasibilitySchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.plannedQuantity.unit !== item.unit) {
      context.addIssue({
        code: "custom",
        message: "Plan item unit must match its planned quantity unit",
        path: ["unit"],
      });
    }

    if (item.plannedEndTime <= item.plannedStartTime) {
      context.addIssue({
        code: "custom",
        message: "Plan item end time must be after its start",
        path: ["plannedEndTime"],
      });
    }

    if (
      item.feasibility.targetQuantity !== null &&
      item.feasibility.targetQuantity.unit !== item.unit
    ) {
      context.addIssue({
        code: "custom",
        message: "Feasibility target must use the plan-item unit",
        path: ["feasibility", "targetQuantity", "unit"],
      });
    }

    if (
      !hasUniqueContractIds(item.resources.map((assignment) => assignment.assignmentId)) ||
      !hasUniqueContractIds(item.materials.map((material) => material.requirementId)) ||
      !hasUniqueContractIds(item.preconditions.map((precondition) => precondition.preconditionId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Plan-item resource, material, and precondition identifiers must be unique",
        path: ["resources"],
      });
    }
  });

export const dailyWorkPlanContentSchema = z
  .object({
    planDate: contractIsoDateSchema,
    timezone: z.string().trim().min(1).max(100),
    baselineVersionId: contractIdentifierSchema,
    scheduleVersionId: contractIdentifierSchema,
    operationalSnapshotId: contractIdentifierSchema,
    items: z.array(dailyWorkPlanItemSchema).min(1).max(100_000),
    conflicts: z.array(dailyPlanConflictSchema).max(100_000),
  })
  .strict()
  .superRefine((content, context) => {
    if (
      !hasUniqueContractIds(content.items.map((item) => item.planItemId)) ||
      !hasUniqueContractIds(content.items.map((item) => item.workItemId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Daily plan item and work-item identifiers must be unique",
        path: ["items"],
      });
    }

    if (!hasUniqueContractIds(content.conflicts.map((conflict) => conflict.conflictId))) {
      context.addIssue({
        code: "custom",
        message: "Daily plan conflict identifiers must be unique",
        path: ["conflicts"],
      });
    }

    const itemIds = new Set(content.items.map((item) => item.planItemId));
    content.conflicts.forEach((conflict, conflictIndex) => {
      conflict.planItemIds.forEach((planItemId, itemIndex) => {
        if (!itemIds.has(planItemId)) {
          context.addIssue({
            code: "custom",
            message: "Conflict references a plan item outside the daily plan",
            path: ["conflicts", conflictIndex, "planItemIds", itemIndex],
          });
        }
      });
    });
  });

function planSources(content: z.infer<typeof dailyWorkPlanContentSchema>) {
  return [
    ...content.items.flatMap((item) => [
      ...item.plannedQuantity.sourceRefs,
      ...item.resources.flatMap((assignment) => [
        ...(assignment.capacity?.sourceRefs ?? []),
        ...assignment.sourceRefs,
      ]),
      ...item.materials.flatMap((material) => [
        ...material.requiredQuantity.sourceRefs,
        ...material.availableQuantity.sourceRefs,
        ...material.sourceRefs,
      ]),
      ...item.preconditions.flatMap((precondition) => precondition.sourceRefs),
      ...(item.feasibility.targetQuantity?.sourceRefs ?? []),
      ...item.feasibility.sourceRefs,
      ...item.sourceRefs,
    ]),
    ...content.conflicts.flatMap((conflict) => conflict.sourceRefs),
  ];
}

function addPlanScopeIssues(
  content: z.infer<typeof dailyWorkPlanContentSchema>,
  tenantId: string,
  projectId: string,
  context: z.RefinementCtx,
) {
  planSources(content).forEach((source, index) => {
    if (!sourceReferenceMatchesScope(source, tenantId, projectId)) {
      context.addIssue({
        code: "custom",
        message: "Daily-plan source is outside the aggregate scope",
        path: ["content", "sources", index],
      });
    }
  });
}

export const dailyWorkPlanDraftV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    draftType: z.literal("DAILY_WORK_PLAN"),
    draftId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    status: z.enum(["DRAFT", "REVIEW_REQUIRED"]),
    content: dailyWorkPlanContentSchema,
    validationIssues: z.array(contractValidationIssueSchema).max(1_000),
    requiresHumanReview: z.literal(true),
    generatedAt: contractIsoDateTimeSchema,
    generatedBy: z.literal("A5"),
  })
  .strict()
  .superRefine((draft, context) => {
    addPlanScopeIssues(draft.content, draft.tenantId, draft.projectId, context);

    const hasBlockingIssue =
      draft.validationIssues.some((issue) => issue.severity === "ERROR") ||
      draft.content.conflicts.some((conflict) => conflict.severity === "ERROR") ||
      draft.content.items.some((item) => !item.feasibility.feasible);

    if (hasBlockingIssue && draft.status === "REVIEW_REQUIRED") {
      context.addIssue({
        code: "custom",
        message: "A daily plan with blocking issues cannot be submitted for approval",
        path: ["status"],
      });
    }
  });

export const approvedDailyWorkPlanVersionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    versionType: z.literal("APPROVED_DAILY_WORK_PLAN"),
    dailyWorkPlanVersionId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    status: z.literal("APPROVED"),
    content: dailyWorkPlanContentSchema,
    metadata: buildWatchImmutableVersionMetadataSchema,
  })
  .strict()
  .superRefine((version, context) => {
    addPlanScopeIssues(version.content, version.tenantId, version.projectId, context);

    if (
      version.content.conflicts.some((conflict) => conflict.severity === "ERROR") ||
      version.content.items.some((item) => !item.feasibility.feasible)
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved daily plans cannot contain errors or infeasible items",
        path: ["content"],
      });
    }
  });

export const approvedDailyWorkPlanCommandV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    commandType: z.literal("APPROVE_DAILY_WORK_PLAN"),
    commandId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    draftId: contractIdentifierSchema,
    approvedVersion: approvedDailyWorkPlanVersionV1Schema,
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
        message: "Approved daily-plan scope must match command scope",
        path: ["approvedVersion"],
      });
    }

    if (
      command.decision.action !== "APPROVE" ||
      command.decision.reviewerRole !== "PROJECT_MANAGER"
    ) {
      context.addIssue({
        code: "custom",
        message: "Daily plan approval requires a project-manager decision",
        path: ["decision"],
      });
    }
  });

const allowedDailyPlanTransitions: Readonly<
  Record<
    z.infer<typeof dailyWorkPlanStatusSchema>,
    readonly z.infer<typeof dailyWorkPlanStatusSchema>[]
  >
> = {
  DRAFT: ["REVIEW_REQUIRED", "CANCELLED"],
  REVIEW_REQUIRED: ["DRAFT", "APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["IN_PROGRESS", "SUPERSEDED", "CANCELLED"],
  IN_PROGRESS: ["CLOSED", "CANCELLED"],
  CLOSED: [],
  REJECTED: ["DRAFT"],
  CANCELLED: [],
  SUPERSEDED: [],
};

export const dailyWorkPlanStateTransitionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    transitionType: z.literal("DAILY_WORK_PLAN_STATE"),
    transitionId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    dailyWorkPlanVersionId: contractIdentifierSchema,
    fromStatus: dailyWorkPlanStatusSchema,
    toStatus: dailyWorkPlanStatusSchema,
    actorId: contractIdentifierSchema,
    actorRole: z.enum(["SITE_ENGINEER", "PROJECT_MANAGER", "SYSTEM"]),
    reason: z.string().trim().min(1).max(2_000).nullable(),
    transitionedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((transition, context) => {
    if (!allowedDailyPlanTransitions[transition.fromStatus].includes(transition.toStatus)) {
      context.addIssue({
        code: "custom",
        message: "Daily-work-plan state transition is not allowed",
        path: ["toStatus"],
      });
    }

    if (
      ["APPROVED", "REJECTED", "CANCELLED", "SUPERSEDED"].includes(transition.toStatus) &&
      transition.reason === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Approval, rejection, cancellation, and supersession require a reason",
        path: ["reason"],
      });
    }

    if (
      ["APPROVED", "REJECTED"].includes(transition.toStatus) &&
      transition.actorRole !== "PROJECT_MANAGER"
    ) {
      context.addIssue({
        code: "custom",
        message: "Only a project manager can approve or reject a daily plan",
        path: ["actorRole"],
      });
    }
  });

export type DailyWorkPlanDraftV1 = z.infer<typeof dailyWorkPlanDraftV1Schema>;
export type ApprovedDailyWorkPlanVersionV1 = z.infer<typeof approvedDailyWorkPlanVersionV1Schema>;
export type ApprovedDailyWorkPlanCommandV1 = z.infer<typeof approvedDailyWorkPlanCommandV1Schema>;
export type DailyWorkPlanStateTransitionV1 = z.infer<typeof dailyWorkPlanStateTransitionV1Schema>;
