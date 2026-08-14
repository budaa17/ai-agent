import { createHash } from "node:crypto";
import {
  dailyWorkPlanDraftV1Schema,
  operationalForecastSnapshotV1Schema,
  operationalPlanningSnapshotV1Schema,
  progressVerificationDraftV1Schema,
  recoveryProposalDraftV1Schema,
  rollingProductivitySnapshotV1Schema,
  type BuildWatchCanonicalUnit,
  type BuildWatchSourceReference,
  type DailyWorkPlanDraftV1,
  type OperationalForecastSnapshotV1,
  type OperationalPlanningSnapshotV1,
  type ProgressVerificationDraftV1,
  type ProjectAnalysisSnapshotV1,
  type RecoveryProposalDraftV1,
  type RollingProductivitySnapshotV1,
} from "../contracts/index.js";
import {
  addWorkingDays,
  compareIsoDates,
  enumerateWorkingDates,
} from "../production-analysis/calendar.js";
import {
  BUILDWATCH_SIMULATION_CALENDAR,
  BUILDWATCH_SIMULATION_GENERATED_AT,
  BUILDWATCH_SIMULATION_WINDOW_END,
  BUILDWATCH_SIMULATION_WINDOW_START,
  buildBuildWatchSimulation,
  replaySimulationSnapshot,
} from "./buildwatch-simulation.js";
import {
  OPERATIONAL_SIMULATION_SCENARIOS,
  buildWatchOperationalSimulationV1Schema,
  operationalPrivateFixtureV1Schema,
  operationalSimulationAgentDatasetV1Schema,
  operationalSimulationAnswerKeyV1Schema,
  type BuildWatchOperationalSimulationV1,
  type OperationalEvidenceRuleV1,
  type OperationalPhotoMetadataV1,
  type OperationalPlanningRuleV1,
  type OperationalPrivateFixtureV1,
  type OperationalSimulationAgentDatasetV1,
  type OperationalSimulationAnswerCaseV1,
  type OperationalSimulationControlType,
  type OperationalSimulationScenario,
} from "./buildwatch-v22-contracts.js";

type SourceType = BuildWatchSourceReference["sourceType"];
type SnapshotWorkItem = ProjectAnalysisSnapshotV1["workItems"][number];
type OperationalWorkItem = OperationalPlanningSnapshotV1["workItems"][number];
type DailyPlanItem = DailyWorkPlanDraftV1["content"]["items"][number];
type VerificationItem = ProgressVerificationDraftV1["content"]["items"][number];
type ForecastStatus = OperationalForecastSnapshotV1["status"];

type SourceOptions = {
  sourceVersionId?: string | null;
  artifactId?: string | null;
  pageNumber?: number | null;
  sheetName?: string | null;
  rowNumber?: number | null;
  fieldPath?: string | null;
  asOf?: string | null;
  sha256?: string | null;
};

type OperationalBuildContext = {
  seed: string;
  analysisSnapshot: ProjectAnalysisSnapshotV1;
  planningDates: string[];
  scenarioDates: Map<OperationalSimulationScenario, string>;
  scenarioByDate: Map<string, OperationalSimulationScenario>;
  sourceRegistry: SourceRegistry;
  workItemById: Map<string, SnapshotWorkItem>;
  leafWorkItemIds: string[];
};

type PhotoVerificationBuild = {
  photos: OperationalPhotoMetadataV1[];
  verificationDrafts: ProgressVerificationDraftV1[];
};

type ForecastBuild = {
  productivitySnapshots: RollingProductivitySnapshotV1[];
  forecasts: OperationalForecastSnapshotV1[];
  recoveryProposals: RecoveryProposalDraftV1[];
};

export type BuildWatchOperationalSimulationReplayV1 = {
  schemaVersion: 1;
  replayType: "BUILDWATCH_OPERATIONAL_V22_REPLAY";
  seed: string;
  asOfDate: string;
  tenantId: string;
  projectId: string;
  deterministic: true;
  llmRequired: false;
  analysisSnapshot: ProjectAnalysisSnapshotV1;
  sourceCatalog: BuildWatchSourceReference[];
  planningRules: OperationalPlanningRuleV1[];
  evidenceRules: OperationalEvidenceRuleV1[];
  operationalSnapshots: OperationalPlanningSnapshotV1[];
  dailyPlans: DailyWorkPlanDraftV1[];
  photoMetadata: OperationalPhotoMetadataV1[];
  verificationDrafts: ProgressVerificationDraftV1[];
  rollingProductivitySnapshots: RollingProductivitySnapshotV1[];
  rollingForecasts: OperationalForecastSnapshotV1[];
  recoveryProposals: RecoveryProposalDraftV1[];
};

export const BUILDWATCH_OPERATIONAL_SIMULATION_SEED = "buildwatch-v22-phase2-v1";
export const BUILDWATCH_OPERATIONAL_SIMULATION_GENERATED_AT = BUILDWATCH_SIMULATION_GENERATED_AT;
export const BUILDWATCH_OPERATIONAL_POLICY_APPROVED_AT = "2026-01-02T05:00:00.000Z";
export const BUILDWATCH_OPERATIONAL_PLANNING_DAY_COUNT = 40;

const stageWorkClasses = [
  "SITE_PREP",
  "FOUNDATION",
  "STRUCTURE",
  "MASONRY",
  "MEP",
  "INTERIOR",
  "EXTERIOR",
  "COMMISSIONING",
] as const;

const stageCrewTypes = [
  "EARTHWORK_CREW",
  "FOUNDATION_CREW",
  "STRUCTURE_CREW",
  "MASONRY_CREW",
  "MEP_CREW",
  "INTERIOR_CREW",
  "FACADE_CREW",
  "COMMISSIONING_CREW",
] as const;

const stageEquipmentIds = [
  "equipment-excavator-01",
  "equipment-concrete-pump-01",
  "equipment-tower-crane-01",
  "equipment-mortar-mixer-01",
  "equipment-mep-lift-01",
  "equipment-interior-lift-01",
  "equipment-facade-lift-01",
  "equipment-test-kit-01",
] as const;

const scenarioSubjects: Record<OperationalSimulationScenario, string[]> = {
  HEALTHY_CONTROL: ["work-item-046"],
  PREDECESSOR_UNFINISHED: ["work-item-017"],
  MATERIAL_SHORTAGE: ["work-item-023"],
  CREW_UNAVAILABLE: ["work-item-029"],
  EQUIPMENT_DOUBLE_BOOKING: ["work-item-035", "work-item-041"],
  ZONE_CONFLICT: ["work-item-038", "work-item-039"],
  HEAVY_RAIN_RESTRICTION: ["work-item-038"],
  INSPECTION_PENDING: ["work-item-041"],
  CRITICAL_WORK_OMITTED: ["work-item-017"],
  PLANNED_TARGET_PARTIAL: ["work-item-029"],
  APPROVED_BLOCKER: ["work-item-023"],
  MISSING_REPORT: ["work-item-029"],
  BLURRY_DARK_PHOTO: ["work-item-035"],
  DUPLICATE_PHOTO: ["work-item-038"],
  PREVIOUS_DAY_REUSED_PHOTO: ["work-item-041"],
  REPORT_PHOTO_MISMATCH: ["work-item-038"],
  FALSE_COMPLETED: ["work-item-041"],
  INSUFFICIENT_FORECAST_DATA: ["work-item-046"],
  CRITICAL_DELAY: ["work-item-017"],
  RECOVERY_OPTION_CONFLICT: ["work-item-041"],
};

const scenarioConflicts: Record<OperationalSimulationScenario, string[]> = {
  HEALTHY_CONTROL: [],
  PREDECESSOR_UNFINISHED: ["PRECONDITION_UNSATISFIED"],
  MATERIAL_SHORTAGE: ["MATERIAL_SHORTAGE"],
  CREW_UNAVAILABLE: ["CREW_UNAVAILABLE"],
  EQUIPMENT_DOUBLE_BOOKING: ["EQUIPMENT_DOUBLE_BOOKING"],
  ZONE_CONFLICT: ["ZONE_OVER_CAPACITY"],
  HEAVY_RAIN_RESTRICTION: ["WEATHER_RESTRICTION"],
  INSPECTION_PENDING: ["PRECONDITION_UNSATISFIED"],
  CRITICAL_WORK_OMITTED: ["CRITICAL_WORK_OMITTED"],
  PLANNED_TARGET_PARTIAL: ["PARTIAL_TARGET"],
  APPROVED_BLOCKER: ["APPROVED_BLOCKER"],
  MISSING_REPORT: ["MISSING_DAILY_REPORT"],
  BLURRY_DARK_PHOTO: ["PHOTO_BLUR", "PHOTO_DARK"],
  DUPLICATE_PHOTO: ["DUPLICATE_PHOTO"],
  PREVIOUS_DAY_REUSED_PHOTO: ["PREVIOUS_DAY_REUSED_PHOTO"],
  REPORT_PHOTO_MISMATCH: ["REPORT_PHOTO_MISMATCH"],
  FALSE_COMPLETED: ["FALSE_COMPLETED_CLAIM"],
  INSUFFICIENT_FORECAST_DATA: ["INSUFFICIENT_FORECAST_DATA"],
  CRITICAL_DELAY: ["CRITICAL_DELAY"],
  RECOVERY_OPTION_CONFLICT: ["RECOVERY_RESOURCE_CONFLICT"],
};

const dailyPlanningScenarios = new Set<OperationalSimulationScenario>([
  "HEALTHY_CONTROL",
  "PREDECESSOR_UNFINISHED",
  "MATERIAL_SHORTAGE",
  "CREW_UNAVAILABLE",
  "EQUIPMENT_DOUBLE_BOOKING",
  "ZONE_CONFLICT",
  "HEAVY_RAIN_RESTRICTION",
  "INSPECTION_PENDING",
  "CRITICAL_WORK_OMITTED",
  "PLANNED_TARGET_PARTIAL",
  "APPROVED_BLOCKER",
]);

const scenarioRationales: Record<OperationalSimulationScenario, string> = {
  HEALTHY_CONTROL: "Бүх precondition, нөөц, evidence болон forecast хэвийн эерэг control.",
  PREDECESSOR_UNFINISHED: "Өмнөх ажил дуусаагүй тул successor тухайн өдөр eligible биш.",
  MATERIAL_SHORTAGE: "Өдрийн хэрэгцээнээс материалын боломжит үлдэгдэл бага.",
  CREW_UNAVAILABLE: "Тухайн work class-д шаардлагатай баг unavailable төлөвтэй.",
  EQUIPMENT_DOUBLE_BOOKING:
    "Хоёр ажил ижил тоног төхөөрөмжийг давхцсан цагаар ашиглахаар төлөвлөсөн.",
  ZONE_CONFLICT: "Нэг zone-ийн concurrency capacity-аас олон ажил зэрэг төлөвлөгдсөн.",
  HEAVY_RAIN_RESTRICTION: "Хүчтэй борооны logistics constraint нь гадна ажлыг хориглосон.",
  INSPECTION_PENDING: "Заавал тэнцсэн байх inspection pending тул ажил эхлэхгүй.",
  CRITICAL_WORK_OMITTED: "Eligible critical ажил өдөр тутмын төлөвлөгөөнөөс зориудаар хасагдсан.",
  PLANNED_TARGET_PARTIAL: "Нөөцийн хязгаарлалтаар бүтэн shift target-ийг бууруулсан boundary case.",
  APPROVED_BLOCKER: "Батлагдсан blocker-той ажлыг BLOCKED гэж зөв ангилах boundary case.",
  MISSING_REPORT: "Төлөвлөгөө байгаа боловч өдрийн тайлан байхгүй тул үр дүн баталгаажихгүй.",
  BLURRY_DARK_PHOTO: "Blur болон brightness deterministic босго хоёул зөрчигдсөн.",
  DUPLICATE_PHOTO: "Ижил hash бүхий өмнөх зураг duplicate lineage-тай.",
  PREVIOUS_DAY_REUSED_PHOTO: "Өмнөх өдрийн зураг шинэ тайланд дахин ашиглагдсан.",
  REPORT_PHOTO_MISMATCH: "Тайлангийн work item болон зурагт танигдсан work item зөрсөн.",
  FALSE_COMPLETED: "Тайланд бүтэн гэж мэдүүлсэн ч verified quantity target-аас бага.",
  INSUFFICIENT_FORECAST_DATA: "Хүчинтэй productivity sample хүрэлцээгүй тул finish тооцохгүй.",
  CRITICAL_DELAY: "Projected delay нь critical threshold-оос давсан.",
  RECOVERY_OPTION_CONFLICT: "Recovery хувилбар шаардлагатай resource/dependency conflict-той.",
};

class SourceRegistry {
  private readonly sources = new Map<string, BuildWatchSourceReference>();

  constructor(
    private readonly tenantId: string,
    private readonly projectId: string,
  ) {}

