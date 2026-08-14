import type {
  BuildWatchSourceReference,
  DailyWorkPlanDraftV1,
  OperationalPlanningSnapshotV1,
} from "../contracts/index.js";
import {
  a5DailyPlanRequestV1Schema,
  a5DailyPlanResultV1Schema,
  type A5DailyPlanRequestV1,
  type A5DailyPlanRequestV1Input,
  type A5DailyPlanResultV1,
  type A5WorkItemDecision,
} from "./contracts.js";
import {
  dedupeSourceRefs,
  planningCalculationSource,
  sourceBackedQuantity,
} from "./deterministic.js";
import { evaluateWorkItemFeasibility } from "./feasibility.js";
import { assignStablePriorityRanks } from "./priority.js";
import { buildReasonConflict, detectResourceConflicts } from "./resource-conflicts.js";

type WorkItem = OperationalPlanningSnapshotV1["workItems"][number];
type PlanItem = DailyWorkPlanDraftV1["content"]["items"][number];

function selectedWorkItemIds(
  request: A5DailyPlanRequestV1,
  decisions: readonly A5WorkItemDecision[],
): Set<string> {
  if (request.selectionMode === "VALIDATE_REQUESTED") {
    return new Set(request.requestedWorkItemIds);
  }
  return new Set(
    decisions
      .filter((decision) => decision.eligibility.eligible && decision.dailyTarget.feasible)
      .slice(0, request.maxItems)
      .map((decision) => decision.workItemId),
  );
}

function checkStatus(
  decision: A5WorkItemDecision,
  code: A5WorkItemDecision["eligibility"]["checks"][number]["code"],
) {
  return decision.eligibility.checks.find((check) => check.code === code)!;
}

function buildPreconditions(
  request: A5DailyPlanRequestV1,
  workItem: WorkItem,
  decision: A5WorkItemDecision,
): PlanItem["preconditions"] {
  const values: PlanItem["preconditions"] = [];
  const add = (
    type: PlanItem["preconditions"][number]["type"],
    referenceId: string,
    status: "SATISFIED" | "UNSATISFIED" | "UNKNOWN",
    message: string,
    sources: readonly BuildWatchSourceReference[],
    suffix: string,
  ) => {
    values.push({
      preconditionId: `a5-precondition-${request.planDate}-${workItem.workItemId}-${suffix}`,
      type,
      referenceId,
      status,
      message,
      sourceRefs: dedupeSourceRefs(sources),
    });
  };
  for (const predecessorId of workItem.predecessorWorkItemIds) {
    const predecessor = request.operationalSnapshot.workItems.find(
      (candidate) => candidate.workItemId === predecessorId,
    );
    add(
      "PREDECESSOR",
      predecessorId,
      predecessor === undefined
        ? "UNKNOWN"
        : predecessor.status === "COMPLETED"
          ? "SATISFIED"
          : "UNSATISFIED",
      predecessor?.status === "COMPLETED"
        ? "Predecessor is completed."
        : "Predecessor is not completed.",
      predecessor?.sourceRefs ?? workItem.sourceRefs,
      `predecessor-${predecessorId}`,
    );
  }
  for (const inspectionId of workItem.requiredInspectionIds) {
    const inspection = request.operationalSnapshot.inspections.find(
      (candidate) => candidate.inspectionId === inspectionId,
    );
    add(
      "INSPECTION",
      inspectionId,
      inspection === undefined
        ? "UNKNOWN"
        : ["PASSED", "WAIVED"].includes(inspection.status)
          ? "SATISFIED"
          : "UNSATISFIED",
      inspection === undefined
        ? "Inspection evidence is missing."
        : `Inspection status is ${inspection.status}.`,
      inspection?.sourceRefs ?? workItem.sourceRefs,
      `inspection-${inspectionId}`,
    );
  }
  for (const material of workItem.requiredMaterials) {
    const inventory = request.operationalSnapshot.materials.find(
      (candidate) => candidate.materialId === material.materialId,
    );
    const coverage = checkStatus(decision, "MATERIAL_COVERAGE");
    add(
      "MATERIAL",
      material.materialId,
      coverage.status === "PASS"
        ? "SATISFIED"
        : coverage.status === "FAIL"
          ? "UNSATISFIED"
          : "UNKNOWN",
      coverage.message,
      inventory?.sourceRefs ?? material.quantity.sourceRefs,
      `material-${material.materialId}`,
    );
  }
  if (workItem.weatherRestrictions.length > 0) {
    const weather = checkStatus(decision, "WEATHER");
    add(
      "WEATHER",
      `weather-${request.planDate}`,
      weather.status === "PASS"
        ? "SATISFIED"
        : weather.status === "FAIL"
          ? "UNSATISFIED"
          : "UNKNOWN",
      weather.message,
      weather.sourceRefs,
      "weather",
    );
  }
  for (const blocker of request.operationalSnapshot.blockers.filter(
    (candidate) => candidate.workItemId === workItem.workItemId && candidate.isOpen,
  )) {
    add(
      "BLOCKER",
      blocker.blockerId,
      "UNSATISFIED",
      "Open blocker prevents execution.",
      blocker.sourceRefs,
      `blocker-${blocker.blockerId}`,
    );
  }
  for (const restriction of workItem.safetyRestrictions) {
    const clearance = request.safetyClearances.find((candidate) => candidate.code === restriction);
    add(
      "SAFETY",
      restriction,
      clearance === undefined ? "UNKNOWN" : clearance.satisfied ? "SATISFIED" : "UNSATISFIED",
      clearance?.satisfied
        ? "Safety clearance is approved."
        : "Safety clearance is absent or not approved.",
      clearance?.sourceRefs ?? workItem.sourceRefs,
      `safety-${restriction}`,
    );
  }
  return values;
}

