import { tool } from "ai";
import {
  getCostLedgerCore,
  getCostLedgerInputSchema,
  getCostLedgerResultSchema,
} from "../tools/cost-ledger.js";
import {
  getDependenciesCore,
  getDependenciesInputSchema,
  getDependenciesResultSchema,
} from "../tools/dependencies.js";
import {
  getProgressHistoryCore,
  getProgressHistoryInputSchema,
  getProgressHistoryResultSchema,
} from "../tools/progress-history.js";
import { toolContextSchema, type ToolContext } from "../tools/context.js";
import {
  getWorkItemsCore,
  getWorkItemsInputSchema,
  getWorkItemsResultSchema,
} from "../tools/work-items.js";

export const referenceTools = {
  lookupWorkItems: tool({
    description:
      "Read authorized project work items with schedule, status, progress, budget, and aggregate summary. Read-only. Cite an item by its id and field; cite aggregate fields with sourceId lookupWorkItems:aggregate.",
    inputSchema: getWorkItemsInputSchema,
    outputSchema: getWorkItemsResultSchema,
    contextSchema: toolContextSchema,
    execute: (input, { context }) => getWorkItemsCore(context, input),
  }),
  lookupDependencies: tool({
    description:
      "Read authorized predecessor and successor relationships, including unfinished and critical dependency evidence. Read-only. Cite a dependency by its id and nested field; cite aggregate fields with sourceId lookupDependencies:aggregate.",
    inputSchema: getDependenciesInputSchema,
    outputSchema: getDependenciesResultSchema,
    contextSchema: toolContextSchema,
    execute: (input, { context }) => getDependenciesCore(context, input),
  }),
  lookupProgressHistory: tool({
    description:
      "Read authorized progress snapshots and calculate deltas, elapsed days, and stalled-work aggregate evidence. Read-only. Cite a snapshot or work item by its id and field; cite aggregate fields with sourceId lookupProgressHistory:aggregate.",
    inputSchema: getProgressHistoryInputSchema,
    outputSchema: getProgressHistoryResultSchema,
    contextSchema: toolContextSchema,
    execute: (input, { context }) => getProgressHistoryCore(context, input),
  }),
  lookupCostLedger: tool({
    description:
      "Read authorized budgets, recorded actual costs, ledger totals, overruns, and reconciliation mismatches. Read-only. Cite a work item or cost entry by its id and field; cite aggregate fields with sourceId lookupCostLedger:aggregate.",
    inputSchema: getCostLedgerInputSchema,
    outputSchema: getCostLedgerResultSchema,
    contextSchema: toolContextSchema,
    execute: (input, { context }) => getCostLedgerCore(context, input),
  }),
} as const;

export type ReferenceToolName = keyof typeof referenceTools;

export function createReferenceToolsContext(context: ToolContext) {
  const parsedContext = toolContextSchema.parse(context);

  return {
    lookupWorkItems: parsedContext,
    lookupDependencies: parsedContext,
    lookupProgressHistory: parsedContext,
    lookupCostLedger: parsedContext,
  };
}