  get(
    sourceId: string,
    sourceType: SourceType,
    options: SourceOptions = {},
  ): BuildWatchSourceReference {
    const existing = this.sources.get(sourceId);
    if (existing !== undefined) {
      if (existing.sourceType !== sourceType) {
        throw new Error(`Source ${sourceId} requested with conflicting types`);
      }
      return existing;
    }

    const source: BuildWatchSourceReference = {
      sourceRefId: `source-ref-${sourceId}`,
      tenantId: this.tenantId,
      projectId: this.projectId,
      sourceType,
      sourceId,
      sourceVersionId: options.sourceVersionId ?? null,
      artifactId: options.artifactId ?? null,
      pageNumber: options.pageNumber ?? null,
      sheetName: options.sheetName ?? null,
      rowNumber: options.rowNumber ?? null,
      fieldPath: options.fieldPath ?? null,
      region: null,
      asOf: options.asOf ?? null,
      sha256: options.sha256 ?? null,
    };
    this.sources.set(sourceId, source);
    return source;
  }

  values(): BuildWatchSourceReference[] {
    return [...this.sources.values()];
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function formatDecimal(value: number, precision = 3): string {
  const rounded = Number(value.toFixed(precision));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function round(value: number, precision = 3): number {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function dateTime(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

function stageIndex(workItem: SnapshotWorkItem): number {
  return Math.min(7, Math.floor((workItem.displayOrder - 1) / 6));
}

function canonicalUnit(unit: string): BuildWatchCanonicalUnit {
  const normalized: Record<string, BuildWatchCanonicalUnit> = {
    м: "m",
    м2: "m2",
    м3: "m3",
    кг: "kg",
    ш: "pcs",
    багц: "pcs",
    m: "m",
    m2: "m2",
    m3: "m3",
    kg: "kg",
    pcs: "pcs",
  };
  return normalized[unit] ?? "pcs";
}

function buildScenarioDates(planningDates: string[]): Map<OperationalSimulationScenario, string> {
  const missingReportDate = planningDates.includes("2026-03-25")
    ? "2026-03-25"
    : planningDates[planningDates.length - 5]!;
  const availableDates = planningDates.filter((date) => date !== missingReportDate);
  const assignments = new Map<OperationalSimulationScenario, string>();
  let dateIndex = 0;

  for (const scenario of OPERATIONAL_SIMULATION_SCENARIOS) {
    if (scenario === "MISSING_REPORT") {
      assignments.set(scenario, missingReportDate);
      continue;
    }
    const date = availableDates[dateIndex];
    if (date === undefined) {
      throw new Error("Not enough planning dates for all scenarios");
    }
    assignments.set(scenario, date);
    dateIndex += 1;
  }

  return assignments;
}

function reverseScenarioDates(
  scenarioDates: Map<OperationalSimulationScenario, string>,
): Map<string, OperationalSimulationScenario> {
  return new Map([...scenarioDates.entries()].map(([scenario, date]) => [date, scenario]));
}

function latestCumulativeQuantity(
  snapshot: ProjectAnalysisSnapshotV1,
  workItemId: string,
  asOfDate: string,
): number {
  let cumulative = 0;
  for (const entry of snapshot.progressEntries) {
    if (entry.workItemId === workItemId && entry.capturedAt.slice(0, 10) <= asOfDate) {
      cumulative = Math.max(cumulative, Number(entry.cumulativeQuantityDone));
    }
  }
  return round(cumulative);
}

function buildPlanningRules(context: OperationalBuildContext): OperationalPlanningRuleV1[] {
  const source = context.sourceRegistry.get("planning-policy-v1", "SYSTEM_CALCULATION", {
    sourceVersionId: "planning-policy-version-001",
    asOf: BUILDWATCH_OPERATIONAL_SIMULATION_GENERATED_AT,
  });
  const policyVersion = {
    policyVersionId: "planning-policy-version-001",
    version: 1,
    effectiveFrom: BUILDWATCH_SIMULATION_WINDOW_START,
  };

  return [
    {
      schemaVersion: 1,
      ruleId: "planning-rule-eligibility-v1",
      code: "ELIGIBILITY",
      version: 1,
      description:
        "Predecessor, inspection, blocker, weather болон safety precondition-ийг deterministic шалгана.",
      inputCodes: ["PREDECESSOR", "INSPECTION", "BLOCKER", "WEATHER", "SAFETY"],
      outputCodes: ["ELIGIBLE", "INELIGIBLE"],
      deterministic: true,
      policyVersion,
      sourceRefs: [source],
    },
    {
      schemaVersion: 1,
      ruleId: "planning-rule-priority-v1",
      code: "PRIORITY",
      version: 1,
      description: "Criticality, float, downstream unlock болон milestone-аар rank тогтооно.",
      inputCodes: ["CRITICALITY", "TOTAL_FLOAT", "DOWNSTREAM_UNLOCK", "MILESTONE"],
      outputCodes: ["PRIORITY_RANK"],
      deterministic: true,
      policyVersion,
      sourceRefs: [source],
    },
    {
      schemaVersion: 1,
      ruleId: "planning-rule-target-v1",
      code: "DAILY_TARGET",
      version: 1,
      description:
        "Remaining quantity, crew productivity, material болон equipment capacity-ийн minimum-ээр target гаргана.",
      inputCodes: [
        "REMAINING_QUANTITY",
        "CREW_PRODUCTIVITY",
        "MATERIAL_AVAILABILITY",
        "EQUIPMENT_CAPACITY",
      ],
      outputCodes: ["TARGET_QUANTITY", "LIMITING_FACTOR"],
      deterministic: true,
      policyVersion,
      sourceRefs: [source],
    },
    {
      schemaVersion: 1,
      ruleId: "planning-rule-conflict-v1",
      code: "RESOURCE_CONFLICT",
      version: 1,
      description: "Crew, equipment болон zone-ийн давхардлыг deterministic илрүүлнэ.",
      inputCodes: ["CREW", "EQUIPMENT", "ZONE"],
      outputCodes: ["CONFLICT"],
      deterministic: true,
      policyVersion,
      sourceRefs: [source],
    },
  ];
}

function buildEvidenceRules(context: OperationalBuildContext): OperationalEvidenceRuleV1[] {
  const source = context.sourceRegistry.get("photo-evidence-policy-v1", "SYSTEM_CALCULATION", {
    sourceVersionId: "photo-evidence-policy-version-001",
    asOf: BUILDWATCH_OPERATIONAL_POLICY_APPROVED_AT,
  });
  return stageWorkClasses.map((workClassCode) => ({
    schemaVersion: 1,
    ruleId: `evidence-rule-${workClassCode.toLowerCase()}`,
    workClassCode,
    requiredPhotoCount: 1,
    requiredAngles: ["OVERVIEW"],
    checklistRequired: true,
    referenceMarkerRequired: ["STRUCTURE", "MASONRY", "EXTERIOR"].includes(workClassCode),
    maxPhotoAgeMinutes: 720,
    duplicateHammingDistanceThreshold: 4,
    deterministic: true,
    sourceRefs: [source],
  }));
}

function buildOperationalSnapshot(
  date: string,
  context: OperationalBuildContext,
): OperationalPlanningSnapshotV1 {
  const scenario = context.scenarioByDate.get(date);
  const scheduleSource = context.sourceRegistry.get("schedule-version-001", "SCHEDULE_VERSION", {
    sourceVersionId: "schedule-version-001",
    asOf: dateTime(date, 4),
  });
  const calendarSource = context.sourceRegistry.get("calendar-version-001", "CALENDAR_VERSION", {
    sourceVersionId: "calendar-version-001",
    asOf: dateTime(date, 4),
  });
  const resourceSource = context.sourceRegistry.get(
    `resource-availability-${date}`,
    "RESOURCE_AVAILABILITY",
    { asOf: dateTime(date, 4) },
  );
  const materialSource = context.sourceRegistry.get(`material-ledger-${date}`, "MATERIAL_LEDGER", {
    asOf: dateTime(date, 4),
  });
  const weatherSource = context.sourceRegistry.get(
    `weather-logistics-${date}`,
    "WEATHER_LOGISTICS",
    { asOf: dateTime(date, 4) },
  );
  const productivityCatalogSource = context.sourceRegistry.get(
    "productivity-catalog-v1",
    "CATALOG_VERSION",
    {
      sourceVersionId: "productivity-catalog-version-001",
      asOf: dateTime(date, 4),
    },
  );
  const normByWorkItem = new Map(
    context.analysisSnapshot.materialNorms.map((norm) => [norm.workItemId, norm]),
  );
  const materialById = new Map(
    context.analysisSnapshot.materials.map((material) => [material.materialId, material]),
  );
  const predecessorsBySuccessor = new Map<string, string[]>();
  for (const dependency of context.analysisSnapshot.dependencies) {
    const predecessors = predecessorsBySuccessor.get(dependency.successorWorkItemId) ?? [];
    predecessors.push(dependency.predecessorWorkItemId);
    predecessorsBySuccessor.set(dependency.successorWorkItemId, predecessors);
  }
  const isolatedSubjectIds = new Set(
    scenario !== undefined && dailyPlanningScenarios.has(scenario)
      ? scenarioSubjects[scenario]
      : [],
  );
  const forcedCompletedPredecessorIds = new Set<string>();
  if (scenario !== "PREDECESSOR_UNFINISHED") {
    for (const subjectId of isolatedSubjectIds) {
      for (const predecessorId of predecessorsBySuccessor.get(subjectId) ?? []) {
        if (!isolatedSubjectIds.has(predecessorId)) {
          forcedCompletedPredecessorIds.add(predecessorId);
        }
      }
    }
  }

  const workItems: OperationalWorkItem[] = context.analysisSnapshot.workItems.map((workItem) => {
    const currentStage = stageIndex(workItem);
    const unit = canonicalUnit(workItem.unit);
    const plannedValue = Number(workItem.plannedQuantity);
    const cumulative = latestCumulativeQuantity(
      context.analysisSnapshot,
      workItem.workItemId,
      date,
    );
    const rawRemainingValue = Math.max(0, plannedValue - cumulative);
    const forceCompleted = forcedCompletedPredecessorIds.has(workItem.workItemId);
    const remainingValue = forceCompleted ? 0 : rawRemainingValue;
    const leaf = workItem.parentWorkItemId !== null;
    const norm = normByWorkItem.get(workItem.workItemId);
    const material = norm === undefined ? undefined : materialById.get(norm.materialId);
    const requiredMaterialValue =
      norm === undefined
        ? 0
        : plannedValue * Number(norm.quantityPerWorkUnit) * (1 + norm.wastePercent / 100);
    const scenarioEquipment =
      scenario === "EQUIPMENT_DOUBLE_BOOKING" &&
      scenarioSubjects[scenario].includes(workItem.workItemId);
    const zoneAlternate =
      scenario === "ZONE_CONFLICT" && workItem.workItemId === scenarioSubjects.ZONE_CONFLICT[1];

    return {
      workItemId: workItem.workItemId,
      activityId: `activity-${workItem.workItemId}`,
      code: workItem.code,
      name: workItem.name,
      zoneCode: leaf ? `ZONE-${String(currentStage + 1).padStart(2, "0")}` : null,
      workClassCode: stageWorkClasses[currentStage]!,
      unit,
      plannedQuantity: {
        value: formatDecimal(plannedValue),
        unit,
        sourceRefs: [scheduleSource],
      },
      remainingQuantity: {
        value: formatDecimal(remainingValue),
        unit,
        sourceRefs: [scheduleSource],
      },
      status:
        forceCompleted || remainingValue <= 0
          ? "COMPLETED"
          : cumulative > 0
            ? "IN_PROGRESS"
            : "NOT_STARTED",
      priority: workItem.priority,
      isCritical: workItem.isCritical,
      totalFloatWorkingDays: workItem.isCritical ? 0 : 2 + currentStage,
      downstreamUnlockCount: context.analysisSnapshot.dependencies.filter(
        (dependency) => dependency.predecessorWorkItemId === workItem.workItemId,
      ).length,
      contractMilestone: workItem.workItemId === "work-item-048",
      plannedStart: isolatedSubjectIds.has(workItem.workItemId)
        ? date < workItem.plannedStart
          ? date
          : workItem.plannedStart
        : workItem.plannedStart,
      plannedFinish: isolatedSubjectIds.has(workItem.workItemId)
        ? date > workItem.plannedEnd
          ? date
          : workItem.plannedEnd
        : workItem.plannedEnd,
      predecessorWorkItemIds: (predecessorsBySuccessor.get(workItem.workItemId) ?? []).filter(
        (predecessorId) => !(scenario === "ZONE_CONFLICT" && isolatedSubjectIds.has(predecessorId)),
      ),
      requiredInspectionIds: leaf ? [`inspection-${workItem.workItemId}`] : [],
      requiredCrewType: leaf
        ? zoneAlternate
          ? "EXTERIOR_CREW_ALT"
          : stageCrewTypes[currentStage]!
        : null,
      requiredEquipmentIds: leaf
        ? [
            zoneAlternate
              ? "equipment-zone-alt-01"
              : scenarioEquipment
                ? "equipment-shared-01"
                : stageEquipmentIds[currentStage]!,
          ]
        : [],
      requiredMaterials:
        leaf && norm !== undefined && material !== undefined
          ? [
              {
                materialId: material.materialId,
                quantity: {
                  value: formatDecimal(requiredMaterialValue),
                  unit: canonicalUnit(material.unit),
                  sourceRefs: [scheduleSource],
                },
              },
            ]
          : [],
      weatherRestrictions: stageWorkClasses[currentStage] === "EXTERIOR" ? ["NO_HEAVY_RAIN"] : [],
      safetyRestrictions: leaf ? ["ACCESS_CLEAR"] : [],
      sourceRefs: [scheduleSource],
    };
  });

  const crews: OperationalPlanningSnapshotV1["crews"] = [
    ...stageCrewTypes.map((crewType, index) => {
      const unavailable = scenario === "CREW_UNAVAILABLE" && crewType === stageCrewTypes[4];
      const unit: OperationalPlanningSnapshotV1["crews"][number]["productivityPerShift"]["unit"] =
        index <= 2 ? "m3" : index === 3 ? "m2" : "m";
      return {
        crewId: `crew-${String(index + 1).padStart(2, "0")}`,
        crewType,
        headcount: 5 + (index % 4),
        shiftStart: "08:00",
        shiftEnd: "17:00",
        productivityPerShift: {
          value: formatDecimal(8 + index * 1.25),
          unit,
          sourceRefs: [resourceSource],
        },
        productivityVersion: {
          tenantId: context.analysisSnapshot.tenantId,
          projectId: context.analysisSnapshot.projectId,
          catalogType: "PRODUCTIVITY" as const,
          versionId: "productivity-catalog-version-001",
          version: 1,
          effectiveFrom: BUILDWATCH_SIMULATION_WINDOW_START,
          effectiveTo: null,
          approvedBy: "user-project-director",
          approvedAt: "2026-01-02T05:00:00.000Z",
          sourceRefs: [productivityCatalogSource],
        },
        availableFrom: BUILDWATCH_SIMULATION_WINDOW_START,
        availableTo: BUILDWATCH_SIMULATION_WINDOW_END,
        available: !unavailable,
        sourceRefs: [resourceSource],
      };
    }),
    ...(scenario === "ZONE_CONFLICT"
      ? [
          {
            crewId: "crew-zone-alt-01",
            crewType: "EXTERIOR_CREW_ALT",
            headcount: 6,
            shiftStart: "08:00",
            shiftEnd: "17:00",
            productivityPerShift: {
              value: "15.5",
              unit: "m" as const,
              sourceRefs: [resourceSource],
            },
            productivityVersion: {
              tenantId: context.analysisSnapshot.tenantId,
              projectId: context.analysisSnapshot.projectId,
              catalogType: "PRODUCTIVITY" as const,
              versionId: "productivity-catalog-version-001",
              version: 1,
              effectiveFrom: BUILDWATCH_SIMULATION_WINDOW_START,
              effectiveTo: null,
              approvedBy: "user-project-director",
              approvedAt: "2026-01-02T05:00:00.000Z",
              sourceRefs: [productivityCatalogSource],
            },
            availableFrom: BUILDWATCH_SIMULATION_WINDOW_START,
            availableTo: BUILDWATCH_SIMULATION_WINDOW_END,
            available: true,
            sourceRefs: [resourceSource],
          },
        ]
      : []),
  ];

  const equipment: OperationalPlanningSnapshotV1["equipment"] = [
    ...stageEquipmentIds.map((equipmentId, index) => ({
      equipmentId,
      equipmentType: equipmentId
        .replace(/^equipment-/u, "")
        .replace(/-01$/u, "")
        .toUpperCase(),
      capacityPerShift: {
        value: formatDecimal(12 + index * 2),
        unit: index <= 2 ? ("m3" as const) : index === 3 ? ("m2" as const) : ("m" as const),
        sourceRefs: [resourceSource],
      },
      availableFrom: BUILDWATCH_SIMULATION_WINDOW_START,
      availableTo: BUILDWATCH_SIMULATION_WINDOW_END,
      available: true,
      sourceRefs: [resourceSource],
    })),
    {
      equipmentId: "equipment-shared-01",
      equipmentType: "SHARED_LIFT",
      capacityPerShift: {
        value: "18",
        unit: "m",
        sourceRefs: [resourceSource],
      },
      availableFrom: BUILDWATCH_SIMULATION_WINDOW_START,
      availableTo: BUILDWATCH_SIMULATION_WINDOW_END,
      available: true,
      sourceRefs: [resourceSource],
    },
    ...(scenario === "ZONE_CONFLICT"
      ? [
          {
            equipmentId: "equipment-zone-alt-01",
            equipmentType: "ZONE_ALT_LIFT",
            capacityPerShift: {
              value: "24",
              unit: "m" as const,
              sourceRefs: [resourceSource],
            },
            availableFrom: BUILDWATCH_SIMULATION_WINDOW_START,
            availableTo: BUILDWATCH_SIMULATION_WINDOW_END,
            available: true,
            sourceRefs: [resourceSource],
          },
        ]
      : []),
  ];

  const shortageMaterialId =
    workItems.find((workItem) => workItem.workItemId === scenarioSubjects.MATERIAL_SHORTAGE[0])
      ?.requiredMaterials[0]?.materialId ?? null;
  const partialTargetWorkItem = workItems.find(
    (workItem) => workItem.workItemId === scenarioSubjects.PLANNED_TARGET_PARTIAL[0],
  );
  const partialTargetMaterial = partialTargetWorkItem?.requiredMaterials[0];
  const partialTargetAvailable =
    partialTargetMaterial === undefined || partialTargetWorkItem === undefined
      ? null
      : (Number(partialTargetMaterial.quantity.value) /
          Number(partialTargetWorkItem.plannedQuantity.value)) *
        4;
  const materials: OperationalPlanningSnapshotV1["materials"] =
    context.analysisSnapshot.materials.map((material) => ({
      materialId: material.materialId,
      availableQuantity: {
        value:
          scenario === "MATERIAL_SHORTAGE" && material.materialId === shortageMaterialId
            ? "0"
            : scenario === "PLANNED_TARGET_PARTIAL" &&
                partialTargetMaterial !== undefined &&
                material.materialId === partialTargetMaterial.materialId &&
                partialTargetAvailable !== null
              ? formatDecimal(partialTargetAvailable)
              : "1000000",
        unit: canonicalUnit(material.unit),
        sourceRefs: [materialSource],
      },
      reservedQuantity: {
        value: "0",
        unit: canonicalUnit(material.unit),
        sourceRefs: [materialSource],
      },
      asOf: dateTime(date, 4),
      sourceRefs: [materialSource],
    }));

  const zones: OperationalPlanningSnapshotV1["zones"] = stageWorkClasses.map(
    (_workClass, index) => ({
      zoneCode: `ZONE-${String(index + 1).padStart(2, "0")}`,
      maxConcurrentActivities: scenario === "ZONE_CONFLICT" && index === 6 ? 1 : 2,
      available: true,
      sourceRefs: [resourceSource],
    }),
  );

  const inspections: OperationalPlanningSnapshotV1["inspections"] = workItems
    .filter((workItem) => workItem.zoneCode !== null)
    .map((workItem) => {
      const pending =
        scenario === "INSPECTION_PENDING" &&
        scenarioSubjects[scenario].includes(workItem.workItemId);
      const source = context.sourceRegistry.get(
        `inspection-${workItem.workItemId}-${date}`,
        "INSPECTION",
        { asOf: dateTime(date, 4) },
      );
      return {
        inspectionId: `inspection-${workItem.workItemId}`,
        workItemId: workItem.workItemId,
        code: `PRESTART-${workItem.workItemId}`,
        status: pending ? ("PENDING" as const) : ("PASSED" as const),
        decidedAt: pending
          ? null
          : dateTime(addWorkingDays(date, -1, BUILDWATCH_SIMULATION_CALENDAR), 10),
        sourceRefs: [source],
      };
    });

  const blockers: OperationalPlanningSnapshotV1["blockers"] = [];
  const approvedBlockerDate = context.scenarioDates.get("APPROVED_BLOCKER")!;
  if (date >= approvedBlockerDate) {
    const source = context.sourceRegistry.get("approved-blocker-material-001", "BLOCKER", {
      asOf: dateTime(approvedBlockerDate, 4),
    });
    blockers.push({
      blockerId: "approved-blocker-material-001",
      workItemId: scenarioSubjects.APPROVED_BLOCKER[0]!,
      category: "MATERIAL",
      isOpen: true,
      approved: true,
      startedOn: approvedBlockerDate,
      resolvedOn: null,
      sourceRefs: [source],
    });
  }

  const weatherConstraints: OperationalPlanningSnapshotV1["weatherConstraints"] = [
    {
      weatherConstraintId: `weather-constraint-${date}`,
      date,
      weatherCode: scenario === "HEAVY_RAIN_RESTRICTION" ? "HEAVY_RAIN" : "CLEAR",
      restrictedWorkClassCodes: scenario === "HEAVY_RAIN_RESTRICTION" ? ["EXTERIOR"] : [],
      sourceRefs: [weatherSource],
    },
  ];

  const latestApprovedEntryByWorkItem = new Map<
    string,
    ProjectAnalysisSnapshotV1["progressEntries"][number]
  >();
  for (const entry of context.analysisSnapshot.progressEntries) {
    if (entry.capturedAt.slice(0, 10) > date) {
      continue;
    }
    const previous = latestApprovedEntryByWorkItem.get(entry.workItemId);
    if (previous === undefined || previous.capturedAt < entry.capturedAt) {
      latestApprovedEntryByWorkItem.set(entry.workItemId, entry);
    }
  }
  const approvedActuals: OperationalPlanningSnapshotV1["approvedActuals"] = [
    ...latestApprovedEntryByWorkItem.values(),
  ].map((entry) => {
    const workItem = context.workItemById.get(entry.workItemId)!;
    const reportSource = context.sourceRegistry.get(entry.dailyReportId, "DAILY_REPORT", {
      asOf: entry.capturedAt,
    });
    return {
      actualId: `approved-actual-${entry.progressEntryId}`,
      workItemId: entry.workItemId,
      reportDate: entry.capturedAt.slice(0, 10),
      approvedQuantity: {
        value: entry.quantityDoneIncrement,
        unit: canonicalUnit(workItem.unit),
        sourceRefs: [reportSource],
      },
      progressVerificationId: `approved-verification-${entry.progressEntryId}`,
      approvedAt: dateTime(entry.capturedAt.slice(0, 10), 12),
      sourceRefs: [reportSource],
    };
  });

  return operationalPlanningSnapshotV1Schema.parse({
    schemaVersion: 1,
    snapshotType: "OPERATIONAL_PLANNING",
    snapshotId: `operational-snapshot-${date}`,
    tenantId: context.analysisSnapshot.tenantId,
    projectId: context.analysisSnapshot.projectId,
    asOf: dateTime(date, 4),
    baselineVersionId: context.analysisSnapshot.activeBaseline.baselineVersionId,
    scheduleVersionId: "schedule-version-001",
    policyVersion: {
      policyVersionId: "planning-policy-version-001",
      version: 1,
      effectiveFrom: BUILDWATCH_SIMULATION_WINDOW_START,
    },
    calendar: {
      calendarVersionId: "calendar-version-001",
      timezone: context.analysisSnapshot.activeBaseline.calendar.timezone,
      workingWeekdays: [...context.analysisSnapshot.activeBaseline.calendar.workingWeekdays],
      workHoursPerDay: context.analysisSnapshot.activeBaseline.calendar.workHoursPerDay,
      holidays: [...context.analysisSnapshot.activeBaseline.calendar.holidays],
      effectiveFrom: BUILDWATCH_SIMULATION_WINDOW_START,
      effectiveTo: null,
      sourceRefs: [calendarSource],
    },
    workItems,
    crews,
    equipment,
    materials,
    zones,
    inspections,
    blockers,
    weatherConstraints,
    approvedActuals,
  });
}

function subjectIdsForPlan(scenario: OperationalSimulationScenario | undefined): string[] {
  if (scenario === undefined || scenario === "CRITICAL_WORK_OMITTED") {
    return [];
  }
  return scenarioSubjects[scenario];
}

function selectPlanWorkItems(
  context: OperationalBuildContext,
  snapshot: OperationalPlanningSnapshotV1,
  scenario: OperationalSimulationScenario | undefined,
  dateIndex: number,
): OperationalWorkItem[] {
  const selectedIds = [...subjectIdsForPlan(scenario)];
  const omittedIds = new Set(
    scenario === "CRITICAL_WORK_OMITTED" ? scenarioSubjects[scenario] : [],
  );
  const rotatedLeafIds = [
    ...context.leafWorkItemIds.slice((dateIndex * 3) % context.leafWorkItemIds.length),
    ...context.leafWorkItemIds.slice(0, (dateIndex * 3) % context.leafWorkItemIds.length),
  ];
  for (const workItemId of rotatedLeafIds) {
    if (selectedIds.length >= 3 || selectedIds.includes(workItemId) || omittedIds.has(workItemId)) {
      continue;
    }
    selectedIds.push(workItemId);
  }

  const workItemMap = new Map(
    snapshot.workItems.map((workItem) => [workItem.workItemId, workItem]),
  );
  return selectedIds
    .slice(0, 3)
    .map((workItemId) => workItemMap.get(workItemId)!)
    .filter((workItem) => workItem !== undefined);
}

function buildDailyPlan(
  date: string,
  dateIndex: number,
  snapshot: OperationalPlanningSnapshotV1,
  context: OperationalBuildContext,
): DailyWorkPlanDraftV1 {
  const scenario = context.scenarioByDate.get(date);
  const selectedWorkItems = selectPlanWorkItems(context, snapshot, scenario, dateIndex);
  const calculationSource = context.sourceRegistry.get(
    `daily-plan-calculation-${date}`,
    "SYSTEM_CALCULATION",
    { asOf: dateTime(date, 5) },
  );
  const scheduleSource = context.sourceRegistry.get("schedule-version-001", "SCHEDULE_VERSION");
  const resourceSource = context.sourceRegistry.get(
    `resource-availability-${date}`,
    "RESOURCE_AVAILABILITY",
  );
  const materialSource = context.sourceRegistry.get(`material-ledger-${date}`, "MATERIAL_LEDGER");
  const weatherSource = context.sourceRegistry.get(
    `weather-logistics-${date}`,
    "WEATHER_LOGISTICS",
  );
  const subjectIds = scenario === undefined ? [] : scenarioSubjects[scenario];

  const items: DailyPlanItem[] = selectedWorkItems.map((workItem, itemIndex) => {
    const applies = scenario !== undefined && subjectIds.includes(workItem.workItemId);
    const remainingValue = Number(workItem.remainingQuantity.value);
    const effectiveRemaining =
      remainingValue > 0 ? remainingValue : Math.min(5, Number(workItem.plannedQuantity.value));
    let targetValue = round(Math.max(0.5, Math.min(effectiveRemaining, 8 + itemIndex)));
    if (scenario === "PLANNED_TARGET_PARTIAL" && applies) {
      targetValue = round(Math.max(0.5, targetValue / 2));
    }

    const crew = snapshot.crews.find(
      (candidate) => candidate.crewType === workItem.requiredCrewType,
    );
    const equipment = snapshot.equipment.find((candidate) =>
      workItem.requiredEquipmentIds.includes(candidate.equipmentId),
    );
    const zone =
      workItem.zoneCode === null
        ? undefined
        : snapshot.zones.find((candidate) => candidate.zoneCode === workItem.zoneCode);
    const requiredMaterial = workItem.requiredMaterials[0];
    const material =
      requiredMaterial === undefined
        ? undefined
        : snapshot.materials.find(
            (candidate) => candidate.materialId === requiredMaterial.materialId,
          );
    const dailyMaterialValue =
      requiredMaterial === undefined
        ? 0
        : round(
            (Number(requiredMaterial.quantity.value) * targetValue) /
              Math.max(1, Number(workItem.plannedQuantity.value)),
          );
    const infeasibleScenario =
      applies &&
      [
        "PREDECESSOR_UNFINISHED",
        "MATERIAL_SHORTAGE",
        "CREW_UNAVAILABLE",
        "HEAVY_RAIN_RESTRICTION",
        "INSPECTION_PENDING",
        "APPROVED_BLOCKER",
      ].includes(scenario ?? "");
    const noRemaining = remainingValue <= 0;
    const feasible = !infeasibleScenario && !noRemaining;
    const reasonCodes: string[] = [];
    if (noRemaining) {
      reasonCodes.push("NO_REMAINING_QUANTITY");
    }
    if (infeasibleScenario && scenario !== undefined) {
      reasonCodes.push(scenario);
    }
    const sources = [scheduleSource, resourceSource, calculationSource];

    const resources: DailyPlanItem["resources"] = [];
    if (crew !== undefined) {
      resources.push({
        assignmentId: `assignment-${date}-${workItem.workItemId}-crew`,
        resourceType: "CREW",
        resourceId: crew.crewId,
        plannedStartTime: "08:00",
        plannedEndTime: "17:00",
        capacity: crew.productivityPerShift,
        sourceRefs: crew.sourceRefs,
      });
    }
    if (equipment !== undefined) {
      resources.push({
        assignmentId: `assignment-${date}-${workItem.workItemId}-equipment`,
        resourceType: "EQUIPMENT",
        resourceId: equipment.equipmentId,
        plannedStartTime: "08:00",
        plannedEndTime: "17:00",
        capacity: equipment.capacityPerShift,
        sourceRefs: equipment.sourceRefs,
      });
    }
    if (zone !== undefined) {
      resources.push({
        assignmentId: `assignment-${date}-${workItem.workItemId}-zone`,
        resourceType: "ZONE",
        resourceId: zone.zoneCode,
        plannedStartTime: "08:00",
        plannedEndTime: "17:00",
        capacity: null,
        sourceRefs: zone.sourceRefs,
      });
    }

    const materials: DailyPlanItem["materials"] =
      requiredMaterial === undefined || material === undefined
        ? []
        : [
            {
              requirementId: `daily-material-${date}-${workItem.workItemId}`,
              materialId: requiredMaterial.materialId,
              requiredQuantity: {
                value: formatDecimal(dailyMaterialValue),
                unit: requiredMaterial.quantity.unit,
                sourceRefs: [materialSource],
              },
              availableQuantity: material.availableQuantity,
              sourceRefs: [materialSource],
            },
          ];

    const preconditions: DailyPlanItem["preconditions"] = [];
    for (const [predecessorIndex, predecessorId] of workItem.predecessorWorkItemIds.entries()) {
      const unsatisfied =
        scenario === "PREDECESSOR_UNFINISHED" && applies && predecessorIndex === 0;
      preconditions.push({
        preconditionId: `precondition-${date}-${workItem.workItemId}-predecessor-${predecessorIndex + 1}`,
        type: "PREDECESSOR",
        referenceId: predecessorId,
        status: unsatisfied ? "UNSATISFIED" : "SATISFIED",
        message: unsatisfied ? "Өмнөх ажил дуусаагүй." : "Өмнөх ажлын нөхцөл хангагдсан.",
        sourceRefs: [scheduleSource],
      });
    }
    for (const inspectionId of workItem.requiredInspectionIds) {
      const inspection = snapshot.inspections.find(
        (candidate) => candidate.inspectionId === inspectionId,
      )!;
      const satisfied = inspection.status !== "PENDING";
      preconditions.push({
        preconditionId: `precondition-${date}-${workItem.workItemId}-inspection`,
        type: "INSPECTION",
        referenceId: inspectionId,
        status: satisfied ? "SATISFIED" : "UNSATISFIED",
        message: satisfied ? "Inspection тэнцсэн." : "Inspection шийдвэр хүлээгдэж байна.",
        sourceRefs: inspection.sourceRefs,
      });
    }
    if (workItem.weatherRestrictions.length > 0) {
      const restricted = scenario === "HEAVY_RAIN_RESTRICTION" && applies;
      preconditions.push({
        preconditionId: `precondition-${date}-${workItem.workItemId}-weather`,
        type: "WEATHER",
        referenceId: `weather-constraint-${date}`,
        status: restricted ? "UNSATISFIED" : "SATISFIED",
        message: restricted
          ? "Хүчтэй бороонд гадна ажил хориглогдсон."
          : "Цаг агаарын нөхцөл хэвийн.",
        sourceRefs: [weatherSource],
      });
    }
    if (scenario === "APPROVED_BLOCKER" && applies) {
      const blocker = snapshot.blockers.find(
        (candidate) => candidate.blockerId === "approved-blocker-material-001",
      )!;
      preconditions.push({
        preconditionId: `precondition-${date}-${workItem.workItemId}-blocker`,
        type: "BLOCKER",
        referenceId: blocker.blockerId,
        status: "UNSATISFIED",
        message: "Батлагдсан blocker нээлттэй.",
        sourceRefs: blocker.sourceRefs,
      });
    }
    if (scenario === "MATERIAL_SHORTAGE" && applies && material !== undefined) {
      preconditions.push({
        preconditionId: `precondition-${date}-${workItem.workItemId}-material`,
        type: "MATERIAL",
        referenceId: material.materialId,
        status: "UNSATISFIED",
        message: "Материалын боломжит үлдэгдэл хүрэлцэхгүй.",
        sourceRefs: [materialSource],
      });
    }

    const limitingFactor =
      scenario === "PLANNED_TARGET_PARTIAL" && applies
        ? "MATERIAL_AVAILABILITY"
        : feasible
          ? "CREW_PRODUCTIVITY"
          : noRemaining
            ? "REMAINING_QUANTITY"
            : "INSUFFICIENT_INFORMATION";

    return {
      planItemId: `plan-item-${date}-${workItem.workItemId}`,
      workItemId: workItem.workItemId,
      sourceScheduleActivityId: workItem.activityId,
      workCode: workItem.code,
      workName: workItem.name,
      zoneCode: workItem.zoneCode,
      unit: workItem.unit,
      plannedQuantity: {
        value: formatDecimal(targetValue),
        unit: workItem.unit,
        sourceRefs: [calculationSource],
      },
      plannedStartTime: "08:00",
      plannedEndTime: "17:00",
      priorityRank: itemIndex + 1,
      criticality: workItem.isCritical
        ? "CRITICAL"
        : workItem.totalFloatWorkingDays <= 3
          ? "NEAR_CRITICAL"
          : "NON_CRITICAL",
      status: "PLANNED",
      resources,
      materials,
      preconditions,
      evidenceRuleId: `evidence-rule-${workItem.workClassCode.toLowerCase()}`,
      feasibility: {
        eligible: !infeasibleScenario && !noRemaining,
        feasible,
        targetQuantity: feasible
          ? {
              value: formatDecimal(targetValue),
              unit: workItem.unit,
              sourceRefs: [calculationSource],
            }
          : null,
        limitingFactor,
        reasonCodes,
        sourceRefs: [...sources, ...(materials.length > 0 ? [materialSource] : [])],
      },
      sourceRefs: [scheduleSource, calculationSource],
    };
  });

  const conflicts: DailyWorkPlanDraftV1["content"]["conflicts"] = [];
  const conflictSource = context.sourceRegistry.get(
    `daily-plan-conflict-${date}`,
    "SYSTEM_CALCULATION",
    { asOf: dateTime(date, 5) },
  );
  const firstSubjectItem = items.find((item) => subjectIds.includes(item.workItemId));
  if (
    scenario === "PREDECESSOR_UNFINISHED" ||
    scenario === "INSPECTION_PENDING" ||
    scenario === "APPROVED_BLOCKER"
  ) {
    conflicts.push({
      conflictId: `conflict-${date}-precondition`,
      type: "PRECONDITION_UNSATISFIED",
      severity: "ERROR",
      planItemIds: [firstSubjectItem!.planItemId],
      resourceId: null,
      message: "Заавал хангах precondition биелээгүй.",
      sourceRefs: [conflictSource],
    });
  }
  if (scenario === "MATERIAL_SHORTAGE") {
    conflicts.push({
      conflictId: `conflict-${date}-material`,
      type: "MATERIAL_SHORTAGE",
      severity: "ERROR",
      planItemIds: [firstSubjectItem!.planItemId],
      resourceId: firstSubjectItem!.materials[0]!.materialId,
      message: "Материалын үлдэгдэл өдрийн target-д хүрэлцэхгүй.",
      sourceRefs: [materialSource, conflictSource],
    });
  }
  if (scenario === "EQUIPMENT_DOUBLE_BOOKING") {
    conflicts.push({
      conflictId: `conflict-${date}-equipment`,
      type: "EQUIPMENT_DOUBLE_BOOKING",
      severity: "ERROR",
      planItemIds: items
        .filter((item) => subjectIds.includes(item.workItemId))
        .map((item) => item.planItemId),
      resourceId: "equipment-shared-01",
      message: "Ижил тоног төхөөрөмж 08:00–17:00 цагт хоёр ажилд давхар оноогдсон.",
      sourceRefs: [resourceSource, conflictSource],
    });
  }
  if (scenario === "ZONE_CONFLICT") {
    conflicts.push({
      conflictId: `conflict-${date}-zone`,
      type: "ZONE_OVER_CAPACITY",
      severity: "ERROR",
      planItemIds: items
        .filter((item) => subjectIds.includes(item.workItemId))
        .map((item) => item.planItemId),
      resourceId: "ZONE-07",
      message: "Zone capacity 1 боловч хоёр ажил зэрэг төлөвлөгдсөн.",
      sourceRefs: [resourceSource, conflictSource],
    });
  }
  if (scenario === "HEAVY_RAIN_RESTRICTION") {
    conflicts.push({
      conflictId: `conflict-${date}-weather`,
      type: "WEATHER_RESTRICTION",
      severity: "ERROR",
      planItemIds: [firstSubjectItem!.planItemId],
      resourceId: null,
      message: "HEAVY_RAIN нөхцөлд EXTERIOR ажил хориглогдсон.",
      sourceRefs: [weatherSource, conflictSource],
    });
  }

  const validationIssues: DailyWorkPlanDraftV1["validationIssues"] = [];
  if (scenario === "CREW_UNAVAILABLE") {
    validationIssues.push({
      code: "CREW_UNAVAILABLE",
      severity: "ERROR",
      fieldPaths: [`content.items.${firstSubjectItem!.planItemId}.resources`],
      message: "Шаардлагатай баг тухайн өдөр available биш.",
      deterministic: true,
    });
  }
  if (scenario === "CRITICAL_WORK_OMITTED") {
    validationIssues.push({
      code: "CRITICAL_WORK_OMITTED",
      severity: "WARNING",
      fieldPaths: ["content.items"],
      message: "Eligible critical work-item-017 төлөвлөгөөнд ороогүй.",
      deterministic: true,
    });
  }

  const hasBlockingIssue =
    items.some((item) => !item.feasibility.feasible) ||
    conflicts.some((conflict) => conflict.severity === "ERROR") ||
    validationIssues.some((issue) => issue.severity === "ERROR");

  return dailyWorkPlanDraftV1Schema.parse({
    schemaVersion: 1,
    draftType: "DAILY_WORK_PLAN",
    draftId: `daily-plan-draft-${date}`,
    tenantId: context.analysisSnapshot.tenantId,
    projectId: context.analysisSnapshot.projectId,
    status: hasBlockingIssue ? "DRAFT" : "REVIEW_REQUIRED",
    content: {
      planDate: date,
      timezone: context.analysisSnapshot.activeBaseline.calendar.timezone,
      baselineVersionId: context.analysisSnapshot.activeBaseline.baselineVersionId,
      scheduleVersionId: "schedule-version-001",
      operationalSnapshotId: snapshot.snapshotId,
      items,
      conflicts,
    },
    validationIssues,
    requiresHumanReview: true,
    generatedAt: dateTime(date, 5),
    generatedBy: "A5",
  });
}

function verificationPhotoChecks(
  scenario: OperationalSimulationScenario | undefined,
  applies: boolean,
  photo: OperationalPhotoMetadataV1,
): VerificationItem["photoChecks"] {
  const sourceRefs = photo.sourceRefs;
  const makeCheck = (
    code: VerificationItem["photoChecks"][number]["code"],
    result: VerificationItem["photoChecks"][number]["result"],
    score: number | null,
    message: string,
  ): VerificationItem["photoChecks"][number] => ({
    checkId: `photo-check-${photo.photoId}-${code.toLocaleLowerCase()}`,
    photoArtifactId: photo.artifactId,
    code,
    result,
    score,
    message,
    deterministic: true,
    sourceRefs,
  });
  const qualityPass =
    photo.sharpnessScore >= 0.25 && photo.brightnessScore >= 0.2 && photo.brightnessScore <= 0.95;
  const datePass =
    photo.capturedAt.slice(0, 10) === photo.reportDate && photo.capturedAt <= photo.uploadedAt;
  const linkPass =
    photo.detectedWorkItemId === null || photo.detectedWorkItemId === photo.reportedWorkItemId;
  const privacyPass = photo.privacyStatus !== "RESTRICTED";
  const contradiction = scenario === "FALSE_COMPLETED" && applies;

  return [
    makeCheck("PE-01", "PASS", 1, "Зургийн файл decode/open шалгалт тэнцсэн."),
    makeCheck(
      "PE-02",
      qualityPass ? "PASS" : "FAIL",
      Math.min(photo.sharpnessScore, photo.brightnessScore),
      qualityPass ? "Blur/darkness quality босго тэнцсэн." : "Blur эсвэл exposure босго зөрсөн.",
    ),
    makeCheck(
      "PE-03",
      photo.duplicateOfPhotoId === null ? "PASS" : "FAIL",
      photo.duplicateOfPhotoId === null ? 1 : 0,
      photo.duplicateOfPhotoId === null
        ? "Exact/near duplicate signal илрээгүй."
        : "Exact duplicate зураг илэрсэн.",
    ),
    makeCheck(
      "PE-04",
      photo.reusedFromReportDate === null ? "PASS" : "FAIL",
      photo.reusedFromReportDate === null ? 1 : 0,
      photo.reusedFromReportDate === null
        ? "Previous-day reuse signal илрээгүй."
        : "Өмнөх өдрийн зураг дахин ашиглагдсан.",
    ),
    makeCheck(
      "PE-05",
      datePass ? "PASS" : "FAIL",
      datePass ? 1 : 0,
      datePass ? "Capture/report date нийцсэн." : "Capture/report date зөрсөн.",
    ),
    makeCheck(
      "PE-06",
      linkPass ? "PASS" : "FAIL",
      linkPass ? 1 : 0,
      linkPass ? "Project/work item linkage нийцсэн." : "Reported/detected work item зөрсөн.",
    ),
    makeCheck("PE-07", "PASS", 1, "Required angle бүрдсэн."),
    makeCheck("PE-08", "PASS", 1, "Reference marker бүрдсэн."),
    makeCheck(
      "PE-09",
      contradiction ? "WARNING" : "NOT_APPLICABLE",
      contradiction ? 0.5 : null,
      contradiction
        ? "Зураг target бүрэн биелснийг батлахгүй."
        : "Text/photo contradiction signal шаардагдаагүй.",
    ),
    makeCheck(
      "PE-10",
      privacyPass ? "PASS" : "FAIL",
      privacyPass ? 1 : 0,
      privacyPass ? "Privacy signal cleared/redacted." : "Privacy review шаардлагатай.",
    ),
  ];
}

function buildPhotosAndVerifications(
  plans: DailyWorkPlanDraftV1[],
  context: OperationalBuildContext,
): PhotoVerificationBuild {
  const photos: OperationalPhotoMetadataV1[] = [];
  const verificationDrafts: ProgressVerificationDraftV1[] = [];
  let lastPhoto: OperationalPhotoMetadataV1 | null = null;

  for (const plan of plans) {
    const date = plan.content.planDate;
    const scenario = context.scenarioByDate.get(date);
    if (scenario === "MISSING_REPORT") {
      continue;
    }
    const subjectIds = scenario === undefined ? [] : scenarioSubjects[scenario];
    const photosForPlan: OperationalPhotoMetadataV1[] = [];

    for (const [itemIndex, item] of plan.content.items.entries()) {
      const applies = subjectIds.includes(item.workItemId);
      const photoId = `photo-${date}-${item.workItemId}`;
      const artifactId = `photo-artifact-${date}-${item.workItemId}`;
      const normalHash = sha256(`${context.seed}|${date}|${item.workItemId}|${itemIndex}`);
      const duplicate =
        applies &&
        (scenario === "DUPLICATE_PHOTO" || scenario === "PREVIOUS_DAY_REUSED_PHOTO") &&
        lastPhoto !== null;
      const photoHash = duplicate ? lastPhoto!.sha256 : normalHash;
      const mismatch = applies && scenario === "REPORT_PHOTO_MISMATCH";
      const lowQuality = applies && scenario === "BLURRY_DARK_PHOTO";
      const duplicateOfPhotoId =
        applies && scenario === "DUPLICATE_PHOTO" ? (lastPhoto?.photoId ?? null) : null;
      const reusedFromReportDate: string | null =
        applies && scenario === "PREVIOUS_DAY_REUSED_PHOTO"
          ? (lastPhoto?.reportDate ?? null)
          : null;
      const accepted =
        !lowQuality && duplicateOfPhotoId === null && reusedFromReportDate === null && !mismatch;
      const source = context.sourceRegistry.get(photoId, "PHOTO_EVIDENCE", {
        artifactId,
        asOf: dateTime(date, 10),
        sha256: photoHash,
      });
      const detectedWorkItemId = mismatch
        ? (plan.content.items.find((candidate) => candidate.workItemId !== item.workItemId)
            ?.workItemId ?? null)
        : item.workItemId;
      const photo: OperationalPhotoMetadataV1 = {
        schemaVersion: 1 as const,
        photoId,
        artifactId,
        tenantId: context.analysisSnapshot.tenantId,
        projectId: context.analysisSnapshot.projectId,
        reportDate: date,
        capturedAt:
          reusedFromReportDate === null ? dateTime(date, 10) : dateTime(reusedFromReportDate, 10),
        uploadedAt: dateTime(date, 11),
        reportedWorkItemId: item.workItemId,
        detectedWorkItemId,
        sha256: photoHash,
        perceptualHash: photoHash.slice(0, 16),
        widthPixels: 1920,
        heightPixels: 1080,
        sharpnessScore: lowQuality ? 0.12 : 0.92,
        brightnessScore: lowQuality ? 0.1 : 0.72,
        duplicateOfPhotoId,
        reusedFromReportDate,
        privacyStatus: "CLEARED" as const,
        acceptedForVerification: accepted,
        sourceRefs: [source],
      };
      photos.push(photo);
      photosForPlan.push(photo);
      lastPhoto = photo;
    }

    const reportSource = context.sourceRegistry.get(
      `operational-daily-report-${date}`,
      "DAILY_REPORT",
      { asOf: dateTime(date, 12) },
    );
    const calculationSource = context.sourceRegistry.get(
      `verification-calculation-${date}`,
      "SYSTEM_CALCULATION",
      { asOf: dateTime(date, 13) },
    );
    const planSource = context.sourceRegistry.get(
      `daily-plan-version-${date}`,
      "SCHEDULE_VERSION",
      {
        sourceVersionId: `daily-plan-version-${date}`,
        asOf: dateTime(date, 6),
      },
    );
    const engineerSource = context.sourceRegistry.get(
      `verification-engineer-decision-${date}`,
      "HUMAN_DECISION",
      { asOf: dateTime(date, 12) },
    );

    const verificationItems: VerificationItem[] = plan.content.items.map((item, itemIndex) => {
      const photo = photosForPlan[itemIndex]!;
      const applies = subjectIds.includes(item.workItemId);
      const invalidPhoto =
        applies &&
        [
          "BLURRY_DARK_PHOTO",
          "DUPLICATE_PHOTO",
          "PREVIOUS_DAY_REUSED_PHOTO",
          "REPORT_PHOTO_MISMATCH",
        ].includes(scenario ?? "");
      const planConflict = plan.content.conflicts.some(
        (conflict) =>
          conflict.severity === "ERROR" && conflict.planItemIds.includes(item.planItemId),
      );
      let completionStatus: VerificationItem["completionStatus"] = "COMPLETED";
      if (!item.feasibility.feasible || planConflict) {
        completionStatus = "NOT_STARTED";
      }
      if (scenario === "APPROVED_BLOCKER" && applies) {
        completionStatus = "BLOCKED";
      }
      if (invalidPhoto) {
        completionStatus = "UNVERIFIABLE";
      }
      if (scenario === "FALSE_COMPLETED" && applies) {
        completionStatus = "PARTIALLY_COMPLETED";
      }

      const plannedValue = Number(item.plannedQuantity.value);
      const verifiedValue =
        completionStatus === "UNVERIFIABLE"
          ? null
          : completionStatus === "COMPLETED"
            ? plannedValue
            : completionStatus === "PARTIALLY_COMPLETED"
              ? round(plannedValue / 2)
              : 0;
      const declaredValue =
        scenario === "FALSE_COMPLETED" && applies ? plannedValue : (verifiedValue ?? plannedValue);
      const issueSource = photo.sourceRefs[0]!;
      const issues: VerificationItem["issues"] = [];
      if (invalidPhoto) {
        issues.push({
          issueId: `verification-issue-${date}-${item.workItemId}`,
          code: scenario!,
          severity: "ERROR",
          message: scenarioRationales[scenario!],
          clarificationQuestion: "Шаардлага хангасан шинэ зураг болон хэмжилт оруулна уу?",
          blocksApproval: true,
          sourceRefs: [issueSource],
        });
      }
      if (scenario === "FALSE_COMPLETED" && applies) {
        issues.push({
          issueId: `verification-issue-${date}-${item.workItemId}-false-completed`,
          code: "FALSE_COMPLETED_CLAIM",
          severity: "WARNING",
          message: "Declared quantity target-тэй тэнцсэн боловч verified quantity дутуу.",
          clarificationQuestion: null,
          blocksApproval: false,
          sourceRefs: [reportSource, calculationSource],
        });
      }
      const evidenceAccepted = photo.acceptedForVerification ? 1 : 0;
      const variance =
        verifiedValue === null
          ? null
          : {
              quantity: {
                value: formatDecimal(verifiedValue - plannedValue),
                unit: item.unit,
                sourceRefs: [calculationSource],
              },
              percentage: formatDecimal(
                plannedValue === 0 ? 0 : ((verifiedValue - plannedValue) / plannedValue) * 100,
              ),
              percentageSourceRefs: [calculationSource],
            };
      const started = !["NOT_STARTED", "UNVERIFIABLE"].includes(completionStatus);

      return {
        verificationItemId: `verification-item-${date}-${item.workItemId}`,
        dailyPlanItemId: item.planItemId,
        workItemId: item.workItemId,
        dailyProgressEntryId: `operational-progress-${date}-${item.workItemId}`,
        reportDate: date,
        unit: item.unit,
        measurementMode: "QUANTITY" as const,
        plannedQuantity: {
          ...item.plannedQuantity,
          sourceRefs: [planSource],
        },
        declaredQuantity: {
          value: formatDecimal(declaredValue),
          unit: item.unit,
          sourceRefs: [reportSource],
        },
        verifiedQuantity:
          verifiedValue === null
            ? null
            : {
                value: formatDecimal(verifiedValue),
                unit: item.unit,
                sourceRefs: [reportSource, calculationSource],
              },
        cumulativeQuantity:
          verifiedValue === null
            ? null
            : {
                value: formatDecimal(verifiedValue),
                unit: item.unit,
                sourceRefs: [reportSource, calculationSource],
              },
        completionRatePercent:
          verifiedValue === null
            ? null
            : formatDecimal(
                plannedValue <= 0 ? 0 : Math.min(100, (verifiedValue / plannedValue) * 100),
              ),
        workStarted: completionStatus === "UNVERIFIABLE" ? true : started,
        crewOrEquipmentAssigned: !(scenario === "CREW_UNAVAILABLE" && applies),
        approvedBlockerId: completionStatus === "BLOCKED" ? "approved-blocker-material-001" : null,
        mandatoryChecklistStatus:
          completionStatus === "COMPLETED" || completionStatus === "PARTIALLY_COMPLETED"
            ? "PASSED"
            : completionStatus === "NOT_STARTED"
              ? "NOT_REQUIRED"
              : "MISSING",
        engineerDecision: {
          decisionId: `verification-engineer-decision-${date}-${item.workItemId}`,
          dailyPlanItemId: item.planItemId,
          workItemId: item.workItemId,
          action:
            completionStatus === "UNVERIFIABLE"
              ? ("REQUEST_CLARIFICATION" as const)
              : scenario === "FALSE_COMPLETED" && applies
                ? ("OVERRIDE_QUANTITY" as const)
                : ("ACCEPT_DECLARED" as const),
          reviewerId: "user-site-engineer",
          reviewerRole: "SITE_ENGINEER" as const,
          decidedAt: dateTime(date, 12),
          reason:
            completionStatus === "UNVERIFIABLE"
              ? "Evidence зөрчилтэй тул тодруулга шаардлагатай."
              : scenario === "FALSE_COMPLETED" && applies
                ? "Талбайн баталгаат хэмжилт declared quantity-гээс бага."
                : null,
          overrideQuantity:
            scenario === "FALSE_COMPLETED" && applies
              ? {
                  value: formatDecimal(verifiedValue!),
                  unit: item.unit,
                  sourceRefs: [engineerSource],
                }
              : null,
          sourceRefs: [engineerSource],
        },
        evidenceCoverage: {
          requiredCount: 1,
          acceptedCount: evidenceAccepted,
          coveragePercent: evidenceAccepted * 100,
          requiredAnglesComplete: evidenceAccepted === 1,
          referenceMarkerPresent: evidenceAccepted === 1 ? true : null,
          sourceRefs: [photo.sourceRefs[0]!],
        },
        photoChecks: verificationPhotoChecks(scenario, applies, photo),
        completionStatus,
        variance,
        confidence: invalidPhoto ? 0.2 : 0.94,
        issues,
        sourceRefs: [
          planSource,
          reportSource,
          photo.sourceRefs[0]!,
          calculationSource,
          engineerSource,
        ],
      };
    });

    const hasBlockingIssue = verificationItems.some((item) =>
      item.issues.some((issue) => issue.blocksApproval),
    );
    verificationDrafts.push(
      progressVerificationDraftV1Schema.parse({
        schemaVersion: 1,
        draftType: "PROGRESS_VERIFICATION",
        draftId: `progress-verification-draft-${date}`,
        tenantId: context.analysisSnapshot.tenantId,
        projectId: context.analysisSnapshot.projectId,
        status: hasBlockingIssue ? "DRAFT" : "REVIEW_REQUIRED",
        content: {
          dailyWorkPlanVersionId: `daily-plan-version-${date}`,
          dailyReportId: `operational-daily-report-${date}`,
          reportDate: date,
          items: verificationItems,
        },
        validationIssues: [],
        requiresHumanReview: true,
        createdAt: dateTime(date, 13),
        createdBy: "A5",
      }),
    );
  }

  return { photos, verificationDrafts };
}

function buildRollingProductivitySnapshot(
  date: string,
  status: ForecastStatus,
  workItem: OperationalWorkItem,
  context: OperationalBuildContext,
): RollingProductivitySnapshotV1 {
  const calculationSource = context.sourceRegistry.get(
    `productivity-calculation-${date}`,
    "SYSTEM_CALCULATION",
    { asOf: dateTime(date, 13) },
  );
  const normSource = context.sourceRegistry.get("productivity-catalog-v1", "CATALOG_VERSION");
  const insufficient = status === "INSUFFICIENT_DATA";
  const samples: RollingProductivitySnapshotV1["workItems"][number]["samples"] = insufficient
    ? []
    : [-2, -1, 0].map((offset, index) => {
        const reportDate = addWorkingDays(date, offset, BUILDWATCH_SIMULATION_CALENDAR);
        const reportSource = context.sourceRegistry.get(
          `forecast-report-${reportDate}`,
          "DAILY_REPORT",
          { asOf: dateTime(reportDate, 12) },
        );
        return {
          sampleId: `productivity-sample-${date}-${index + 1}`,
          workItemId: workItem.workItemId,
          reportDate,
          approvedVerificationId: `approved-forecast-verification-${reportDate}`,
          quantity: {
            value: formatDecimal(7.5 + index * 0.5),
            unit: workItem.unit,
            sourceRefs: [reportSource],
          },
          included: true,
          exclusionReason: null,
          outlierCandidate: false,
          sourceRefs: [reportSource],
        };
      });
  const sampleIds = samples.map((sample) => sample.sampleId);
  const rollingProductivity = {
    value: "8",
    unit: workItem.unit,
    sourceRefs: [calculationSource],
  };
  const windows = insufficient
    ? ([3, 7, 14] as const).map((windowWorkingDays) => ({
        windowWorkingDays,
        method: "INSUFFICIENT_DATA" as const,
        sampleIds: [],
        validSampleCount: 0,
        coveragePercent: 0,
        productivityPerWorkingDay: null,
        confidence: 0.15,
        sourceRefs: [calculationSource],
      }))
    : [
        {
          windowWorkingDays: 3 as const,
          method: "ROLLING_ACTUAL" as const,
          sampleIds,
          validSampleCount: sampleIds.length,
          coveragePercent: 100,
          productivityPerWorkingDay: rollingProductivity,
          confidence: 0.9,
          sourceRefs: [calculationSource],
        },
        {
          windowWorkingDays: 7 as const,
          method: "COLD_START_NORM" as const,
          sampleIds: [],
          validSampleCount: 0,
          coveragePercent: 42.86,
          productivityPerWorkingDay: {
            value: "7.5",
            unit: workItem.unit,
            sourceRefs: [normSource],
          },
          confidence: 0.6,
          sourceRefs: [normSource],
        },
        {
          windowWorkingDays: 14 as const,
          method: "INSUFFICIENT_DATA" as const,
          sampleIds: [],
          validSampleCount: 0,
          coveragePercent: 21.43,
          productivityPerWorkingDay: null,
          confidence: 0.2,
          sourceRefs: [calculationSource],
        },
      ];

  return rollingProductivitySnapshotV1Schema.parse({
    schemaVersion: 1,
    snapshotType: "ROLLING_PRODUCTIVITY",
    snapshotId: `rolling-productivity-${date}`,
    tenantId: context.analysisSnapshot.tenantId,
    projectId: context.analysisSnapshot.projectId,
    asOf: dateTime(date, 13),
    policyVersion: {
      policyVersionId: "forecast-policy-version-001",
      version: 1,
      effectiveFrom: BUILDWATCH_SIMULATION_WINDOW_START,
    },
    workItems: [
      {
        workItemId: workItem.workItemId,
        unit: workItem.unit,
        samples,
        windows,
        selectedWindowWorkingDays: insufficient ? null : 3,
        selectedProductivity: insufficient ? null : rollingProductivity,
      },
    ],
  });
}

function forecastDelayForStatus(status: ForecastStatus): number | null {
  switch (status) {
    case "ON_TRACK":
      return 0;
    case "AT_RISK":
      return 3;
    case "LIKELY_LATE":
      return 7;
    case "CRITICAL_LATE":
      return 12;
    case "INSUFFICIENT_DATA":
      return null;
  }
}

function buildForecastSnapshot(
  date: string,
  status: ForecastStatus,
  workItem: OperationalWorkItem,
  productivitySnapshot: RollingProductivitySnapshotV1,
  context: OperationalBuildContext,
): OperationalForecastSnapshotV1 {
  const calculationSource = context.sourceRegistry.get(
    `forecast-calculation-${date}`,
    "SYSTEM_CALCULATION",
    { asOf: dateTime(date, 14) },
  );
  const scheduleSource = context.sourceRegistry.get("schedule-version-001", "SCHEDULE_VERSION");
  const delay = forecastDelayForStatus(status);
  const insufficient = delay === null;
  const projectedFinish =
    delay === null
      ? null
      : addWorkingDays(
          context.analysisSnapshot.activeBaseline.plannedEnd,
          delay,
          BUILDWATCH_SIMULATION_CALENDAR,
        );
  const workItemProjectedFinish =
    delay === null
      ? null
      : addWorkingDays(workItem.plannedFinish, Math.max(0, delay), BUILDWATCH_SIMULATION_CALENDAR);
  const driverType =
    status === "CRITICAL_LATE"
      ? "DEPENDENCY"
      : status === "INSUFFICIENT_DATA"
        ? "DATA_QUALITY"
        : "PRODUCTIVITY";
  const drivers =
    status === "ON_TRACK"
      ? []
      : [
          {
            driverId: `forecast-driver-${date}`,
            type: driverType,
            workItemId: workItem.workItemId,
            summary:
              status === "INSUFFICIENT_DATA"
                ? "Approved productivity sample хүрэлцээгүй."
                : "Rolling productivity болон dependency нөлөөгөөр хугацаа хойшилсон.",
            impactWorkingDays: {
              value: delay ?? 0,
              sourceRefs: [calculationSource],
            },
            sourceRefs: [calculationSource],
          },
        ];
  const confidenceFactor = {
    factor: insufficient
      ? ("PRODUCTIVITY_HISTORY_LENGTH" as const)
      : ("APPROVED_REPORT_COVERAGE" as const),
    score: insufficient ? 0.15 : 0.9,
    weight: 1,
    sourceRefs: [calculationSource],
  };
  const remainingValue = Math.max(1, Number(workItem.remainingQuantity.value));
  const productivity = 8;
  const remainingDuration = Math.ceil(remainingValue / productivity);

  return operationalForecastSnapshotV1Schema.parse({
    schemaVersion: 1,
    snapshotType: "OPERATIONAL_FORECAST",
    snapshotId: `operational-forecast-${date}`,
    tenantId: context.analysisSnapshot.tenantId,
    projectId: context.analysisSnapshot.projectId,
    asOf: dateTime(date, 14),
    baselineVersionId: context.analysisSnapshot.activeBaseline.baselineVersionId,
    scheduleVersionId: "schedule-version-001",
    rollingProductivitySnapshotId: productivitySnapshot.snapshotId,
    policyVersion: {
      policyVersionId: "forecast-policy-version-001",
      version: 1,
      effectiveFrom: BUILDWATCH_SIMULATION_WINDOW_START,
    },
    thresholds: {
      warningWorkingDays: 5,
      criticalWorkingDays: 10,
      sourceRefs: [scheduleSource],
    },
    baselineFinish: context.analysisSnapshot.activeBaseline.plannedEnd,
    projectedFinish,
    delayWorkingDays:
      delay === null
        ? null
        : {
            value: delay,
            sourceRefs: [calculationSource],
          },
    status,
    confidence: insufficient ? 0.15 : 0.9,
    confidenceFactors: [confidenceFactor],
    workItems: [
      {
        workItemId: workItem.workItemId,
        remainingQuantity: {
          value: formatDecimal(remainingValue),
          unit: workItem.unit,
          sourceRefs: [scheduleSource],
        },
        adjustedDailyProductivity: insufficient
          ? null
          : {
              value: formatDecimal(productivity),
              unit: workItem.unit,
              sourceRefs: [calculationSource],
            },
        remainingDurationWorkingDays: insufficient
          ? null
          : {
              value: remainingDuration,
              sourceRefs: [calculationSource],
            },
        projectedFinish: workItemProjectedFinish,
        delayWorkingDays:
          delay === null
            ? null
            : {
                value: delay,
                sourceRefs: [calculationSource],
              },
        status,
        confidence: insufficient ? 0.15 : 0.9,
        confidenceFactors: [confidenceFactor],
        drivers,
        sourceRefs: [scheduleSource, calculationSource],
      },
    ],
    drivers,
    sourceRefs: [scheduleSource, calculationSource],
    deterministic: true,
    baselineChanged: false,
  });
}

function buildForecasts(
  snapshots: OperationalPlanningSnapshotV1[],
  context: OperationalBuildContext,
): ForecastBuild {
  const healthyDate = context.scenarioDates.get("HEALTHY_CONTROL")!;
  const insufficientDate = context.scenarioDates.get("INSUFFICIENT_FORECAST_DATA")!;
  const criticalDate = context.scenarioDates.get("CRITICAL_DELAY")!;
  const recoveryDate = context.scenarioDates.get("RECOVERY_OPTION_CONFLICT")!;
  const periodicDates = [0, 7, 14, 21, 28, 35, 39]
    .map((index) => context.planningDates[index])
    .filter((date): date is string => date !== undefined);
  const forecastDates = [
    ...new Set([...periodicDates, healthyDate, insufficientDate, criticalDate, recoveryDate]),
  ].sort();
  const snapshotByDate = new Map(
    snapshots.map((snapshot) => [snapshot.asOf.slice(0, 10), snapshot]),
  );
  const productivitySnapshots: RollingProductivitySnapshotV1[] = [];
  const forecasts: OperationalForecastSnapshotV1[] = [];

  for (const [index, date] of forecastDates.entries()) {
    const snapshot = snapshotByDate.get(date)!;
    const scenario = context.scenarioByDate.get(date);
    const subjectId = scenario === undefined ? "work-item-041" : scenarioSubjects[scenario][0]!;
    const workItem =
      snapshot.workItems.find((candidate) => candidate.workItemId === subjectId) ??
      snapshot.workItems.find((candidate) => candidate.zoneCode !== null)!;
    let status: ForecastStatus;
    if (date === insufficientDate) {
      status = "INSUFFICIENT_DATA";
    } else if (date === healthyDate) {
      status = "ON_TRACK";
    } else if (date >= criticalDate) {
      status = "CRITICAL_LATE";
    } else if (index >= Math.ceil(forecastDates.length / 2)) {
      status = "LIKELY_LATE";
    } else {
      status = "AT_RISK";
    }
    const productivitySnapshot = buildRollingProductivitySnapshot(date, status, workItem, context);
    productivitySnapshots.push(productivitySnapshot);
    forecasts.push(buildForecastSnapshot(date, status, workItem, productivitySnapshot, context));
  }

  const recoveryForecast = forecasts.find(
    (forecast) => forecast.asOf.slice(0, 10) === recoveryDate,
  )!;
  const calculationSource = context.sourceRegistry.get(
    `recovery-calculation-${recoveryDate}`,
    "SYSTEM_CALCULATION",
    { asOf: dateTime(recoveryDate, 15) },
  );
  const recoveryProposals = [
    recoveryProposalDraftV1Schema.parse({
      schemaVersion: 1,
      draftType: "RECOVERY_PROPOSAL",
      draftId: `recovery-proposal-${recoveryDate}`,
      tenantId: context.analysisSnapshot.tenantId,
      projectId: context.analysisSnapshot.projectId,
      operationalForecastSnapshotId: recoveryForecast.snapshotId,
      status: "DRAFT",
      proposal: "Нэмэлт баг болон shared lift-ийг critical ажлуудад шилжүүлэх.",
      actions: [
        {
          actionId: `recovery-action-${recoveryDate}-crew`,
          type: "MOVE_RESOURCE",
          workItemIds: scenarioSubjects.RECOVERY_OPTION_CONFLICT,
          description: "Commissioning crew-г critical exterior ажилд түр шилжүүлэх.",
          sourceRefs: [calculationSource],
        },
        {
          actionId: `recovery-action-${recoveryDate}-shift`,
          type: "ADD_SHIFT",
          workItemIds: scenarioSubjects.RECOVERY_OPTION_CONFLICT,
          description: "Нэмэлт ээлжийн хувилбар тооцох.",
          sourceRefs: [calculationSource],
        },
      ],
      estimatedScheduleImpactWorkingDays: {
        value: -4,
        sourceRefs: [calculationSource],
      },
      additionalCostMnt: {
        value: "8500000.00",
        currency: "MNT",
        sourceRefs: [calculationSource],
      },
      requiredResourceIds: ["crew-08", "equipment-shared-01"],
      dependencyConflictIds: ["recovery-conflict-shared-resource-001"],
      risks: [
        "Shared lift аль хэдийн өөр critical ажилд оноогдсон.",
        "Zone congestion нэмэгдэх магадлалтай.",
      ],
      sourceRefs: [calculationSource],
      calculatedBy: "DETERMINISTIC_SCENARIO_ENGINE",
      baselineChanged: false,
      requiresHumanReview: true,
      createdAt: dateTime(recoveryDate, 15),
    }),
  ];

  return {
    productivitySnapshots,
    forecasts,
    recoveryProposals,
  };
}

function buildPrivateFixture(): OperationalPrivateFixtureV1 {
  const tenantId = "tenant-private";
  const projectId = "project-private-operational";
  const registry = new SourceRegistry(tenantId, projectId);
  const scheduleSource = registry.get("private-schedule-version-001", "SCHEDULE_VERSION");
  const resourceSource = registry.get("private-resource-availability-001", "RESOURCE_AVAILABILITY");
  const calendarSource = registry.get("private-calendar-version-001", "CALENDAR_VERSION");
  const catalogSource = registry.get("private-productivity-catalog-001", "CATALOG_VERSION");

  return operationalPrivateFixtureV1Schema.parse({
    schemaVersion: 1,
    fixtureType: "CROSS_TENANT_PRIVATE",
    marker: "TENANT-PRIVATE-ONLY",
    tenantId,
    projectId,
    operationalSnapshot: {
      schemaVersion: 1,
      snapshotType: "OPERATIONAL_PLANNING",
      snapshotId: "private-operational-snapshot-001",
      tenantId,
      projectId,
      asOf: BUILDWATCH_OPERATIONAL_SIMULATION_GENERATED_AT,
      baselineVersionId: "private-baseline-version-001",
      scheduleVersionId: "private-schedule-version-001",
      policyVersion: {
        policyVersionId: "private-policy-version-001",
        version: 1,
        effectiveFrom: BUILDWATCH_SIMULATION_WINDOW_START,
      },
      calendar: {
        calendarVersionId: "private-calendar-version-001",
        timezone: "Asia/Ulaanbaatar",
        workingWeekdays: [1, 2, 3, 4, 5, 6],
        workHoursPerDay: 8,
        holidays: [],
        effectiveFrom: BUILDWATCH_SIMULATION_WINDOW_START,
        effectiveTo: null,
        sourceRefs: [calendarSource],
      },
      workItems: [
        {
          workItemId: "private-work-item-001",
          activityId: "private-activity-001",
          code: "PRIVATE-001",
          name: "TENANT-PRIVATE-ONLY confidential work",
          zoneCode: "PRIVATE-ZONE-01",
          workClassCode: "PRIVATE_CLASS",
          unit: "m2",
          plannedQuantity: {
            value: "100",
            unit: "m2",
            sourceRefs: [scheduleSource],
          },
          remainingQuantity: {
            value: "40",
            unit: "m2",
            sourceRefs: [scheduleSource],
          },
          status: "IN_PROGRESS",
          priority: "HIGH",
          isCritical: true,
          totalFloatWorkingDays: 0,
          downstreamUnlockCount: 0,
          contractMilestone: false,
          plannedStart: BUILDWATCH_SIMULATION_WINDOW_START,
          plannedFinish: BUILDWATCH_SIMULATION_WINDOW_END,
          predecessorWorkItemIds: [],
          requiredInspectionIds: [],
          requiredCrewType: "PRIVATE_CREW",
          requiredEquipmentIds: [],
          requiredMaterials: [],
          weatherRestrictions: [],
          safetyRestrictions: [],
          sourceRefs: [scheduleSource],
        },
      ],
      crews: [
        {
          crewId: "private-crew-001",
          crewType: "PRIVATE_CREW",
          headcount: 4,
          shiftStart: "08:00",
          shiftEnd: "17:00",
          productivityPerShift: {
            value: "10",
            unit: "m2",
            sourceRefs: [resourceSource],
          },
          productivityVersion: {
            tenantId,
            projectId,
            catalogType: "PRODUCTIVITY",
            versionId: "private-productivity-version-001",
            version: 1,
            effectiveFrom: BUILDWATCH_SIMULATION_WINDOW_START,
            effectiveTo: null,
            approvedBy: "private-manager",
            approvedAt: "2026-01-02T05:00:00.000Z",
            sourceRefs: [catalogSource],
          },
          availableFrom: BUILDWATCH_SIMULATION_WINDOW_START,
          availableTo: BUILDWATCH_SIMULATION_WINDOW_END,
          available: true,
          sourceRefs: [resourceSource],
        },
      ],
      equipment: [],
      materials: [],
      zones: [
        {
          zoneCode: "PRIVATE-ZONE-01",
          maxConcurrentActivities: 1,
          available: true,
          sourceRefs: [resourceSource],
        },
      ],
      inspections: [],
      blockers: [],
      weatherConstraints: [],
      approvedActuals: [],
    },
  });
}

function collectSourceIds(value: unknown): string[] {
  const sourceIds = new Set<string>();

  function visit(candidate: unknown): void {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate === null || typeof candidate !== "object") {
      return;
    }
    const record = candidate as Record<string, unknown>;
    if (Array.isArray(record.sourceRefs)) {
      for (const source of record.sourceRefs) {
        if (
          source !== null &&
          typeof source === "object" &&
          typeof (source as Record<string, unknown>).sourceId === "string"
        ) {
          sourceIds.add((source as { sourceId: string }).sourceId);
        }
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== "sourceRefs") {
        visit(child);
      }
    }
  }

  visit(value);
  return [...sourceIds];
}

function answerControlType(
  scenario: OperationalSimulationScenario,
): OperationalSimulationControlType {
  if (scenario === "HEALTHY_CONTROL") {
    return "POSITIVE";
  }
  if (
    ["PLANNED_TARGET_PARTIAL", "APPROVED_BLOCKER", "INSUFFICIENT_FORECAST_DATA"].includes(scenario)
  ) {
    return "BOUNDARY";
  }
  return "NEGATIVE";
}

function expectedPlanningTarget(
  snapshot: OperationalPlanningSnapshotV1,
  workItem: OperationalWorkItem,
) {
  const crew = snapshot.crews
    .filter(
      (candidate) =>
        candidate.crewType === workItem.requiredCrewType &&
        candidate.available &&
        candidate.productivityPerShift.unit === workItem.unit,
    )
    .sort((left, right) => left.crewId.localeCompare(right.crewId))[0];
  if (crew === undefined) {
    return null;
  }
  const capacities = [
    Number(workItem.remainingQuantity.value),
    Number(crew.productivityPerShift.value),
  ];
  for (const equipmentId of workItem.requiredEquipmentIds) {
    const equipment = snapshot.equipment.find((candidate) => candidate.equipmentId === equipmentId);
    if (
      equipment === undefined ||
      !equipment.available ||
      equipment.capacityPerShift.unit !== workItem.unit
    ) {
      return null;
    }
    capacities.push(Number(equipment.capacityPerShift.value));
  }
  for (const requirement of workItem.requiredMaterials) {
    const inventory = snapshot.materials.find(
      (candidate) => candidate.materialId === requirement.materialId,
    );
    if (
      inventory === undefined ||
      inventory.availableQuantity.unit !== requirement.quantity.unit ||
      inventory.reservedQuantity.unit !== requirement.quantity.unit
    ) {
      return null;
    }
    const requiredPerWorkUnit =
      Number(requirement.quantity.value) / Number(workItem.plannedQuantity.value);
    if (requiredPerWorkUnit <= 0) {
      return null;
    }
    capacities.push(
      Math.max(
        0,
        Number(inventory.availableQuantity.value) - Number(inventory.reservedQuantity.value),
      ) / requiredPerWorkUnit,
    );
  }
  const zone = snapshot.zones.find((candidate) => candidate.zoneCode === workItem.zoneCode);
  if (zone === undefined || !zone.available) {
    return null;
  }
  capacities.push(Number(workItem.remainingQuantity.value));
  return {
    value: formatDecimal(Math.min(...capacities)),
    unit: workItem.unit,
    sourceRefs: workItem.sourceRefs,
  };
}

function expectedScenarioPriority(
  snapshot: OperationalPlanningSnapshotV1,
  workItemIds: readonly string[],
  subjectId: string,
): number {
  const baselineSequence = new Map(
    snapshot.workItems.map((workItem, index) => [workItem.workItemId, index]),
  );
  const candidates = snapshot.workItems
    .filter((workItem) => workItemIds.includes(workItem.workItemId))
    .sort(
      (left, right) =>
        Number(right.isCritical) - Number(left.isCritical) ||
        left.totalFloatWorkingDays - right.totalFloatWorkingDays ||
        Number(right.contractMilestone) - Number(left.contractMilestone) ||
        right.downstreamUnlockCount - left.downstreamUnlockCount ||
        baselineSequence.get(left.workItemId)! - baselineSequence.get(right.workItemId)! ||
        left.workItemId.localeCompare(right.workItemId),
    );
  return candidates.findIndex((workItem) => workItem.workItemId === subjectId) + 1;
}

function buildAnswerKey(
  agentDataset: OperationalSimulationAgentDatasetV1,
  context: OperationalBuildContext,
): ReturnType<typeof operationalSimulationAnswerKeyV1Schema.parse> {
  const planByDate = new Map(agentDataset.dailyPlans.map((plan) => [plan.content.planDate, plan]));
  const verificationByDate = new Map(
    agentDataset.verificationDrafts.map((draft) => [draft.content.reportDate, draft]),
  );
  const forecastByDate = new Map(
    agentDataset.rollingForecasts.map((forecast) => [forecast.asOf.slice(0, 10), forecast]),
  );
  const recoveryByDate = new Map(
    agentDataset.recoveryProposals.map((proposal) => [proposal.createdAt.slice(0, 10), proposal]),
  );
  const photosByDate = new Map<string, OperationalPhotoMetadataV1[]>();
  for (const photo of agentDataset.photoMetadata) {
    const datePhotos = photosByDate.get(photo.reportDate) ?? [];
    datePhotos.push(photo);
    photosByDate.set(photo.reportDate, datePhotos);
  }
  const snapshotByDate = new Map(
    agentDataset.operationalSnapshots.map((snapshot) => [snapshot.asOf.slice(0, 10), snapshot]),
  );
  const forecastScenarios = new Set<OperationalSimulationScenario>([
    "HEALTHY_CONTROL",
    "INSUFFICIENT_FORECAST_DATA",
    "CRITICAL_DELAY",
    "RECOVERY_OPTION_CONFLICT",
  ]);

  const cases: OperationalSimulationAnswerCaseV1[] = OPERATIONAL_SIMULATION_SCENARIOS.map(
    (scenario) => {
      const date = context.scenarioDates.get(scenario)!;
      const workItemIds = scenarioSubjects[scenario];
      const plan = planByDate.get(date)!;
      const subjectItem = plan.content.items.find((item) => workItemIds.includes(item.workItemId));
      const verification = verificationByDate.get(date) ?? null;
      const verificationItem =
        verification?.content.items.find((item) => workItemIds.includes(item.workItemId)) ?? null;
      const forecast = forecastScenarios.has(scenario) ? (forecastByDate.get(date) ?? null) : null;
      const recovery =
        scenario === "RECOVERY_OPTION_CONFLICT" ? (recoveryByDate.get(date) ?? null) : null;
      const scenarioPhotos = (photosByDate.get(date) ?? []).filter((photo) =>
        workItemIds.includes(photo.reportedWorkItemId),
      );
      const snapshot = snapshotByDate.get(date)!;
      const omittedWorkItem =
        scenario === "CRITICAL_WORK_OMITTED"
          ? snapshot.workItems.find((workItem) => workItem.workItemId === workItemIds[0])!
          : null;
      const expectedEligible =
        scenario === "CRITICAL_WORK_OMITTED" ? true : (subjectItem?.feasibility.eligible ?? null);
      const targetWorkItem =
        omittedWorkItem ??
        snapshot.workItems.find((workItem) => workItem.workItemId === workItemIds[0]);
      const target =
        expectedEligible === true && targetWorkItem !== undefined
          ? expectedPlanningTarget(snapshot, targetWorkItem)
          : null;
      const expectedVariance =
        verificationItem?.variance === null || verificationItem?.variance === undefined
          ? null
          : {
              quantity: verificationItem.variance.quantity.value,
              percentage: verificationItem.variance.percentage,
              unit: verificationItem.unit,
            };
      const sourceIds = collectSourceIds([
        subjectItem ?? plan,
        verificationItem,
        forecast,
        recovery,
        scenarioPhotos,
        omittedWorkItem,
      ]);
      if (sourceIds.length === 0) {
        throw new Error(`Scenario ${scenario} has no source lineage`);
      }

      return {
        caseId: `operational-answer-${scenario.toLowerCase().replaceAll("_", "-")}`,
        scenario,
        controlType: answerControlType(scenario),
        effectiveDate: date,
        tenantId: agentDataset.tenantId,
        projectId: agentDataset.projectId,
        workItemIds,
        dailyPlanDraftId: plan.draftId,
        progressVerificationDraftId: verification?.draftId ?? null,
        forecastSnapshotId: forecast?.snapshotId ?? null,
        recoveryProposalDraftId: recovery?.draftId ?? null,
        photoIds: scenarioPhotos.map((photo) => photo.photoId),
        expectedEligible,
        expectedPriority:
          expectedEligible === null
            ? null
            : expectedScenarioPriority(snapshot, workItemIds, workItemIds[0]!),
        expectedDailyTarget:
          target === null
            ? null
            : {
                value: target.value,
                unit: target.unit,
              },
        expectedConflicts: scenarioConflicts[scenario],
        expectedCompletionStatus:
          scenario === "MISSING_REPORT"
            ? "UNVERIFIABLE"
            : (verificationItem?.completionStatus ?? null),
        expectedVariance,
        expectedForecastStatus: forecast?.status ?? null,
        expectedDrivers: [...new Set(forecast?.drivers.map((driver) => driver.type) ?? [])],
        expectedSourceIds: sourceIds,
        rationale: scenarioRationales[scenario],
      };
    },
  );

  return operationalSimulationAnswerKeyV1Schema.parse({
    schemaVersion: 1,
    answerKeyType: "BUILDWATCH_OPERATIONAL_V22",
    seed: context.seed,
    generatedAt: BUILDWATCH_OPERATIONAL_SIMULATION_GENERATED_AT,
    windowStart: BUILDWATCH_SIMULATION_WINDOW_START,
    windowEnd: BUILDWATCH_SIMULATION_WINDOW_END,
    cases,
  });
}

export function buildBuildWatchOperationalSimulation(
  seed = BUILDWATCH_OPERATIONAL_SIMULATION_SEED,
): BuildWatchOperationalSimulationV1 {
  const baseSimulation = buildBuildWatchSimulation(seed);
  const analysisSnapshot = baseSimulation.snapshot;
  const planningDates = enumerateWorkingDates(
    BUILDWATCH_SIMULATION_WINDOW_START,
    BUILDWATCH_SIMULATION_WINDOW_END,
    BUILDWATCH_SIMULATION_CALENDAR,
  ).slice(-BUILDWATCH_OPERATIONAL_PLANNING_DAY_COUNT);
  if (planningDates.length !== BUILDWATCH_OPERATIONAL_PLANNING_DAY_COUNT) {
    throw new Error(`Expected ${BUILDWATCH_OPERATIONAL_PLANNING_DAY_COUNT} planning days`);
  }
  const scenarioDates = buildScenarioDates(planningDates);
  const sourceRegistry = new SourceRegistry(analysisSnapshot.tenantId, analysisSnapshot.projectId);
  const context: OperationalBuildContext = {
    seed,
    analysisSnapshot,
    planningDates,
    scenarioDates,
    scenarioByDate: reverseScenarioDates(scenarioDates),
    sourceRegistry,
    workItemById: new Map(
      analysisSnapshot.workItems.map((workItem) => [workItem.workItemId, workItem]),
    ),
    leafWorkItemIds: analysisSnapshot.workItems
      .filter((workItem) => workItem.parentWorkItemId !== null)
      .map((workItem) => workItem.workItemId),
  };
  const planningRules = buildPlanningRules(context);
  const evidenceRules = buildEvidenceRules(context);
  const operationalSnapshots = planningDates.map((date) => buildOperationalSnapshot(date, context));
  const dailyPlans = operationalSnapshots.map((snapshot, index) =>
    buildDailyPlan(planningDates[index]!, index, snapshot, context),
  );
  const photoVerification = buildPhotosAndVerifications(dailyPlans, context);
  const forecastBuild = buildForecasts(operationalSnapshots, context);
  const agentDataset = operationalSimulationAgentDatasetV1Schema.parse({
    schemaVersion: 1,
    datasetType: "BUILDWATCH_OPERATIONAL_V22_AGENT_DATA",
    seed,
    generatedAt: BUILDWATCH_OPERATIONAL_SIMULATION_GENERATED_AT,
    windowStart: BUILDWATCH_SIMULATION_WINDOW_START,
    windowEnd: BUILDWATCH_SIMULATION_WINDOW_END,
    tenantId: analysisSnapshot.tenantId,
    projectId: analysisSnapshot.projectId,
    deterministic: true,
    llmRequired: false,
    analysisSnapshot,
    sourceCatalog: sourceRegistry.values(),
    planningRules,
    evidenceRules,
    operationalSnapshots,
    dailyPlans,
    photoMetadata: photoVerification.photos,
    verificationDrafts: photoVerification.verificationDrafts,
    rollingProductivitySnapshots: forecastBuild.productivitySnapshots,
    rollingForecasts: forecastBuild.forecasts,
    recoveryProposals: forecastBuild.recoveryProposals,
  });
  const privateFixture = buildPrivateFixture();
  const answerKey = buildAnswerKey(agentDataset, context);

  return buildWatchOperationalSimulationV1Schema.parse({
    schemaVersion: 1,
    simulationType: "BUILDWATCH_OPERATIONAL_V22",
    seed,
    generatedAt: BUILDWATCH_OPERATIONAL_SIMULATION_GENERATED_AT,
    windowStart: BUILDWATCH_SIMULATION_WINDOW_START,
    windowEnd: BUILDWATCH_SIMULATION_WINDOW_END,
    agentDataset,
    privateFixture,
    answerKey,
  });
}

export function operationalSimulationPlanningDates(
  simulation: BuildWatchOperationalSimulationV1,
): string[] {
  return simulation.agentDataset.dailyPlans.map((plan) => plan.content.planDate);
}

export function buildOperationalSimulationAgentDataset(
  simulation: BuildWatchOperationalSimulationV1,
): OperationalSimulationAgentDatasetV1 {
  return simulation.agentDataset;
}

function atOrBefore(dateTimeValue: string, asOfDate: string): boolean {
  return dateTimeValue.slice(0, 10) <= asOfDate;
}

export function replayBuildWatchOperationalSimulation(
  simulation: BuildWatchOperationalSimulationV1,
  asOfDate: string,
): BuildWatchOperationalSimulationReplayV1 {
  if (
    compareIsoDates(asOfDate, BUILDWATCH_SIMULATION_WINDOW_START) < 0 ||
    compareIsoDates(asOfDate, BUILDWATCH_SIMULATION_WINDOW_END) > 0
  ) {
    throw new Error(
      `Replay date must be between ${BUILDWATCH_SIMULATION_WINDOW_START} and ${BUILDWATCH_SIMULATION_WINDOW_END}`,
    );
  }
  const dataset = simulation.agentDataset;
  const operationalSnapshots = dataset.operationalSnapshots.filter((snapshot) =>
    atOrBefore(snapshot.asOf, asOfDate),
  );
  const dailyPlans = dataset.dailyPlans.filter((plan) => plan.content.planDate <= asOfDate);
  const photoMetadata = dataset.photoMetadata.filter((photo) => photo.reportDate <= asOfDate);
  const verificationDrafts = dataset.verificationDrafts.filter(
    (draft) => draft.content.reportDate <= asOfDate,
  );
  const rollingProductivitySnapshots = dataset.rollingProductivitySnapshots.filter((snapshot) =>
    atOrBefore(snapshot.asOf, asOfDate),
  );
  const rollingForecasts = dataset.rollingForecasts.filter((snapshot) =>
    atOrBefore(snapshot.asOf, asOfDate),
  );
  const recoveryProposals = dataset.recoveryProposals.filter((proposal) =>
    atOrBefore(proposal.createdAt, asOfDate),
  );
  const replayWithoutCatalog = {
    planningRules: dataset.planningRules,
    evidenceRules: dataset.evidenceRules,
    operationalSnapshots,
    dailyPlans,
    photoMetadata,
    verificationDrafts,
    rollingProductivitySnapshots,
    rollingForecasts,
    recoveryProposals,
  };
  const usedSourceIds = new Set(collectSourceIds(replayWithoutCatalog));

  return {
    schemaVersion: 1,
    replayType: "BUILDWATCH_OPERATIONAL_V22_REPLAY",
    seed: simulation.seed,
    asOfDate,
    tenantId: dataset.tenantId,
    projectId: dataset.projectId,
    deterministic: true,
    llmRequired: false,
    analysisSnapshot: replaySimulationSnapshot(dataset.analysisSnapshot, asOfDate),
    sourceCatalog: dataset.sourceCatalog.filter((source) => usedSourceIds.has(source.sourceId)),
    planningRules: dataset.planningRules,
    evidenceRules: dataset.evidenceRules,
    operationalSnapshots,
    dailyPlans,
    photoMetadata,
    verificationDrafts,
    rollingProductivitySnapshots,
    rollingForecasts,
    recoveryProposals,
  };
}

export function operationalSimulationCounts(simulation: BuildWatchOperationalSimulationV1): {
  workItems: number;
  planningDays: number;
  planItemDecisions: number;
  photos: number;
  verificationDrafts: number;
  forecasts: number;
  answerCases: number;
} {
  const dataset = simulation.agentDataset;
  return {
    workItems: dataset.operationalSnapshots[0]?.workItems.length ?? 0,
    planningDays: dataset.dailyPlans.length,
    planItemDecisions: dataset.dailyPlans.reduce((sum, plan) => sum + plan.content.items.length, 0),
    photos: dataset.photoMetadata.length,
    verificationDrafts: dataset.verificationDrafts.length,
    forecasts: dataset.rollingForecasts.length,
    answerCases: simulation.answerKey.cases.length,
  };
}
