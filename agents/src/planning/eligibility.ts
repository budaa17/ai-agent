import type {
  BuildWatchSourceReference,
  OperationalPlanningSnapshotV1,
} from "../contracts/index.js";
import {
  a5EligibilityResultSchema,
  type A5DailyPlanRequestV1,
  type A5EligibilityCheck,
  type A5EligibilityResult,
} from "./contracts.js";
import { dedupeSourceRefs, isWorkingDate } from "./deterministic.js";

type WorkItem = OperationalPlanningSnapshotV1["workItems"][number];

function check(
  code: A5EligibilityCheck["code"],
  status: A5EligibilityCheck["status"],
  reasonCode: string | null,
  message: string,
  sources: readonly BuildWatchSourceReference[],
): A5EligibilityCheck {
  return {
    code,
    status,
    reasonCode,
    message,
    sourceRefs: dedupeSourceRefs(sources),
  };
}

function materialWorkCapacity(
  request: A5DailyPlanRequestV1,
  workItem: WorkItem,
): { status: "PASS" | "FAIL" | "UNKNOWN"; sources: BuildWatchSourceReference[] } {
  if (workItem.requiredMaterials.length === 0) {
    return { status: "PASS", sources: workItem.sourceRefs };
  }

  const capacities: number[] = [];
  const sources: BuildWatchSourceReference[] = [...workItem.sourceRefs];
  for (const requirement of workItem.requiredMaterials) {
    const inventory = request.operationalSnapshot.materials.find(
      (candidate) => candidate.materialId === requirement.materialId,
    );
    if (
      inventory === undefined ||
      inventory.availableQuantity.unit !== requirement.quantity.unit ||
      inventory.reservedQuantity.unit !== requirement.quantity.unit
    ) {
      return { status: "UNKNOWN", sources };
    }
    sources.push(...requirement.quantity.sourceRefs, ...inventory.sourceRefs);
    const planned = Number(workItem.plannedQuantity.value);
    const totalRequirement = Number(requirement.quantity.value);
    if (planned <= 0 || totalRequirement <= 0) {
      return { status: "UNKNOWN", sources };
    }
    const netAvailable = Math.max(
      0,
      Number(inventory.availableQuantity.value) - Number(inventory.reservedQuantity.value),
    );
    capacities.push(netAvailable / (totalRequirement / planned));
  }

  const capacity = Math.min(...capacities);
  return {
    status: capacity >= Number(request.minimumExecutableQuantity) ? "PASS" : "FAIL",
    sources,
  };
}

