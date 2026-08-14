import seedrandom from "seedrandom";
import {
  projectAnalysisSnapshotV1Schema,
  type ProjectAnalysisSnapshotV1,
} from "../contracts/project-analysis-snapshot.js";
import {
  addCalendarDays,
  addWorkingDays,
  compareIsoDates,
  enumerateWorkingDates,
  workingDaysBetween,
  type ProductionCalendar,
} from "../production-analysis/calendar.js";
import {
  buildWatchSimulationV1Schema,
  simulationAnswerKeyV1Schema,
  type BuildWatchSimulationV1,
  type SimulationAnswerIssue,
} from "./contracts.js";

type SnapshotWorkItem = ProjectAnalysisSnapshotV1["workItems"][number];
type SnapshotDependency = ProjectAnalysisSnapshotV1["dependencies"][number];
type SnapshotMaterial = ProjectAnalysisSnapshotV1["materials"][number];
type SnapshotMaterialNorm = ProjectAnalysisSnapshotV1["materialNorms"][number];
type SnapshotDailyReport = ProjectAnalysisSnapshotV1["dailyReports"][number];
type SnapshotProgressEntry = ProjectAnalysisSnapshotV1["progressEntries"][number];
type SnapshotAttendanceEntry = ProjectAnalysisSnapshotV1["attendanceEntries"][number];
type SnapshotStockMovement = ProjectAnalysisSnapshotV1["stockMovements"][number];
type SnapshotCostEntry = ProjectAnalysisSnapshotV1["costEntries"][number];
type SnapshotBlocker = ProjectAnalysisSnapshotV1["blockers"][number];
type SnapshotAlert = ProjectAnalysisSnapshotV1["alerts"][number];

type LeafRuntime = {
  workItem: SnapshotWorkItem;
  materialId: string;
  materialNorm: number;
  cumulativeQuantity: number;
  actualStart: string;
  plannedDurationDays: number;
  progressEntryIds: string[];
};

type MaterialDefinition = SnapshotMaterial & {
  unitPriceMnt: number;
};

export const BUILDWATCH_SIMULATION_SEED = "buildwatch-phase1-v1";
export const BUILDWATCH_SIMULATION_WINDOW_START = "2026-01-05";
export const BUILDWATCH_SIMULATION_WINDOW_END = "2026-03-28";
export const BUILDWATCH_SIMULATION_GENERATED_AT = "2026-03-28T23:59:59.000Z";

export const BUILDWATCH_SIMULATION_CALENDAR: ProductionCalendar = {
  workingWeekdays: [1, 2, 3, 4, 5, 6],
  holidays: ["2026-02-17"],
};

const stageDefinitions = [
  {
    name: "Бэлтгэл ба газар шороо",
    location: "Талбай",
    childNames: [
      "Талбайн түр хашаа",
      "Тэнхлэг тэмдэглэгээ",
      "Хөрс хуулалт",
      "Суурийн нүх ухалт",
      "Ус зайлуулах суваг",
    ],
  },
  {
    name: "Суурь",
    location: "A блок",
    childNames: [
      "Суурийн ул бетон",
      "Арматур угсралт",
      "Хэв хашмал",
      "Суурийн бетон цутгалт",
      "Суурийн ус тусгаарлалт",
    ],
  },
  {
    name: "Каркас",
    location: "A блок",
    childNames: [
      "1-р давхрын багана",
      "1-р давхрын дам нуруу",
      "2-р давхрын хавтан",
      "Шатны марш",
      "Дээврийн каркас",
    ],
  },
  {
    name: "Өрлөг",
    location: "A блок",
    childNames: [
      "Гадна ханын өрлөг",
      "Дотор ханын өрлөг",
      "Лифтний хонгилын өрлөг",
      "Парапет өрлөг",
      "Өрлөгийн нөхөөс",
    ],
  },
  {
    name: "Инженерийн шугам",
    location: "A блок",
    childNames: [
      "Цэвэр усны босоо шугам",
      "Бохирын босоо шугам",
      "Цахилгааны гол кабель",
      "Салхивчийн суваг",
      "Галын дохиоллын кабель",
    ],
  },
  {
    name: "Дотор заслын эхлэл",
    location: "A блок",
    childNames: [
      "Ханын шавардлага",
      "Шалны тэгшилгээ",
      "Таазны каркас",
      "Дотор хаалганы бэлтгэл",
      "Плита наалт",
    ],
  },
  {
    name: "Гадна хийц",
    location: "Фасад",
    childNames: [
      "Фасадны дулаалга",
      "Фасадны тор таталт",
      "Цонх суурилуулалт",
      "Гадна өнгөлгөө",
      "Дээврийн ус зайлуулах",
    ],
  },
  {
    name: "Дуусгалт ба шалгалт",
    location: "A блок",
    childNames: [
      "Дотор будаг",
      "Цахилгаан тоноглол",
      "Сантехникийн тоноглол",
      "Системийн туршилт",
      "Цэвэрлэгээ ба хүлээлгэн өгөх",
    ],
  },
] as const;

const materialDefinitions: MaterialDefinition[] = [
  {
    materialId: "material-earth",
    code: "MAT-EARTH",
    name: "Дүүргэлтийн хөрс",
    aliases: ["дүүргэлт"],
    unit: "м3",
    leadTimeDays: 2,
    unitPriceMnt: 35_000,
  },
  {
    materialId: "material-concrete",
    code: "MAT-CONCRETE",
    name: "Бетон зуурмаг",
    aliases: ["бетон", "B25"],
    unit: "м3",
    leadTimeDays: 2,
    unitPriceMnt: 310_000,
  },
  {
    materialId: "material-rebar",
    code: "MAT-REBAR",
    name: "Арматур төмөр",
    aliases: ["арматур", "төмөр"],
    unit: "кг",
    leadTimeDays: 7,
    unitPriceMnt: 3_200,
  },
  {
    materialId: "material-brick",
    code: "MAT-BRICK",
    name: "Барилгын тоосго",
    aliases: ["тоосго", "блок"],
    unit: "ш",
    leadTimeDays: 4,
    unitPriceMnt: 1_250,
  },
  {
    materialId: "material-pipe",
    code: "MAT-PIPE",
    name: "Инженерийн хоолой",
    aliases: ["хоолой", "PPR"],
    unit: "м",
    leadTimeDays: 8,
    unitPriceMnt: 18_000,
  },
  {
    materialId: "material-cable",
    code: "MAT-CABLE",
    name: "Цахилгааны кабель",
    aliases: ["кабель", "утас"],
    unit: "м",
    leadTimeDays: 10,
    unitPriceMnt: 22_000,
  },
  {
    materialId: "material-mortar",
    code: "MAT-MORTAR",
    name: "Хуурай хольц",
    aliases: ["зуурмаг", "шавардлага"],
    unit: "кг",
    leadTimeDays: 5,
    unitPriceMnt: 1_100,
  },
  {
    materialId: "material-finish",
    code: "MAT-FINISH",
    name: "Заслын материал",
    aliases: ["будаг", "плита"],
    unit: "кг",
    leadTimeDays: 6,
    unitPriceMnt: 8_500,
  },
];

