import { z } from "zod";
import { contractIdentifierSchema, contractIsoDateTimeSchema } from "../contracts/common.js";
import { productionToolNameSchema } from "../production-tools/index.js";

export const agentFailureCategorySchema = z.enum([
  "NONE",
  "AUTHORIZATION",
  "BUDGET",
  "CIRCUIT_OPEN",
  "TIMEOUT",
  "RATE_LIMIT",
  "PROVIDER",
  "SCHEMA",
  "GROUNDING",
  "DATA_QUALITY",
  "DEPENDENCY",
  "INTERNAL",
]);

export const agentRuntimeUsageV1Schema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    estimatedCostMicroUsd: z.number().int().nonnegative(),
    actualCostMicroUsd: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const agentRunMetadataV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    runId: contractIdentifierSchema,
    agentType: z.enum(["A1", "A2", "A3", "A4"]),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    trigger: z.enum(["MANUAL", "EVENT", "NIGHTLY", "SCHEDULED", "REQUEST"]),
    requestId: contractIdentifierSchema,
    eventId: contractIdentifierSchema.nullable(),
    promptVersion: z.string().trim().min(1).max(200),
    toolBundleVersion: z.string().trim().min(1).max(200),
    outputSchemaVersion: z.number().int().positive(),
    provider: z.string().trim().min(1).max(100).nullable(),
    modelId: z.string().trim().min(1).max(200).nullable(),
    usage: agentRuntimeUsageV1Schema,
    latencyMs: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
    status: z.enum(["RUNNING", "COMPLETED", "REJECTED", "FAILED", "DEGRADED"]),
    failureCategory: agentFailureCategorySchema,
    traceId: z.string().trim().min(1).max(200).nullable(),
    dataSnapshotVersion: z.string().trim().min(1).max(500),
    outputSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    startedAt: contractIsoDateTimeSchema,
    completedAt: contractIsoDateTimeSchema.nullable(),
    contentLoggingEnabled: z.literal(false),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.trigger === "EVENT" && run.eventId === null) {
      context.addIssue({
        code: "custom",
        message: "Event-triggered runs require an event ID",
        path: ["eventId"],
      });
    }

    if ((run.status === "RUNNING") !== (run.completedAt === null)) {
      context.addIssue({
        code: "custom",
        message: "Only running agent runs may omit completedAt",
        path: ["completedAt"],
      });
    }

    if ((run.failureCategory === "NONE") !== ["RUNNING", "COMPLETED"].includes(run.status)) {
      context.addIssue({
        code: "custom",
        message: "Failure category must be NONE only for running/completed runs",
        path: ["failureCategory"],
      });
    }
  });

export const agentToolCallMetadataV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    toolCallId: contractIdentifierSchema,
    runId: contractIdentifierSchema,
    stepNumber: z.number().int().nonnegative(),
    toolName: productionToolNameSchema,
    authorizedScopeSha256: z.string().regex(/^[a-f0-9]{64}$/),
    argumentsSha256: z.string().regex(/^[a-f0-9]{64}$/),
    rowCount: z.number().int().nonnegative(),
    returnedRowCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    durationMs: z.number().int().nonnegative(),
    outputSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    status: z.enum(["COMPLETED", "FAILED", "REJECTED"]),
    failureCategory: agentFailureCategorySchema,
    occurredAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((call, context) => {
    if (call.returnedRowCount > call.rowCount) {
      context.addIssue({
        code: "custom",
        message: "Returned rows cannot exceed total rows",
        path: ["returnedRowCount"],
      });
    }

    if (call.truncated !== call.returnedRowCount < call.rowCount) {
      context.addIssue({
        code: "custom",
        message: "Tool truncation metadata is inconsistent",
        path: ["truncated"],
      });
    }

    if ((call.failureCategory === "NONE") !== (call.status === "COMPLETED")) {
      context.addIssue({
        code: "custom",
        message: "Completed calls require NONE; failed/rejected calls require a failure category",
        path: ["failureCategory"],
      });
    }
  });

export type AgentFailureCategory = z.infer<typeof agentFailureCategorySchema>;
export type AgentRuntimeUsageV1 = z.infer<typeof agentRuntimeUsageV1Schema>;
export type AgentRunMetadataV1 = z.infer<typeof agentRunMetadataV1Schema>;
export type AgentToolCallMetadataV1 = z.infer<typeof agentToolCallMetadataV1Schema>;
