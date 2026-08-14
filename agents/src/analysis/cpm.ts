import { DependencyType } from "@prisma/client";
import { addDays, differenceInCalendarDays } from "date-fns";
import { z } from "zod";
import { DependencyGraphError, topologicalSortWorkItems } from "./graph.js";

const cpmDateSchema = z.string().datetime();

export const cpmWorkItemSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1),
    name: z.string().min(1),
    plannedStart: cpmDateSchema,
    plannedEnd: cpmDateSchema,
  })
  .strict();

export const cpmDependencySchema = z
  .object({
    id: z.string().min(1),
    predecessorId: z.string().min(1),
    successorId: z.string().min(1),
    type: z.nativeEnum(DependencyType),
    lagDays: z.number().int(),
  })
  .strict();

export const cpmInputSchema = z
  .object({
    projectStart: cpmDateSchema.optional(),
    workItems: z.array(cpmWorkItemSchema).min(1),
    dependencies: z.array(cpmDependencySchema),
  })
  .strict();

export const cpmTaskResultSchema = z
  .object({
    workItemId: z.string(),
    code: z.string(),
    name: z.string(),
    durationDays: z.number().int().positive(),
    earliestStartOffset: z.number().int().nonnegative(),
    earliestFinishOffset: z.number().int().positive(),
    latestStartOffset: z.number().int().nonnegative(),
    latestFinishOffset: z.number().int().positive(),
    totalFloatDays: z.number().int().nonnegative(),
    freeFloatDays: z.number().int().nonnegative(),
    earliestStart: cpmDateSchema,
    earliestFinish: cpmDateSchema,
    latestStart: cpmDateSchema,
    latestFinish: cpmDateSchema,
    isCritical: z.boolean(),
  })
  .strict();

export const cpmResultSchema = z
  .object({
    projectStart: cpmDateSchema,
    projectFinish: cpmDateSchema,
    projectDurationDays: z.number().int().positive(),
    topologicalOrder: z.array(z.string()),
    criticalWorkItemIds: z.array(z.string()),
    criticalPaths: z.array(z.array(z.string()).min(1)).min(1),
    tasks: z.array(cpmTaskResultSchema).min(1),
  })
  .strict();

export type CpmInput = z.input<typeof cpmInputSchema>;
export type CpmResult = z.infer<typeof cpmResultSchema>;

interface WeightedDependency {
  id: string;
  predecessorId: string;
  successorId: string;
  startConstraintDays: number;
}

function durationDays(plannedStart: string, plannedEnd: string) {
  const duration = differenceInCalendarDays(new Date(plannedEnd), new Date(plannedStart)) + 1;

  if (duration <= 0) {
    throw new DependencyGraphError(
      `plannedEnd must be on or after plannedStart: ${plannedStart} -> ${plannedEnd}`,
    );
  }

  return duration;
}

function dependencyStartConstraint(
  type: DependencyType,
  lagDays: number,
  predecessorDuration: number,
  successorDuration: number,
) {
  switch (type) {
    case DependencyType.FINISH_TO_START:
      return predecessorDuration + lagDays;
    case DependencyType.START_TO_START:
      return lagDays;
    case DependencyType.FINISH_TO_FINISH:
      return predecessorDuration + lagDays - successorDuration;
    case DependencyType.START_TO_FINISH:
      return lagDays - successorDuration;
  }
}

function dateAtStartOffset(projectStart: Date, offset: number) {
  return addDays(projectStart, offset).toISOString();
}

function dateAtFinishOffset(projectStart: Date, offset: number) {
  return addDays(projectStart, offset - 1).toISOString();
}

function collectCriticalPaths(
  topologicalOrder: readonly string[],
  criticalWorkItemIds: ReadonlySet<string>,
  tightSuccessors: ReadonlyMap<string, readonly string[]>,
  projectDurationDays: number,
  earliestFinish: ReadonlyMap<string, number>,
) {
  const incomingTightCount = new Map(topologicalOrder.map((workItemId) => [workItemId, 0]));

  for (const successors of tightSuccessors.values()) {
    for (const successorId of successors) {
      incomingTightCount.set(successorId, (incomingTightCount.get(successorId) ?? 0) + 1);
    }
  }

  const starts = topologicalOrder.filter(
    (workItemId) =>
      criticalWorkItemIds.has(workItemId) && (incomingTightCount.get(workItemId) ?? 0) === 0,
  );
  const paths: string[][] = [];

  function visit(workItemId: string, path: string[]) {
    const successors = (tightSuccessors.get(workItemId) ?? []).filter((successorId) =>
      criticalWorkItemIds.has(successorId),
    );

    if (successors.length === 0) {
      if (earliestFinish.get(workItemId) === projectDurationDays) {
        paths.push([...path, workItemId]);
      }
      return;
    }

    for (const successorId of successors) {
      if (paths.length >= 100) {
        return;
      }

      visit(successorId, [...path, workItemId]);
    }
  }

  for (const startId of starts) {
    visit(startId, []);
  }

  return paths.length > 0
    ? paths
    : [topologicalOrder.filter((workItemId) => criticalWorkItemIds.has(workItemId))];
}

