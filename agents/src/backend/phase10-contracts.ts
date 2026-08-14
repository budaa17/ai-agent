import { z } from "zod";
import { projectUpdateExtractionSchema } from "../structuring/schema.js";
import {
  phase9IdentifierSchema,
  phase9IsoDateTimeSchema,
  phase9PermissionSchema,
  phase9RoleSchema,
} from "./contracts.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const decimalInputSchema = z
  .union([
    z.number().finite(),
    z
      .string()
      .trim()
      .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/),
  ])
  .transform((value) => String(value));
const jsonEntitySchema = z.record(z.string(), z.unknown());

export const phase10ProjectCodeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().normalize("NFC") : value),
  z
    .string()
    .min(2)
    .max(100)
    .regex(/^[\p{L}0-9][\p{L}0-9._-]*$/u),
);

export const phase10ProjectCreateRequestSchema = z
  .object({
    code: phase10ProjectCodeSchema,
    name: z.string().trim().min(2).max(300),
    description: z.string().trim().max(2_000).nullable().default(null),
    location: z.string().trim().max(500).nullable().default(null),
    plannedStart: dateSchema,
    plannedEnd: dateSchema,
    budgetMnt: decimalInputSchema.refine((value) => Number(value) >= 0),
    timezone: z.string().trim().min(1).max(100).default("Asia/Ulaanbaatar"),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.plannedEnd) < Date.parse(value.plannedStart)) {
      context.addIssue({
        code: "custom",
        path: ["plannedEnd"],
        message: "Project finish cannot be before project start",
      });
    }
  });

export const phase10ProjectCreateResultSchema = z
  .object({
    projectId: phase9IdentifierSchema,
    code: z.string(),
    status: z.literal("PLANNED"),
    eventId: phase9IdentifierSchema,
    auditId: phase9IdentifierSchema,
    createdAt: phase9IsoDateTimeSchema,
    replayed: z.boolean(),
  })
  .strict();