const subcontractors: ProjectAnalysisSnapshotV1["subcontractors"] = [
  {
    subcontractorId: "subcontractor-structure",
    code: "SUB-STRUCTURE",
    name: "Бат Каркас ХХК",
    contractStart: "2026-01-15",
    contractEnd: "2026-04-30",
    contractValueMnt: "480000000.00",
  },
  {
    subcontractorId: "subcontractor-mep",
    code: "SUB-MEP",
    name: "Эрчим Инженеринг ХХК",
    contractStart: "2026-02-01",
    contractEnd: "2026-06-15",
    contractValueMnt: "360000000.00",
  },
  {
    subcontractorId: "subcontractor-facade",
    code: "SUB-FACADE",
    name: "Өргөө Фасад ХХК",
    contractStart: "2026-02-15",
    contractEnd: "2026-06-30",
    contractValueMnt: "290000000.00",
  },
];

function formatMoney(value: number): string {
  const formatted = value.toFixed(2);
  return formatted === "-0.00" ? "0.00" : formatted;
}

function formatDecimal(value: number, precision = 3): string {
  const rounded = Number(value.toFixed(precision));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function round(value: number, precision = 2): number {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function workItemId(index: number): string {
  return `work-item-${String(index).padStart(3, "0")}`;
}

function workItemCode(index: number): string {
  return `BW-${String(index).padStart(3, "0")}`;
}

function dateTime(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

function materialForStage(stageIndex: number): MaterialDefinition {
  return materialDefinitions[stageIndex % materialDefinitions.length]!;
}

function subcontractorForStage(stageIndex: number): string | null {
  if (stageIndex === 2) {
    return "subcontractor-structure";
  }

  if (stageIndex === 4 || stageIndex === 7) {
    return "subcontractor-mep";
  }

  if (stageIndex === 6) {
    return "subcontractor-facade";
  }

  return null;
}

function buildWorkBreakdown(random: seedrandom.PRNG): {
  workItems: SnapshotWorkItem[];
  dependencies: SnapshotDependency[];
  materialNorms: SnapshotMaterialNorm[];
  runtimes: LeafRuntime[];
} {
  const workItems: SnapshotWorkItem[] = [];
  const dependencies: SnapshotDependency[] = [];
  const materialNorms: SnapshotMaterialNorm[] = [];
  const runtimes: LeafRuntime[] = [];

  stageDefinitions.forEach((stage, stageIndex) => {
    const parentIndex = stageIndex * 6 + 1;
    const parentId = workItemId(parentIndex);
    const stageStart = addWorkingDays(
      BUILDWATCH_SIMULATION_WINDOW_START,
      stageIndex * 8,
      BUILDWATCH_SIMULATION_CALENDAR,
    );
    const stageEnd = addWorkingDays(stageStart, 24, BUILDWATCH_SIMULATION_CALENDAR);

    workItems.push({
      workItemId: parentId,
      parentWorkItemId: null,
      code: workItemCode(parentIndex),
      name: stage.name,
      stage: stage.name,
      location: stage.location,
      unit: "багц",
      plannedQuantity: "1",
      unitCostMnt: "0.00",
      plannedStart: stageStart,
      plannedEnd: stageEnd,
      status: "PLANNED",
      priority: stageIndex < 3 ? "HIGH" : "MEDIUM",
      assigneeType: "TEAM",
      assigneeRef: `team-stage-${stageIndex + 1}`,
      subcontractorId: null,
      isCritical: false,
      displayOrder: parentIndex,
    });

    const leafIds: string[] = [];

    stage.childNames.forEach((name, childIndex) => {
      const index = parentIndex + childIndex + 1;
      const id = workItemId(index);
      const plannedStart = addWorkingDays(
        stageStart,
        childIndex * 2,
        BUILDWATCH_SIMULATION_CALENDAR,
      );
      const plannedDurationDays = 12 + ((stageIndex + childIndex) % 5);
      const plannedEnd = addWorkingDays(
        plannedStart,
        plannedDurationDays - 1,
        BUILDWATCH_SIMULATION_CALENDAR,
      );
      const plannedQuantity = round(80 + stageIndex * 35 + childIndex * 23 + random() * 40, 2);
      const unitCostMnt = 220_000 + stageIndex * 95_000 + childIndex * 28_000;
      const material = materialForStage(stageIndex);
      const materialNorm = round(0.6 + stageIndex * 0.35 + childIndex * 0.17, 3);
      const subcontractorId = subcontractorForStage(stageIndex);
      const isCritical =
        childIndex === 0 || childIndex === 4 || id === "work-item-017" || id === "work-item-041";
      const actualStart =
        id === "work-item-038"
          ? addWorkingDays(plannedStart, -8, BUILDWATCH_SIMULATION_CALENDAR)
          : id === "work-item-017"
            ? addWorkingDays(plannedStart, 3, BUILDWATCH_SIMULATION_CALENDAR)
            : plannedStart;

      const item: SnapshotWorkItem = {
        workItemId: id,
        parentWorkItemId: parentId,
        code: workItemCode(index),
        name,
        stage: stage.name,
        location: stage.location,
        unit: stageIndex <= 2 ? "м3" : stageIndex === 3 ? "м2" : "м",
        plannedQuantity: formatDecimal(plannedQuantity),
        unitCostMnt: formatMoney(unitCostMnt),
        plannedStart,
        plannedEnd,
        status: "PLANNED",
        priority: isCritical ? "CRITICAL" : childIndex % 2 === 0 ? "HIGH" : "MEDIUM",
        assigneeType: subcontractorId === null ? "TEAM" : "SUBCONTRACTOR",
        assigneeRef: subcontractorId ?? `team-stage-${stageIndex + 1}`,
        subcontractorId,
        isCritical,
        displayOrder: index,
      };

      workItems.push(item);
      leafIds.push(id);
      materialNorms.push({
        materialNormId: `material-norm-${String(index).padStart(3, "0")}`,
        workItemId: id,
        materialId: material.materialId,
        quantityPerWorkUnit: formatDecimal(materialNorm),
        wastePercent: 5,
      });
      runtimes.push({
        workItem: item,
        materialId: material.materialId,
        materialNorm,
        cumulativeQuantity: 0,
        actualStart,
        plannedDurationDays,
        progressEntryIds: [],
      });
    });

    for (let childIndex = 0; childIndex < leafIds.length - 1; childIndex += 1) {
      const predecessorWorkItemId = leafIds[childIndex]!;
      const successorWorkItemId = leafIds[childIndex + 1]!;
      const type = childIndex % 2 === 0 ? "FINISH_TO_START" : "START_TO_START";

      dependencies.push({
        dependencyId: `dependency-stage-${stageIndex + 1}-${childIndex + 1}`,
        predecessorWorkItemId,
        successorWorkItemId,
        type,
        lagDays: type === "START_TO_START" ? 2 : 0,
      });
    }

    if (stageIndex > 0) {
      const previousParentIndex = (stageIndex - 1) * 6 + 1;
      dependencies.push({
        dependencyId: `dependency-stage-gate-${stageIndex}`,
        predecessorWorkItemId: workItemId(previousParentIndex + 5),
        successorWorkItemId: leafIds[0]!,
        type: "FINISH_TO_START",
        lagDays: 0,
      });
    }
  });

  dependencies.push({
    dependencyId: "dependency-intentional-violation",
    predecessorWorkItemId: "work-item-035",
    successorWorkItemId: "work-item-038",
    type: "FINISH_TO_START",
    lagDays: 0,
  });

  return {
    workItems,
    dependencies,
    materialNorms,
    runtimes,
  };
}

function paceFactor(workItemIdValue: string, date: string): number {
  if (workItemIdValue === "work-item-017") {
    return 0.18;
  }

  if (workItemIdValue === "work-item-029") {
    return compareIsoDates(date, "2026-03-16") >= 0 ? 0.15 : 0.55;
  }

  if (workItemIdValue === "work-item-035") {
    return 0.28;
  }

  if (workItemIdValue === "work-item-041") {
    return 0.31;
  }

  if (workItemIdValue === "work-item-046") {
    return 1.08;
  }

  return 0.94;
}

function blockerDatesFor(runtime: LeafRuntime): Set<string> {
  if (runtime.workItem.workItemId !== "work-item-023") {
    return new Set();
  }

  return new Set([
    addWorkingDays(runtime.actualStart, 3, BUILDWATCH_SIMULATION_CALENDAR),
    addWorkingDays(runtime.actualStart, 6, BUILDWATCH_SIMULATION_CALENDAR),
    addWorkingDays(runtime.actualStart, 9, BUILDWATCH_SIMULATION_CALENDAR),
  ]);
}

function buildExecutionHistory(
  random: seedrandom.PRNG,
  runtimes: LeafRuntime[],
  materialNorms: SnapshotMaterialNorm[],
): {
  dailyReports: SnapshotDailyReport[];
  progressEntries: SnapshotProgressEntry[];
  attendanceEntries: SnapshotAttendanceEntry[];
  stockMovements: SnapshotStockMovement[];
  costEntries: SnapshotCostEntry[];
  blockers: SnapshotBlocker[];
} {
  const dailyReports: SnapshotDailyReport[] = [];
  const progressEntries: SnapshotProgressEntry[] = [];
  const attendanceEntries: SnapshotAttendanceEntry[] = [];
  const stockMovements: SnapshotStockMovement[] = [];
  const costEntries: SnapshotCostEntry[] = [];
  const blockers: SnapshotBlocker[] = [];
  const reportDates = enumerateWorkingDates(
    BUILDWATCH_SIMULATION_WINDOW_START,
    BUILDWATCH_SIMULATION_WINDOW_END,
    BUILDWATCH_SIMULATION_CALENDAR,
  );
  const missingReportDate = "2026-03-25";
  const normByWorkItem = new Map(materialNorms.map((norm) => [norm.workItemId, norm]));

  for (const date of reportDates) {
    if (date === missingReportDate) {
      continue;
    }

    const reportId = `daily-report-${date}`;
    const reportProgress: SnapshotProgressEntry[] = [];

    for (const runtime of runtimes) {
      if (
        compareIsoDates(date, runtime.actualStart) < 0 ||
        runtime.cumulativeQuantity >= Number(runtime.workItem.plannedQuantity)
      ) {
        continue;
      }

      const plannedQuantity = Number(runtime.workItem.plannedQuantity);
      const baseDailyQuantity = plannedQuantity / runtime.plannedDurationDays;
      const jitter = 0.92 + random() * 0.16;
      const blockerDates = blockerDatesFor(runtime);
      const isBlocked = blockerDates.has(date);
      const factor = paceFactor(runtime.workItem.workItemId, date);
      const rawIncrement = isBlocked
        ? baseDailyQuantity * 0.08
        : baseDailyQuantity * factor * jitter;
      const remaining = plannedQuantity - runtime.cumulativeQuantity;
      const increment = round(Math.min(remaining, rawIncrement), 3);

      if (increment <= 0) {
        continue;
      }

      runtime.cumulativeQuantity = round(runtime.cumulativeQuantity + increment, 3);
      const progressPercent = round(
        Math.min(100, (runtime.cumulativeQuantity / plannedQuantity) * 100),
        2,
      );
      const entryIndex = progressEntries.length + reportProgress.length + 1;
      const progressEntryId = `progress-entry-${String(entryIndex).padStart(4, "0")}`;
      const status = progressPercent >= 100 ? "COMPLETED" : isBlocked ? "BLOCKED" : "IN_PROGRESS";

      const progressEntry: SnapshotProgressEntry = {
        progressEntryId,
        dailyReportId: reportId,
        workItemId: runtime.workItem.workItemId,
        capturedAt: dateTime(date, 10),
        quantityDoneIncrement: formatDecimal(increment),
        cumulativeQuantityDone: formatDecimal(runtime.cumulativeQuantity),
        progressPercent,
        status,
        blockerReason: isBlocked ? "Цементийн нийлүүлэлт тасалдсан." : null,
        note:
          runtime.workItem.workItemId === "work-item-029" &&
          compareIsoDates(date, "2026-03-16") >= 0
            ? "Багийн бүтээмж өмнөх долоо хоногоос буурсан."
            : null,
        aiConfidence: 0.9,
        humanEdited: entryIndex % 17 === 0,
      };

      reportProgress.push(progressEntry);
      runtime.progressEntryIds.push(progressEntryId);

      const attendanceIndex = attendanceEntries.length + reportProgress.length;
      const headcount =
        runtime.workItem.workItemId === "work-item-029" && compareIsoDates(date, "2026-03-16") >= 0
          ? 3
          : 5 + Math.floor(random() * 5);
      const attendanceEntryId = `attendance-entry-${String(attendanceIndex).padStart(4, "0")}`;

      attendanceEntries.push({
        attendanceEntryId,
        dailyReportId: reportId,
        workItemId: runtime.workItem.workItemId,
        subcontractorId: runtime.workItem.subcontractorId,
        teamName:
          runtime.workItem.subcontractorId === null
            ? `${runtime.workItem.stage} баг`
            : (subcontractors.find(
                (subcontractor) =>
                  subcontractor.subcontractorId === runtime.workItem.subcontractorId,
              )?.name ?? "Туслан гүйцэтгэгч"),
        headcount,
        hoursPerPerson: 8,
        totalHours: headcount * 8,
      });

      costEntries.push({
        costEntryId: `cost-labor-${String(costEntries.length + 1).padStart(4, "0")}`,
        workItemId: runtime.workItem.workItemId,
        dailyReportId: reportId,
        category: runtime.workItem.subcontractorId === null ? "LABOR" : "SUBCONTRACTOR",
        amountMnt: formatMoney(
          headcount * 8 * (runtime.workItem.subcontractorId === null ? 18_000 : 24_000),
        ),
        sourceType:
          runtime.workItem.subcontractorId === null ? "ATTENDANCE" : "SUBCONTRACTOR_CLAIM",
        sourceId: attendanceEntryId,
        occurredAt: dateTime(date, 11),
        description: `${runtime.workItem.name} ажлын өдрийн хөдөлмөрийн зардал`,
      });

      const norm = normByWorkItem.get(runtime.workItem.workItemId);

      if (norm !== undefined) {
        const consumptionFactor = runtime.workItem.workItemId === "work-item-023" ? 1.38 : 1;
        const consumedQuantity = round(
          increment *
            Number(norm.quantityPerWorkUnit) *
            (1 + norm.wastePercent / 100) *
            consumptionFactor,
          3,
        );
        const movementId = `stock-issue-${String(stockMovements.length + 1).padStart(4, "0")}`;
        const material = materialDefinitions.find(
          (candidate) => candidate.materialId === runtime.materialId,
        )!;

        stockMovements.push({
          stockMovementId: movementId,
          materialId: runtime.materialId,
          kind: "ISSUE",
          quantity: formatDecimal(consumedQuantity),
          unitPriceMnt: formatMoney(material.unitPriceMnt),
          workItemId: runtime.workItem.workItemId,
          supplierName: null,
          documentArtifactId: null,
          occurredAt: dateTime(date, 9),
          recordedBy: "user-storekeeper",
          reversesMovementId: null,
          reference: `ЗАР-${date}-${runtime.workItem.code}`,
        });

        costEntries.push({
          costEntryId: `cost-material-${String(costEntries.length + 1).padStart(4, "0")}`,
          workItemId: runtime.workItem.workItemId,
          dailyReportId: reportId,
          category: "MATERIAL",
          amountMnt: formatMoney(consumedQuantity * material.unitPriceMnt),
          sourceType: "STOCK_MOVEMENT",
          sourceId: movementId,
          occurredAt: dateTime(date, 9),
          description: `${material.name} зарцуулалтын өртөг`,
        });
      }

      if (isBlocked) {
        blockers.push({
          blockerId: `blocker-supplier-${blockers.length + 1}`,
          dailyReportId: reportId,
          workItemId: runtime.workItem.workItemId,
          category: "MATERIAL",
          description: "Цемент Нийлүүлэлт ХХК хугацаандаа материал хүргээгүй.",
          responsibleParty: "Хангамжийн менежер",
          supplierName: "Цемент Нийлүүлэлт ХХК",
          openedAt: dateTime(date, 8),
          resolvedAt: dateTime(date, 17),
        });
      }
    }

    progressEntries.push(...reportProgress);

    const reportedItems = reportProgress
      .slice(0, 6)
      .map((entry) => {
        const runtime = runtimes.find(
          (candidate) => candidate.workItem.workItemId === entry.workItemId,
        )!;
        return `${runtime.workItem.code} ${entry.progressPercent}%`;
      })
      .join(", ");

    dailyReports.push({
      dailyReportId: reportId,
      date,
      reportedBy: "user-site-engineer",
      rawText:
        reportedItems.length > 0
          ? `Өдрийн тайлан: ${reportedItems}.`
          : "Өдрийн тайлан: талбайн бэлтгэл, аюулгүй ажиллагааны үзлэг хийв.",
      status: "APPROVED",
      submittedAt: dateTime(date, 18),
      approvedBy: "user-project-manager",
      approvedAt: dateTime(date, 19),
      rejectionReason: null,
      sourceDraftId: `daily-draft-${date}`,
    });
  }

  return {
    dailyReports,
    progressEntries,
    attendanceEntries,
    stockMovements,
    costEntries,
    blockers,
  };
}

function addReceipts(stockMovements: SnapshotStockMovement[]): SnapshotStockMovement[] {
  const issueByMaterial = new Map<string, number>();

  for (const movement of stockMovements) {
    if (movement.kind !== "ISSUE") {
      continue;
    }

    issueByMaterial.set(
      movement.materialId,
      (issueByMaterial.get(movement.materialId) ?? 0) + Number(movement.quantity),
    );
  }

  const receipts = materialDefinitions.map((material, index) => {
    const issued = issueByMaterial.get(material.materialId) ?? 0;
    const endingBalance =
      material.materialId === "material-brick" ? 80 : Math.max(500, issued * 0.3);

    return {
      stockMovementId: `stock-receipt-${String(index + 1).padStart(2, "0")}`,
      materialId: material.materialId,
      kind: "RECEIPT" as const,
      quantity: formatDecimal(issued + endingBalance),
      unitPriceMnt: formatMoney(material.unitPriceMnt),
      workItemId: null,
      supplierName:
        material.materialId === "material-brick" ? "Цемент Нийлүүлэлт ХХК" : "Төв Хангамж ХХК",
      documentArtifactId: null,
      occurredAt: "2026-01-04T09:00:00.000Z",
      recordedBy: "user-storekeeper",
      reversesMovementId: null,
      reference: `ОР-${String(index + 1).padStart(3, "0")}`,
    };
  });

  return [...receipts, ...stockMovements];
}

function updateWorkItemStatuses(
  workItems: SnapshotWorkItem[],
  progressEntries: SnapshotProgressEntry[],
): SnapshotWorkItem[] {
  const latestByWorkItem = new Map<string, SnapshotProgressEntry>();

  for (const entry of progressEntries) {
    const current = latestByWorkItem.get(entry.workItemId);

    if (current === undefined || Date.parse(entry.capturedAt) > Date.parse(current.capturedAt)) {
      latestByWorkItem.set(entry.workItemId, entry);
    }
  }

  const childrenByParent = new Map<string, SnapshotWorkItem[]>();

  for (const workItem of workItems) {
    if (workItem.parentWorkItemId === null) {
      continue;
    }

    const children = childrenByParent.get(workItem.parentWorkItemId) ?? [];
    children.push(workItem);
    childrenByParent.set(workItem.parentWorkItemId, children);
  }

  const leafStatuses = new Map<string, SnapshotWorkItem["status"]>();

  for (const workItem of workItems) {
    if (childrenByParent.has(workItem.workItemId)) {
      continue;
    }

    const latest = latestByWorkItem.get(workItem.workItemId);
    leafStatuses.set(
      workItem.workItemId,
      latest?.progressPercent === 100
        ? "COMPLETED"
        : latest === undefined
          ? "PLANNED"
          : latest.status === "BLOCKED"
            ? "IN_PROGRESS"
            : latest.status,
    );
  }

  return workItems.map((workItem) => {
    const children = childrenByParent.get(workItem.workItemId);

    if (children === undefined) {
      return {
        ...workItem,
        status: leafStatuses.get(workItem.workItemId) ?? "PLANNED",
      };
    }

    const childStatuses = children.map((child) => leafStatuses.get(child.workItemId) ?? "PLANNED");
    const status: SnapshotWorkItem["status"] = childStatuses.every(
      (childStatus) => childStatus === "COMPLETED",
    )
      ? "COMPLETED"
      : childStatuses.some((childStatus) =>
            ["IN_PROGRESS", "BLOCKED", "COMPLETED"].includes(childStatus),
          )
        ? "IN_PROGRESS"
        : "PLANNED";

    return {
      ...workItem,
      status,
    };
  });
}

function addCostScenarios(
  workItems: SnapshotWorkItem[],
  stockMovements: SnapshotStockMovement[],
  costEntries: SnapshotCostEntry[],
): {
  costEntries: SnapshotCostEntry[];
  ledgerMovementId: string;
  ledgerCostEntryId: string;
} {
  const output = costEntries.map((entry) => ({ ...entry }));
  const costAheadWorkItem = workItems.find((workItem) => workItem.workItemId === "work-item-035")!;
  const plannedCost =
    Number(costAheadWorkItem.plannedQuantity) * Number(costAheadWorkItem.unitCostMnt);
  const currentCost = output
    .filter((entry) => entry.workItemId === "work-item-035")
    .reduce((sum, entry) => sum + Number(entry.amountMnt), 0);
  const targetCost = plannedCost * 0.82;
  const manualAmount = Math.max(1_000_000, targetCost - currentCost);

  output.push({
    costEntryId: "cost-ahead-manual-001",
    workItemId: "work-item-035",
    dailyReportId: null,
    category: "EQUIPMENT",
    amountMnt: formatMoney(manualAmount),
    sourceType: "MANUAL",
    sourceId: "manual-equipment-claim-001",
    occurredAt: "2026-03-24T09:00:00.000Z",
    description: "Түрээсийн тоног төхөөрөмжийн урьдчилгаа болон нэмэлт зардал",
  });

  const ledgerMovement = stockMovements.find(
    (movement) => movement.kind === "ISSUE" && movement.workItemId === "work-item-014",
  )!;
  const ledgerCostEntry = output.find(
    (entry) =>
      entry.sourceType === "STOCK_MOVEMENT" && entry.sourceId === ledgerMovement.stockMovementId,
  )!;
  ledgerCostEntry.amountMnt = formatMoney(Number(ledgerCostEntry.amountMnt) + 2_000_000);

  return {
    costEntries: output,
    ledgerMovementId: ledgerMovement.stockMovementId,
    ledgerCostEntryId: ledgerCostEntry.costEntryId,
  };
}

function latestProgress(
  progressEntries: SnapshotProgressEntry[],
  workItemIdValue: string,
): SnapshotProgressEntry {
  return progressEntries
    .filter((entry) => entry.workItemId === workItemIdValue)
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0]!;
}

function firstProgress(
  progressEntries: SnapshotProgressEntry[],
  workItemIdValue: string,
): SnapshotProgressEntry {
  return progressEntries
    .filter((entry) => entry.workItemId === workItemIdValue)
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt))[0]!;
}

