import type {
  BuildWatchSourceReference,
  DailyWorkPlanDraftV1,
  OperationalPlanningSnapshotV1,
} from "../contracts/index.js";
import type { A5DailyPlanRequestV1 } from "./contracts.js";
import { dedupeSourceRefs, planningCalculationSource, timeRangesOverlap } from "./deterministic.js";

type PlanItem = DailyWorkPlanDraftV1["content"]["items"][number];
type Conflict = DailyWorkPlanDraftV1["content"]["conflicts"][number];

function conflict(
  request: A5DailyPlanRequestV1,
  suffix: string,
  type: Conflict["type"],
  planItemIds: string[],
  resourceId: string | null,
  message: string,
  sources: readonly BuildWatchSourceReference[],
): Conflict {
  return {
    conflictId: `a5-conflict-${request.planDate}-${suffix}`,
    type,
    severity: "ERROR",
    planItemIds: [...planItemIds].sort(),
    resourceId,
    message,
    sourceRefs: dedupeSourceRefs([
      ...sources,
      planningCalculationSource(request, `conflicts.${suffix}`),
    ]),
  };
}

function overlappingAssignments(items: readonly PlanItem[], resourceType: "CREW" | "EQUIPMENT") {
  const groups = new Map<
    string,
    Array<{ item: PlanItem; assignment: PlanItem["resources"][number] }>
  >();
  for (const item of items) {
    for (const assignment of item.resources.filter(
      (candidate) => candidate.resourceType === resourceType,
    )) {
      const values = groups.get(assignment.resourceId) ?? [];
      values.push({ item, assignment });
      groups.set(assignment.resourceId, values);
    }
  }
  return groups;
}

export function detectResourceConflicts(
  request: A5DailyPlanRequestV1,
  items: readonly PlanItem[],
): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const resourceType of ["CREW", "EQUIPMENT"] as const) {
    for (const [resourceId, assignments] of overlappingAssignments(items, resourceType)) {
      const conflicting = assignments.filter((left, leftIndex) =>
        assignments.some(
          (right, rightIndex) =>
            leftIndex !== rightIndex &&
            timeRangesOverlap(
              left.assignment.plannedStartTime,
              left.assignment.plannedEndTime,
              right.assignment.plannedStartTime,
              right.assignment.plannedEndTime,
            ),
        ),
      );
      const planItemIds = [...new Set(conflicting.map((value) => value.item.planItemId))];
      if (planItemIds.length < 2) {
        continue;
      }
      conflicts.push(
        conflict(
          request,
          `${resourceType.toLowerCase()}-${resourceId}`,
          resourceType === "CREW" ? "CREW_DOUBLE_BOOKING" : "EQUIPMENT_DOUBLE_BOOKING",
          planItemIds,
          resourceId,
          `${resourceType} ${resourceId} is assigned to overlapping work items.`,
          conflicting.flatMap((value) => value.assignment.sourceRefs),
        ),
      );
    }
  }

  const itemsByZone = new Map<string, PlanItem[]>();
  for (const item of items) {
    if (item.zoneCode === null) {
      continue;
    }
    const values = itemsByZone.get(item.zoneCode) ?? [];
    values.push(item);
    itemsByZone.set(item.zoneCode, values);
  }
  for (const [zoneCode, zoneItems] of itemsByZone) {
    const zone = request.operationalSnapshot.zones.find(
      (candidate) => candidate.zoneCode === zoneCode,
    );
    if (zone === undefined || zoneItems.length <= zone.maxConcurrentActivities) {
      continue;
    }
    const overlapping = zoneItems.filter((left, leftIndex) =>
      zoneItems.some(
        (right, rightIndex) =>
          leftIndex !== rightIndex &&
          timeRangesOverlap(
            left.plannedStartTime,
            left.plannedEndTime,
            right.plannedStartTime,
            right.plannedEndTime,
          ),
      ),
    );
    if (overlapping.length <= zone.maxConcurrentActivities) {
      continue;
    }
    conflicts.push(
      conflict(
        request,
        `zone-${zoneCode}`,
        "ZONE_OVER_CAPACITY",
        overlapping.map((item) => item.planItemId),
        zoneCode,
        `Zone ${zoneCode} exceeds its concurrent activity capacity.`,
        zone.sourceRefs,
      ),
    );
  }

  return conflicts.sort((left, right) => left.conflictId.localeCompare(right.conflictId));
}

export function sourceForWorkItemReason(
  snapshot: OperationalPlanningSnapshotV1,
  workItemId: string,
  reasonCode: string,
): BuildWatchSourceReference[] {
  const workItem = snapshot.workItems.find((item) => item.workItemId === workItemId);
  if (workItem === undefined) {
    return [];
  }
  if (reasonCode === "MATERIAL_SHORTAGE") {
    const materialIds = new Set(workItem.requiredMaterials.map((material) => material.materialId));
    return snapshot.materials
      .filter((material) => materialIds.has(material.materialId))
      .flatMap((material) => material.sourceRefs);
  }
  if (reasonCode.startsWith("INSPECTION")) {
    const inspectionIds = new Set(workItem.requiredInspectionIds);
    return snapshot.inspections
      .filter((inspection) => inspectionIds.has(inspection.inspectionId))
      .flatMap((inspection) => inspection.sourceRefs);
  }
  if (reasonCode === "WEATHER_RESTRICTION") {
    return snapshot.weatherConstraints.flatMap((weather) => weather.sourceRefs);
  }
  if (reasonCode === "APPROVED_BLOCKER" || reasonCode === "OPEN_BLOCKER") {
    return snapshot.blockers
      .filter((blocker) => blocker.workItemId === workItemId && blocker.isOpen)
      .flatMap((blocker) => blocker.sourceRefs);
  }
  return workItem.sourceRefs;
}

export function buildReasonConflict(
  request: A5DailyPlanRequestV1,
  item: PlanItem,
  reasonCode: string,
): Conflict | null {
  const mapping: Partial<Record<string, Conflict["type"]>> = {
    PREDECESSOR_UNFINISHED: "PRECONDITION_UNSATISFIED",
    INSPECTION_NOT_PASSED: "PRECONDITION_UNSATISFIED",
    INSPECTION_MISSING: "INSPECTION_MISSING",
    MATERIAL_SHORTAGE: "MATERIAL_SHORTAGE",
    WEATHER_RESTRICTION: "WEATHER_RESTRICTION",
    SAFETY_RESTRICTION: "SAFETY_RESTRICTION",
    CALENDAR_CONFLICT: "CALENDAR_CONFLICT",
    INVALID_SHIFT: "INVALID_SHIFT",
    APPROVED_BLOCKER: "OPEN_BLOCKER",
    OPEN_BLOCKER: "OPEN_BLOCKER",
  };
  const type = mapping[reasonCode];
  if (type === undefined) {
    return null;
  }
  const resourceId = type === "MATERIAL_SHORTAGE" ? (item.materials[0]?.materialId ?? null) : null;
  return conflict(
    request,
    `${item.workItemId}-${reasonCode.toLowerCase().replaceAll("_", "-")}`,
    type,
    [item.planItemId],
    resourceId,
    `${item.workCode}: ${reasonCode}`,
    sourceForWorkItemReason(request.operationalSnapshot, item.workItemId, reasonCode),
  );
}
