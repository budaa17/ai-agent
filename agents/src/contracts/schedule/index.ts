import { z } from "zod";
import {
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
  contractMoneySchema,
  contractValidationIssueSchema,
} from "../common.js";
import {
  buildWatchCanonicalUnitSchema,
  buildWatchCatalogVersionReferenceSchema,
  buildWatchDraftStatusSchema,
  buildWatchImmutableVersionMetadataSchema,
  buildWatchPolicyVersionSchema,
  buildWatchReviewDecisionSchema,
  buildWatchSourceBackedQuantitySchema,
  buildWatchSourceReferenceSchema,
  catalogReferenceMatchesScope,
  hasUniqueContractIds,
  sourceReferenceMatchesScope,
} from "../buildwatch-v2-common.js";
import {
  snapshotDependencyTypeSchema,
  snapshotWorkPrioritySchema,
} from "../project-analysis-snapshot.js";

export const operationalCalendarVersionSchema = z
  .object({
    calendarVersionId: contractIdentifierSchema,
    timezone: z.string().trim().min(1).max(100),
    workingWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    workHoursPerDay: z.number().finite().positive().max(24),
    holidays: z.array(contractIsoDateSchema).max(3_660),
    effectiveFrom: contractIsoDateSchema,
    effectiveTo: contractIsoDateSchema.nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
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

    if (calendar.effectiveTo !== null && calendar.effectiveTo < calendar.effectiveFrom) {
      context.addIssue({
        code: "custom",
        message: "Calendar effective end cannot precede its start",
        path: ["effectiveTo"],
      });
    }
  });

export const scheduleActivityStatusSchema = z.enum([
  "NOT_STARTED",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
]);