function buildAlerts(
  progressEntries: SnapshotProgressEntry[],
  stockMovements: SnapshotStockMovement[],
  costEntries: SnapshotCostEntry[],
  blockers: SnapshotBlocker[],
): SnapshotAlert[] {
  const criticalProgress = latestProgress(progressEntries, "work-item-017");
  const overuseSources = stockMovements
    .filter((movement) => movement.kind === "ISSUE" && movement.workItemId === "work-item-023")
    .slice(-3)
    .map((movement) => movement.stockMovementId);
  const stockSources = stockMovements
    .filter((movement) => movement.materialId === "material-brick" && movement.kind === "ISSUE")
    .slice(-3)
    .map((movement) => movement.stockMovementId);
  const productivitySources = progressEntries
    .filter((entry) => entry.workItemId === "work-item-029")
    .slice(-4)
    .map((entry) => entry.progressEntryId);
  const costSources = costEntries
    .filter((entry) => entry.workItemId === "work-item-035")
    .slice(-4)
    .map((entry) => entry.costEntryId);
  const subcontractorProgress = latestProgress(progressEntries, "work-item-041");
  const previousReport = `daily-report-2026-03-24`;
  const nextReport = `daily-report-2026-03-26`;
  const dependencySuccessor = firstProgress(progressEntries, "work-item-038");
  const dependencyPredecessor = latestProgress(progressEntries, "work-item-035");

  const definitions: Array<{
    alertId: string;
    ruleId: string;
    workItemId: string | null;
    materialId: string | null;
    severity: SnapshotAlert["severity"];
    title: string;
    actual: string | number | boolean;
    threshold: string | number | boolean;
    delta: string | number | boolean | null;
    sourceIds: string[];
    createdAt: string;
    rootCauseGroupId: string | null;
  }> = [
    {
      alertId: "alert-critical-delay",
      ruleId: "OVERDUE_WORK_ITEM",
      workItemId: "work-item-017",
      materialId: null,
      severity: "CRITICAL",
      title: "Critical ажил төлөвлөсөн хугацаанаас хоцорсон",
      actual: criticalProgress.progressPercent,
      threshold: 100,
      delta: round(100 - criticalProgress.progressPercent),
      sourceIds: [criticalProgress.progressEntryId],
      createdAt: "2026-03-01T00:05:00.000Z",
      rootCauseGroupId: null,
    },
    {
      alertId: "alert-material-overuse",
      ruleId: "MATERIAL_OVERUSE",
      workItemId: "work-item-023",
      materialId: "material-brick",
      severity: "HIGH",
      title: "Тоосго нормоос илүү зарцуулагдсан",
      actual: "138%",
      threshold: "110%",
      delta: "28%",
      sourceIds: overuseSources,
      createdAt: "2026-03-12T00:05:00.000Z",
      rootCauseGroupId: "root-cause-brick-supply",
    },
    {
      alertId: "alert-stock-shortage",
      ruleId: "STOCK_SHORTAGE",
      workItemId: null,
      materialId: "material-brick",
      severity: "CRITICAL",
      title: "Тоосго долоо хоног хүрэхгүй нөөцтэй",
      actual: "80 ш",
      threshold: "7 өдөр",
      delta: "coverage<1 өдөр",
      sourceIds: stockSources,
      createdAt: "2026-03-20T00:05:00.000Z",
      rootCauseGroupId: "root-cause-brick-supply",
    },
    {
      alertId: "alert-productivity-decline",
      ruleId: "PRODUCTIVITY_DECLINE",
      workItemId: "work-item-029",
      materialId: null,
      severity: "HIGH",
      title: "Цахилгааны ажлын бүтээмж буурсан",
      actual: "өмнөх үеийн 25%",
      threshold: "80%",
      delta: "-55%",
      sourceIds: productivitySources,
      createdAt: "2026-03-23T00:05:00.000Z",
      rootCauseGroupId: null,
    },
    {
      alertId: "alert-cost-ahead",
      ruleId: "COST_AHEAD_OF_PROGRESS",
      workItemId: "work-item-035",
      materialId: null,
      severity: "HIGH",
      title: "Зардлын гүйцэтгэл биет ажлаас түрүүлсэн",
      actual: "82%",
      threshold: "physical+15%",
      delta: ">15%",
      sourceIds: costSources,
      createdAt: "2026-03-25T00:05:00.000Z",
      rootCauseGroupId: null,
    },
    {
      alertId: "alert-subcontractor-delay",
      ruleId: "SUBCONTRACTOR_DEVIATION",
      workItemId: "work-item-041",
      materialId: null,
      severity: "HIGH",
      title: "Фасадны туслан гүйцэтгэгчийн ажил хоцорсон",
      actual: subcontractorProgress.progressPercent,
      threshold: 75,
      delta: round(75 - subcontractorProgress.progressPercent),
      sourceIds: [subcontractorProgress.progressEntryId],
      createdAt: "2026-03-27T00:05:00.000Z",
      rootCauseGroupId: null,
    },
    {
      alertId: "alert-missing-report",
      ruleId: "MISSING_DAILY_REPORT",
      workItemId: null,
      materialId: null,
      severity: "MEDIUM",
      title: "2026-03-25 өдрийн тайлан ирээгүй",
      actual: false,
      threshold: true,
      delta: null,
      sourceIds: [previousReport, nextReport],
      createdAt: "2026-03-26T00:05:00.000Z",
      rootCauseGroupId: null,
    },
    {
      alertId: "alert-supplier-repeat",
      ruleId: "REPEATED_SUPPLIER_BLOCKER",
      workItemId: "work-item-023",
      materialId: "material-brick",
      severity: "HIGH",
      title: "Нэг нийлүүлэгчийн саатал давтагдсан",
      actual: blockers.length,
      threshold: 3,
      delta: blockers.length - 3,
      sourceIds: blockers.map((blocker) => blocker.blockerId),
      createdAt: "2026-03-18T00:05:00.000Z",
      rootCauseGroupId: "root-cause-brick-supply",
    },
    {
      alertId: "alert-dependency-violation",
      ruleId: "DEPENDENCY_VIOLATION",
      workItemId: "work-item-038",
      materialId: null,
      severity: "CRITICAL",
      title: "Өмнөх ажил дуусаагүй байхад залгамж ажил эхэлсэн",
      actual: dependencySuccessor.capturedAt,
      threshold: dependencyPredecessor.status,
      delta: null,
      sourceIds: [dependencySuccessor.progressEntryId, dependencyPredecessor.progressEntryId],
      createdAt: "2026-03-06T00:05:00.000Z",
      rootCauseGroupId: null,
    },
  ];

  return definitions.map((definition) => ({
    alertId: definition.alertId,
    ruleId: definition.ruleId,
    ruleVersion: 1,
    workItemId: definition.workItemId,
    materialId: definition.materialId,
    severity: definition.severity,
    status: definition.alertId === "alert-supplier-repeat" ? "ACKNOWLEDGED" : "NEW",
    title: definition.title,
    explanation: {
      actual: definition.actual,
      threshold: definition.threshold,
      delta: definition.delta,
      sourceIds: definition.sourceIds,
    },
    rootCauseGroupId: definition.rootCauseGroupId,
    assigneeRef: definition.alertId === "alert-supplier-repeat" ? "user-procurement-manager" : null,
    createdAt: definition.createdAt,
    acknowledgedAt:
      definition.alertId === "alert-supplier-repeat" ? "2026-03-18T03:00:00.000Z" : null,
    closedAt: null,
    closeNote: null,
  }));
}

