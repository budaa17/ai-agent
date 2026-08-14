import { DependencyType, WorkItemPriority, WorkItemStatus } from "@prisma/client";
import { z } from "zod";
import { issueSeveritySchema, issueTypeSchema } from "../answer-key.js";

export const analysisMoneySchema = z
  .string()
  .regex(/^-?\d+\.\d{2}$/, "Money must use a two-decimal string");

const analysisDateSchema = z.string().datetime();

export const analysisProgressSnapshotSchema = z
  .object({
    id: z.string().min(1),
    capturedAt: analysisDateSchema,
    status: z.nativeEnum(WorkItemStatus),
    progressPercent: z.number().int().min(0).max(100),
    actualCost: analysisMoneySchema,
  })
  .strict();

export const analysisCostEntrySchema = z
  .object({
    id: z.string().min(1),
    occurredAt: analysisDateSchema,
    amount: analysisMoneySchema,
  })
  .strict();

export const analysisWorkItemSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    projectId: z.string().min(1),
    code: z.string().min(1),
    name: z.string().min(1),
    status: z.nativeEnum(WorkItemStatus),
    priority: z.nativeEnum(WorkItemPriority),
    plannedStart: analysisDateSchema,
    plannedEnd: analysisDateSchema,
    actualStart: analysisDateSchema.nullable(),
    actualEnd: analysisDateSchema.nullable(),
    progressPercent: z.number().int().min(0).max(100),
    budget: analysisMoneySchema,
    actualCost: analysisMoneySchema,
    isCritical: z.boolean(),
    snapshots: z.array(analysisProgressSnapshotSchema),
    costEntries: z.array(analysisCostEntrySchema),
  })
  .strict();

export const analysisDependencySchema = z
  .object({
    id: z.string().min(1),
    predecessorId: z.string().min(1),
    successorId: z.string().min(1),
    type: z.nativeEnum(DependencyType),
    lagDays: z.number().int(),
  })
  .strict();

export const projectAnalysisDataSchema = z
  .object({
    tenantId: z.string().min(1),
    projectId: z.string().min(1),
    projectCode: z.string().min(1),
    projectName: z.string().min(1),
    projectPlannedStart: analysisDateSchema,
    projectPlannedEnd: analysisDateSchema,
    asOf: analysisDateSchema,
    workItems: z.array(analysisWorkItemSchema).min(1),
    dependencies: z.array(analysisDependencySchema),
  })
  .strict()
  .superRefine((data, context) => {
    const workItemIds = new Set(data.workItems.map((workItem) => workItem.id));

    for (const workItem of data.workItems) {
      if (workItem.tenantId !== data.tenantId || workItem.projectId !== data.projectId) {
        context.addIssue({
          code: "custom",
          message: `Work item ${workItem.id} is outside the analysis scope`,
          path: ["workItems"],
        });
      }
    }

    for (const dependency of data.dependencies) {
      if (!workItemIds.has(dependency.predecessorId) || !workItemIds.has(dependency.successorId)) {
        context.addIssue({
          code: "custom",
          message: `Dependency ${dependency.id} references an unknown work item`,
          path: ["dependencies"],
        });
      }
    }
  });

const evidenceScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const evidenceValueSchema = z.union([evidenceScalarSchema, z.array(evidenceScalarSchema)]);

export const detectedIssueSchema = z
  .object({
    id: z.string().min(1),
    ruleId: z.string().min(1),
    type: issueTypeSchema,
    severity: issueSeveritySchema,
    tenantId: z.string().min(1),
    projectId: z.string().min(1),
    workItemId: z.string().min(1),
    effectiveFrom: analysisDateSchema,
    summary: z.string().min(1),
    evidence: z.record(z.string(), evidenceValueSchema),
  })
  .strict();

export const ruleEvaluationSchema = z
  .object({
    decisionId: z.string().min(1),
    decisionVersion: z.literal(1),
    hitPolicy: z.literal("COLLECT"),
    matchedCount: z.number().int().nonnegative(),
    outputs: z.array(detectedIssueSchema),
  })
  .strict();

export type AnalysisWorkItem = z.infer<typeof analysisWorkItemSchema>;
export type AnalysisDependency = z.infer<typeof analysisDependencySchema>;
export type ProjectAnalysisData = z.infer<typeof projectAnalysisDataSchema>;
export type DetectedIssue = z.infer<typeof detectedIssueSchema>;
export type RuleEvaluation = z.infer<typeof ruleEvaluationSchema>;
