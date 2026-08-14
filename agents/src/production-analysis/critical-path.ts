import {
  calendarCriticalPathV1Schema,
  type CalendarCriticalPathV1,
} from "../contracts/deterministic-analysis.js";
import type { ProjectAnalysisSnapshotV1 } from "../contracts/project-analysis-snapshot.js";
import { addWorkingDays, workingDaysBetween, type ProductionCalendar } from "./calendar.js";
import { topologicalSort } from "./graph.js";

type SnapshotDependency = ProjectAnalysisSnapshotV1["dependencies"][number];
type SnapshotWorkItem = ProjectAnalysisSnapshotV1["workItems"][number];

type WeightedDependency = SnapshotDependency & {
  startConstraintWorkingDays: number;
};

export function executableWorkItems(snapshot: ProjectAnalysisSnapshotV1): SnapshotWorkItem[] {
  const parentIds = new Set(
    snapshot.workItems
      .map((workItem) => workItem.parentWorkItemId)
      .filter((parentId): parentId is string => parentId !== null),
  );

  return snapshot.workItems.filter((workItem) => !parentIds.has(workItem.workItemId));
}

export function executableDependencies(
  snapshot: ProjectAnalysisSnapshotV1,
  workItems = executableWorkItems(snapshot),
): SnapshotDependency[] {
  const workItemIds = new Set(workItems.map((workItem) => workItem.workItemId));

  return snapshot.dependencies.filter(
    (dependency) =>
      workItemIds.has(dependency.predecessorWorkItemId) &&
      workItemIds.has(dependency.successorWorkItemId),
  );
}

function durationWorkingDays(workItem: SnapshotWorkItem, calendar: ProductionCalendar): number {
  const duration = workingDaysBetween(workItem.plannedStart, workItem.plannedEnd, calendar, true);

  if (duration <= 0) {
    throw new Error(`Work item ${workItem.workItemId} has no working-day duration`);
  }

  return duration;
}

function dependencyStartConstraint(
  dependency: SnapshotDependency,
  predecessorDuration: number,
  successorDuration: number,
): number {
  switch (dependency.type) {
    case "FINISH_TO_START":
      return predecessorDuration + dependency.lagDays;
    case "START_TO_START":
      return dependency.lagDays;
    case "FINISH_TO_FINISH":
      return predecessorDuration + dependency.lagDays - successorDuration;
    case "START_TO_FINISH":
      return dependency.lagDays - successorDuration;
  }
}

function collectCriticalPaths(
  topologicalOrder: readonly string[],
  criticalIds: ReadonlySet<string>,
  tightSuccessors: ReadonlyMap<string, readonly string[]>,
  projectDuration: number,
  earliestFinish: ReadonlyMap<string, number>,
): string[][] {
  const incomingTightCount = new Map(topologicalOrder.map((workItemId) => [workItemId, 0]));

  for (const successors of tightSuccessors.values()) {
    for (const successorId of successors) {
      incomingTightCount.set(successorId, incomingTightCount.get(successorId)! + 1);
    }
  }

  const starts = topologicalOrder.filter(
    (workItemId) => criticalIds.has(workItemId) && incomingTightCount.get(workItemId) === 0,
  );
  const paths: string[][] = [];

  const visit = (workItemId: string, current: string[]) => {
    if (paths.length >= 100) {
      return;
    }

    const next = (tightSuccessors.get(workItemId) ?? []).filter((successorId) =>
      criticalIds.has(successorId),
    );

    if (next.length === 0) {
      if (earliestFinish.get(workItemId) === projectDuration) {
        paths.push([...current, workItemId]);
      }
      return;
    }

    for (const successorId of next) {
      visit(successorId, [...current, workItemId]);
    }
  };

  for (const start of starts) {
    visit(start, []);
  }

  if (paths.length > 0) {
    return paths;
  }

  return [topologicalOrder.filter((workItemId) => criticalIds.has(workItemId))];
}

