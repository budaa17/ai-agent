import type { ModelMessage } from "ai";
import { getCostLedgerCore } from "../tools/cost-ledger.js";
import { getDependenciesCore } from "../tools/dependencies.js";
import { getProgressHistoryCore } from "../tools/progress-history.js";
import { toolContextSchema, type ToolContext } from "../tools/context.js";
import { getWorkItemsCore } from "../tools/work-items.js";
import type { A4ToolEvidence } from "./grounding.js";
import type { A4ToolName } from "./schema.js";

const TOOL_ORDER: A4ToolName[] = [
  "lookupWorkItems",
  "lookupDependencies",
  "lookupProgressHistory",
  "lookupCostLedger",
];

function messageText(message: ModelMessage) {
  if (message.role !== "user") {
    return "";
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter(
      (part): part is Extract<(typeof message.content)[number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

export function latestA4UserText(messages: readonly ModelMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = messageText(messages[index]!);

    if (text.trim()) {
      return text.trim();
    }
  }

  return "";
}

export function selectA4ToolNames(messages: readonly ModelMessage[]): A4ToolName[] {
  const text = latestA4UserText(messages).toLowerCase();
  const comprehensive =
    /эрсдэл|ерөнхий тойм|бүх мэдээлэл|дүн шинжилгээ|overall|overview|all project/i.test(text);

  if (comprehensive) {
    return [...TOOL_ORDER];
  }

  const selected = new Set<A4ToolName>();
  const asksCost = /төсөв|зардал|өртөг|санхүү|мөнгөн дүн|ledger|budget|cost|variance/i.test(text);
  const asksDependency =
    /хамаарал|өмнөх ажил|дараах ажил|залгамж|dependency|predecessor|successor|critical path|критик зам/i.test(
      text,
    );
  const asksHistory =
    /явцын түүх|ахицын түүх|өмнөх бүртгэл|сүүлийн бүртгэл|snapshot|progress history|зогсонги|саатсан|хэд хоног|хоног өнгөр/i.test(
      text,
    );

  if (asksDependency) {
    selected.add("lookupDependencies");
  }

  if (asksHistory) {
    selected.add("lookupProgressHistory");
  }

  if (asksCost) {
    selected.add("lookupCostLedger");
  }

  if (selected.size === 0) {
    selected.add("lookupWorkItems");
  }

  return TOOL_ORDER.filter((toolName) => selected.has(toolName));
}

async function executeA4Tool(context: ToolContext, toolName: A4ToolName): Promise<A4ToolEvidence> {
  if (toolName === "lookupWorkItems") {
    return {
      toolName,
      output: await getWorkItemsCore(context, { limit: 200 }),
    };
  }

  if (toolName === "lookupDependencies") {
    return {
      toolName,
      output: await getDependenciesCore(context, { limit: 300 }),
    };
  }

  if (toolName === "lookupProgressHistory") {
    return {
      toolName,
      output: await getProgressHistoryCore(context, {
        limit: 1_000,
      }),
    };
  }

  return {
    toolName,
    output: await getCostLedgerCore(context, { limit: 200 }),
  };
}

export async function executeA4ReadOnlyFallback(
  contextInput: ToolContext,
  messages: readonly ModelMessage[],
) {
  const context = toolContextSchema.parse(contextInput);
  const toolNames = selectA4ToolNames(messages);
  const toolResults = await Promise.all(
    toolNames.map((toolName) => executeA4Tool(context, toolName)),
  );

  return {
    toolNames,
    toolResults,
    toolCalls: toolNames.map((toolName, index) => ({
      toolCallId: `a4-deterministic-${index + 1}`,
      toolName,
      input: { projectIds: context.projectIds },
    })),
  };
}
