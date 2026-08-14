import { getCostLedgerCore } from "../tools/cost-ledger.js";
import { getDependenciesCore } from "../tools/dependencies.js";
import { getProgressHistoryCore } from "../tools/progress-history.js";
import { toolContextSchema, type ToolContext } from "../tools/context.js";
import { getWorkItemsCore } from "../tools/work-items.js";
import type { PersistableResearchStep } from "./persistence.js";
import type { RecommendationToolName } from "./tools.js";

export const A2_RESEARCH_TOOL_NAMES: RecommendationToolName[] = [
  "inspectWorkItems",
  "inspectDependencies",
  "inspectProgressTrends",
  "inspectCostVariance",
];

function toolInput(toolName: RecommendationToolName) {
  if (toolName === "inspectWorkItems") {
    return { limit: 200 };
  }

  if (toolName === "inspectDependencies") {
    return { limit: 300 };
  }

  if (toolName === "inspectProgressTrends") {
    return { limit: 1_000 };
  }

  return { limit: 200 };
}

async function executeTool(context: ToolContext, toolName: RecommendationToolName) {
  const input = toolInput(toolName);

  if (toolName === "inspectWorkItems") {
    return getWorkItemsCore(context, input);
  }

  if (toolName === "inspectDependencies") {
    return getDependenciesCore(context, input);
  }

  if (toolName === "inspectProgressTrends") {
    return getProgressHistoryCore(context, input);
  }

  return getCostLedgerCore(context, input);
}

export async function executeA2ReadOnlyResearch(contextInput: ToolContext, stepNumber = 0) {
  const context = toolContextSchema.parse(contextInput);
  const startedAt = Date.now();
  const outputs = await Promise.all(
    A2_RESEARCH_TOOL_NAMES.map(async (toolName, index) => {
      const toolStartedAt = Date.now();
      const output = await executeTool(context, toolName);

      return {
        toolCallId: `a2-deterministic-${index + 1}`,
        toolName,
        input: toolInput(toolName),
        output,
        durationMs: Date.now() - toolStartedAt,
      };
    }),
  );
  const toolExecutionMs = Object.fromEntries(
    outputs.map((result) => [result.toolCallId, result.durationMs]),
  );
  const step = {
    stepNumber,
    toolCalls: outputs.map(({ toolCallId, toolName, input }) => ({
      toolCallId,
      toolName,
      input,
    })),
    toolResults: outputs.map(({ toolCallId, output }) => ({
      toolCallId,
      output,
    })),
    content: [],
    performance: {
      toolExecutionMs,
    },
  } satisfies PersistableResearchStep;

  return {
    step,
    toolNames: [...A2_RESEARCH_TOOL_NAMES],
    toolEvidence: outputs.map(({ toolCallId, toolName, output }) => ({
      stepNumber,
      toolCallId,
      toolName,
      output,
    })),
    durationMs: Date.now() - startedAt,
  };
}