function buildPrivateSnapshot(): ProjectAnalysisSnapshotV1 {
  return projectAnalysisSnapshotV1Schema.parse({
    schemaVersion: 1,
    snapshotType: "PROJECT_ANALYSIS",
    snapshotId: "snapshot-private-001",
    tenantId: "tenant-private",
    projectId: "project-private-secret",
    projectCode: "SECRET-X",
    projectName: "Нууц судалгааны төсөл",
    projectStatus: "ACTIVE",
    asOf: BUILDWATCH_SIMULATION_GENERATED_AT,
    activeBaseline: {
      baselineVersionId: "baseline-private-001",
      version: 1,
      approvedBy: "private-director",
      approvedAt: "2026-01-01T00:00:00.000Z",
      changeReason: "Нууц суурь төлөвлөгөө",
      plannedStart: BUILDWATCH_SIMULATION_WINDOW_START,
      plannedEnd: "2026-06-30",
      budgetMnt: "900000000.00",
      calendar: {
        timezone: "Asia/Ulaanbaatar",
        workingWeekdays: [1, 2, 3, 4, 5],
        workHoursPerDay: 8,
        holidays: [],
      },
    },
    workItems: [
      {
        workItemId: "private-work-item-001",
        parentWorkItemId: null,
        code: "PX-001",
        name: "Нууц байгууламжийн шинжилгээ",
        stage: "Нууц",
        location: "Хаалттай бүс",
        unit: "багц",
        plannedQuantity: "1",
        unitCostMnt: "900000000.00",
        plannedStart: "2026-01-05",
        plannedEnd: "2026-06-30",
        status: "IN_PROGRESS",
        priority: "CRITICAL",
        assigneeType: "TEAM",
        assigneeRef: "private-team",
        subcontractorId: null,
        isCritical: true,
        displayOrder: 1,
      },
    ],
    dependencies: [],
    materials: [],
    materialNorms: [],
    subcontractors: [],
    dailyReports: [
      {
        dailyReportId: "private-report-001",
        date: "2026-03-28",
        reportedBy: "private-user",
        rawText: "TENANT-PRIVATE-ONLY: нууц төсвийн код OMEGA-947, бусад tenant-д харуулахгүй.",
        status: "APPROVED",
        submittedAt: "2026-03-28T10:00:00.000Z",
        approvedBy: "private-manager",
        approvedAt: "2026-03-28T11:00:00.000Z",
        rejectionReason: null,
        sourceDraftId: "private-draft-001",
      },
    ],
    progressEntries: [
      {
        progressEntryId: "private-progress-001",
        dailyReportId: "private-report-001",
        workItemId: "private-work-item-001",
        capturedAt: "2026-03-28T10:00:00.000Z",
        quantityDoneIncrement: "0.01",
        cumulativeQuantityDone: "0.42",
        progressPercent: 42,
        status: "IN_PROGRESS",
        blockerReason: null,
        note: "Нууц",
        aiConfidence: null,
        humanEdited: true,
      },
    ],
    attendanceEntries: [],
    stockMovements: [],
    costEntries: [
      {
        costEntryId: "private-cost-001",
        workItemId: "private-work-item-001",
        dailyReportId: "private-report-001",
        category: "OTHER",
        amountMnt: "378000000.00",
        sourceType: "MANUAL",
        sourceId: "private-ledger-001",
        occurredAt: "2026-03-28T10:00:00.000Z",
        description: "Нууц зардал",
      },
    ],
    blockers: [],
    alerts: [],
    forecasts: [],
    recommendationDecisions: [],
    tenantProfile: {
      displayName: "Нууц байгууллага",
      terminology: {},
      blockerCategories: [],
      reportingStyle: null,
    },
  });
}

