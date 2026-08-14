import { Prisma, PrismaClient, WorkItemPriority, WorkItemStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { resolveProjectScope, type ToolContext } from "./context.js";
import { createCollectionWindow } from "./summarize.js";

export const getWorkItemsInputSchema = z
  .object({
    projectIds: z.array(z.string().trim().min(1)).min(1).max(50).optional(),
    statuses: z.array(z.nativeEnum(WorkItemStatus)).min(1).optional(),
    priorities: z.array(z.nativeEnum(WorkItemPriority)).min(1).optional(),
    plannedEndFrom: z.string().datetime().optional(),
    plannedEndTo: z.string().datetime().optional(),
    includeCompleted: z.boolean().default(true),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();

export const workItemViewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  code: z.string(),
  name: z.string(),
  assigneeName: z.string().nullable(),
  status: z.nativeEnum(WorkItemStatus),
  priority: z.nativeEnum(WorkItemPriority),
  plannedStart: z.string().datetime(),
  plannedEnd: z.string().datetime(),
  actualStart: z.string().datetime().nullable(),
  actualEnd: z.string().datetime().nullable(),
  progressPercent: z.number().int().min(0).max(100),
  budget: z.string(),
  actualCost: z.string(),
  isCritical: z.boolean(),
});

export const workItemSummarySchema = z.object({
  byStatus: z.object({
    PLANNED: z.number().int().nonnegative(),
    IN_PROGRESS: z.number().int().nonnegative(),
    BLOCKED: z.number().int().nonnegative(),
    COMPLETED: z.number().int().nonnegative(),
    CANCELLED: z.number().int().nonnegative(),
  }),
  criticalCount: z.number().int().nonnegative(),
  averageProgressPercent: z.number().min(0).max(100),
  totalBudget: z.string(),
  totalActualCost: z.string(),
});

export const getWorkItemsResultSchema = z.object({
  items: z.array(workItemViewSchema),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  summary: workItemSummarySchema,
});

export type GetWorkItemsInput = z.input<typeof getWorkItemsInputSchema>;
export type GetWorkItemsResult = z.infer<typeof getWorkItemsResultSchema>;

export async function getWorkItemsCore(
  context: ToolContext,
  input: GetWorkItemsInput = {},
  client: PrismaClient = prisma,
): Promise<GetWorkItemsResult> {
  const params = getWorkItemsInputSchema.parse(input);
  const scope = resolveProjectScope(context, params.projectIds);
  const plannedEnd =
    params.plannedEndFrom || params.plannedEndTo
      ? {
          gte: params.plannedEndFrom ? new Date(params.plannedEndFrom) : undefined,
          lte: params.plannedEndTo ? new Date(params.plannedEndTo) : undefined,
        }
      : undefined;
  const status = params.statuses
    ? { in: params.statuses }
    : params.includeCompleted
      ? undefined
      : { notIn: [WorkItemStatus.COMPLETED, WorkItemStatus.CANCELLED] };
  const where: Prisma.WorkItemWhereInput = {
    tenantId: scope.tenantId,
    projectId: { in: scope.projectIds },
    status,
    priority: params.priorities ? { in: params.priorities } : undefined,
    plannedEnd,
  };

  const workItems = await client.workItem.findMany({
    where,
    orderBy: [{ plannedStart: "asc" }, { code: "asc" }],
    select: {
      id: true,
      projectId: true,
      code: true,
      name: true,
      assigneeName: true,
      status: true,
      priority: true,
      plannedStart: true,
      plannedEnd: true,
      actualStart: true,
      actualEnd: true,
      progressPercent: true,
      budget: true,
      actualCost: true,
      isCritical: true,
    },
  });
  const window = createCollectionWindow(workItems, params.limit, (allWorkItems) => {
    const byStatus: Record<WorkItemStatus, number> = {
      [WorkItemStatus.PLANNED]: 0,
      [WorkItemStatus.IN_PROGRESS]: 0,
      [WorkItemStatus.BLOCKED]: 0,
      [WorkItemStatus.COMPLETED]: 0,
      [WorkItemStatus.CANCELLED]: 0,
    };
    let totalProgress = 0;
    let totalBudget = new Prisma.Decimal(0);
    let totalActualCost = new Prisma.Decimal(0);
    let criticalCount = 0;

    for (const workItem of allWorkItems) {
      byStatus[workItem.status] += 1;
      totalProgress += workItem.progressPercent;
      totalBudget = totalBudget.add(workItem.budget);
      totalActualCost = totalActualCost.add(workItem.actualCost);
      criticalCount += workItem.isCritical ? 1 : 0;
    }

    return {
      byStatus,
      criticalCount,
      averageProgressPercent:
        allWorkItems.length === 0
          ? 0
          : Math.round((totalProgress / allWorkItems.length) * 100) / 100,
      totalBudget: totalBudget.toFixed(2),
      totalActualCost: totalActualCost.toFixed(2),
    };
  });

  return getWorkItemsResultSchema.parse({
    items: window.sample.map((workItem) => ({
      ...workItem,
      plannedStart: workItem.plannedStart.toISOString(),
      plannedEnd: workItem.plannedEnd.toISOString(),
      actualStart: workItem.actualStart?.toISOString() ?? null,
      actualEnd: workItem.actualEnd?.toISOString() ?? null,
      budget: workItem.budget.toFixed(2),
      actualCost: workItem.actualCost.toFixed(2),
    })),
    total: window.total,
    truncated: window.truncated,
    summary: window.summary,
  });
}