function buildPlanItem(
  request: A5DailyPlanRequestV1,
  workItem: WorkItem,
  decision: A5WorkItemDecision,
  planPriorityRank: number,
): PlanItem {
  const target = decision.dailyTarget.targetQuantity;
  const plannedStartTime =
    request.operationalSnapshot.crews.find(
      (crew) => crew.crewId === decision.eligibility.selectedCrewId,
    )?.shiftStart ?? request.planningWindow.startTime;
  const plannedEndTime =
    request.operationalSnapshot.crews.find(
      (crew) => crew.crewId === decision.eligibility.selectedCrewId,
    )?.shiftEnd ?? request.planningWindow.endTime;
  const calculationSource = planningCalculationSource(request, `workItems.${workItem.workItemId}`);
  const resources: PlanItem["resources"] = [];
  const crew = request.operationalSnapshot.crews.find(
    (candidate) => candidate.crewId === decision.eligibility.selectedCrewId,
  );
  if (crew !== undefined) {
    resources.push({
      assignmentId: `a5-assignment-${request.planDate}-${workItem.workItemId}-crew`,
      resourceType: "CREW",
      resourceId: crew.crewId,
      plannedStartTime,
      plannedEndTime,
      capacity: crew.productivityPerShift,
      sourceRefs: crew.sourceRefs,
    });
  }
  for (const equipmentId of workItem.requiredEquipmentIds) {
    const equipment = request.operationalSnapshot.equipment.find(
      (candidate) => candidate.equipmentId === equipmentId,
    );
    if (equipment !== undefined) {
      resources.push({
        assignmentId: `a5-assignment-${request.planDate}-${workItem.workItemId}-${equipmentId}`,
        resourceType: "EQUIPMENT",
        resourceId: equipmentId,
        plannedStartTime,
        plannedEndTime,
        capacity: equipment.capacityPerShift,
        sourceRefs: equipment.sourceRefs,
      });
    }
  }
  if (workItem.zoneCode !== null) {
    const zone = request.operationalSnapshot.zones.find(
      (candidate) => candidate.zoneCode === workItem.zoneCode,
    );
    if (zone !== undefined) {
      resources.push({
        assignmentId: `a5-assignment-${request.planDate}-${workItem.workItemId}-zone`,
        resourceType: "ZONE",
        resourceId: zone.zoneCode,
        plannedStartTime,
        plannedEndTime,
        capacity: null,
        sourceRefs: zone.sourceRefs,
      });
    }
  }

  const materials: PlanItem["materials"] = workItem.requiredMaterials.flatMap((requirement) => {
    const inventory = request.operationalSnapshot.materials.find(
      (candidate) => candidate.materialId === requirement.materialId,
    );
    if (inventory === undefined) {
      return [];
    }
    const dailyRequired =
      target === null
        ? 0
        : (Number(requirement.quantity.value) / Number(workItem.plannedQuantity.value)) *
          Number(target.value);
    return [
      {
        requirementId: `a5-material-${request.planDate}-${workItem.workItemId}-${requirement.materialId}`,
        materialId: requirement.materialId,
        requiredQuantity: sourceBackedQuantity(dailyRequired, requirement.quantity.unit, [
          ...requirement.quantity.sourceRefs,
          calculationSource,
        ]),
        availableQuantity: sourceBackedQuantity(
          Math.max(
            0,
            Number(inventory.availableQuantity.value) - Number(inventory.reservedQuantity.value),
          ),
          inventory.availableQuantity.unit,
          [...inventory.availableQuantity.sourceRefs, ...inventory.reservedQuantity.sourceRefs],
        ),
        sourceRefs: inventory.sourceRefs,
      },
    ];
  });
  const feasibilitySources = dedupeSourceRefs([...decision.sourceRefs, calculationSource]);
  return {
    planItemId: `a5-plan-item-${request.planDate}-${workItem.workItemId}`,
    workItemId: workItem.workItemId,
    sourceScheduleActivityId: workItem.activityId,
    workCode: workItem.code,
    workName: workItem.name,
    zoneCode: workItem.zoneCode,
    unit: workItem.unit,
    plannedQuantity: target ?? sourceBackedQuantity(0, workItem.unit, feasibilitySources),
    plannedStartTime,
    plannedEndTime,
    priorityRank: planPriorityRank,
    criticality: workItem.isCritical
      ? "CRITICAL"
      : workItem.totalFloatWorkingDays <= 3
        ? "NEAR_CRITICAL"
        : "NON_CRITICAL",
    status: "PLANNED",
    resources,
    materials,
    preconditions: buildPreconditions(request, workItem, decision),
    evidenceRuleId: request.evidenceRuleIdsByWorkClass[workItem.workClassCode]!,
    feasibility: {
      eligible: decision.eligibility.eligible,
      feasible: decision.dailyTarget.feasible,
      targetQuantity: target,
      limitingFactor: decision.dailyTarget.limitingFactor,
      reasonCodes: decision.diagnosticCodes,
      sourceRefs: feasibilitySources,
    },
    sourceRefs: feasibilitySources,
  };
}

