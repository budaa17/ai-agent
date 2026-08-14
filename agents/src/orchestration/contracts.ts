import { z } from "zod";
import { signedArtifactReadReferenceV1Schema } from "../artifacts/contracts.js";
import { contractIdentifierSchema, contractIsoDateTimeSchema } from "../contracts/common.js";
import {
  buildWatchSourceReferenceSchema,
  buildWatchReviewerRoleSchema,
} from "../contracts/buildwatch-v2-common.js";
import {
  estimateDraftV1Schema,
  approvedEstimateVersionV1Schema,
} from "../contracts/estimate/index.js";
import {
  operationalForecastSnapshotV1Schema,
  recoveryProposalDraftV1Schema,
  rollingProductivitySnapshotV1Schema,
} from "../contracts/forecast/index.js";
import { progressVerificationDraftV1Schema } from "../contracts/verification/index.js";
import { baselineDraftV1Schema } from "../contracts/schedule/index.js";
import {
  approvedQuantityTakeoffVersionV1Schema,
  quantityTakeoffDraftV1Schema,
} from "../contracts/quantity/index.js";
import { operationalPhotoMetadataV1Schema } from "../simulation/buildwatch-v22-contracts.js";
import { a5DailyPlanRequestV1Schema, a5DailyPlanResultV1Schema } from "../planning/contracts.js";
import {
  approvedScheduleVersionV1Schema,
  quantityGenerationRequestV1Schema,
  scheduleDraftV1Schema,
  scheduleGenerationRequestV1Schema,
} from "../baseline-generation/contracts.js";

export const phase8A0ToolNames = [
  "getDesignDocuments",
  "getDrawingRevisions",
  "getDrawingPages",
  "getVerifiedScale",
  "getExtractedElements",
  "getQuantityTakeoff",
  "getMaterialNorms",
  "getMaterialPrices",
  "getProductivityRates",
  "getScheduleDependencies",
  "getEstimateAssumptions",
] as const;

export const phase8A5ToolNames = [
  "getCurrentSchedule",
  "getEligibleWorkItems",
  "getRemainingQuantities",
  "getCrewAvailability",
  "getEquipmentAvailability",
  "getMaterialAvailability",
  "getWeatherConstraints",
  "getOpenBlockers",
  "getDailyPlan",
  "getDailyActuals",
  "getPhotoEvidence",
  "getProgressVerification",
  "getRollingProductivity",
  "getLatestForecast",
  "getRecoveryScenarios",
] as const;

export const phase8ToolNames = [...phase8A0ToolNames, ...phase8A5ToolNames] as const;

export const phase8ToolNameSchema = z.enum(phase8ToolNames);
export const phase8AgentSchema = z.enum(["A0", "A5"]);

export const phase8PermissionSchema = z.enum([
  "AGENT_READ",
  "A0_READ",
  "A5_READ",
  "A0_RUN",
  "A5_RUN",
  "DESIGN_DOCUMENT_READ",
  "CATALOG_READ",
  "COST_READ",
  "REPORT_TEXT_READ",
  "ARTIFACT_SIGNED_READ",
]);

