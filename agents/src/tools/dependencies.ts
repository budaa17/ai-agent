import { DependencyType, Prisma, PrismaClient, WorkItemStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { resolveProjectScope, type ToolContext } from "./context.js";
import { createCollectionWindow } from "./summarize.js";

export const getDependenciesInputSchema = z
  .object({
    projectIds: z.array(z.string().trim().min(1)).min(1).max(50).optional(),
    workItemIds: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
    types: z.array(z.nativeEnum(DependencyType)).min(1).optional(),
    limit: z.number().int().min(1).max(300).default(100),
  })
  .strict();

const dependencyWorkItemSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  status: z.nativeEnum(WorkItemStatus),
  plannedStart: z.string().datetime(),
  plannedEnd: z.string().datetime(),
  actualStart: z.string().datetime().nullable(),
  actualEnd: z.string().datetime().nullable(),
  progressPercent: z.number().int().min(0).max(100),
  isCritical: z.boolean(),
});

export const dependencyViewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  type: z.nativeEnum(DependencyType),
  lagDays: z.number().int(),
  predecessor: dependencyWorkItemSchema,
  successor: dependencyWorkItemSchema,
});

export const dependencySummarySchema = z.object({
  byType: z.object({
    FINISH_TO_START: z.number().int().nonnegative(),
    START_TO_START: z.number().int().nonnegative(),
    FINISH_TO_FINISH: z.number().int().nonnegative(),
    START_TO_FINISH: z.number().int().nonnegative(),
  }),
  criticalDependencyCount: z.number().int().nonnegative(),
  unfinishedPredecessorCount: z.number().int().nonnegative(),
});

export const getDependenciesResultSchema = z.object({
  dependencies: z.array(dependencyViewSchema),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  summary: dependencySummarySchema,
});

export type GetDependenciesInput = z.input<typeof getDependenciesInputSchema>;
export type GetDependenciesResult = z.infer<typeof getDependenciesResultSchema>;

function serializeWorkItem(workItem: {
  id: string;
  code: string;
  name: string;
  status: WorkItemStatus;
  plannedStart: Date;
  plannedEnd: Date;
  actualStart: Date | null;
  actualEnd: Date | null;
  progressPercent: number;
  isCritical: boolean;
}) {
  return {
    ...workItem,
    plannedStart: workItem.plannedStart.toISOString(),
    plannedEnd: workItem.plannedEnd.toISOString(),
    actualStart: workItem.actualStart?.toISOString() ?? null,
    actualEnd: workItem.actualEnd?.toISOString() ?? null,
  };
}

export async function getDependenciesCore(
  context: ToolContext,
  input: GetDependenciesInput = {},
  client: PrismaClient = prisma,
): Promise<GetDependenciesResult> {
  const params = getDependenciesInputSchema.parse(input);
  const scope = resolveProjectScope(context, params.projectIds);
  const workItemFilter: Prisma.WorkItemDependencyWhereInput | undefined = params.workItemIds
    ? {
        OR: [
          { predecessorId: { in: params.workItemIds } },
          { successorId: { in: params.workItemIds } },
        ],
      }
    : undefined;
  const where: Prisma.WorkItemDependencyWhereInput = {
    tenantId: scope.tenantId,
    projectId: { in: scope.projectIds },
    type: params.types ? { in: params.types } : undefined,
    ...workItemFilter,
  };
  const workItemSelect = {
    id: true,
    code: true,
    name: true,
    status: true,
    plannedStart: true,
    plannedEnd: true,
    actualStart: true,
    actualEnd: true,
    progressPercent: true,
    isCritical: true,
  } satisfies Prisma.WorkItemSelect;

  const dependencies = await client.workItemDependency.findMany({
    where,
    orderBy: [{ projectId: "asc" }, { id: "asc" }],
    select: {
      id: true,
      projectId: true,
      type: true,
      lagDays: true,
      predecessor: { select: workItemSelect },
      successor: { select: workItemSelect },
    },
  });
  const window = createCollectionWindow(dependencies, params.limit, (allDependencies) => {
    const byType: Record<DependencyType, number> = {
      [DependencyType.FINISH_TO_START]: 0,
      [DependencyType.START_TO_START]: 0,
      [DependencyType.FINISH_TO_FINISH]: 0,
      [DependencyType.START_TO_FINISH]: 0,
    };
    let criticalDependencyCount = 0;
    let unfinishedPredecessorCount = 0;

    for (const dependency of allDependencies) {
      byType[dependency.type] += 1;
      criticalDependencyCount +=
        dependency.predecessor.isCritical || dependency.successor.isCritical ? 1 : 0;
      unfinishedPredecessorCount +=
        dependency.predecessor.status !== WorkItemStatus.COMPLETED &&
        dependency.predecessor.status !== WorkItemStatus.CANCELLED
          ? 1
          : 0;
    }

    return {
      byType,
      criticalDependencyCount,
      unfinishedPredecessorCount,
    };
  });

  return getDependenciesResultSchema.parse({
    dependencies: window.sample.map((dependency) => ({
      ...dependency,
      predecessor: serializeWorkItem(dependency.predecessor),
      successor: serializeWorkItem(dependency.successor),
    })),
    total: window.total,
    truncated: window.truncated,
    summary: window.summary,
  });
}