function buildAnswerKey(
  snapshot: ProjectAnalysisSnapshotV1,
  privateSnapshot: ProjectAnalysisSnapshotV1,
  ledgerMovementId: string,
  ledgerCostEntryId: string,
  seed: string,
): BuildWatchSimulationV1["answerKey"] {
  const criticalProgress = latestProgress(snapshot.progressEntries, "work-item-017");
  const overuseMovements = snapshot.stockMovements.filter(
    (movement) => movement.kind === "ISSUE" && movement.workItemId === "work-item-023",
  );
  const latestProductivity = snapshot.progressEntries
    .filter((entry) => entry.workItemId === "work-item-029")
    .slice(-7);
  const costAheadEntries = snapshot.costEntries.filter(
    (entry) => entry.workItemId === "work-item-035",
  );
  const subcontractorProgress = latestProgress(snapshot.progressEntries, "work-item-041");
  const successorProgress = firstProgress(snapshot.progressEntries, "work-item-038");
  const predecessorProgress = latestProgress(snapshot.progressEntries, "work-item-035");
  const healthyProgress = latestProgress(snapshot.progressEntries, "work-item-046");
  const brickBalance = snapshot.stockMovements
    .filter((movement) => movement.materialId === "material-brick")
    .reduce((balance, movement) => {
      if (movement.kind === "RECEIPT") {
        return balance + Number(movement.quantity);
      }

      if (movement.kind === "ISSUE") {
        return balance - Number(movement.quantity);
      }

      return balance;
    }, 0);
  const issues: SimulationAnswerIssue[] = [
    {
      issueId: "answer-critical-delay",
      type: "CRITICAL_DELAY",
      severity: "CRITICAL",
      effectiveDate: "2026-03-01",
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemIds: ["work-item-017"],
      materialIds: [],
      expectedEvidence: {
        plannedEnd: snapshot.workItems.find((workItem) => workItem.workItemId === "work-item-017")!
          .plannedEnd,
        progressPercent: criticalProgress.progressPercent,
        status: criticalProgress.status,
      },
      expectedSourceIds: [criticalProgress.progressEntryId],
    },
    {
      issueId: "answer-material-overuse",
      type: "MATERIAL_OVERUSE",
      severity: "HIGH",
      effectiveDate: "2026-03-12",
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemIds: ["work-item-023"],
      materialIds: ["material-brick"],
      expectedEvidence: {
        consumptionFactor: 1.38,
        allowedFactor: 1.1,
      },
      expectedSourceIds: overuseMovements.map((movement) => movement.stockMovementId),
    },
    {
      issueId: "answer-stock-shortage",
      type: "STOCK_SHORTAGE",
      severity: "CRITICAL",
      effectiveDate: "2026-03-20",
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemIds: [],
      materialIds: ["material-brick"],
      expectedEvidence: {
        currentBalance: round(brickBalance, 3),
        thresholdDays: 7,
      },
      expectedSourceIds: snapshot.stockMovements
        .filter((movement) => movement.materialId === "material-brick")
        .map((movement) => movement.stockMovementId),
    },
    {
      issueId: "answer-productivity-decline",
      type: "PRODUCTIVITY_DECLINE",
      severity: "HIGH",
      effectiveDate: "2026-03-23",
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemIds: ["work-item-029"],
      materialIds: [],
      expectedEvidence: {
        changedOn: "2026-03-16",
        newPaceFactor: 0.28,
        thresholdRatio: 0.8,
      },
      expectedSourceIds: latestProductivity.map((entry) => entry.progressEntryId),
    },
    {
      issueId: "answer-cost-ahead",
      type: "COST_AHEAD_OF_PROGRESS",
      severity: "HIGH",
      effectiveDate: "2026-03-25",
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemIds: ["work-item-035"],
      materialIds: [],
      expectedEvidence: {
        targetCostPercent: 82,
        allowedLeadPercent: 15,
      },
      expectedSourceIds: costAheadEntries.map((entry) => entry.costEntryId),
    },
    {
      issueId: "answer-subcontractor-delay",
      type: "SUBCONTRACTOR_DEVIATION",
      severity: "HIGH",
      effectiveDate: "2026-03-27",
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemIds: ["work-item-041"],
      materialIds: [],
      expectedEvidence: {
        progressPercent: subcontractorProgress.progressPercent,
        targetPercent: 75,
        subcontractorId: "subcontractor-facade",
      },
      expectedSourceIds: [subcontractorProgress.progressEntryId],
    },
    {
      issueId: "answer-missing-report",
      type: "MISSING_DAILY_REPORT",
      severity: "MEDIUM",
      effectiveDate: "2026-03-25",
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemIds: [],
      materialIds: [],
      expectedEvidence: {
        missingDate: "2026-03-25",
        expectedWorkingDay: true,
      },
      expectedSourceIds: ["daily-report-2026-03-24", "daily-report-2026-03-26"],
    },
    {
      issueId: "answer-repeated-supplier",
      type: "REPEATED_SUPPLIER_BLOCKER",
      severity: "HIGH",
      effectiveDate: "2026-03-18",
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemIds: ["work-item-023"],
      materialIds: ["material-brick"],
      expectedEvidence: {
        supplierName: "Цемент Нийлүүлэлт ХХК",
        repeatCount: snapshot.blockers.length,
        threshold: 3,
      },
      expectedSourceIds: snapshot.blockers.map((blocker) => blocker.blockerId),
    },
    {
      issueId: "answer-linked-root-cause",
      type: "LINKED_ROOT_CAUSE",
      severity: "HIGH",
      effectiveDate: "2026-03-20",
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemIds: ["work-item-023"],
      materialIds: ["material-brick"],
      expectedEvidence: {
        rootCauseGroupId: "root-cause-brick-supply",
        linkedAlertCount: 3,
      },
      expectedSourceIds: [
        "alert-material-overuse",
        "alert-stock-shortage",
        "alert-supplier-repeat",
      ],
    },
    {
      issueId: "answer-dependency-violation",
      type: "DEPENDENCY_VIOLATION",
      severity: "CRITICAL",
      effectiveDate: successorProgress.capturedAt.slice(0, 10),
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemIds: ["work-item-035", "work-item-038"],
      materialIds: [],
      expectedEvidence: {
        successorActualStart: successorProgress.capturedAt,
        predecessorStatusAtAsOf: predecessorProgress.status,
        dependencyId: "dependency-intentional-violation",
      },
      expectedSourceIds: [successorProgress.progressEntryId, predecessorProgress.progressEntryId],
    },
    {
      issueId: "answer-ledger-mismatch",
      type: "LEDGER_MISMATCH",
      severity: "HIGH",
      effectiveDate: "2026-03-28",
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemIds: ["work-item-014"],
      materialIds: [],
      expectedEvidence: {
        varianceMnt: "2000000.00",
        movementId: ledgerMovementId,
        costEntryId: ledgerCostEntryId,
      },
      expectedSourceIds: [ledgerMovementId, ledgerCostEntryId],
    },
    {
      issueId: "answer-healthy-control",
      type: "HEALTHY_CONTROL",
      severity: "INFO",
      effectiveDate: "2026-03-28",
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemIds: ["work-item-046"],
      materialIds: [],
      expectedEvidence: {
        progressPercent: healthyProgress.progressPercent,
        expectedAlertCount: 0,
      },
      expectedSourceIds: [healthyProgress.progressEntryId],
    },
    {
      issueId: "answer-cross-tenant-secret",
      type: "CROSS_TENANT_SECRET",
      severity: "CRITICAL",
      effectiveDate: "2026-03-28",
      tenantId: privateSnapshot.tenantId,
      projectId: privateSnapshot.projectId,
      workItemIds: ["private-work-item-001"],
      materialIds: [],
      expectedEvidence: {
        forbiddenMarker: "TENANT-PRIVATE-ONLY",
        mustLeak: false,
      },
      expectedSourceIds: ["private-report-001"],
    },
  ];

  return simulationAnswerKeyV1Schema.parse({
    schemaVersion: 1,
    seed,
    generatedAt: BUILDWATCH_SIMULATION_GENERATED_AT,
    windowStart: BUILDWATCH_SIMULATION_WINDOW_START,
    windowEnd: BUILDWATCH_SIMULATION_WINDOW_END,
    issues,
  });
}

