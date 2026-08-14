import {
  scheduleForecastV1Schema,
  type ScheduleForecastV1,
  type WorkItemForecastV1,
} from "../contracts/deterministic-analysis.js";
import type { ProjectAnalysisSnapshotV1 } from "../contracts/project-analysis-snapshot.js";
import { addWorkingDays, compareIsoDates, workingDaysBetween } from "./calendar.js";
import {
  calculateCalendarCriticalPath,
  executableDependencies,
  executableWorkItems,
} from "./critical-path.js";
import { topologicalSort } from "./graph.js";

type SnapshotWorkItem = ProjectAnalysisSnapshotV1["workItems"][number];
type SnapshotProgressEntry = ProjectAnalysisSnapshotV1["progressEntries"][number];
type SnapshotDependency = ProjectAnalysisSnapshotV1["dependencies"][number];

export type ForecastCalculationOptions = {
  forecastIdSuffix?: string;
  remainingDurationScaleByWorkItem?: Readonly<Record<string, number>>;
  plannedDurationScaleByWorkItem?: Readonly<Record<string, number>>;
  startAdvanceWorkingDaysByWorkItem?: Readonly<Record<string, number>>;
  dependencyTypeById?: Readonly<Record<string, SnapshotDependency["type"]>>;
};

type ForecastState = {
  workItem: SnapshotWorkItem;
  started: boolean;
  completed: boolean;
  startOffset: number;
  finishExclusiveOffset: number;
  durationWorkingDays: number;
  currentProgressPercent: number;
  cumulativeQuantityDone: number;
  pace: number | null;
  remainingDurationWorkingDays: number;
  confidence: WorkItemForecastV1["confidence"];
  sourceProgressEntryIds: string[];
  actualStartDate: string | null;
};

function formatDecimal(value: number): string {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function dateOffset(
  projectStart: string,
  date: string,
  snapshot: ProjectAnalysisSnapshotV1,
): number {
  return workingDaysBetween(projectStart, date, snapshot.activeBaseline.calendar, false);
}

function signedWorkingDayDifference(
  plannedDate: string,
  projectedDate: string,
  snapshot: ProjectAnalysisSnapshotV1,
): number {
  return workingDaysBetween(plannedDate, projectedDate, snapshot.activeBaseline.calendar, false);
}

function scaledDuration(duration: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 2) {
    throw new Error(`Forecast duration scale must be greater than 0 and at most 2: ${scale}`);
  }

  return Math.max(1, Math.ceil(duration * scale));
}

function paceFromEntries(
  entries: readonly SnapshotProgressEntry[],
  asOfDate: string,
  snapshot: ProjectAnalysisSnapshotV1,
): number | null {
  if (entries.length === 0) {
    return null;
  }

  const sample = entries.slice(-14);
  const latest = sample.at(-1)!;

  if (sample.length >= 2) {
    const first = sample[0]!;
    const elapsedWorkingDays = Math.max(
      1,
      workingDaysBetween(
        first.capturedAt.slice(0, 10),
        latest.capturedAt.slice(0, 10),
        snapshot.activeBaseline.calendar,
        false,
      ),
    );
    const delta = Number(latest.cumulativeQuantityDone) - Number(first.cumulativeQuantityDone);

    if (delta > 0) {
      return delta / elapsedWorkingDays;
    }
  }

  const actualStartDate = entries[0]!.capturedAt.slice(0, 10);
  const elapsedWorkingDays = Math.max(
    1,
    workingDaysBetween(actualStartDate, asOfDate, snapshot.activeBaseline.calendar, true),
  );
  const cumulative = Number(latest.cumulativeQuantityDone);
  return cumulative > 0 ? cumulative / elapsedWorkingDays : null;
}

function confidenceFromEntries(
  entries: readonly SnapshotProgressEntry[],
  pace: number | null,
  completed: boolean,
): WorkItemForecastV1["confidence"] {
  if (completed) {
    return "HIGH";
  }

  if (pace === null) {
    return "INSUFFICIENT_DATA";
  }

  if (entries.length >= 7) {
    return "HIGH";
  }

  if (entries.length >= 2) {
    return "MEDIUM";
  }

  return "LOW";
}

function dependencyConstraint(
  dependency: SnapshotDependency,
  predecessor: ForecastState,
  successorDuration: number,
): number {
  switch (dependency.type) {
    case "FINISH_TO_START":
      return predecessor.finishExclusiveOffset + dependency.lagDays;
    case "START_TO_START":
      return predecessor.startOffset + dependency.lagDays;
    case "FINISH_TO_FINISH":
      return predecessor.finishExclusiveOffset + dependency.lagDays - successorDuration;
    case "START_TO_FINISH":
      return predecessor.startOffset + dependency.lagDays - successorDuration;
  }
}

