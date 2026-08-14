import type {
  BuildWatchSourceReference,
  OperationalPlanningSnapshotV1,
} from "../contracts/index.js";
import {
  a5DailyTargetResultSchema,
  type A5DailyPlanRequestV1,
  type A5DailyTargetResult,
  type A5EligibilityResult,
} from "./contracts.js";
import {
  dedupeSourceRefs,
  planningCalculationSource,
  sourceBackedQuantity,
} from "./deterministic.js";

type WorkItem = OperationalPlanningSnapshotV1["workItems"][number];

type Capacity = {
  value: number;
  factor: A5DailyTargetResult["limitingFactor"];
  sources: BuildWatchSourceReference[];
};

export function calculateDailyTarget(
  request: A5DailyPlanRequestV1,
  workItem: WorkItem,
  eligibility: A5EligibilityResult,
): A5DailyTargetResult {
  const remaining = Number(workItem.remainingQuantity.value);
  const calculationSource = planningCalculationSource(
    request,
    `workItems.${workItem.workItemId}.dailyTarget`,
  );
  const remainingCapacity: Capacity = {
    value: remaining,
    factor: "REMAINING_QUANTITY",
    sources: [...workItem.remainingQuantity.sourceRefs],
  };
  const unknownReasons: string[] = [];

  const crew = request.operationalSnapshot.crews.find(
    (candidate) => candidate.crewId === eligibility.selectedCrewId,
  );
  const productivityFactor = request.productivityFactors.find(
    (candidate) => candidate.crewId === eligibility.selectedCrewId,
  );
  let crewCapacity: Capacity | null = null;
  if (
    crew === undefined ||
    productivityFactor === undefined ||
    crew.productivityPerShift.unit !== workItem.unit
  ) {
    unknownReasons.push("CREW_PRODUCTIVITY_INPUT_MISSING");
  } else {
    crewCapacity = {
      value:
        Number(crew.productivityPerShift.value) *
        Number(productivityFactor.crewFactor) *
        Number(productivityFactor.shiftFactor),
      factor: "CREW_PRODUCTIVITY",
      sources: [
        ...crew.productivityPerShift.sourceRefs,
        ...crew.productivityVersion.sourceRefs,
        ...productivityFactor.sourceRefs,
      ],
    };
  }

  let materialCapacity: Capacity | null = {
    value: remaining,
    factor: "MATERIAL_AVAILABILITY",
    sources: [...workItem.remainingQuantity.sourceRefs],
  };
  for (const requirement of workItem.requiredMaterials) {
    const inventory = request.operationalSnapshot.materials.find(
      (candidate) => candidate.materialId === requirement.materialId,
    );
    const planned = Number(workItem.plannedQuantity.value);
    const totalRequired = Number(requirement.quantity.value);
    if (
      inventory === undefined ||
      planned <= 0 ||
      totalRequired <= 0 ||
      inventory.availableQuantity.unit !== requirement.quantity.unit ||
      inventory.reservedQuantity.unit !== requirement.quantity.unit
    ) {
      materialCapacity = null;
      unknownReasons.push("MATERIAL_CAPACITY_INPUT_MISSING");
      break;
    }
    const netAvailable = Math.max(
      0,
      Number(inventory.availableQuantity.value) - Number(inventory.reservedQuantity.value),
    );
    const candidate: Capacity = {
      value: netAvailable / (totalRequired / planned),
      factor: "MATERIAL_AVAILABILITY",
      sources: [
        ...requirement.quantity.sourceRefs,
        ...inventory.availableQuantity.sourceRefs,
        ...inventory.reservedQuantity.sourceRefs,
        ...inventory.sourceRefs,
      ],
    };
    if (materialCapacity === null || candidate.value < materialCapacity.value) {
      materialCapacity = candidate;
    }
  }

  let equipmentCapacity: Capacity | null = {
    value: remaining,
    factor: "EQUIPMENT_CAPACITY",
    sources: [...workItem.remainingQuantity.sourceRefs],
  };
  for (const equipmentId of workItem.requiredEquipmentIds) {
    const equipment = request.operationalSnapshot.equipment.find(
      (candidate) => candidate.equipmentId === equipmentId,
    );
    if (equipment === undefined || equipment.capacityPerShift.unit !== workItem.unit) {
      equipmentCapacity = null;
      unknownReasons.push("EQUIPMENT_CAPACITY_INPUT_MISSING");
      break;
    }
    const candidate: Capacity = {
      value: Number(equipment.capacityPerShift.value),
      factor: "EQUIPMENT_CAPACITY",
      sources: [...equipment.capacityPerShift.sourceRefs, ...equipment.sourceRefs],
    };
    if (candidate.value < equipmentCapacity.value) {
      equipmentCapacity = candidate;
    }
  }

  const zone =
    workItem.zoneCode === null
      ? undefined
      : request.operationalSnapshot.zones.find(
          (candidate) => candidate.zoneCode === workItem.zoneCode,
        );
  const zoneCapacity: Capacity | null =
    zone === undefined
      ? null
      : {
          value: zone.available && zone.maxConcurrentActivities > 0 ? remaining : 0,
          factor: "ZONE_CAPACITY",
          sources: [...zone.sourceRefs],
        };
  if (zoneCapacity === null) {
    unknownReasons.push("ZONE_CAPACITY_INPUT_MISSING");
  }

  const breakdown = {
    remainingQuantity: sourceBackedQuantity(
      remainingCapacity.value,
      workItem.unit,
      remainingCapacity.sources,
    ),
    crewCapacity:
      crewCapacity === null
        ? null
        : sourceBackedQuantity(crewCapacity.value, workItem.unit, crewCapacity.sources),
    materialCapacity:
      materialCapacity === null
        ? null
        : sourceBackedQuantity(materialCapacity.value, workItem.unit, materialCapacity.sources),
    equipmentCapacity:
      equipmentCapacity === null
        ? null
        : sourceBackedQuantity(equipmentCapacity.value, workItem.unit, equipmentCapacity.sources),
    zoneCapacity:
      zoneCapacity === null
        ? null
        : sourceBackedQuantity(zoneCapacity.value, workItem.unit, zoneCapacity.sources),
  };

  if (
    !eligibility.eligible ||
    unknownReasons.length > 0 ||
    crewCapacity === null ||
    materialCapacity === null ||
    equipmentCapacity === null ||
    zoneCapacity === null
  ) {
    return a5DailyTargetResultSchema.parse({
      feasible: false,
      targetQuantity: null,
      limitingFactor: "INSUFFICIENT_INFORMATION",
      reasonCodes: [...new Set([...eligibility.reasonCodes, ...unknownReasons])],
      breakdown,
    });
  }

  const capacities = [
    remainingCapacity,
    crewCapacity,
    materialCapacity,
    equipmentCapacity,
    zoneCapacity,
  ];
  const limiting = capacities.reduce((current, candidate) =>
    candidate.value < current.value ? candidate : current,
  );
  const minimum = Number(request.minimumExecutableQuantity);
  if (limiting.value < minimum) {
    return a5DailyTargetResultSchema.parse({
      feasible: false,
      targetQuantity: null,
      limitingFactor: limiting.factor,
      reasonCodes: [
        limiting.factor === "MATERIAL_AVAILABILITY"
          ? "MATERIAL_SHORTAGE"
          : "TARGET_BELOW_MINIMUM_EXECUTABLE_QUANTITY",
      ],
      breakdown,
    });
  }

  const targetSources = dedupeSourceRefs([
    ...capacities.flatMap((capacity) => capacity.sources),
    calculationSource,
  ]);
  const reasonCodes =
    limiting.factor === "MATERIAL_AVAILABILITY" && limiting.value < crewCapacity.value
      ? ["PARTIAL_TARGET"]
      : [];
  return a5DailyTargetResultSchema.parse({
    feasible: true,
    targetQuantity: sourceBackedQuantity(limiting.value, workItem.unit, targetSources),
    limitingFactor: limiting.factor,
    reasonCodes,
    breakdown,
  });
}