export const scheduleResourceRequirementSchema = z
  .object({
    requirementId: contractIdentifierSchema,
    resourceType: z.enum(["CREW", "EQUIPMENT"]),
    resourceClassCode: z.string().trim().min(1).max(200),
    count: z.number().int().positive().max(100_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const baselineScheduleActivitySchema = z
  .object({
    activityId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    wbsCode: z.string().trim().min(1).max(200).optional(),
    parentWbsCode: z.string().trim().min(1).max(200).nullable().optional(),
    code: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(500),
    zoneCode: z.string().trim().min(1).max(200).nullable(),
    unit: buildWatchCanonicalUnitSchema,
    plannedQuantity: buildWatchSourceBackedQuantitySchema,
    durationWorkingDays: z.number().int().positive().max(100_000),
    plannedStart: contractIsoDateSchema,
    plannedEnd: contractIsoDateSchema,
    priority: snapshotWorkPrioritySchema,
    isCritical: z.boolean(),
    totalFloatWorkingDays: z.number().int().min(-100_000).max(100_000),
    contractMilestone: z.boolean(),
    productivityVersion: buildWatchCatalogVersionReferenceSchema.optional(),
    resourceRequirements: z.array(scheduleResourceRequirementSchema).max(1_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((activity, context) => {
    if (activity.plannedQuantity.unit !== activity.unit) {
      context.addIssue({
        code: "custom",
        message: "Schedule activity unit must match its planned quantity unit",
        path: ["unit"],
      });
    }

    if (activity.plannedEnd < activity.plannedStart) {
      context.addIssue({
        code: "custom",
        message: "Schedule activity end cannot precede its start",
        path: ["plannedEnd"],
      });
    }

    if (
      !hasUniqueContractIds(
        activity.resourceRequirements.map((requirement) => requirement.requirementId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Schedule resource requirement identifiers must be unique",
        path: ["resourceRequirements"],
      });
    }

    if (
      activity.productivityVersion !== undefined &&
      activity.productivityVersion.catalogType !== "PRODUCTIVITY"
    ) {
      context.addIssue({
        code: "custom",
        message: "Schedule activity requires a productivity version",
        path: ["productivityVersion", "catalogType"],
      });
    }
  });

export const baselineScheduleDependencySchema = z
  .object({
    dependencyId: contractIdentifierSchema,
    predecessorActivityId: contractIdentifierSchema,
    successorActivityId: contractIdentifierSchema,
    type: snapshotDependencyTypeSchema,
    lagWorkingDays: z.number().int().min(-10_000).max(10_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((dependency, context) => {
    if (dependency.predecessorActivityId === dependency.successorActivityId) {
      context.addIssue({
        code: "custom",
        message: "A schedule activity cannot depend on itself",
        path: ["successorActivityId"],
      });
    }
  });

export const baselineContentSchema = z
  .object({
    quantityTakeoffVersionId: contractIdentifierSchema,
    estimateVersionId: contractIdentifierSchema,
    scheduleVersionId: contractIdentifierSchema,
    plannedStart: contractIsoDateSchema,
    plannedFinish: contractIsoDateSchema,
    budgetMnt: contractMoneySchema,
    calendar: operationalCalendarVersionSchema,
    activities: z.array(baselineScheduleActivitySchema).min(1).max(100_000),
    dependencies: z.array(baselineScheduleDependencySchema).max(500_000),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.plannedFinish < content.plannedStart) {
      context.addIssue({
        code: "custom",
        message: "Baseline finish cannot precede its start",
        path: ["plannedFinish"],
      });
    }

    if (
      !hasUniqueContractIds(content.activities.map((activity) => activity.activityId)) ||
      !hasUniqueContractIds(content.activities.map((activity) => activity.workItemId)) ||
      !hasUniqueContractIds(content.activities.map((activity) => activity.code))
    ) {
      context.addIssue({
        code: "custom",
        message: "Schedule activity identifiers, work items, and codes must be unique",
        path: ["activities"],
      });
    }

    if (!hasUniqueContractIds(content.dependencies.map((dependency) => dependency.dependencyId))) {
      context.addIssue({
        code: "custom",
        message: "Schedule dependency identifiers must be unique",
        path: ["dependencies"],
      });
    }

    const activityIds = new Set(content.activities.map((activity) => activity.activityId));
    content.dependencies.forEach((dependency, index) => {
      if (!activityIds.has(dependency.predecessorActivityId)) {
        context.addIssue({
          code: "custom",
          message: "Schedule dependency predecessor is outside the baseline",
          path: ["dependencies", index, "predecessorActivityId"],
        });
      }
      if (!activityIds.has(dependency.successorActivityId)) {
        context.addIssue({
          code: "custom",
          message: "Schedule dependency successor is outside the baseline",
          path: ["dependencies", index, "successorActivityId"],
        });
      }
    });
  });

function baselineSources(content: z.infer<typeof baselineContentSchema>) {
  return [
    ...content.calendar.sourceRefs,
    ...content.activities.flatMap((activity) => [
      ...activity.plannedQuantity.sourceRefs,
      ...(activity.productivityVersion?.sourceRefs ?? []),
      ...activity.sourceRefs,
      ...activity.resourceRequirements.flatMap((requirement) => requirement.sourceRefs),
    ]),
    ...content.dependencies.flatMap((dependency) => dependency.sourceRefs),
  ];
}

function addBaselineScopeIssues(
  content: z.infer<typeof baselineContentSchema>,
  tenantId: string,
  projectId: string,
  context: z.RefinementCtx,
) {
  baselineSources(content).forEach((source, index) => {
    if (!sourceReferenceMatchesScope(source, tenantId, projectId)) {
      context.addIssue({
        code: "custom",
        message: "Baseline source is outside the aggregate scope",
        path: ["content", "sources", index],
      });
    }
  });

  content.activities.forEach((activity, index) => {
    if (activity.productivityVersion === undefined) {
      return;
    }
    if (!catalogReferenceMatchesScope(activity.productivityVersion, tenantId, projectId)) {
      context.addIssue({
        code: "custom",
        message: "Schedule productivity version is outside the aggregate scope",
        path: ["content", "activities", index, "productivityVersion"],
      });
    }
  });
}

export const baselineDraftV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    draftType: z.literal("BASELINE"),
    draftId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    status: buildWatchDraftStatusSchema,
    content: baselineContentSchema,
    validationIssues: z.array(contractValidationIssueSchema).max(1_000),
    requiresHumanReview: z.literal(true),
    createdAt: contractIsoDateTimeSchema,
    createdBy: contractIdentifierSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    addBaselineScopeIssues(draft.content, draft.tenantId, draft.projectId, context);

    if (
      draft.validationIssues.some((issue) => issue.severity === "ERROR") &&
      draft.status !== "NEEDS_CORRECTION"
    ) {
      context.addIssue({
        code: "custom",
        message: "Baseline drafts with errors require correction",
        path: ["status"],
      });
    }
  });

export const approvedBaselineVersionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    versionType: z.literal("APPROVED_BASELINE"),
    baselineVersionId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    status: z.literal("APPROVED"),
    content: baselineContentSchema,
    metadata: buildWatchImmutableVersionMetadataSchema,
  })
  .strict()
  .superRefine((version, context) => {
    addBaselineScopeIssues(version.content, version.tenantId, version.projectId, context);
  });

export const approvedBaselineCommandV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    commandType: z.literal("APPROVE_BASELINE"),
    commandId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    draftId: contractIdentifierSchema,
    approvedVersion: approvedBaselineVersionV1Schema,
    decision: buildWatchReviewDecisionSchema,
    changeReason: z.string().trim().min(1).max(2_000).nullable().optional(),
  })
  .strict()
  .superRefine((command, context) => {
    if (
      command.approvedVersion.tenantId !== command.tenantId ||
      command.approvedVersion.projectId !== command.projectId
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved baseline scope must match command scope",
        path: ["approvedVersion"],
      });
    }

    if (
      command.decision.action !== "APPROVE" ||
      command.decision.reviewerRole !== "PROJECT_MANAGER"
    ) {
      context.addIssue({
        code: "custom",
        message: "Baseline approval requires a project-manager approval decision",
        path: ["decision"],
      });
    }

    if (
      command.approvedVersion.metadata.supersedesVersionId !== null &&
      (command.changeReason ?? null) === null
    ) {
      context.addIssue({
        code: "custom",
        message: "A superseding baseline version requires a change reason",
        path: ["changeReason"],
      });
    }

    if (
      command.approvedVersion.metadata.supersedesVersionId === null &&
      (command.changeReason ?? null) !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "An initial baseline version cannot have a change reason",
        path: ["changeReason"],
      });
    }
  });

