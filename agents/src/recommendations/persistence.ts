import { createHash, randomUUID } from "node:crypto";
import { AgentToolCallStatus, Prisma, PrismaClient } from "@prisma/client";
import { hashAuthorizedScope } from "../runtime/logging.js";

interface ResearchToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

interface ResearchToolResult {
  toolCallId: string;
  output: unknown;
}

interface ResearchContentPart {
  type: string;
  toolCallId?: string;
  error?: unknown;
}

export interface PersistableResearchStep {
  stepNumber: number;
  toolCalls: ReadonlyArray<ResearchToolCall>;
  toolResults: ReadonlyArray<ResearchToolResult>;
  content: ReadonlyArray<ResearchContentPart>;
  performance?: {
    toolExecutionMs: Readonly<Record<string, number>>;
  };
}

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new Error("Value is not JSON serializable");
  }

  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

function formatToolError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function rowMetadata(output: unknown) {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    const rows = Array.isArray(output) ? output.length : 0;
    return {
      rowCount: rows,
      returnedRowCount: rows,
      truncated: false,
    };
  }

  const record = output as Record<string, unknown>;
  const returnedRowCount = Math.max(
    0,
    ...Object.values(record)
      .filter(Array.isArray)
      .map((value) => value.length),
  );
  const explicitTotal = Object.entries(record)
    .filter(
      ([key, value]) =>
        /^(?:total|totalCount|rowCount)$/u.test(key) &&
        typeof value === "number" &&
        Number.isInteger(value),
    )
    .map(([, value]) => value as number)[0];
  const rowCount = Math.max(returnedRowCount, explicitTotal ?? returnedRowCount);

  return {
    rowCount,
    returnedRowCount,
    truncated: record.truncated === true || returnedRowCount < rowCount,
  };
}

export async function persistResearchToolCalls(
  client: PrismaClient,
  agentRunId: string,
  steps: ReadonlyArray<PersistableResearchStep>,
  scope?: {
    tenantId: string;
    projectIds: readonly string[];
  },
) {
  const records = steps.flatMap((step) => {
    const results = new Map(step.toolResults.map((result) => [result.toolCallId, result.output]));
    const errors = new Map(
      step.content
        .filter(
          (
            part,
          ): part is ResearchContentPart & {
            toolCallId: string;
            error: unknown;
          } => part.type === "tool-error" && typeof part.toolCallId === "string",
        )
        .map((part) => [part.toolCallId, formatToolError(part.error)]),
    );

    return step.toolCalls.map((toolCall) => {
      const hasResult = results.has(toolCall.toolCallId);
      const output = results.get(toolCall.toolCallId);
      const rows = rowMetadata(output);

      return {
        id: randomUUID(),
        agentRunId,
        stepNumber: step.stepNumber,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toInputJson(toolCall.input),
        schemaVersion: 1,
        authorizedScopeSha256:
          scope === undefined
            ? undefined
            : hashAuthorizedScope({
                principalId: "agent-a2",
                tenantId: scope.tenantId,
                projectIds: [...scope.projectIds],
                permissions: ["AGENT_READ"],
              }),
        argumentsSha256: sha256(toolCall.input),
        output: hasResult && output !== undefined ? toInputJson(output) : undefined,
        status: hasResult ? AgentToolCallStatus.COMPLETED : AgentToolCallStatus.FAILED,
        errorMessage:
          errors.get(toolCall.toolCallId) ??
          (hasResult ? undefined : "Tool call did not return a result"),
        durationMs:
          step.performance?.toolExecutionMs[toolCall.toolCallId] === undefined
            ? undefined
            : Math.round(step.performance.toolExecutionMs[toolCall.toolCallId]!),
        rowCount: rows.rowCount,
        returnedRowCount: rows.returnedRowCount,
        truncated: rows.truncated,
        outputSha256: hasResult && output !== undefined ? sha256(output) : undefined,
        failureCategory: hasResult ? "NONE" : "INTERNAL",
        occurredAt: new Date(),
      };
    });
  });

  if (records.length === 0) {
    return 0;
  }

  await client.agentToolCall.createMany({ data: records });
  return records.length;
}
