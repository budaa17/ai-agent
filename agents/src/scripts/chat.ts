import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ModelMessage } from "ai";
import { ZodError } from "zod";
import {
  createChatModel,
  parseChatCliArguments,
  resolveChatRuntimeConfig,
  runProjectChat,
} from "../agent/index.js";
import { prisma } from "../prisma.js";
import { startLangfuseTelemetry } from "../telemetry/index.js";
import { createProductionAgentRuntimeGuard } from "../runtime/index.js";

const HELP_TEXT = `
Usage:
  pnpm.cmd chat -- [options]

Options:
  --tenant <id>                     Authorized tenant ID
  --projects <id,id>                Authorized project IDs
  --model <id>                      OpenAI model ID
  --max-steps <1-15>                Maximum model/tool loop steps
  --record-telemetry-content        Send prompts and outputs to telemetry
  --help                            Show this help

Chat commands:
  /scope                            Show active authorization scope
  /clear                            Clear conversation history
  /help                             Show chat commands
  /exit                             Exit and flush telemetry
`.trim();

function formatError(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
  }

  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const arguments_ = parseChatCliArguments(process.argv.slice(2));

  if (arguments_.help) {
    console.log(HELP_TEXT);
    return;
  }

  const config = resolveChatRuntimeConfig(process.env, arguments_);
  const telemetry = startLangfuseTelemetry(process.env);
  const runtimeGuard = createProductionAgentRuntimeGuard(process.env, prisma);
  const model = createChatModel({
    apiKey: config.apiKey,
    modelId: config.modelId,
  });
  const scope = {
    tenantId: config.tenantId,
    projectIds: config.projectIds,
  };
  const readline = createInterface({ input, output });
  let messages: ModelMessage[] = [];

  console.log(
    `A4 chat ready | provider=${config.provider} | model=${config.modelId} | tenant=${scope.tenantId} | projects=${scope.projectIds.join(",")}`,
  );
  console.log(
    `Langfuse telemetry: ${telemetry.enabled ? "enabled" : "disabled (keys not configured)"}`,
  );
  console.log("Commands: /scope, /clear, /help, /exit");

  try {
    while (true) {
      const question = (await readline.question("\nТа: ")).trim();

      if (!question) {
        continue;
      }

      if (question === "/exit" || question === "/quit") {
        break;
      }

      if (question === "/clear") {
        messages = [];
        console.log("Conversation history cleared.");
        continue;
      }

      if (question === "/scope") {
        console.log(JSON.stringify(scope, null, 2));
        continue;
      }

      if (question === "/help") {
        console.log(HELP_TEXT);
        continue;
      }

      const userMessage = {
        role: "user",
        content: question,
      } satisfies ModelMessage;

      try {
        const result = await runProjectChat({
          context: scope,
          messages: [...messages, userMessage],
          model,
          maxSteps: config.maxSteps,
          recordTelemetryContent: config.recordTelemetryContent,
          runtimeGuard,
        });
        const usedTools = [...new Set(result.toolCalls.map((toolCall) => toolCall.toolName))];

        messages = [...messages, userMessage, ...result.responseMessages];
        console.log(`\nAgent: ${result.text || "(text response was empty)"}`);

        if (usedTools.length > 0) {
          console.log(`Tools: ${usedTools.join(", ")}`);
        }
        console.log(`Research mode: ${result.researchMode}`);

        const uniqueSources = new Map(
          result.validation.resolvedSources.map((source) => [
            [source.toolName, source.sourceId, source.field].join("\u0000"),
            source,
          ]),
        );

        if (uniqueSources.size > 0) {
          console.log("Sources:");

          for (const source of uniqueSources.values()) {
            console.log(
              `- ${source.toolName} | ${source.sourceType}:${source.sourceId} | ${source.field}=${JSON.stringify(source.value)}`,
            );
          }
        }

        console.log(`Grounding: passed (${result.validation.checkedSourceCount} source reference)`);
      } catch (error) {
        console.error(`Chat error: ${formatError(error)}`);
      }
    }
  } finally {
    readline.close();
    await prisma.$disconnect();
    await telemetry.shutdown();
  }
}

void main().catch((error) => {
  console.error(`Chat startup failed: ${formatError(error)}`);
  process.exitCode = 1;
});