export const operationalWorkItemSchema = z
  .object({
    workItemId: contractIdentifierSchema,
    activityId: contractIdentifierSchema,
    code: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(500),
    zoneCode: z.string().trim().min(1).max(200).nullable(),
    workClassCode: z.string().trim().min(1).max(200),
    unit: buildWatchCanonicalUnitSchema,
    plannedQuantity: buildWatchSourceBackedQuantitySchema,
    remainingQuantity: buildWatchSourceBackedQuantitySchema,
    status: scheduleActivityStatusSchema,
    priority: snapshotWorkPrioritySchema,
    isCritical: z.boolean(),
    totalFloatWorkingDays: z.number().int().min(-100_000).max(100_000),
    downstreamUnlockCount: z.number().int().nonnegative().max(100_000),
    contractMilestone: z.boolean(),
    plannedStart: contractIsoDateSchema,
    plannedFinish: contractIsoDateSchema,
    predecessorWorkItemIds: z.array(contractIdentifierSchema).max(10_000),
    requiredInspectionIds: z.array(contractIdentifierSchema).max(1_000),
    requiredCrewType: z.string().trim().min(1).max(200).nullable(),
    requiredEquipmentIds: z.array(contractIdentifierSchema).max(1_000),
    requiredMaterials: z
      .array(
        z
          .object({
            materialId: contractIdentifierSchema,
            quantity: buildWatchSourceBackedQuantitySchema,
          })
          .strict(),
      )
      .max(10_000),
    weatherRestrictions: z.array(z.string().trim().min(1).max(200)).max(100),
    safetyRestrictions: z.array(z.string().trim().min(1).max(500)).max(100),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((workItem, context) => {
    if (
      workItem.plannedQuantity.unit !== workItem.unit ||
      workItem.remainingQuantity.unit !== workItem.unit
    ) {
      context.addIssue({
        code: "custom",
        message: "Operational work-item quantities must use its canonical unit",
        path: ["remainingQuantity", "unit"],
      });
    }

    if (Number(workItem.remainingQuantity.value) > Number(workItem.plannedQuantity.value)) {
      context.addIssue({
        code: "custom",
        message: "Remaining quantity cannot exceed planned quantity",
        path: ["remainingQuantity", "value"],
      });
    }

    if (workItem.plannedFinish < workItem.plannedStart) {
      context.addIssue({
        code: "custom",
        message: "Work-item finish cannot precede its start",
        path: ["plannedFinish"],
      });
    }

    if (
      !hasUniqueContractIds(workItem.predecessorWorkItemIds) ||
      !hasUniqueContractIds(workItem.requiredInspectionIds) ||
      !hasUniqueContractIds(workItem.requiredEquipmentIds) ||
      !hasUniqueContractIds(workItem.requiredMaterials.map((material) => material.materialId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Operational work-item references must be unique",
        path: ["predecessorWorkItemIds"],
      });
    }
  });

export const operationalCrewAvailabilitySchema = z
  .object({
    crewId: contractIdentifierSchema,
    crewType: z.string().trim().min(1).max(200),
    headcount: z.number().int().positive().max(100_000),
    shiftStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    shiftEnd: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    productivityPerShift: buildWatchSourceBackedQuantitySchema,
    productivityVersion: buildWatchCatalogVersionReferenceSchema,
    availableFrom: contractIsoDateSchema,
    availableTo: contractIsoDateSchema,
    available: z.boolean(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((crew, context) => {
    if (crew.availableTo < crew.availableFrom) {
      context.addIssue({
        code: "custom",
        message: "Crew availability end cannot precede its start",
        path: ["availableTo"],
      });
    }

    if (crew.productivityVersion.catalogType !== "PRODUCTIVITY") {
      context.addIssue({
        code: "custom",
        message: "Crew productivity requires a productivity version",
        path: ["productivityVersion", "catalogType"],
      });
    }
  });

export const operationalEquipmentAvailabilitySchema = z
  .object({
    equipmentId: contractIdentifierSchema,
    equipmentType: z.string().trim().min(1).max(200),
    capacityPerShift: buildWatchSourceBackedQuantitySchema,
    availableFrom: contractIsoDateSchema,
    availableTo: contractIsoDateSchema,
    available: z.boolean(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((equipment, context) => {
    if (equipment.availableTo < equipment.availableFrom) {
      context.addIssue({
        code: "custom",
        message: "Equipment availability end cannot precede its start",
        path: ["availableTo"],
      });
    }
  });

export const operationalMaterialAvailabilitySchema = z
  .object({
    materialId: contractIdentifierSchema,
    availableQuantity: buildWatchSourceBackedQuantitySchema,
    reservedQuantity: buildWatchSourceBackedQuantitySchema,
    asOf: contractIsoDateTimeSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((material, context) => {
    if (material.availableQuantity.unit !== material.reservedQuantity.unit) {
      context.addIssue({
        code: "custom",
        message: "Available and reserved material quantities must use the same unit",
        path: ["reservedQuantity", "unit"],
      });
    }
  });

export const operationalZoneCapacitySchema = z
  .object({
    zoneCode: z.string().trim().min(1).max(200),
    maxConcurrentActivities: z.number().int().positive().max(10_000),
    available: z.boolean(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const operationalInspectionSchema = z
  .object({
    inspectionId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    code: z.string().trim().min(1).max(200),
    status: z.enum(["PENDING", "PASSED", "FAILED", "WAIVED"]),
    decidedAt: contractIsoDateTimeSchema.nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const operationalBlockerSchema = z
  .object({
    blockerId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    category: z.string().trim().min(1).max(100),
    isOpen: z.boolean(),
    approved: z.boolean(),
    startedOn: contractIsoDateSchema,
    resolvedOn: contractIsoDateSchema.nullable(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((blocker, context) => {
    if (blocker.resolvedOn !== null && blocker.resolvedOn < blocker.startedOn) {
      context.addIssue({
        code: "custom",
        message: "Blocker resolution cannot precede its start",
        path: ["resolvedOn"],
      });
    }
  });

export const operationalWeatherConstraintSchema = z
  .object({
    weatherConstraintId: contractIdentifierSchema,
    date: contractIsoDateSchema,
    weatherCode: z.string().trim().min(1).max(100),
    restrictedWorkClassCodes: z.array(z.string().trim().min(1).max(200)).max(10_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const operationalApprovedActualSchema = z
  .object({
    actualId: contractIdentifierSchema,
    workItemId: contractIdentifierSchema,
    reportDate: contractIsoDateSchema,
    approvedQuantity: buildWatchSourceBackedQuantitySchema,
    progressVerificationId: contractIdentifierSchema,
    approvedAt: contractIsoDateTimeSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const operationalPlanningSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotType: z.literal("OPERATIONAL_PLANNING"),
    snapshotId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    asOf: contractIsoDateTimeSchema,
    baselineVersionId: contractIdentifierSchema,
    scheduleVersionId: contractIdentifierSchema,
    policyVersion: buildWatchPolicyVersionSchema,
    calendar: operationalCalendarVersionSchema,
    workItems: z.array(operationalWorkItemSchema).min(1).max(100_000),
    crews: z.array(operationalCrewAvailabilitySchema).max(100_000),
    equipment: z.array(operationalEquipmentAvailabilitySchema).max(100_000),
    materials: z.array(operationalMaterialAvailabilitySchema).max(100_000),
    zones: z.array(operationalZoneCapacitySchema).max(100_000),
    inspections: z.array(operationalInspectionSchema).max(500_000),
    blockers: z.array(operationalBlockerSchema).max(500_000),
    weatherConstraints: z.array(operationalWeatherConstraintSchema).max(100_000),
    approvedActuals: z.array(operationalApprovedActualSchema).max(1_000_000),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const uniqueCollections: Array<{
      values: string[];
      path: string;
      message: string;
    }> = [
      {
        values: snapshot.workItems.map((workItem) => workItem.workItemId),
        path: "workItems",
        message: "Operational work-item identifiers must be unique",
      },
      {
        values: snapshot.crews.map((crew) => crew.crewId),
        path: "crews",
        message: "Crew identifiers must be unique",
      },
      {
        values: snapshot.equipment.map((equipment) => equipment.equipmentId),
        path: "equipment",
        message: "Equipment identifiers must be unique",
      },
      {
        values: snapshot.materials.map((material) => material.materialId),
        path: "materials",
        message: "Material identifiers must be unique",
      },
      {
        values: snapshot.zones.map((zone) => zone.zoneCode),
        path: "zones",
        message: "Zone codes must be unique",
      },
      {
        values: snapshot.inspections.map((inspection) => inspection.inspectionId),
        path: "inspections",
        message: "Inspection identifiers must be unique",
      },
      {
        values: snapshot.blockers.map((blocker) => blocker.blockerId),
        path: "blockers",
        message: "Blocker identifiers must be unique",
      },
      {
        values: snapshot.approvedActuals.map((actual) => actual.actualId),
        path: "approvedActuals",
        message: "Approved actual identifiers must be unique",
      },
    ];

    uniqueCollections.forEach(({ values, path, message }) => {
      if (!hasUniqueContractIds(values)) {
        context.addIssue({ code: "custom", message, path: [path] });
      }
    });

    const workItemIds = new Set(snapshot.workItems.map((workItem) => workItem.workItemId));
    const equipmentIds = new Set(snapshot.equipment.map((equipment) => equipment.equipmentId));
    const materialIds = new Set(snapshot.materials.map((material) => material.materialId));
    const inspectionIds = new Set(
      snapshot.inspections.map((inspection) => inspection.inspectionId),
    );

    snapshot.workItems.forEach((workItem, index) => {
      workItem.predecessorWorkItemIds.forEach((predecessorId, predecessorIndex) => {
        if (predecessorId === workItem.workItemId || !workItemIds.has(predecessorId)) {
          context.addIssue({
            code: "custom",
            message: "Work-item predecessor must reference another snapshot work item",
            path: ["workItems", index, "predecessorWorkItemIds", predecessorIndex],
          });
        }
      });

      workItem.requiredEquipmentIds.forEach((equipmentId, equipmentIndex) => {
        if (!equipmentIds.has(equipmentId)) {
          context.addIssue({
            code: "custom",
            message: "Required equipment is outside the operational snapshot",
            path: ["workItems", index, "requiredEquipmentIds", equipmentIndex],
          });
        }
      });

      workItem.requiredMaterials.forEach((material, materialIndex) => {
        if (!materialIds.has(material.materialId)) {
          context.addIssue({
            code: "custom",
            message: "Required material is outside the operational snapshot",
            path: ["workItems", index, "requiredMaterials", materialIndex, "materialId"],
          });
        }
      });

      workItem.requiredInspectionIds.forEach((inspectionId, inspectionIndex) => {
        if (!inspectionIds.has(inspectionId)) {
          context.addIssue({
            code: "custom",
            message: "Required inspection is outside the operational snapshot",
            path: ["workItems", index, "requiredInspectionIds", inspectionIndex],
          });
        }
      });
    });

    for (const [collectionName, entries] of [
      ["inspections", snapshot.inspections],
      ["blockers", snapshot.blockers],
      ["approvedActuals", snapshot.approvedActuals],
    ] as const) {
      entries.forEach((entry, index) => {
        if (!workItemIds.has(entry.workItemId)) {
          context.addIssue({
            code: "custom",
            message: `${collectionName} work item is outside the snapshot`,
            path: [collectionName, index, "workItemId"],
          });
        }
      });
    }

    const sources = [
      ...snapshot.calendar.sourceRefs,
      ...snapshot.workItems.flatMap((workItem) => [
        ...workItem.plannedQuantity.sourceRefs,
        ...workItem.remainingQuantity.sourceRefs,
        ...workItem.requiredMaterials.flatMap((material) => material.quantity.sourceRefs),
        ...workItem.sourceRefs,
      ]),
      ...snapshot.crews.flatMap((crew) => [
        ...crew.productivityPerShift.sourceRefs,
        ...crew.productivityVersion.sourceRefs,
        ...crew.sourceRefs,
      ]),
      ...snapshot.equipment.flatMap((equipment) => [
        ...equipment.capacityPerShift.sourceRefs,
        ...equipment.sourceRefs,
      ]),
      ...snapshot.materials.flatMap((material) => [
        ...material.availableQuantity.sourceRefs,
        ...material.reservedQuantity.sourceRefs,
        ...material.sourceRefs,
      ]),
      ...snapshot.zones.flatMap((zone) => zone.sourceRefs),
      ...snapshot.inspections.flatMap((inspection) => inspection.sourceRefs),
      ...snapshot.blockers.flatMap((blocker) => blocker.sourceRefs),
      ...snapshot.weatherConstraints.flatMap((weather) => weather.sourceRefs),
      ...snapshot.approvedActuals.flatMap((actual) => [
        ...actual.approvedQuantity.sourceRefs,
        ...actual.sourceRefs,
      ]),
    ];

    sources.forEach((source, index) => {
      if (!sourceReferenceMatchesScope(source, snapshot.tenantId, snapshot.projectId)) {
        context.addIssue({
          code: "custom",
          message: "Operational snapshot source is outside its tenant/project scope",
          path: ["sources", index],
        });
      }
    });
  });

export type BaselineDraftV1 = z.infer<typeof baselineDraftV1Schema>;
export type ApprovedBaselineVersionV1 = z.infer<typeof approvedBaselineVersionV1Schema>;
export type ApprovedBaselineCommandV1 = z.infer<typeof approvedBaselineCommandV1Schema>;
export type OperationalPlanningSnapshotV1 = z.infer<typeof operationalPlanningSnapshotV1Schema>;