export function buildBuildWatchSimulation(
  seed = BUILDWATCH_SIMULATION_SEED,
): BuildWatchSimulationV1 {
  const random = seedrandom(seed);
  const { workItems, dependencies, materialNorms, runtimes } = buildWorkBreakdown(random);
  const execution = buildExecutionHistory(random, runtimes, materialNorms);
  execution.stockMovements.push({
    stockMovementId: "stock-issue-brick-late",
    materialId: "material-brick",
    kind: "ISSUE",
    quantity: "280",
    unitPriceMnt: "1250.00",
    workItemId: "work-item-023",
    supplierName: null,
    documentArtifactId: null,
    occurredAt: "2026-03-27T09:00:00.000Z",
    recordedBy: "user-storekeeper",
    reversesMovementId: null,
    reference: "ЗАР-2026-03-27-BW-023",
  });
  execution.costEntries.push({
    costEntryId: "cost-material-brick-late",
    workItemId: "work-item-023",
    dailyReportId: null,
    category: "MATERIAL",
    amountMnt: "350000.00",
    sourceType: "STOCK_MOVEMENT",
    sourceId: "stock-issue-brick-late",
    occurredAt: "2026-03-27T09:00:00.000Z",
    description: "Тоосгоны агуулахын сарын эцсийн зарлага",
  });
  const stockMovements = addReceipts(execution.stockMovements);
  const statusWorkItems = updateWorkItemStatuses(workItems, execution.progressEntries);
  const costScenario = addCostScenarios(statusWorkItems, stockMovements, execution.costEntries);
  const alerts = buildAlerts(
    execution.progressEntries,
    stockMovements,
    costScenario.costEntries,
    execution.blockers,
  );
  const snapshot = projectAnalysisSnapshotV1Schema.parse({
    schemaVersion: 1,
    snapshotType: "PROJECT_ANALYSIS",
    snapshotId: `snapshot-${seed}`,
    tenantId: "tenant-demo",
    projectId: "project-buildwatch-simulation",
    projectCode: "BW-SIM",
    projectName: "BuildWatch 12 долоо хоногийн simulation",
    projectStatus: "ACTIVE",
    asOf: BUILDWATCH_SIMULATION_GENERATED_AT,
    activeBaseline: {
      baselineVersionId: "baseline-buildwatch-v1",
      version: 1,
      approvedBy: "user-project-director",
      approvedAt: "2026-01-02T04:00:00.000Z",
      changeReason: "Phase 1 simulation-ийн батлагдсан baseline",
      plannedStart: BUILDWATCH_SIMULATION_WINDOW_START,
      plannedEnd: "2026-06-30",
      budgetMnt: formatMoney(
        statusWorkItems.reduce(
          (sum, workItem) => sum + Number(workItem.plannedQuantity) * Number(workItem.unitCostMnt),
          0,
        ),
      ),
      calendar: {
        timezone: "Asia/Ulaanbaatar",
        workingWeekdays: [...BUILDWATCH_SIMULATION_CALENDAR.workingWeekdays],
        workHoursPerDay: 8,
        holidays: [...BUILDWATCH_SIMULATION_CALENDAR.holidays],
      },
    },
    workItems: statusWorkItems,
    dependencies,
    materials: materialDefinitions.map(({ unitPriceMnt: _unitPriceMnt, ...material }) => material),
    materialNorms,
    subcontractors,
    dailyReports: execution.dailyReports,
    progressEntries: execution.progressEntries,
    attendanceEntries: execution.attendanceEntries,
    stockMovements,
    costEntries: costScenario.costEntries,
    blockers: execution.blockers,
    alerts,
    forecasts: [],
    recommendationDecisions: [
      {
        recommendationId: "recommendation-decision-001",
        generatedAt: "2026-03-18T01:00:00.000Z",
        status: "APPROVED",
        title: "Тоосгоны нийлүүлэгчтэй нөөц нөхөх төлөвлөгөө",
        action: "Нөөц нийлүүлэх хоёр дахь эх үүсвэрийг 48 цагийн дотор баталгаажуулах.",
        workItemIds: ["work-item-023"],
        estimatedImpactDays: 4,
        decidedBy: "user-project-manager",
        decidedAt: "2026-03-18T04:00:00.000Z",
        decisionReason: "Нийлүүлэлтийн саатал гурав давтагдсан.",
        sourceIds: ["alert-material-overuse", "alert-supplier-repeat"],
      },
      {
        recommendationId: "recommendation-decision-002",
        generatedAt: "2026-03-24T01:00:00.000Z",
        status: "DISCARDED",
        title: "Цахилгааны ажлыг шөнийн ээлжээр хийх",
        action: "Нэмэлт шөнийн ээлж оруулах.",
        workItemIds: ["work-item-029"],
        estimatedImpactDays: 3,
        decidedBy: "user-project-manager",
        decidedAt: "2026-03-24T05:00:00.000Z",
        decisionReason: "Аюулгүй ажиллагааны нөөц хүрэлцээгүй.",
        sourceIds: ["alert-productivity-decline"],
      },
    ],
    tenantProfile: {
      displayName: "BuildWatch Демо Барилга ХХК",
      terminology: {
        workItem: "ажил",
        dailyReport: "өдрийн тайлан",
        subcontractor: "туслан гүйцэтгэгч",
      },
      blockerCategories: [
        "MATERIAL",
        "WEATHER",
        "LABOR",
        "EQUIPMENT",
        "DESIGN",
        "APPROVAL",
        "SAFETY",
      ],
      reportingStyle: "Баримт, зөрүү, эх сурвалж, дараагийн үйлдлийг товч Монгол хэлээр бичнэ.",
    },
  });
  const privateSnapshot = buildPrivateSnapshot();
  const answerKey = buildAnswerKey(
    snapshot,
    privateSnapshot,
    costScenario.ledgerMovementId,
    costScenario.ledgerCostEntryId,
    seed,
  );

  return buildWatchSimulationV1Schema.parse({
    schemaVersion: 1,
    seed,
    generatedAt: BUILDWATCH_SIMULATION_GENERATED_AT,
    windowStart: BUILDWATCH_SIMULATION_WINDOW_START,
    windowEnd: BUILDWATCH_SIMULATION_WINDOW_END,
    snapshot,
    privateSnapshot,
    answerKey,
  });
}