function forecastConfidence(
  states: readonly ForecastState[],
  criticalWorkItemIds: ReadonlySet<string>,
): ScheduleForecastV1["confidence"] {
  const candidates = states.filter(
    (state) => !state.completed && criticalWorkItemIds.has(state.workItem.workItemId),
  );

  if (candidates.length === 0) {
    return "HIGH";
  }

  const values = candidates.map((state) => state.confidence);

  if (values.every((value) => value === "INSUFFICIENT_DATA")) {
    return "INSUFFICIENT_DATA";
  }

  if (values.some((value) => value === "LOW" || value === "INSUFFICIENT_DATA")) {
    return "LOW";
  }

  if (values.some((value) => value === "MEDIUM")) {
    return "MEDIUM";
  }

  return "HIGH";
}

export function calculateScheduleForecast(
  snapshot: ProjectAnalysisSnapshotV1,
  options: ForecastCalculationOptions = {},
): ScheduleForecastV1 {
  const workItems = executableWorkItems(snapshot);
  const dependencies = executableDependencies(snapshot, workItems).map((dependency) => ({
    ...dependency,
    type: options.dependencyTypeById?.[dependency.dependencyId] ?? dependency.type,
  }));
  const workItemsById = new Map(workItems.map((workItem) => [workItem.workItemId, workItem]));
  const topologicalOrder = topologicalSort(
    workItems.map((workItem) => workItem.workItemId),
    dependencies,
  );
  const incoming = new Map(
    topologicalOrder.map((workItemId) => [workItemId, [] as SnapshotDependency[]]),
  );

  for (const dependency of dependencies) {
    incoming.get(dependency.successorWorkItemId)!.push(dependency);
  }

  const approvedReportIds = new Set(
    snapshot.dailyReports
      .filter((report) => report.status === "APPROVED")
      .map((report) => report.dailyReportId),
  );
  const progressByWorkItem = new Map<string, SnapshotProgressEntry[]>(
    workItems.map((workItem) => [workItem.workItemId, []]),
  );

  for (const entry of snapshot.progressEntries) {
    if (!approvedReportIds.has(entry.dailyReportId)) {
      continue;
    }

    progressByWorkItem.get(entry.workItemId)?.push(entry);
  }

  for (const entries of progressByWorkItem.values()) {
    entries.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
  }

  const projectStart = snapshot.activeBaseline.plannedStart;
  const asOfDate = snapshot.asOf.slice(0, 10);
  const states = new Map<string, ForecastState>();

  for (const workItemId of topologicalOrder) {
    const workItem = workItemsById.get(workItemId)!;
    const entries = progressByWorkItem.get(workItemId)!;
    const latest = entries.at(-1);
    const plannedQuantity = Number(workItem.plannedQuantity);
    const currentProgressPercent =
      latest?.progressPercent ?? (workItem.status === "COMPLETED" ? 100 : 0);
    const cumulativeQuantityDone =
      latest === undefined
        ? currentProgressPercent === 100
          ? plannedQuantity
          : 0
        : Number(latest.cumulativeQuantityDone);
    const completed = currentProgressPercent >= 100 || workItem.status === "COMPLETED";
    const pace = paceFromEntries(entries, asOfDate, snapshot);
    const plannedDuration = Math.max(
      1,
      workingDaysBetween(
        workItem.plannedStart,
        workItem.plannedEnd,
        snapshot.activeBaseline.calendar,
        true,
      ),
    );
    const remainingQuantity = Math.max(0, plannedQuantity - cumulativeQuantityDone);
    const fallbackRemaining = Math.max(
      1,
      Math.ceil(plannedDuration * (1 - currentProgressPercent / 100)),
    );
    const rawRemainingDuration = completed
      ? 0
      : pace !== null && pace > 0
        ? Math.max(1, Math.ceil(remainingQuantity / pace))
        : fallbackRemaining;
    const remainingScale = options.remainingDurationScaleByWorkItem?.[workItemId] ?? 1;
    const remainingDuration = completed ? 0 : scaledDuration(rawRemainingDuration, remainingScale);
    const actualStartDate = entries[0]?.capturedAt.slice(0, 10) ?? null;
    const started = actualStartDate !== null;
    const plannedScale = options.plannedDurationScaleByWorkItem?.[workItemId] ?? 1;
    const duration = started
      ? Math.max(1, remainingDuration)
      : scaledDuration(plannedDuration, plannedScale);
    const advance = options.startAdvanceWorkingDaysByWorkItem?.[workItemId] ?? 0;
    const releaseOffset = Math.max(
      0,
      dateOffset(projectStart, workItem.plannedStart, snapshot) - advance,
    );
    const startOffset = started
      ? Math.max(0, dateOffset(projectStart, actualStartDate, snapshot))
      : releaseOffset;
    let finishExclusiveOffset: number;

    if (completed && latest !== undefined) {
      finishExclusiveOffset =
        dateOffset(projectStart, latest.capturedAt.slice(0, 10), snapshot) + 1;
    } else if (started) {
      const projectedFinishDate = addWorkingDays(
        asOfDate,
        remainingDuration,
        snapshot.activeBaseline.calendar,
      );
      finishExclusiveOffset = dateOffset(projectStart, projectedFinishDate, snapshot) + 1;
    } else {
      finishExclusiveOffset = startOffset + duration;
    }

    states.set(workItemId, {
      workItem,
      started,
      completed,
      startOffset,
      finishExclusiveOffset,
      durationWorkingDays: duration,
      currentProgressPercent,
      cumulativeQuantityDone,
      pace,
      remainingDurationWorkingDays: remainingDuration,
      confidence: confidenceFromEntries(entries, pace, completed),
      sourceProgressEntryIds: entries.slice(-20).map((entry) => entry.progressEntryId),
      actualStartDate,
    });
  }

  for (const workItemId of topologicalOrder) {
    const state = states.get(workItemId)!;

    if (state.started) {
      continue;
    }

    let constrainedStart = state.startOffset;

    for (const dependency of incoming.get(workItemId)!) {
      const predecessor = states.get(dependency.predecessorWorkItemId)!;
      constrainedStart = Math.max(
        constrainedStart,
        dependencyConstraint(dependency, predecessor, state.durationWorkingDays),
      );
    }

    state.startOffset = Math.max(0, constrainedStart);
    state.finishExclusiveOffset = state.startOffset + state.durationWorkingDays;
  }

  const criticalPath = calculateCalendarCriticalPath(snapshot);
  const criticalIds = new Set(criticalPath.criticalWorkItemIds);
  const forecasts = topologicalOrder.map((workItemId) => {
    const state = states.get(workItemId)!;
    const projectedStartDate = addWorkingDays(
      projectStart,
      state.startOffset,
      snapshot.activeBaseline.calendar,
    );
    const projectedFinishDate = addWorkingDays(
      projectStart,
      state.finishExclusiveOffset - 1,
      snapshot.activeBaseline.calendar,
    );

    return {
      workItemId,
      currentProgressPercent: state.currentProgressPercent,
      cumulativeQuantityDone: formatDecimal(state.cumulativeQuantityDone),
      actualStartDate: state.actualStartDate,
      actualPacePerWorkingDay: state.pace === null ? null : formatDecimal(state.pace),
      remainingDurationWorkingDays: state.remainingDurationWorkingDays,
      projectedStartDate,
      projectedFinishDate,
      delayWorkingDays: signedWorkingDayDifference(
        state.workItem.plannedEnd,
        projectedFinishDate,
        snapshot,
      ),
      confidence: state.confidence,
      isPlannedCritical: criticalIds.has(workItemId),
      sourceProgressEntryIds: state.sourceProgressEntryIds,
    } satisfies WorkItemForecastV1;
  });
  const projectedEndDate = forecasts
    .map((forecast) => forecast.projectedFinishDate)
    .sort(compareIsoDates)
    .at(-1)!;
  const sourceProgressEntryIds = [
    ...new Set(forecasts.flatMap((forecast) => forecast.sourceProgressEntryIds)),
  ];
  const suffix = options.forecastIdSuffix ? `-${options.forecastIdSuffix}` : "";

  return scheduleForecastV1Schema.parse({
    forecastId: `forecast-${snapshot.snapshotId}${suffix}`,
    calculatedAt: snapshot.asOf,
    baselineEndDate: snapshot.activeBaseline.plannedEnd,
    projectedEndDate,
    delayWorkingDays: signedWorkingDayDifference(
      snapshot.activeBaseline.plannedEnd,
      projectedEndDate,
      snapshot,
    ),
    confidence: forecastConfidence([...states.values()], criticalIds),
    criticalPath,
    workItems: forecasts,
    affectedWorkItemIds: forecasts
      .filter((forecast) => forecast.delayWorkingDays > 0)
      .map((forecast) => forecast.workItemId),
    sourceProgressEntryIds,
  });
}