export function calculateCriticalPath(input: CpmInput): CpmResult {
  const parsed = cpmInputSchema.parse(input);
  const workItemsById = new Map(parsed.workItems.map((workItem) => [workItem.id, workItem]));
  const durations = new Map(
    parsed.workItems.map((workItem) => [
      workItem.id,
      durationDays(workItem.plannedStart, workItem.plannedEnd),
    ]),
  );
  const topologicalOrder = topologicalSortWorkItems(
    parsed.workItems.map((workItem) => workItem.id),
    parsed.dependencies,
  );
  const projectStart = parsed.projectStart
    ? new Date(parsed.projectStart)
    : new Date(
        Math.min(...parsed.workItems.map((workItem) => new Date(workItem.plannedStart).getTime())),
      );
  const weightedDependencies: WeightedDependency[] = parsed.dependencies.map((dependency) => ({
    ...dependency,
    startConstraintDays: dependencyStartConstraint(
      dependency.type,
      dependency.lagDays,
      durations.get(dependency.predecessorId)!,
      durations.get(dependency.successorId)!,
    ),
  }));
  const outgoing = new Map<string, WeightedDependency[]>(
    topologicalOrder.map((workItemId) => [workItemId, []]),
  );

  for (const dependency of weightedDependencies) {
    outgoing.get(dependency.predecessorId)!.push(dependency);
  }

  const earliestStart = new Map(topologicalOrder.map((workItemId) => [workItemId, 0]));

  for (const workItemId of topologicalOrder) {
    const currentStart = earliestStart.get(workItemId)!;

    for (const dependency of outgoing.get(workItemId) ?? []) {
      const candidateStart = Math.max(0, currentStart + dependency.startConstraintDays);
      earliestStart.set(
        dependency.successorId,
        Math.max(earliestStart.get(dependency.successorId) ?? 0, candidateStart),
      );
    }
  }

  const earliestFinish = new Map(
    topologicalOrder.map((workItemId) => [
      workItemId,
      earliestStart.get(workItemId)! + durations.get(workItemId)!,
    ]),
  );
  const projectDurationDays = Math.max(...earliestFinish.values());
  const latestStart = new Map(
    topologicalOrder.map((workItemId) => [
      workItemId,
      projectDurationDays - durations.get(workItemId)!,
    ]),
  );

  for (const workItemId of [...topologicalOrder].reverse()) {
    for (const dependency of outgoing.get(workItemId) ?? []) {
      latestStart.set(
        workItemId,
        Math.min(
          latestStart.get(workItemId)!,
          latestStart.get(dependency.successorId)! - dependency.startConstraintDays,
        ),
      );
    }
  }

  const criticalWorkItemIdSet = new Set(
    topologicalOrder.filter(
      (workItemId) => latestStart.get(workItemId)! - earliestStart.get(workItemId)! === 0,
    ),
  );
  const tightSuccessors = new Map<string, string[]>(
    topologicalOrder.map((workItemId) => [workItemId, []]),
  );

  for (const dependency of weightedDependencies) {
    const edgeFloat =
      earliestStart.get(dependency.successorId)! -
      earliestStart.get(dependency.predecessorId)! -
      dependency.startConstraintDays;

    if (
      edgeFloat === 0 &&
      criticalWorkItemIdSet.has(dependency.predecessorId) &&
      criticalWorkItemIdSet.has(dependency.successorId)
    ) {
      tightSuccessors.get(dependency.predecessorId)!.push(dependency.successorId);
    }
  }

  const tasks = topologicalOrder.map((workItemId) => {
    const workItem = workItemsById.get(workItemId)!;
    const duration = durations.get(workItemId)!;
    const earliestStartOffset = earliestStart.get(workItemId)!;
    const earliestFinishOffset = earliestFinish.get(workItemId)!;
    const latestStartOffset = latestStart.get(workItemId)!;
    const latestFinishOffset = latestStartOffset + duration;
    const successorFloats = (outgoing.get(workItemId) ?? []).map(
      (dependency) =>
        earliestStart.get(dependency.successorId)! -
        earliestStartOffset -
        dependency.startConstraintDays,
    );
    const freeFloatDays =
      successorFloats.length > 0
        ? Math.min(...successorFloats)
        : projectDurationDays - earliestFinishOffset;

    return {
      workItemId,
      code: workItem.code,
      name: workItem.name,
      durationDays: duration,
      earliestStartOffset,
      earliestFinishOffset,
      latestStartOffset,
      latestFinishOffset,
      totalFloatDays: latestStartOffset - earliestStartOffset,
      freeFloatDays,
      earliestStart: dateAtStartOffset(projectStart, earliestStartOffset),
      earliestFinish: dateAtFinishOffset(projectStart, earliestFinishOffset),
      latestStart: dateAtStartOffset(projectStart, latestStartOffset),
      latestFinish: dateAtFinishOffset(projectStart, latestFinishOffset),
      isCritical: criticalWorkItemIdSet.has(workItemId),
    };
  });

  return cpmResultSchema.parse({
    projectStart: projectStart.toISOString(),
    projectFinish: dateAtFinishOffset(projectStart, projectDurationDays),
    projectDurationDays,
    topologicalOrder,
    criticalWorkItemIds: topologicalOrder.filter((workItemId) =>
      criticalWorkItemIdSet.has(workItemId),
    ),
    criticalPaths: collectCriticalPaths(
      topologicalOrder,
      criticalWorkItemIdSet,
      tightSuccessors,
      projectDurationDays,
      earliestFinish,
    ),
    tasks,
  });
}