export function calculateCalendarCriticalPath(
  snapshot: ProjectAnalysisSnapshotV1,
): CalendarCriticalPathV1 {
  const workItems = executableWorkItems(snapshot);
  const dependencies = executableDependencies(snapshot, workItems);
  const calendar = snapshot.activeBaseline.calendar;
  const projectStart = snapshot.activeBaseline.plannedStart;
  const workItemsById = new Map(workItems.map((workItem) => [workItem.workItemId, workItem]));
  const durations = new Map(
    workItems.map((workItem) => [workItem.workItemId, durationWorkingDays(workItem, calendar)]),
  );
  const topologicalOrder = topologicalSort(
    workItems.map((workItem) => workItem.workItemId),
    dependencies,
  );
  const weightedDependencies: WeightedDependency[] = dependencies.map((dependency) => ({
    ...dependency,
    startConstraintWorkingDays: dependencyStartConstraint(
      dependency,
      durations.get(dependency.predecessorWorkItemId)!,
      durations.get(dependency.successorWorkItemId)!,
    ),
  }));
  const outgoing = new Map(
    topologicalOrder.map((workItemId) => [workItemId, [] as WeightedDependency[]]),
  );

  for (const dependency of weightedDependencies) {
    outgoing.get(dependency.predecessorWorkItemId)!.push(dependency);
  }

  const earliestStart = new Map(
    topologicalOrder.map((workItemId) => {
      const workItem = workItemsById.get(workItemId)!;
      return [
        workItemId,
        Math.max(0, workingDaysBetween(projectStart, workItem.plannedStart, calendar, false)),
      ];
    }),
  );

  for (const workItemId of topologicalOrder) {
    const currentStart = earliestStart.get(workItemId)!;

    for (const dependency of outgoing.get(workItemId)!) {
      const candidate = Math.max(0, currentStart + dependency.startConstraintWorkingDays);
      earliestStart.set(
        dependency.successorWorkItemId,
        Math.max(earliestStart.get(dependency.successorWorkItemId)!, candidate),
      );
    }
  }

  const earliestFinish = new Map(
    topologicalOrder.map((workItemId) => [
      workItemId,
      earliestStart.get(workItemId)! + durations.get(workItemId)!,
    ]),
  );
  const projectDuration = Math.max(...earliestFinish.values());
  const latestStart = new Map(
    topologicalOrder.map((workItemId) => [
      workItemId,
      projectDuration - durations.get(workItemId)!,
    ]),
  );

  for (const workItemId of [...topologicalOrder].reverse()) {
    for (const dependency of outgoing.get(workItemId)!) {
      latestStart.set(
        workItemId,
        Math.min(
          latestStart.get(workItemId)!,
          latestStart.get(dependency.successorWorkItemId)! - dependency.startConstraintWorkingDays,
        ),
      );
    }
  }

  const criticalIds = new Set(
    topologicalOrder.filter(
      (workItemId) => latestStart.get(workItemId)! - earliestStart.get(workItemId)! === 0,
    ),
  );
  const tightSuccessors = new Map(
    topologicalOrder.map((workItemId) => [workItemId, [] as string[]]),
  );

  for (const dependency of weightedDependencies) {
    const edgeFloat =
      earliestStart.get(dependency.successorWorkItemId)! -
      earliestStart.get(dependency.predecessorWorkItemId)! -
      dependency.startConstraintWorkingDays;

    if (
      edgeFloat === 0 &&
      criticalIds.has(dependency.predecessorWorkItemId) &&
      criticalIds.has(dependency.successorWorkItemId)
    ) {
      tightSuccessors.get(dependency.predecessorWorkItemId)!.push(dependency.successorWorkItemId);
    }
  }

  const tasks = topologicalOrder.map((workItemId) => {
    const duration = durations.get(workItemId)!;
    const earliestStartOffset = earliestStart.get(workItemId)!;
    const earliestFinishOffset = earliestFinish.get(workItemId)!;
    const latestStartOffset = latestStart.get(workItemId)!;
    const latestFinishOffset = latestStartOffset + duration;
    const successorFloats = outgoing
      .get(workItemId)!
      .map(
        (dependency) =>
          earliestStart.get(dependency.successorWorkItemId)! -
          earliestStartOffset -
          dependency.startConstraintWorkingDays,
      );
    const freeFloat =
      successorFloats.length === 0
        ? projectDuration - earliestFinishOffset
        : Math.max(0, Math.min(...successorFloats));

    return {
      workItemId,
      durationWorkingDays: duration,
      earliestStart: addWorkingDays(projectStart, earliestStartOffset, calendar),
      earliestFinish: addWorkingDays(projectStart, earliestFinishOffset - 1, calendar),
      latestStart: addWorkingDays(projectStart, latestStartOffset, calendar),
      latestFinish: addWorkingDays(projectStart, latestFinishOffset - 1, calendar),
      totalFloatWorkingDays: Math.max(0, latestStartOffset - earliestStartOffset),
      freeFloatWorkingDays: freeFloat,
      isCritical: criticalIds.has(workItemId),
    };
  });

  return calendarCriticalPathV1Schema.parse({
    projectStart,
    projectFinish: addWorkingDays(projectStart, projectDuration - 1, calendar),
    projectDurationWorkingDays: projectDuration,
    topologicalOrder,
    criticalWorkItemIds: topologicalOrder.filter((workItemId) => criticalIds.has(workItemId)),
    criticalPaths: collectCriticalPaths(
      topologicalOrder,
      criticalIds,
      tightSuccessors,
      projectDuration,
      earliestFinish,
    ),
    tasks,
  });
}
