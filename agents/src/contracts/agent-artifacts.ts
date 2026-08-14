import { z } from "zod";
import {
  contractArtifactReferenceSchema,
  contractIdentifierSchema,
  contractIsoDateTimeSchema,
  contractMoneySchema,
} from "./common.js";

export const agentTypeV1Schema = z.enum([
  "A1_REGISTRATION",
  "A2_OBSERVER",
  "A3_DOCUMENT",
  "A4_REFERENCE",
]);

export const agentRunTriggerV1Schema = z.enum([
  "MANUAL",
  "EVENT",
  "NIGHTLY",
  "SCHEDULED",
  "EVALUATION",
]);

export const agentRunStatusV1Schema = z.enum([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "AI_UNAVAILABLE",
]);

export const agentUsageV1Schema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    estimatedCostUsd: contractMoneySchema,
    toolCallCount: z.number().int().nonnegative(),
  })
  .strict();

export const agentErrorV1Schema = z
  .object({
    category: z.enum([
      "VALIDATION",
      "AUTHORIZATION",
      "MODEL_QUOTA",
      "MODEL_TIMEOUT",
      "MODEL_RESPONSE",
      "DATA",
      "STORAGE",
      "QUEUE",
      "UNKNOWN",
    ]),
    message: z.string().trim().min(1).max(2_000),
    retryable: z.boolean(),
  })
  .strict();

export const agentRunEnvelopeV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    runId: contractIdentifierSchema,
    requestId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    agentType: agentTypeV1Schema,
    trigger: agentRunTriggerV1Schema,
    status: agentRunStatusV1Schema,
    provider: z.string().trim().min(1).max(200),
    modelId: z.string().trim().min(1).max(200),
    promptVersion: z.string().trim().min(1).max(200),
    toolBundleVersion: z.string().trim().min(1).max(200),
    inputSchemaVersion: z.number().int().positive(),
    outputSchemaVersion: z.number().int().positive(),
    dataSnapshotId: contractIdentifierSchema.nullable(),
    traceId: z.string().trim().min(1).max(200).nullable(),
    startedAt: contractIsoDateTimeSchema,
    completedAt: contractIsoDateTimeSchema.nullable(),
    retryCount: z.number().int().nonnegative(),
    usage: agentUsageV1Schema,
    outputArtifacts: z.array(contractArtifactReferenceSchema).max(100),
    error: agentErrorV1Schema.nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    if (
      ["COMPLETED", "REJECTED", "FAILED", "AI_UNAVAILABLE"].includes(run.status) &&
      run.completedAt === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Terminal agent runs require completedAt",
        path: ["completedAt"],
      });
    }

    if (["FAILED", "AI_UNAVAILABLE"].includes(run.status) && run.error === null) {
      context.addIssue({
        code: "custom",
        message: "Failed agent runs require an error",
        path: ["error"],
      });
    }

    if (["QUEUED", "RUNNING", "COMPLETED", "REJECTED"].includes(run.status) && run.error !== null) {
      context.addIssue({
        code: "custom",
        message: "Non-failed agent runs must not define an error",
        path: ["error"],
      });
    }
  });

export const agentEventV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: contractIdentifierSchema,
    eventType: z.enum([
      "PROJECT_EXECUTION_APPROVED",
      "PROJECT_ANALYSIS_COMPLETED",
      "RECOMMENDATION_DRAFTED",
      "DOCUMENT_DRAFTED",
      "AGENT_RUN_FAILED",
    ]),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    aggregateId: contractIdentifierSchema,
    aggregateVersion: z.number().int().positive(),
    occurredAt: contractIsoDateTimeSchema,
    idempotencyKey: contractIdentifierSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type AgentRunEnvelopeV1 = z.infer<typeof agentRunEnvelopeV1Schema>;
export type AgentUsageV1 = z.infer<typeof agentUsageV1Schema>;
export type AgentErrorV1 = z.infer<typeof agentErrorV1Schema>;
export type AgentEventV1 = z.infer<typeof agentEventV1Schema>;
