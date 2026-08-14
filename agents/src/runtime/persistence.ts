import { AgentRunStatus, AgentToolCallStatus, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  agentRunMetadataV1Schema,
  agentToolCallMetadataV1Schema,
  type AgentRunMetadataV1,
  type AgentToolCallMetadataV1,
} from "./contracts.js";
import {
  AgentRuntimeGuard,
  assertProductionModelPricingConfigured,
  resolveAgentRuntimeBudgetConfig,
  type UsageBudgetStore,
} from "./guard.js";

export type PersistAgentRunInput = {
  metadata: AgentRunMetadataV1;
  asOf: string | Date;
  request?: Prisma.InputJsonValue;
  researchText?: string | null;
  output?: Prisma.InputJsonValue;
  validation?: Prisma.InputJsonValue;
  errorMessage?: string | null;
  langfuseTraceId?: string | null;
};

export type PersistAgentToolCallInput = {
  metadata: AgentToolCallMetadataV1;
  input?: Prisma.InputJsonValue;
  output?: Prisma.InputJsonValue;
  errorMessage?: string | null;
};

function date(value: string | Date) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Agent runtime persistence received an invalid date");
  }

  return parsed;
}

function runData(input: PersistAgentRunInput) {
  const metadata = agentRunMetadataV1Schema.parse(input.metadata);

  return {
    tenantId: metadata.tenantId,
    projectId: metadata.projectId,
    agentType: metadata.agentType,
    status: metadata.status as AgentRunStatus,
    trigger: metadata.trigger,
    requestId: metadata.requestId,
    eventId: metadata.eventId,
    promptVersion: metadata.promptVersion,
    toolBundleVersion: metadata.toolBundleVersion,
    outputSchemaVersion: metadata.outputSchemaVersion,
    provider: metadata.provider ?? "deterministic",
    modelId: metadata.modelId ?? "none",
    asOf: date(input.asOf),
    request:
      input.request ??
      ({
        requestId: metadata.requestId,
        eventId: metadata.eventId,
        trigger: metadata.trigger,
      } satisfies Prisma.InputJsonObject),
    researchText: input.researchText,
    output: input.output,
    validation: input.validation,
    inputTokens: metadata.usage.inputTokens,
    outputTokens: metadata.usage.outputTokens,
    cachedInputTokens: metadata.usage.cachedInputTokens,
    reasoningTokens: metadata.usage.reasoningTokens,
    estimatedCostMicroUsd: metadata.usage.estimatedCostMicroUsd,
    actualCostMicroUsd: metadata.usage.actualCostMicroUsd,
    latencyMs: metadata.latencyMs,
    retryCount: metadata.retryCount,
    failureCategory: metadata.failureCategory,
    traceId: metadata.traceId,
    dataSnapshotVersion: metadata.dataSnapshotVersion,
    outputSha256: metadata.outputSha256,
    contentLoggingEnabled: metadata.contentLoggingEnabled,
    errorMessage: input.errorMessage,
    langfuseTraceId: input.langfuseTraceId,
    startedAt: date(metadata.startedAt),
    completedAt: metadata.completedAt === null ? null : date(metadata.completedAt),
  };
}

function toolCallData(input: PersistAgentToolCallInput) {
  const metadata = agentToolCallMetadataV1Schema.parse(input.metadata);

  return {
    agentRunId: metadata.runId,
    schemaVersion: metadata.schemaVersion,
    stepNumber: metadata.stepNumber,
    toolCallId: metadata.toolCallId,
    toolName: metadata.toolName,
    input:
      input.input ??
      ({
        argumentsSha256: metadata.argumentsSha256,
      } satisfies Prisma.InputJsonObject),
    output: input.output,
    authorizedScopeSha256: metadata.authorizedScopeSha256,
    argumentsSha256: metadata.argumentsSha256,
    rowCount: metadata.rowCount,
    returnedRowCount: metadata.returnedRowCount,
    truncated: metadata.truncated,
    outputSha256: metadata.outputSha256,
    status: metadata.status as AgentToolCallStatus,
    failureCategory: metadata.failureCategory,
    errorMessage: input.errorMessage,
    durationMs: metadata.durationMs,
    occurredAt: date(metadata.occurredAt),
  };
}

export class PrismaAgentRuntimeStore {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient = prisma) {
    this.#client = client;
  }

  async saveRun(input: PersistAgentRunInput) {
    const metadata = agentRunMetadataV1Schema.parse(input.metadata);
    const data = runData({ ...input, metadata });

    return this.#client.agentRun.upsert({
      where: { id: metadata.runId },
      create: {
        id: metadata.runId,
        ...data,
      },
      update: data,
    });
  }

  async saveToolCall(input: PersistAgentToolCallInput) {
    const metadata = agentToolCallMetadataV1Schema.parse(input.metadata);
    const data = toolCallData({ ...input, metadata });

    return this.#client.agentToolCall.upsert({
      where: {
        agentRunId_toolCallId: {
          agentRunId: metadata.runId,
          toolCallId: metadata.toolCallId,
        },
      },
      create: data,
      update: data,
    });
  }
}

export class PrismaUsageBudgetStore implements UsageBudgetStore {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient = prisma) {
    this.#client = client;
  }

  async usedMicroUsd(tenantId: string, month: string) {
    const budget = await this.#client.agentUsageBudget.findUnique({
      where: {
        tenantId_month: { tenantId, month },
      },
      select: { usedMicroUsd: true },
    });

    return budget?.usedMicroUsd ?? 0;
  }

  async reserveMicroUsd(tenantId: string, month: string, amount: number, limit: number) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error("Usage reservation must be a non-negative integer");
    }

    await this.#client.agentUsageBudget.upsert({
      where: {
        tenantId_month: { tenantId, month },
      },
      create: {
        tenantId,
        month,
        usedMicroUsd: 0,
      },
      update: {},
    });
    const result = await this.#client.agentUsageBudget.updateMany({
      where: {
        tenantId,
        month,
        usedMicroUsd: { lte: limit - amount },
      },
      data: {
        usedMicroUsd: { increment: amount },
      },
    });

    return result.count === 1;
  }

  async addMicroUsd(tenantId: string, month: string, amount: number) {
    if (!Number.isInteger(amount)) {
      throw new Error("Usage adjustment must be an integer");
    }

    if (amount >= 0) {
      await this.#client.agentUsageBudget.upsert({
        where: {
          tenantId_month: { tenantId, month },
        },
        create: {
          tenantId,
          month,
          usedMicroUsd: amount,
        },
        update: {
          usedMicroUsd: { increment: amount },
        },
      });
      return;
    }

    await this.#client.agentUsageBudget.updateMany({
      where: {
        tenantId,
        month,
        usedMicroUsd: { gte: -amount },
      },
      data: {
        usedMicroUsd: { increment: amount },
      },
    });
  }
}

export function createProductionAgentRuntimeGuard(
  environment: NodeJS.ProcessEnv = process.env,
  client: PrismaClient = prisma,
) {
  const config = assertProductionModelPricingConfigured(
    environment,
    resolveAgentRuntimeBudgetConfig(environment),
  );

  return new AgentRuntimeGuard(config, new PrismaUsageBudgetStore(client));
}

export const mapAgentRunToPersistence = runData;
export const mapAgentToolCallToPersistence = toolCallData;