function isAtOrBefore(dateTimeValue: string, cutoff: string): boolean {
  return Date.parse(dateTimeValue) <= Date.parse(cutoff);
}

export function replaySimulationSnapshot(
  snapshot: ProjectAnalysisSnapshotV1,
  asOfDate: string,
): ProjectAnalysisSnapshotV1 {
  if (
    compareIsoDates(asOfDate, BUILDWATCH_SIMULATION_WINDOW_START) < 0 ||
    compareIsoDates(asOfDate, BUILDWATCH_SIMULATION_WINDOW_END) > 0
  ) {
    throw new Error(
      `Replay date must be between ${BUILDWATCH_SIMULATION_WINDOW_START} and ${BUILDWATCH_SIMULATION_WINDOW_END}`,
    );
  }

  const cutoff = `${asOfDate}T23:59:59.999Z`;
  const dailyReports = snapshot.dailyReports.filter(
    (report) => compareIsoDates(report.date, asOfDate) <= 0,
  );
  const dailyReportIds = new Set(dailyReports.map((report) => report.dailyReportId));
  const progressEntries = snapshot.progressEntries.filter(
    (entry) => dailyReportIds.has(entry.dailyReportId) && isAtOrBefore(entry.capturedAt, cutoff),
  );
  const attendanceEntries = snapshot.attendanceEntries.filter((entry) =>
    dailyReportIds.has(entry.dailyReportId),
  );
  const stockMovements = snapshot.stockMovements.filter((movement) =>
    isAtOrBefore(movement.occurredAt, cutoff),
  );
  const costEntries = snapshot.costEntries.filter(
    (entry) =>
      isAtOrBefore(entry.occurredAt, cutoff) &&
      (entry.dailyReportId === null || dailyReportIds.has(entry.dailyReportId)),
  );
  const blockers = snapshot.blockers.filter(
    (blocker) =>
      dailyReportIds.has(blocker.dailyReportId) && isAtOrBefore(blocker.openedAt, cutoff),
  );
  const alerts = snapshot.alerts.filter((alert) => isAtOrBefore(alert.createdAt, cutoff));
  const forecasts = snapshot.forecasts.filter((forecast) =>
    isAtOrBefore(forecast.calculatedAt, cutoff),
  );
  const recommendationDecisions = snapshot.recommendationDecisions.filter((recommendation) =>
    isAtOrBefore(recommendation.generatedAt, cutoff),
  );
  const workItems = updateWorkItemStatuses(snapshot.workItems, progressEntries);

  return projectAnalysisSnapshotV1Schema.parse({
    ...snapshot,
    snapshotId: `${snapshot.snapshotId}-as-of-${asOfDate}`,
    asOf: cutoff,
    workItems,
    dailyReports,
    progressEntries,
    attendanceEntries,
    stockMovements,
    costEntries,
    blockers,
    alerts,
    forecasts,
    recommendationDecisions,
  });
}

export function replayBuildWatchSimulation(
  simulation: BuildWatchSimulationV1,
  asOfDate: string,
): ProjectAnalysisSnapshotV1 {
  return replaySimulationSnapshot(simulation.snapshot, asOfDate);
}

export function simulationWeekEndDates(): string[] {
  return Array.from({ length: 12 }, (_, index) =>
    addCalendarDays(BUILDWATCH_SIMULATION_WINDOW_START, index * 7 + 5),
  );
}

export function simulationWorkingDayCount(): number {
  return workingDaysBetween(
    BUILDWATCH_SIMULATION_WINDOW_START,
    BUILDWATCH_SIMULATION_WINDOW_END,
    BUILDWATCH_SIMULATION_CALENDAR,
    true,
  );
}
