import {
  recoveryScenarioV1Schema,
  type RecoveryScenarioV1,
  type ScheduleForecastV1,
} from "../contracts/deterministic-analysis.js";
import type { ProjectAnalysisSnapshotV1 } from "../contracts/project-analysis-snapshot.js";
import { compareIsoDates, workingDaysBetween } from "./calendar.js";
import { calculateScheduleForecast } from "./forecast.js";

function impactWorkingDays(
  baselineEnd: string,
  scenarioEnd: string,
  snapshot: ProjectAnalysisSnapshotV1,
): number {
  if (compareIsoDates(scenarioEnd, baselineEnd) >= 0) {
    return 0;
  }

  return Math.max(
    0,
    workingDaysBetween(scenarioEnd, baselineEnd, snapshot.activeBaseline.calendar, false),
  );
}

function sourceIds(forecast: ScheduleForecastV1, workItemId: string): string[] {
  const workItem = forecast.workItems.find((item) => item.workItemId === workItemId);

  if (workItem === undefined || workItem.sourceProgressEntryIds.length === 0) {
    return [workItemId];
  }

  return workItem.sourceProgressEntryIds.slice(-20);
}

function scenario(
  snapshot: ProjectAnalysisSnapshotV1,
  baseline: ScheduleForecastV1,
  input: {
    scenarioId: string;
    type: RecoveryScenarioV1["type"];
    targetWorkItemId: string;
    assumptions: string[];
    recalculated: ScheduleForecastV1;
    dataSufficient: boolean;
  },
): RecoveryScenarioV1 {
  return recoveryScenarioV1Schema.parse({
    scenarioId: input.scenarioId,
    type: input.type,
    targetWorkItemIds: [input.targetWorkItemId],
    baselineProjectedEndDate: baseline.projectedEndDate,
    scenarioProjectedEndDate: input.recalculated.projectedEndDate,
    estimatedImpactDays: impactWorkingDays(
      baseline.projectedEndDate,
      input.recalculated.projectedEndDate,
      snapshot,
    ),
    assumptions: input.assumptions,
    dataSufficient: input.dataSufficient,
    sourceIds: sourceIds(baseline, input.targetWorkItemId),
  });
}

function delayedCandidates(forecast: ScheduleForecastV1): ScheduleForecastV1["workItems"] {
  return [...forecast.workItems]
    .filter((item) => item.currentProgressPercent < 100 && item.delayWorkingDays > 0)
    .sort(
      (left, right) =>
        right.delayWorkingDays - left.delayWorkingDays ||
        right.remainingDurationWorkingDays - left.remainingDurationWorkingDays ||
        left.workItemId.localeCompare(right.workItemId),
    );
}

export function simulateRecoveryScenarios(
  snapshot: ProjectAnalysisSnapshotV1,
  baseline = calculateScheduleForecast(snapshot),
): RecoveryScenarioV1[] {
  const candidates = delayedCandidates(baseline);
  const criticalTarget =
    candidates.find((item) => item.isPlannedCritical) ?? candidates[0] ?? baseline.workItems[0]!;
  const startedTarget = candidates.find((item) => item.actualStartDate !== null) ?? criticalTarget;
  const workItemsById = new Map(
    snapshot.workItems.map((workItem) => [workItem.workItemId, workItem]),
  );
  const subcontractorTarget =
    candidates.find((item) => workItemsById.get(item.workItemId)?.subcontractorId !== null) ??
    criticalTarget;
  const resequenceDependency = snapshot.dependencies
    .filter(
      (dependency) =>
        dependency.successorWorkItemId === criticalTarget.workItemId &&
        dependency.type === "FINISH_TO_START",
    )
    .sort((left, right) => left.dependencyId.localeCompare(right.dependencyId))[0];
  const parallelForecast = calculateScheduleForecast(snapshot, {
    forecastIdSuffix: "scenario-parallel",
    remainingDurationScaleByWorkItem: {
      [criticalTarget.workItemId]: 0.8,
    },
  });
  const extraCrewForecast = calculateScheduleForecast(snapshot, {
    forecastIdSuffix: "scenario-extra-crew",
    remainingDurationScaleByWorkItem: {
      [startedTarget.workItemId]: 0.7,
    },
  });
  const resequenceForecast =
    resequenceDependency === undefined
      ? baseline
      : calculateScheduleForecast(snapshot, {
          forecastIdSuffix: "scenario-resequence",
          dependencyTypeById: {
            [resequenceDependency.dependencyId]: "START_TO_START",
          },
        });
  const subcontractorForecast = calculateScheduleForecast(snapshot, {
    forecastIdSuffix: "scenario-subcontractor",
    remainingDurationScaleByWorkItem: {
      [subcontractorTarget.workItemId]: 0.65,
    },
  });

  return [
    scenario(snapshot, baseline, {
      scenarioId: "scenario-parallelization",
      type: "PARALLELIZATION",
      targetWorkItemId: criticalTarget.workItemId,
      assumptions: [
        "Ажлын фронтыг хоёр бие даасан бүсэд зэрэг нээнэ.",
        "Үлдсэн хугацааг 20 хувиар бууруулсан deterministic таамаг хэрэглэнэ.",
        "Чанар, аюулгүй ажиллагааны шалгалтыг алгасахгүй.",
      ],
      recalculated: parallelForecast,
      dataSufficient: criticalTarget.sourceProgressEntryIds.length >= 2,
    }),
    scenario(snapshot, baseline, {
      scenarioId: "scenario-extra-crew",
      type: "EXTRA_CREW",
      targetWorkItemId: startedTarget.workItemId,
      assumptions: [
        "Нэмэлт багийн нөөц шууд бэлэн.",
        "Үлдсэн хугацааг 30 хувиар бууруулна.",
        "Бүтээмжийн бууралтын нэмэлт коэффициент тооцоогүй.",
      ],
      recalculated: extraCrewForecast,
      dataSufficient: startedTarget.actualPacePerWorkingDay !== null,
    }),
    scenario(snapshot, baseline, {
      scenarioId: "scenario-resequence",
      type: "RESEQUENCE",
      targetWorkItemId: criticalTarget.workItemId,
      assumptions:
        resequenceDependency === undefined
          ? [
              "Шилжүүлж болох FINISH_TO_START хамаарал олдоогүй.",
              "Baseline forecast өөрчлөгдөөгүй.",
            ]
          : [
              `${resequenceDependency.dependencyId} хамаарлыг START_TO_START гэж түр тооцов.`,
              "Техникийн болон аюулгүй ажиллагааны approval тусдаа шаардлагатай.",
            ],
      recalculated: resequenceForecast,
      dataSufficient: resequenceDependency !== undefined,
    }),
    scenario(snapshot, baseline, {
      scenarioId: "scenario-subcontractor-option",
      type: "SUBCONTRACTOR_OPTION",
      targetWorkItemId: subcontractorTarget.workItemId,
      assumptions: [
        "Нэмэлт туслан гүйцэтгэгч ижил ажлын фронтод орно.",
        "Үлдсэн хугацааг 35 хувиар бууруулна.",
        "Гэрээ, чанар, нэвтрэх зөвшөөрлийн хугацааг тусад нь батална.",
      ],
      recalculated: subcontractorForecast,
      dataSufficient: workItemsById.get(subcontractorTarget.workItemId)?.subcontractorId !== null,
    }),
  ];
}