export const phase8AuthorizationContextSchema = z
  .object({
    principalId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    roles: z.array(buildWatchReviewerRoleSchema).min(1).max(10),
    allowedProjectIds: z.array(contractIdentifierSchema).min(1).max(10_000),
    permissions: z.array(phase8PermissionSchema).min(1).max(100),
    allowedCatalogVersionIds: z.array(contractIdentifierSchema).max(100_000),
    signedArtifactReads: z.array(signedArtifactReadReferenceV1Schema).max(100_000),
    requestedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((context, refinement) => {
    for (const [path, values] of [
      ["roles", context.roles],
      ["allowedProjectIds", context.allowedProjectIds],
      ["permissions", context.permissions],
      ["allowedCatalogVersionIds", context.allowedCatalogVersionIds],
      [
        "signedArtifactReads",
        context.signedArtifactReads.map((reference) => reference.referenceId),
      ],
    ] as const) {
      if (new Set(values).size !== values.length) {
        refinement.addIssue({
          code: "custom",
          message: `${path} values must be unique`,
          path: [path],
        });
      }
    }

    context.signedArtifactReads.forEach((reference, index) => {
      if (
        reference.tenantId !== context.tenantId ||
        !context.allowedProjectIds.includes(reference.projectId)
      ) {
        refinement.addIssue({
          code: "custom",
          message: "Signed artifact grant is outside the authorized scope",
          path: ["signedArtifactReads", index],
        });
      }
    });
  });

export const phase8ToolQuerySchema = z
  .object({
    projectId: contractIdentifierSchema,
    asOf: contractIsoDateTimeSchema,
    versionId: contractIdentifierSchema.nullable().default(null),
    limit: z.number().int().min(1).max(500).default(100),
    sourceLimit: z.number().int().min(1).max(2_000).default(200),
  })
  .strict();

export const phase8ToolRecordSchema = z
  .object({
    recordId: contractIdentifierSchema,
    toolName: phase8ToolNameSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    versionId: contractIdentifierSchema,
    effectiveAt: contractIsoDateTimeSchema,
    artifactIds: z.array(contractIdentifierSchema).max(10_000),
    catalogVersionIds: z.array(contractIdentifierSchema).max(100_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).max(2_000),
    data: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((record, refinement) => {
    for (const [path, values] of [
      ["artifactIds", record.artifactIds],
      ["catalogVersionIds", record.catalogVersionIds],
      ["sourceRefs", record.sourceRefs.map((source) => source.sourceRefId)],
    ] as const) {
      if (new Set(values).size !== values.length) {
        refinement.addIssue({
          code: "custom",
          message: `${path} values must be unique`,
          path: [path],
        });
      }
    }

    record.sourceRefs.forEach((source, index) => {
      if (source.tenantId !== record.tenantId || source.projectId !== record.projectId) {
        refinement.addIssue({
          code: "custom",
          message: "Tool record source is outside the record scope",
          path: ["sourceRefs", index],
        });
      }
    });
  });

export const phase8ToolMetaSchema = z
  .object({
    schemaVersion: z.literal(1),
    toolContractVersion: z.literal("buildwatch-v22-phase8-tools-v1"),
    toolName: phase8ToolNameSchema,
    principalId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    asOf: contractIsoDateTimeSchema,
    versionId: contractIdentifierSchema.nullable(),
    rowCount: z.number().int().nonnegative(),
    returnedRowCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    sourceCatalogTruncated: z.boolean(),
    appliedLimit: z.number().int().positive(),
    appliedSourceLimit: z.number().int().positive(),
    dataClassification: z.literal("AUTHORIZED_PROJECT_READ_ONLY"),
    authorizationChecks: z
      .object({
        tenantScope: z.literal(true),
        projectAssignment: z.literal(true),
        rolePermission: z.literal(true),
        fieldPermission: z.literal(true),
        signedArtifactRead: z.literal(true),
        catalogScope: z.literal(true),
        sourceScope: z.literal(true),
      })
      .strict(),
    sourceCatalog: z.array(buildWatchSourceReferenceSchema).max(2_000),
  })
  .strict()
  .superRefine((meta, refinement) => {
    if (meta.returnedRowCount > meta.rowCount) {
      refinement.addIssue({
        code: "custom",
        message: "returnedRowCount cannot exceed rowCount",
        path: ["returnedRowCount"],
      });
    }
    if (meta.truncated !== meta.returnedRowCount < meta.rowCount) {
      refinement.addIssue({
        code: "custom",
        message: "truncated must match returned and authorized row counts",
        path: ["truncated"],
      });
    }
  });

export const phase8ToolOutputSchema = z
  .object({
    meta: phase8ToolMetaSchema,
    records: z.array(phase8ToolRecordSchema).max(500),
  })
  .strict()
  .superRefine((output, refinement) => {
    if (output.meta.returnedRowCount !== output.records.length) {
      refinement.addIssue({
        code: "custom",
        message: "Tool metadata returnedRowCount must match records length",
        path: ["meta", "returnedRowCount"],
      });
    }
    const sourceIds = new Set(output.meta.sourceCatalog.map((source) => source.sourceRefId));
    output.records.forEach((record, index) => {
      if (
        record.toolName !== output.meta.toolName ||
        record.tenantId !== output.meta.tenantId ||
        record.projectId !== output.meta.projectId
      ) {
        refinement.addIssue({
          code: "custom",
          message: "Tool record metadata must match the enclosing tool response",
          path: ["records", index],
        });
      }
      if (record.sourceRefs.some((source) => !sourceIds.has(source.sourceRefId))) {
        refinement.addIssue({
          code: "custom",
          message: "Every returned record source must be present in the bounded source catalog",
          path: ["records", index, "sourceRefs"],
        });
      }
    });
  });

export const phase8ToolCallAuditSchema = z
  .object({
    callId: contractIdentifierSchema,
    toolName: phase8ToolNameSchema,
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    outputHash: z.string().regex(/^[a-f0-9]{64}$/),
    returnedRecordIds: z.array(contractIdentifierSchema).max(500),
    sourceRefIds: z.array(contractIdentifierSchema).max(2_000),
    toolContractVersion: z.literal("buildwatch-v22-phase8-tools-v1"),
    readOnly: z.literal(true),
    completedAt: contractIsoDateTimeSchema,
  })
  .strict();

export const phase8AgentRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: contractIdentifierSchema,
    agent: phase8AgentSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    status: z.enum(["COMPLETED", "REVIEW_REQUIRED", "BLOCKED"]),
    promptVersion: z.string().trim().min(1).max(200),
    modelProvider: z.enum(["NONE", "OPENAI"]),
    modelName: z.string().trim().min(1).max(200),
    modelVersion: z.string().trim().min(1).max(200),
    toolContractVersion: z.literal("buildwatch-v22-phase8-tools-v1"),
    outputSchemaVersion: z.literal(1),
    deterministicServiceVersions: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
    llmMode: z.enum(["OFF", "OPTIONAL_EXPLANATION"]),
    numericAuthority: z.literal("DETERMINISTIC_SERVICES_ONLY"),
    toolCalls: z.array(phase8ToolCallAuditSchema).max(100),
    authorizedSourceRefIds: z.array(contractIdentifierSchema).max(100_000),
    startedAt: contractIsoDateTimeSchema,
    completedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((run, refinement) => {
    if (
      new Set(run.toolCalls.map((call) => call.callId)).size !== run.toolCalls.length ||
      new Set(run.toolCalls.map((call) => call.toolName)).size !== run.toolCalls.length
    ) {
      refinement.addIssue({
        code: "custom",
        message: "Agent run tool calls must have unique IDs and tool names",
        path: ["toolCalls"],
      });
    }
    if (new Set(run.authorizedSourceRefIds).size !== run.authorizedSourceRefIds.length) {
      refinement.addIssue({
        code: "custom",
        message: "Agent run authorized source IDs must be unique",
        path: ["authorizedSourceRefIds"],
      });
    }
  });

export const phase8ReviewTaskSchema = z
  .object({
    reviewTaskId: contractIdentifierSchema,
    targetType: z.enum([
      "VERIFIED_SCALE",
      "DESIGN_CANDIDATE",
      "QUANTITY_TAKEOFF",
      "ESTIMATE",
      "SCHEDULE",
      "BASELINE",
      "DAILY_WORK_PLAN",
      "PROGRESS_VERIFICATION",
      "RECOVERY_PROPOSAL",
    ]),
    targetId: contractIdentifierSchema,
    requiredRole: buildWatchReviewerRoleSchema,
    status: z.literal("PENDING_REVIEW"),
    reason: z.string().trim().min(1).max(2_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).max(2_000),
  })
  .strict();

export const phase8WorkflowStepSchema = z
  .object({
    sequence: z.number().int().positive(),
    stage: z.string().trim().min(1).max(200),
    status: z.enum(["COMPLETED", "REVIEW_REQUIRED", "BLOCKED", "SKIPPED"]),
    toolNames: z.array(phase8ToolNameSchema).max(26),
    recordIds: z.array(contractIdentifierSchema).max(100_000),
    message: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const phase8SafeguardSummarySchema = z
  .object({
    numericHallucinationCount: z.number().int().nonnegative(),
    unauthorizedSourceCount: z.number().int().nonnegative(),
    unauthorizedObjectDisclosureCount: z.number().int().nonnegative(),
    baselineMutationCount: z.number().int().nonnegative(),
    llmOffCorePassed: z.boolean(),
    allNumbersDeterministic: z.literal(true),
    allArtifactsSigned: z.literal(true),
  })
  .strict();

export const a0OrchestrationRequestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestType: z.literal("A0_ORCHESTRATION"),
    runId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    asOf: contractIsoDateTimeSchema,
    quantityRequest: quantityGenerationRequestV1Schema,
    approvedQuantity: approvedQuantityTakeoffVersionV1Schema,
    approvedEstimate: approvedEstimateVersionV1Schema,
    approvedSchedule: approvedScheduleVersionV1Schema,
    scheduleRequest: scheduleGenerationRequestV1Schema,
    estimateGeneratedAt: contractIsoDateTimeSchema,
    baselineDraftId: contractIdentifierSchema,
    llmMode: z.enum(["OFF", "OPTIONAL_EXPLANATION"]).default("OFF"),
    generatedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((request, refinement) => {
    const scoped = [
      request.quantityRequest,
      request.approvedQuantity,
      request.approvedEstimate,
      request.approvedSchedule,
      request.scheduleRequest,
    ];
    if (
      scoped.some(
        (value) => value.tenantId !== request.tenantId || value.projectId !== request.projectId,
      )
    ) {
      refinement.addIssue({
        code: "custom",
        message: "A0 orchestration inputs must share one tenant/project scope",
        path: ["projectId"],
      });
    }
  });

export const a0OrchestrationResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    resultType: z.literal("A0_ORCHESTRATION_RESULT"),
    run: phase8AgentRunSchema,
    workflow: z.array(phase8WorkflowStepSchema).min(1).max(20),
    quantityDraft: quantityTakeoffDraftV1Schema.nullable(),
    estimateDraft: estimateDraftV1Schema.nullable(),
    scheduleDraft: scheduleDraftV1Schema.nullable(),
    baselineDraft: baselineDraftV1Schema.nullable(),
    reviewQueue: z.array(phase8ReviewTaskSchema).max(100),
    safeguards: phase8SafeguardSummarySchema,
    issues: z.array(z.string().trim().min(1).max(2_000)).max(100),
  })
  .strict();

export const a5OrchestrationRequestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestType: z.literal("A5_ORCHESTRATION"),
    runId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    asOf: contractIsoDateTimeSchema,
    planningRequest: a5DailyPlanRequestV1Schema,
    llmMode: z.enum(["OFF", "OPTIONAL_EXPLANATION"]).default("OFF"),
    generatedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((request, refinement) => {
    if (
      request.planningRequest.tenantId !== request.tenantId ||
      request.planningRequest.projectId !== request.projectId
    ) {
      refinement.addIssue({
        code: "custom",
        message: "A5 planning request scope must match orchestration scope",
        path: ["planningRequest"],
      });
    }
  });

export const a5OptionalExplanationSchema = z
  .object({
    text: z.string().trim().min(1).max(10_000),
    sourceRefIds: z.array(contractIdentifierSchema).min(1).max(2_000),
    numericFactsAllowed: z.literal(false),
  })
  .strict();

export const a5OrchestrationResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    resultType: z.literal("A5_ORCHESTRATION_RESULT"),
    run: phase8AgentRunSchema,
    workflow: z.array(phase8WorkflowStepSchema).min(1).max(20),
    planResult: a5DailyPlanResultV1Schema,
    photoEvidence: z.array(operationalPhotoMetadataV1Schema).max(10_000),
    progressVerification: progressVerificationDraftV1Schema.nullable(),
    rollingProductivity: rollingProductivitySnapshotV1Schema.nullable(),
    latestForecast: operationalForecastSnapshotV1Schema.nullable(),
    recoveryScenarios: z.array(recoveryProposalDraftV1Schema).max(100),
    eligibleWorkItemIds: z.array(contractIdentifierSchema).max(100_000),
    dailyActualCount: z.number().int().nonnegative(),
    optionalExplanation: a5OptionalExplanationSchema.nullable(),
    reviewQueue: z.array(phase8ReviewTaskSchema).max(100),
    safeguards: phase8SafeguardSummarySchema,
    baselineChanged: z.literal(false),
    issues: z.array(z.string().trim().min(1).max(2_000)).max(100),
  })
  .strict();

export type Phase8ToolName = z.infer<typeof phase8ToolNameSchema>;
export type Phase8AuthorizationContext = z.infer<typeof phase8AuthorizationContextSchema>;
export type Phase8ToolQuery = z.input<typeof phase8ToolQuerySchema>;
export type Phase8ToolRecord = z.infer<typeof phase8ToolRecordSchema>;
export type Phase8ToolOutput = z.infer<typeof phase8ToolOutputSchema>;
export type Phase8AgentRun = z.infer<typeof phase8AgentRunSchema>;
export type A0OrchestrationRequestV1 = z.infer<typeof a0OrchestrationRequestV1Schema>;
export type A0OrchestrationResultV1 = z.infer<typeof a0OrchestrationResultV1Schema>;
export type A5OrchestrationRequestV1 = z.infer<typeof a5OrchestrationRequestV1Schema>;
export type A5OrchestrationResultV1 = z.infer<typeof a5OrchestrationResultV1Schema>;