export function generateA5DailyPlan(input: A5DailyPlanRequestV1Input): A5DailyPlanResultV1 {
  const request = a5DailyPlanRequestV1Schema.parse(input);
  const ranked = assignStablePriorityRanks(
    request.operationalSnapshot.workItems.map((workItem) =>
      evaluateWorkItemFeasibility(request, workItem),
    ),
  );
  const selectedIds = selectedWorkItemIds(request, ranked);
  const decisions = ranked.map((decision) => ({
    ...decision,
    selected: selectedIds.has(decision.workItemId),
  }));
  const workItemsById = new Map(
    request.operationalSnapshot.workItems.map((workItem) => [workItem.workItemId, workItem]),
  );
  const selectedDecisions = decisions.filter((decision) => decision.selected);
  const items = selectedDecisions.map((decision, index) =>
    buildPlanItem(request, workItemsById.get(decision.workItemId)!, decision, index + 1),
  );
  const omittedCriticalWorkItemIds = decisions
    .filter(
      (decision) =>
        !decision.selected &&
        decision.eligibility.eligible &&
        decision.dailyTarget.feasible &&
        workItemsById.get(decision.workItemId)!.isCritical,
    )
    .map((decision) => decision.workItemId)
    .sort();

  let draft: DailyWorkPlanDraftV1 | null = null;
  if (items.length > 0) {
    const reasonConflicts = items.flatMap((item) => {
      const decision = decisions.find((candidate) => candidate.workItemId === item.workItemId)!;
      return decision.diagnosticCodes
        .map((reason) => buildReasonConflict(request, item, reason))
        .filter((value): value is NonNullable<typeof value> => value !== null);
    });
    const conflicts = [...reasonConflicts, ...detectResourceConflicts(request, items)].sort(
      (left, right) => left.conflictId.localeCompare(right.conflictId),
    );
    const validationIssues: DailyWorkPlanDraftV1["validationIssues"] = [];
    for (const decision of selectedDecisions) {
      for (const reasonCode of decision.diagnosticCodes) {
        validationIssues.push({
          code: reasonCode,
          severity: reasonCode === "PARTIAL_TARGET" ? "WARNING" : "ERROR",
          fieldPaths: [`content.items.${decision.workItemId}`],
          message: `${decision.workItemId}: ${reasonCode}`,
          deterministic: true,
        });
      }
    }
    for (const workItemId of omittedCriticalWorkItemIds) {
      validationIssues.push({
        code: "CRITICAL_WORK_OMITTED",
        severity: "WARNING",
        fieldPaths: ["content.items"],
        message: `Eligible critical work item ${workItemId} is omitted.`,
        deterministic: true,
      });
    }
    const blocking =
      items.some((item) => !item.feasibility.feasible) ||
      conflicts.some((item) => item.severity === "ERROR") ||
      validationIssues.some((issue) => issue.severity === "ERROR");
    draft = {
      schemaVersion: 1,
      draftType: "DAILY_WORK_PLAN",
      draftId: `a5-daily-plan-${request.projectId}-${request.planDate}`,
      tenantId: request.tenantId,
      projectId: request.projectId,
      status: blocking ? "DRAFT" : "REVIEW_REQUIRED",
      content: {
        planDate: request.planDate,
        timezone: request.timezone,
        baselineVersionId: request.operationalSnapshot.baselineVersionId,
        scheduleVersionId: request.operationalSnapshot.scheduleVersionId,
        operationalSnapshotId: request.operationalSnapshot.snapshotId,
        items,
        conflicts,
      },
      validationIssues,
      requiresHumanReview: true,
      generatedAt: request.generatedAt,
      generatedBy: "A5",
    };
  }

  return a5DailyPlanResultV1Schema.parse({
    schemaVersion: 1,
    resultType: "A5_DAILY_PLAN_RESULT",
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    tenantId: request.tenantId,
    projectId: request.projectId,
    planDate: request.planDate,
    deterministic: true,
    llmRequired: false,
    draft,
    decisions,
    omittedCriticalWorkItemIds,
    generatedAt: request.generatedAt,
  });
}