export const phase10DailyReportDraftRequestSchema = z
  .object({
    reportDate: dateSchema,
    timezone: z.string().trim().min(1).max(100).default("Asia/Ulaanbaatar"),
    narrative: z.string().trim().max(10_000).nullable().default(null),
    weather: z.record(z.string(), z.unknown()).nullable().default(null),
    sourceDraftId: phase9IdentifierSchema.nullable().default(null),
    progress: z
      .array(
        z
          .object({
            workItemId: phase9IdentifierSchema,
            planItemId: phase9IdentifierSchema.nullable().default(null),
            quantity: decimalInputSchema.refine((value) => Number(value) >= 0),
            unit: z.string().trim().min(1).max(50),
            progressPercent: z.number().min(0).max(100).nullable().default(null),
            sourceRefs: z.array(jsonEntitySchema).max(100).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    attendance: z
      .array(
        z
          .object({
            crewId: phase9IdentifierSchema.nullable().default(null),
            trade: z.string().trim().min(1).max(200),
            workerCount: z.number().int().min(1).max(10_000),
            hoursPerWorker: z.number().min(0).max(24),
            laborRateMnt: decimalInputSchema.nullable().default(null),
            sourceRefs: z.array(jsonEntitySchema).max(100).default([]),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    photos: z
      .array(
        z
          .object({
            fileAssetId: phase9IdentifierSchema,
            capturedAt: phase9IsoDateTimeSchema,
            planItemId: phase9IdentifierSchema.nullable().default(null),
            latitude: z.number().min(-90).max(90).nullable().default(null),
            longitude: z.number().min(-180).max(180).nullable().default(null),
            orientation: z.number().int().min(0).max(359).nullable().default(null),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const workItemIds = value.progress.map((entry) => entry.workItemId);
    if (new Set(workItemIds).size !== workItemIds.length) {
      context.addIssue({
        code: "custom",
        path: ["progress"],
        message: "Daily report work items must be unique",
      });
    }
    const assetIds = value.photos.map((photo) => photo.fileAssetId);
    if (new Set(assetIds).size !== assetIds.length) {
      context.addIssue({
        code: "custom",
        path: ["photos"],
        message: "Daily report photo assets must be unique",
      });
    }
  });

export const phase10DailyReportDraftResultSchema = z
  .object({
    reportId: phase9IdentifierSchema,
    reviewTaskId: phase9IdentifierSchema,
    status: z.literal("REVIEW_REQUIRED"),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    rowVersion: z.number().int().positive(),
    eventId: phase9IdentifierSchema,
    auditId: phase9IdentifierSchema,
    createdAt: phase9IsoDateTimeSchema,
    replayed: z.boolean(),
  })
  .strict();

export const phase10StockMovementRequestSchema = z
  .object({
    movementType: z.enum(["RECEIPT", "ISSUE", "REVERSAL"]),
    materialItemId: phase9IdentifierSchema.nullable().default(null),
    quantity: decimalInputSchema.nullable().default(null),
    unit: z.string().trim().min(1).max(50).nullable().default(null),
    occurredAt: phase9IsoDateTimeSchema,
    warehouseCode: z.string().trim().min(1).max(100).default("MAIN"),
    referenceType: z.string().trim().min(1).max(100).default("MANUAL"),
    referenceId: z.string().trim().min(1).max(200),
    reversalOfId: phase9IdentifierSchema.nullable().default(null),
    reason: z.string().trim().min(3).max(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.movementType === "REVERSAL") {
      if (value.reversalOfId === null) {
        context.addIssue({ code: "custom", path: ["reversalOfId"], message: "Reversal target is required" });
      }
      return;
    }
    if (value.materialItemId === null || value.quantity === null || Number(value.quantity) <= 0) {
      context.addIssue({ code: "custom", path: ["quantity"], message: "Positive material quantity is required" });
    }
    if (value.unit === null) {
      context.addIssue({ code: "custom", path: ["unit"], message: "Material unit is required" });
    }
  });

export const phase10A1IntakeRequestSchema = z
  .object({
    requestId: phase9IdentifierSchema,
    referenceDate: dateSchema,
    sourceText: z.string().trim().max(20_000).nullable().default(null),
    imageArtifactId: phase9IdentifierSchema.nullable().default(null),
  })
  .strict()
  .refine(
    (value) => value.sourceText !== null || value.imageArtifactId !== null,
    "A1 intake requires text or an image artifact",
  );

export const phase10A1DraftCorrectionRequestSchema = z
  .object({
    expectedRowVersion: z.number().int().positive(),
    structuredData: projectUpdateExtractionSchema,
    reason: z.string().trim().min(3).max(2_000),
  })
  .strict();

export const phase10A1DraftReviewResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    draftId: phase9IdentifierSchema,
    requestId: phase9IdentifierSchema,
    status: z.enum([
      "READY_FOR_REVIEW",
      "NEEDS_CORRECTION",
      "APPROVED",
      "APPLIED",
      "REJECTED",
    ]),
    rowVersion: z.number().int().positive(),
    reviewTaskId: phase9IdentifierSchema.nullable(),
    reviewStatus: z
      .enum(["DRAFT", "REVIEW_REQUIRED", "APPROVED", "APPLIED", "REJECTED", "SUPERSEDED"])
      .nullable(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    reused: z.boolean(),
    draft: z.unknown(),
  })
  .strict();

export const phase10ArtifactUploadResultSchema = z
  .object({
    artifactId: phase9IdentifierSchema,
    originalFileName: z.string().min(1),
    mediaType: z.string().min(1),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.literal("AVAILABLE"),
    eventId: phase9IdentifierSchema,
    createdAt: phase9IsoDateTimeSchema,
    replayed: z.boolean(),
  })
  .strict();

export const phase10A0ArtifactRoleSchema = z.enum([
  "MATERIAL_PRICE_CATALOG",
  "MATERIAL_NORMS",
  "BOQ_WORK_ITEMS",
  "WBS_DEPENDENCIES",
  "DRAWING_REFERENCE",
]);

export const phase10A0IntakeRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: phase9IdentifierSchema,
    revisionCode: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9._-]+$/),
    effectiveDate: dateSchema,
    artifacts: z
      .array(
        z
          .object({
            artifactId: phase9IdentifierSchema,
            role: phase10A0ArtifactRoleSchema,
          })
          .strict(),
      )
      .min(4)
      .max(14),
  })
  .strict()
  .superRefine((value, context) => {
    const artifactIds = value.artifacts.map((artifact) => artifact.artifactId);
    if (new Set(artifactIds).size !== artifactIds.length) {
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "A0 intake artifact IDs must be unique",
      });
    }
    for (const role of [
      "MATERIAL_PRICE_CATALOG",
      "MATERIAL_NORMS",
      "BOQ_WORK_ITEMS",
      "WBS_DEPENDENCIES",
    ] as const) {
      const count = value.artifacts.filter((artifact) => artifact.role === role).length;
      if (count !== 1) {
        context.addIssue({
          code: "custom",
          path: ["artifacts"],
          message: `A0 intake requires exactly one ${role} artifact`,
        });
      }
    }
  });

export const phase10A0IntakeResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: phase9IdentifierSchema,
    requestId: phase9IdentifierSchema,
    status: z.literal("REVIEW_REQUIRED"),
    quantityVersionId: phase9IdentifierSchema,
    estimateVersionId: phase9IdentifierSchema,
    scheduleVersionId: phase9IdentifierSchema,
    baselineVersionId: phase9IdentifierSchema,
    reviewTaskIds: z
      .object({
        quantity: phase9IdentifierSchema,
        estimate: phase9IdentifierSchema,
        schedule: phase9IdentifierSchema,
        baseline: phase9IdentifierSchema,
      })
      .strict(),
    counts: z
      .object({
        documents: z.number().int().positive(),
        quantityItems: z.number().int().positive(),
        materialRequirements: z.number().int().nonnegative(),
        estimateLines: z.number().int().positive(),
        scheduleActivities: z.number().int().positive(),
        scheduleDependencies: z.number().int().nonnegative(),
      })
      .strict(),
    estimateTotalMnt: decimalInputSchema,
    plannedStart: dateSchema,
    plannedFinish: dateSchema,
    criticalActivityCodes: z.array(z.string().trim().min(1)).min(1),
    warnings: z.array(z.string().trim().min(1)).max(100),
    eventId: phase9IdentifierSchema,
    auditId: phase9IdentifierSchema,
    createdAt: phase9IsoDateTimeSchema,
    replayed: z.boolean(),
  })
  .strict();

