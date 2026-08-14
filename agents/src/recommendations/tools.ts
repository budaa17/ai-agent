import { tool } from "ai";
import {
  getCostLedgerCore,
  getCostLedgerInputSchema,
  getCostLedgerResultSchema,
} from "../tools/cost-ledger.js";
import { toolContextSchema, type ToolContext } from "../tools/context.js";
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
import {
  getWorkItemsCore,
  getWorkItemsInputSchema,
  getWorkItemsResultSchema,
} from "../tools/work-items.js";

export const recommendationTools = {
  inspectWorkItems: tool({
    description:
      "Inspect authorized project work items for schedule, status, criticality, progress, and aggregate delivery patterns.",
    inputSchema: getWorkItemsInputSchema,
    outputSchema: getWorkItemsResultSchema,
    contextSchema: toolContextSchema,
    execute: (input, { context }) => getWorkItemsCore(context, input),
  }),
  inspectDependencies: tool({
    description:
      "Inspect authorized predecessor and successor evidence to identify dependency patterns and supported root causes.",
    inputSchema: getDependenciesInputSchema,
    outputSchema: getDependenciesResultSchema,
    contextSchema: toolContextSchema,
    execute: (input, { context }) => getDependenciesCore(context, input),
  }),
  inspectProgressTrends: tool({
    description:
      "Inspect authorized progress snapshots to identify repeated stalls, direction, deltas, and elapsed-time evidence.",
    inputSchema: getProgressHistoryInputSchema,
    outputSchema: getProgressHistoryResultSchema,
    contextSchema: toolContextSchema,
    execute: (input, { context }) => getProgressHistoryCore(context, input),
  }),
  inspectCostVariance: tool({
    description:
      "Inspect authorized budgets, actual costs, ledger totals, overruns, and reconciliation patterns.",
    inputSchema: getCostLedgerInputSchema,
    outputSchema: getCostLedgerResultSchema,
    contextSchema: toolContextSchema,
    execute: (input, { context }) => getCostLedgerCore(context, input),
  }),
} as const;

export type RecommendationToolName = keyof typeof recommendationTools;

export function createRecommendationToolsContext(context: ToolContext) {
  const parsedContext = toolContextSchema.parse(context);

  return {
    inspectWorkItems: parsedContext,
    inspectDependencies: parsedContext,
    inspectProgressTrends: parsedContext,
    inspectCostVariance: parsedContext,
  };
}
