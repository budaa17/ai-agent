import { CostCategory, Prisma, PrismaClient, WorkItemStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { resolveProjectScope, type ToolContext } from "./context.js";
import { createCollectionWindow } from "./summarize.js";

export const getCostLedgerInputSchema = z
  .object({
    projectIds: z.array(z.string().trim().min(1)).min(1).max(50).optional(),
    workItemIds: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict();

const costEntryViewSchema = z.object({
  id: z.string(),
  reference: z.string(),
  occurredAt: z.string().datetime(),
  category: z.nativeEnum(CostCategory),
  amount: z.string(),
  description: z.string(),
});

export const costLedgerWorkItemViewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  code: z.string(),
  name: z.string(),
  status: z.nativeEnum(WorkItemStatus),
  budget: z.string(),
  recordedActualCost: z.string(),
  ledgerTotal: z.string(),
  budgetVariance: z.string(),
  ledgerVariance: z.string(),
  isOverBudget: z.boolean(),
  hasLedgerMismatch: z.boolean(),
  entries: z.array(costEntryViewSchema),
});

export const costLedgerSummarySchema = z.object({
  totalBudget: z.string(),
  recordedActualCost: z.string(),
  ledgerTotal: z.string(),
  overBudgetCount: z.number().int().nonnegative(),
  ledgerMismatchCount: z.number().int().nonnegative(),
});

export const getCostLedgerResultSchema = z.object({
  workItems: z.array(costLedgerWorkItemViewSchema),
  totalWorkItems: z.number().int().nonnegative(),
  truncated: z.boolean(),
  summary: costLedgerSummarySchema,
});

export type GetCostLedgerInput = z.input<typeof getCostLedgerInputSchema>;
export type GetCostLedgerResult = z.infer<typeof getCostLedgerResultSchema>;

export async function getCostLedgerCore(
  context: ToolContext,
  input: GetCostLedgerInput = {},
  client: PrismaClient = prisma,
): Promise<GetCostLedgerResult> {
  const params = getCostLedgerInputSchema.parse(input);
  const scope = resolveProjectScope(context, params.projectIds);
  const where: Prisma.WorkItemWhereInput = {
    tenantId: scope.tenantId,
    projectId: { in: scope.projectIds },
    id: params.workItemIds ? { in: params.workItemIds } : undefined,
  };

  const workItems = await client.workItem.findMany({
    where,
    orderBy: [{ projectId: "asc" }, { code: "asc" }],
    select: {
      id: true,
      projectId: true,
      code: true,
      name: true,
      status: true,
      budget: true,
      actualCost: true,
      costEntries: {
        orderBy: [{ occurredAt: "asc" }, { reference: "asc" }],
        select: {
          id: true,
          reference: true,
          occurredAt: true,
          category: true,
          amount: true,
          description: true,
        },
      },
    },
  });
  const ledgerWorkItems = workItems.map((workItem) => {
    const ledgerTotal = workItem.costEntries.reduce(
      (total, entry) => total.add(entry.amount),
      new Prisma.Decimal(0),
    );
    const budgetVariance = workItem.actualCost.sub(workItem.budget);
    const ledgerVariance = workItem.actualCost.sub(ledgerTotal);

    return {
      id: workItem.id,
      projectId: workItem.projectId,
      code: workItem.code,
      name: workItem.name,
      status: workItem.status,
      budget: workItem.budget.toFixed(2),
      recordedActualCost: workItem.actualCost.toFixed(2),
      ledgerTotal: ledgerTotal.toFixed(2),
      budgetVariance: budgetVariance.toFixed(2),
      ledgerVariance: ledgerVariance.toFixed(2),
      isOverBudget: budgetVariance.gt(0),
      hasLedgerMismatch: !ledgerVariance.equals(0),
      entries: workItem.costEntries.map((entry) => ({
        ...entry,
        occurredAt: entry.occurredAt.toISOString(),
        amount: entry.amount.toFixed(2),
      })),
    };
  });
  const window = createCollectionWindow(ledgerWorkItems, params.limit, (allWorkItems) => {
    let totalBudget = new Prisma.Decimal(0);
    let recordedActualCost = new Prisma.Decimal(0);
    let ledgerTotal = new Prisma.Decimal(0);
    let overBudgetCount = 0;
    let ledgerMismatchCount = 0;

    for (const workItem of allWorkItems) {
      totalBudget = totalBudget.add(workItem.budget);
      recordedActualCost = recordedActualCost.add(workItem.recordedActualCost);
      ledgerTotal = ledgerTotal.add(workItem.ledgerTotal);
      overBudgetCount += workItem.isOverBudget ? 1 : 0;
      ledgerMismatchCount += workItem.hasLedgerMismatch ? 1 : 0;
    }

    return {
      totalBudget: totalBudget.toFixed(2),
      recordedActualCost: recordedActualCost.toFixed(2),
      ledgerTotal: ledgerTotal.toFixed(2),
      overBudgetCount,
      ledgerMismatchCount,
    };
  });

  return getCostLedgerResultSchema.parse({
    workItems: window.sample,
    totalWorkItems: window.total,
    truncated: window.truncated,
    summary: window.summary,
  });
}