export function evaluateWorkItemEligibility(
  request: A5DailyPlanRequestV1,
  workItem: WorkItem,
): A5EligibilityResult {
  const snapshot = request.operationalSnapshot;
  const checks: A5EligibilityCheck[] = [];
  const statusPass =
    !["COMPLETED", "CANCELLED", "BLOCKED"].includes(workItem.status) &&
    Number(workItem.remainingQuantity.value) > 0;
  checks.push(
    check(
      "WORK_STATUS",
      statusPass ? "PASS" : "FAIL",
      statusPass ? null : "WORK_STATUS_NOT_PLANNABLE",
      statusPass
        ? "Work item has remaining plannable quantity."
        : "Work item status or remaining quantity is not plannable.",
      workItem.sourceRefs,
    ),
  );

  const inDateWindow =
    request.planDate >= workItem.plannedStart && request.planDate <= workItem.plannedFinish;
  checks.push(
    check(
      "ACTIVITY_DATE_WINDOW",
      inDateWindow ? "PASS" : "FAIL",
      inDateWindow ? null : "ACTIVITY_OUTSIDE_DATE_WINDOW",
      inDateWindow
        ? "Plan date is inside the approved activity window."
        : "Plan date is outside the approved activity window.",
      workItem.sourceRefs,
    ),
  );

  const calendar = snapshot.calendar;
  const workingDate =
    request.planDate >= calendar.effectiveFrom &&
    (calendar.effectiveTo === null || request.planDate <= calendar.effectiveTo) &&
    isWorkingDate(request.planDate, calendar.workingWeekdays, calendar.holidays);
  checks.push(
    check(
      "CALENDAR",
      workingDate ? "PASS" : "FAIL",
      workingDate ? null : "CALENDAR_CONFLICT",
      workingDate
        ? "Plan date is an approved working date."
        : "Plan date is not an approved working date.",
      calendar.sourceRefs,
    ),
  );

  const predecessorSources: BuildWatchSourceReference[] = [...workItem.sourceRefs];
  let predecessorStatus: "PASS" | "FAIL" | "UNKNOWN" = "PASS";
  for (const predecessorId of workItem.predecessorWorkItemIds) {
    const predecessor = snapshot.workItems.find(
      (candidate) => candidate.workItemId === predecessorId,
    );
    if (predecessor === undefined) {
      predecessorStatus = "UNKNOWN";
      continue;
    }
    predecessorSources.push(...predecessor.sourceRefs);
    if (predecessor.status !== "COMPLETED") {
      predecessorStatus = "FAIL";
    }
  }
  checks.push(
    check(
      "PREDECESSOR",
      predecessorStatus,
      predecessorStatus === "PASS"
        ? null
        : predecessorStatus === "FAIL"
          ? "PREDECESSOR_UNFINISHED"
          : "PREDECESSOR_DATA_MISSING",
      predecessorStatus === "PASS"
        ? "All predecessors are completed."
        : predecessorStatus === "FAIL"
          ? "At least one predecessor is unfinished."
          : "Predecessor status is missing.",
      predecessorSources,
    ),
  );

  const inspectionSources: BuildWatchSourceReference[] = [...workItem.sourceRefs];
  let inspectionStatus: "PASS" | "FAIL" | "UNKNOWN" = "PASS";
  for (const inspectionId of workItem.requiredInspectionIds) {
    const inspection = snapshot.inspections.find(
      (candidate) => candidate.inspectionId === inspectionId,
    );
    if (inspection === undefined) {
      inspectionStatus = "UNKNOWN";
      continue;
    }
    inspectionSources.push(...inspection.sourceRefs);
    if (!["PASSED", "WAIVED"].includes(inspection.status)) {
      inspectionStatus = "FAIL";
    }
  }
  checks.push(
    check(
      "INSPECTION",
      inspectionStatus,
      inspectionStatus === "PASS"
        ? null
        : inspectionStatus === "FAIL"
          ? "INSPECTION_NOT_PASSED"
          : "INSPECTION_MISSING",
      inspectionStatus === "PASS"
        ? "Required inspections are passed or waived."
        : inspectionStatus === "FAIL"
          ? "A required inspection is not passed."
          : "Required inspection data is missing.",
      inspectionSources,
    ),
  );

  const material = materialWorkCapacity(request, workItem);
  checks.push(
    check(
      "MATERIAL_COVERAGE",
      material.status,
      material.status === "PASS"
        ? null
        : material.status === "FAIL"
          ? "MATERIAL_SHORTAGE"
          : "MATERIAL_DATA_MISSING",
      material.status === "PASS"
        ? "Material covers the minimum executable quantity."
        : material.status === "FAIL"
          ? "Material does not cover the minimum executable quantity."
          : "Material coverage cannot be calculated.",
      material.sources,
    ),
  );

  const matchingCrews = snapshot.crews.filter(
    (crew) => crew.crewType === workItem.requiredCrewType,
  );
  const availableCrews = matchingCrews.filter(
    (crew) =>
      crew.available &&
      request.planDate >= crew.availableFrom &&
      request.planDate <= crew.availableTo,
  );
  const selectedCrew = availableCrews
    .filter((crew) => crew.shiftEnd > crew.shiftStart)
    .sort((left, right) => left.crewId.localeCompare(right.crewId))[0];
  const crewStatus =
    workItem.requiredCrewType === null || matchingCrews.length === 0
      ? "UNKNOWN"
      : availableCrews.length === 0 || selectedCrew === undefined
        ? "FAIL"
        : "PASS";
  const crewReason =
    crewStatus === "PASS"
      ? null
      : crewStatus === "UNKNOWN"
        ? "CREW_DATA_MISSING"
        : availableCrews.length > 0
          ? "INVALID_SHIFT"
          : "CREW_UNAVAILABLE";
  checks.push(
    check(
      "CREW_AVAILABILITY",
      crewStatus,
      crewReason,
      crewStatus === "PASS"
        ? "An approved crew is available."
        : crewStatus === "FAIL"
          ? crewReason === "INVALID_SHIFT"
            ? "The available crew has an invalid shift window."
            : "The required crew is unavailable."
          : "Required crew data is missing.",
      matchingCrews.length > 0
        ? matchingCrews.flatMap((crew) => crew.sourceRefs)
        : workItem.sourceRefs,
    ),
  );

  const equipmentSources: BuildWatchSourceReference[] = [...workItem.sourceRefs];
  let equipmentStatus: "PASS" | "FAIL" | "UNKNOWN" = "PASS";
  for (const equipmentId of workItem.requiredEquipmentIds) {
    const equipment = snapshot.equipment.find((candidate) => candidate.equipmentId === equipmentId);
    if (equipment === undefined) {
      equipmentStatus = "UNKNOWN";
      continue;
    }
    equipmentSources.push(...equipment.sourceRefs);
    if (
      !equipment.available ||
      request.planDate < equipment.availableFrom ||
      request.planDate > equipment.availableTo
    ) {
      equipmentStatus = "FAIL";
    }
  }
  checks.push(
    check(
      "EQUIPMENT_AVAILABILITY",
      equipmentStatus,
      equipmentStatus === "PASS"
        ? null
        : equipmentStatus === "FAIL"
          ? "EQUIPMENT_UNAVAILABLE"
          : "EQUIPMENT_DATA_MISSING",
      equipmentStatus === "PASS"
        ? "Required equipment is available."
        : equipmentStatus === "FAIL"
          ? "Required equipment is unavailable."
          : "Required equipment data is missing.",
      equipmentSources,
    ),
  );

  const zone =
    workItem.zoneCode === null
      ? undefined
      : snapshot.zones.find((candidate) => candidate.zoneCode === workItem.zoneCode);
  const zoneStatus =
    workItem.zoneCode === null || zone === undefined
      ? "UNKNOWN"
      : zone.available && zone.maxConcurrentActivities > 0
        ? "PASS"
        : "FAIL";
  checks.push(
    check(
      "ZONE_AVAILABILITY",
      zoneStatus,
      zoneStatus === "PASS"
        ? null
        : zoneStatus === "FAIL"
          ? "ZONE_UNAVAILABLE"
          : "ZONE_DATA_MISSING",
      zoneStatus === "PASS"
        ? "Work zone has an available activity slot."
        : zoneStatus === "FAIL"
          ? "Work zone is unavailable."
          : "Work zone capacity data is missing.",
      zone?.sourceRefs ?? workItem.sourceRefs,
    ),
  );

  const weatherForDate = snapshot.weatherConstraints.filter(
    (weather) => weather.date === request.planDate,
  );
  const weatherRestricted = weatherForDate.some((weather) =>
    weather.restrictedWorkClassCodes.includes(workItem.workClassCode),
  );
  const weatherStatus =
    workItem.weatherRestrictions.length === 0
      ? "PASS"
      : weatherForDate.length === 0
        ? "UNKNOWN"
        : weatherRestricted
          ? "FAIL"
          : "PASS";
  checks.push(
    check(
      "WEATHER",
      weatherStatus,
      weatherStatus === "PASS"
        ? null
        : weatherStatus === "FAIL"
          ? "WEATHER_RESTRICTION"
          : "WEATHER_DATA_MISSING",
      weatherStatus === "PASS"
        ? "Weather does not restrict the work class."
        : weatherStatus === "FAIL"
          ? "Weather restricts the work class."
          : "Weather input is missing.",
      weatherForDate.length > 0
        ? weatherForDate.flatMap((weather) => weather.sourceRefs)
        : workItem.sourceRefs,
    ),
  );

  const openBlockers = snapshot.blockers.filter(
    (blocker) => blocker.workItemId === workItem.workItemId && blocker.isOpen,
  );
  checks.push(
    check(
      "OPEN_BLOCKER",
      openBlockers.length === 0 ? "PASS" : "FAIL",
      openBlockers.length === 0
        ? null
        : openBlockers.some((blocker) => blocker.approved)
          ? "APPROVED_BLOCKER"
          : "OPEN_BLOCKER",
      openBlockers.length === 0
        ? "No open blocker prevents execution."
        : "An open blocker prevents execution.",
      openBlockers.length > 0
        ? openBlockers.flatMap((blocker) => blocker.sourceRefs)
        : workItem.sourceRefs,
    ),
  );

  const safetySources: BuildWatchSourceReference[] = [...workItem.sourceRefs];
  let safetyStatus: "PASS" | "FAIL" | "UNKNOWN" = "PASS";
  for (const restriction of workItem.safetyRestrictions) {
    const clearance = request.safetyClearances.find((candidate) => candidate.code === restriction);
    if (clearance === undefined) {
      safetyStatus = "UNKNOWN";
      continue;
    }
    safetySources.push(...clearance.sourceRefs);
    if (!clearance.satisfied) {
      safetyStatus = "FAIL";
    }
  }
  checks.push(
    check(
      "SAFETY_RESTRICTION",
      safetyStatus,
      safetyStatus === "PASS"
        ? null
        : safetyStatus === "FAIL"
          ? "SAFETY_RESTRICTION"
          : "SAFETY_CLEARANCE_MISSING",
      safetyStatus === "PASS"
        ? "Safety restrictions are cleared."
        : safetyStatus === "FAIL"
          ? "A safety restriction is not cleared."
          : "Safety clearance evidence is missing.",
      safetySources,
    ),
  );

  const reasonCodes = checks
    .filter((item) => item.status !== "PASS")
    .map((item) => item.reasonCode!)
    .filter((value, index, values) => values.indexOf(value) === index);

  return a5EligibilityResultSchema.parse({
    eligible: checks.every((item) => item.status === "PASS"),
    checks,
    reasonCodes,
    selectedCrewId: selectedCrew?.crewId ?? null,
  });
}