export const phase10A4QuestionSchema = z
  .object({
    question: z.string().trim().min(2).max(2_000),
  })
  .strict();

export const phase10A4AnswerSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["ANSWERED", "INSUFFICIENT_EVIDENCE"]),
    answer: z.string().trim().min(1).max(10_000),
    claims: z.array(
      z
        .object({
          text: z.string().trim().min(1),
          sourceIds: z.array(z.string().trim().min(1)).min(1),
        })
        .strict(),
    ),
    sources: z.array(
      z
        .object({
          sourceId: z.string().trim().min(1),
          entityType: z.string().trim().min(1),
          entityId: phase9IdentifierSchema,
          field: z.string().trim().min(1),
          value: z.unknown(),
        })
        .strict(),
    ),
    toolNames: z.array(z.string().trim().min(1)),
  })
  .strict();

export const phase10WorkspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: phase9IsoDateTimeSchema,
    role: phase9RoleSchema,
    permissions: z.array(phase9PermissionSchema),
    project: z
      .object({
        id: phase9IdentifierSchema,
        code: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        location: z.string().nullable(),
        status: z.enum(["PLANNED", "ACTIVE", "PAUSED", "COMPLETED"]),
        plannedStart: phase9IsoDateTimeSchema,
        plannedEnd: phase9IsoDateTimeSchema,
        budgetMnt: z.string().nullable(),
        actualCostMnt: z.string().nullable(),
        rowVersion: z.number().int().positive(),
      })
      .strict(),
    dashboard: z
      .object({
        plannedProgressPercent: z.number().min(0).max(100),
        actualProgressPercent: z.number().min(0).max(100),
        projectedFinish: phase9IsoDateTimeSchema.nullable(),
        projectedDelayDays: z.string().nullable(),
        costVarianceMnt: z.string().nullable(),
        criticalActivityCount: z.number().int().nonnegative(),
        openAlertCount: z.number().int().nonnegative(),
      })
      .strict(),
    workItems: z.array(jsonEntitySchema),
    dependencies: z.array(jsonEntitySchema),
    design: z
      .object({
        documents: z.array(jsonEntitySchema),
        revisions: z.array(jsonEntitySchema),
        pages: z.array(jsonEntitySchema),
        scales: z.array(jsonEntitySchema),
        elements: z.array(jsonEntitySchema),
      })
      .strict(),
    commercial: z
      .object({
        quantityVersions: z.array(jsonEntitySchema),
        quantityItems: z.array(jsonEntitySchema),
        estimateVersions: z.array(jsonEntitySchema),
        estimateLines: z.array(jsonEntitySchema),
        estimateAssumptions: z.array(jsonEntitySchema),
        baselines: z.array(jsonEntitySchema),
      })
      .strict(),
    schedule: z
      .object({
        versions: z.array(jsonEntitySchema),
        activities: z.array(jsonEntitySchema),
        dependencies: z.array(jsonEntitySchema),
      })
      .strict(),
    resources: z
      .object({
        crews: z.array(jsonEntitySchema),
        equipment: z.array(jsonEntitySchema),
      })
      .strict(),
    operations: z
      .object({
        plans: z.array(jsonEntitySchema),
        planItems: z.array(jsonEntitySchema),
        reports: z.array(jsonEntitySchema),
        progress: z.array(jsonEntitySchema),
        attendance: z.array(jsonEntitySchema),
        photos: z.array(jsonEntitySchema),
        verifications: z.array(jsonEntitySchema),
        variances: z.array(jsonEntitySchema),
      })
      .strict(),
    forecast: z
      .object({
        snapshots: z.array(jsonEntitySchema),
        workItems: z.array(jsonEntitySchema),
        drivers: z.array(jsonEntitySchema),
        recoveryScenarios: z.array(jsonEntitySchema),
      })
      .strict(),
    reviews: z.array(jsonEntitySchema),
    artifacts: z.array(jsonEntitySchema),
    assistants: z
      .object({
        a1Drafts: z.array(jsonEntitySchema),
        a3Drafts: z.array(jsonEntitySchema),
      })
      .strict(),
    alerts: z.array(jsonEntitySchema),
  })
  .strict();

export type Phase10ProjectCreateRequest = z.infer<typeof phase10ProjectCreateRequestSchema>;
export type Phase10DailyReportDraftRequest = z.infer<typeof phase10DailyReportDraftRequestSchema>;
export type Phase10A0ArtifactRole = z.infer<typeof phase10A0ArtifactRoleSchema>;
export type Phase10A0IntakeRequest = z.infer<typeof phase10A0IntakeRequestSchema>;
export type Phase10A0IntakeResult = z.infer<typeof phase10A0IntakeResultSchema>;
export type Phase10Workspace = z.infer<typeof phase10WorkspaceSchema>;
