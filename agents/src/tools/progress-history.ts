import { Prisma, PrismaClient, WorkItemStatus } from "@prisma/client";
import { differenceInCalendarDays } from "date-fns";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { resolveProjectScope, type ToolContext } from "./context.js";
import { createCollectionWindow } from "./summarize.js";

export const getProgressHistoryInputSchema = z
  .object({
    projectIds: z.array(z.string().trim().min(1)).min(1).max(50).optional(),
    workItemIds: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
    capturedFrom: z.string().datetime().optional(),
    capturedTo: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(1000).default(300),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.capturedFrom &&
      input.capturedTo &&
      new Date(input.capturedFrom) > new Date(input.capturedTo)
    ) {
      context.addIssue({
        code: "custom",
        message: "capturedFrom must be before or equal to capturedTo",
        path: ["capturedFrom"],
      });
    }
  });

const progressSnapshotViewSchema = z.object({
  id: z.string(),
  capturedAt: z.string().datetime(),
  status: z.nativeEnum(WorkItemStatus),
  progressPercent: z.number().int().min(0).max(100),
  actualCost: z.string(),
  note: z.string().nullable(),
  progressDelta: z.number().int().nullable(),
  daysSincePrevious: z.number().int().nonnegative().nullable(),
});

const progressWorkItemViewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  code: z.string(),
  name: z.string(),
  status: z.nativeEnum(WorkItemStatus),
  progressPercent: z.number().int().min(0).max(100),
  plannedStart: z.string().datetime(),
  plannedEnd: z.string().datetime(),
  isCritical: z.boolean(),
});

export const progressHistoryViewSchema = z.object({
  workItem: progressWorkItemViewSchema,
  snapshots: z.array(progressSnapshotViewSchema),
});

export const progressHistorySummarySchema = z.object({
  snapshotCount: z.number().int().nonnegative(),
  workItemCount: z.number().int().nonnegative(),
  stalledWorkItemCount: z.number().int().nonnegative(),
  averageLatestProgressPercent: z.number().min(0).max(100),
});

export const getProgressHistoryResultSchema = z.object({
  histories: z.array(progressHistoryViewSchema),
  totalSnapshots: z.number().int().nonnegative(),
  truncated: z.boolean(),
  summary: progressHistorySummarySchema,
});

export type GetProgressHistoryInput = z.input<typeof getProgressHistoryInputSchema>;
export type GetProgressHistoryResult = z.infer<typeof getProgressHistoryResultSchema>;

export async function getProgressHistoryCore(
  context: ToolContext,
  input: GetProgressHistoryInput = {},
  client: PrismaClient = prisma,
): Promise<GetProgressHistoryResult> {
  const params = getProgressHistoryInputSchema.parse(input);
  const scope = resolveProjectScope(context, params.projectIds);
  const capturedAt =
    params.capturedFrom || params.capturedTo
      ? {
          gte: params.capturedFrom ? new Date(params.capturedFrom) : undefined,
          lte: params.capturedTo ? new Date(params.capturedTo) : undefined,
        }
      : undefined;
  const where: Prisma.WorkItemSnapshotWhereInput = {
    tenantId: scope.tenantId,
    projectId: { in: scope.projectIds },
    workItemId: params.workItemIds ? { in: params.workItemIds } : undefined,
    capturedAt,
  };

  const snapshots = await client.workItemSnapshot.findMany({
    where,
    orderBy: [{ workItemId: "asc" }, { capturedAt: "asc" }],
    select: {
      id: true,
      capturedAt: true,
      status: true,
      progressPercent: true,
      actualCost: true,
      note: true,
      workItem: {
        select: {
          id: true,
          projectId: true,
          code: true,
          name: true,
          status: true,
          progressPercent: true,
          plannedStart: true,
          plannedEnd: true,
          isCritical: true,
        },
      },
    },
  });
  const window = createCollectionWindow(snapshots, params.limit, (allSnapshots) => {
    const snapshotsByWorkItem = new Map<
      string,
      Array<{ progressPercent: number; capturedAt: Date }>
    >();

    for (const snapshot of allSnapshots) {
      const workItemSnapshots = snapshotsByWorkItem.get(snapshot.workItem.id) ?? [];
      workItemSnapshots.push({
        progressPercent: snapshot.progressPercent,
        capturedAt: snapshot.capturedAt,
      });
      snapshotsByWorkItem.set(snapshot.workItem.id, workItemSnapshots);
    }

    let stalledWorkItemCount = 0;
    let latestProgressTotal = 0;

    for (const workItemSnapshots of snapshotsByWorkItem.values()) {
      const latest = workItemSnapshots.at(-1);
      const previous = workItemSnapshots.at(-2);

      latestProgressTotal += latest?.progressPercent ?? 0;
      stalledWorkItemCount +=
        latest &&
        previous &&
        latest.capturedAt > previous.capturedAt &&
        latest.progressPercent === previous.progressPercent
          ? 1
          : 0;
    }

    return {
      snapshotCount: allSnapshots.length,
      workItemCount: snapshotsByWorkItem.size,
      stalledWorkItemCount,
      averageLatestProgressPercent:
        snapshotsByWorkItem.size === 0
          ? 0
          : Math.round((latestProgressTotal / snapshotsByWorkItem.size) * 100) / 100,
    };
  });

  const histories = new Map<string, z.infer<typeof progressHistoryViewSchema>>();

  for (const snapshot of window.sample) {
    let history = histories.get(snapshot.workItem.id);

    if (!history) {
      history = {
        workItem: {
          ...snapshot.workItem,
          plannedStart: snapshot.workItem.plannedStart.toISOString(),
          plannedEnd: snapshot.workItem.plannedEnd.toISOString(),
        },
        snapshots: [],
      };
      histories.set(snapshot.workItem.id, history);
    }

    const previous = history.snapshots.at(-1);
    history.snapshots.push({
      id: snapshot.id,
      capturedAt: snapshot.capturedAt.toISOString(),
      status: snapshot.status,
      progressPercent: snapshot.progressPercent,
      actualCost: snapshot.actualCost.toFixed(2),
      note: snapshot.note,
      progressDelta: previous ? snapshot.progressPercent - previous.progressPercent : null,
      daysSincePrevious: previous
        ? differenceInCalendarDays(snapshot.capturedAt, new Date(previous.capturedAt))
        : null,
    });
  }

  return getProgressHistoryResultSchema.parse({
    histories: [...histories.values()],
    totalSnapshots: window.total,
    truncated: window.truncated,
    summary: window.summary,
  });
}
