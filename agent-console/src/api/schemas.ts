import { z } from "zod";
import { tokenPairSchema } from "../auth/token-store";

const entitySchema = z.record(z.string(), z.unknown());

export const apiErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        correlationId: z.string(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();

export const sessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    user: z
      .object({
        id: z.string(),
        tenantId: z.string(),
        email: z.string().email(),
        displayName: z.string(),
        tenantRole: z.string(),
      })
      .strict(),
    tenantPermissions: z.array(z.string()),
    projectMemberships: z.array(
      z
        .object({
          projectId: z.string(),
          role: z.string(),
          permissions: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

/**
 * Single project header. Deliberately loose: `GET /v1/projects/{id}` returns
 * more than the OpenAPI document advertises (budget, location, tenantId,
 * timestamps), so a strict shape would reject a perfectly valid response. Only
 * the fields the console actually reads are pinned.
 */
export const projectSummarySchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    status: z.string(),
    role: z.string(),
    plannedStart: z.string().datetime(),
    plannedEnd: z.string().datetime(),
    rowVersion: z.number().int().positive(),
  })
  .loose();

/** Field-level diff returned by `/versions/compare`. */
export const versionComparisonSchema = z
  .object({
    targetType: z.string(),
    left: entitySchema.nullable(),
    right: entitySchema.nullable(),
    differences: z.array(
      z.object({ path: z.string(), left: z.unknown(), right: z.unknown() }).loose(),
    ),
  })
  .loose();

/** One forecast snapshot with its drivers, as served by `/forecast/latest`. */
export const forecastSnapshotSchema = entitySchema;

export const inventorySchema = z
  .object({
    schemaVersion: z.literal(1),
    materials: z.array(entitySchema),
    movements: z.array(entitySchema),
    balances: z.array(
      z
        .object({
          materialItemId: z.string(),
          code: z.string(),
          name: z.string(),
          unit: z.string(),
          quantity: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const a1IntakeResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    draftId: z.string(),
    requestId: z.string(),
    status: z.enum([
      "READY_FOR_REVIEW",
      "NEEDS_CORRECTION",
      "APPROVED",
      "APPLIED",
      "REJECTED",
    ]),
    rowVersion: z.number().int().positive(),
    reviewTaskId: z.string().nullable(),
    reviewStatus: z.string().nullable(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    reused: z.boolean(),
    draft: entitySchema,
  })
  .strict();

export const projectPageSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string(),
          code: z.string(),
          name: z.string(),
          status: z.string(),
          role: z.string(),
          plannedStart: z.string().datetime(),
          plannedEnd: z.string().datetime(),
          rowVersion: z.number().int().positive(),
        })
        .strict(),
    ),
    page: z
      .object({
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      })
      .strict(),
  })
  .strict();

const entityArraySchema = z.array(entitySchema);

export const workspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().datetime(),
    role: z.string(),
    permissions: z.array(z.string()),
    project: z
      .object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        location: z.string().nullable(),
        status: z.enum(["PLANNED", "ACTIVE", "PAUSED", "COMPLETED"]),
        plannedStart: z.string().datetime(),
        plannedEnd: z.string().datetime(),
        budgetMnt: z.string().nullable(),
        actualCostMnt: z.string().nullable(),
        rowVersion: z.number().int().positive(),
      })
      .strict(),
    dashboard: z
      .object({
        plannedProgressPercent: z.number().min(0).max(100),
        actualProgressPercent: z.number().min(0).max(100),
        projectedFinish: z.string().datetime().nullable(),
        projectedDelayDays: z.string().nullable(),
        costVarianceMnt: z.string().nullable(),
        criticalActivityCount: z.number().int().nonnegative(),
        openAlertCount: z.number().int().nonnegative(),
      })
      .strict(),
    workItems: z.array(entitySchema),
    dependencies: z.array(entitySchema),
    design: z
      .object({
        documents: entityArraySchema,
        revisions: entityArraySchema,
        pages: entityArraySchema,
        scales: entityArraySchema,
        elements: entityArraySchema,
      })
      .strict(),
    commercial: z
      .object({
        quantityVersions: entityArraySchema,
        quantityItems: entityArraySchema,
        estimateVersions: entityArraySchema,
        estimateLines: entityArraySchema,
        estimateAssumptions: entityArraySchema.default([]),
        baselines: entityArraySchema,
      })
      .strict(),
    schedule: z
      .object({
        versions: entityArraySchema,
        activities: entityArraySchema,
        dependencies: entityArraySchema,
      })
      .strict(),
    resources: z.object({ crews: entityArraySchema, equipment: entityArraySchema }).strict(),
    operations: z
      .object({
        plans: entityArraySchema,
        planItems: entityArraySchema,
        reports: entityArraySchema,
        progress: entityArraySchema,
        attendance: entityArraySchema,
        photos: entityArraySchema,
        verifications: entityArraySchema,
        variances: entityArraySchema,
      })
      .strict(),
    forecast: z
      .object({
        snapshots: entityArraySchema,
        workItems: entityArraySchema,
        drivers: entityArraySchema,
        recoveryScenarios: entityArraySchema,
      })
      .strict(),
    reviews: z.array(entitySchema),
    artifacts: z.array(entitySchema),
    assistants: z.object({ a1Drafts: entityArraySchema, a3Drafts: entityArraySchema }).strict(),
    alerts: z.array(entitySchema),
  })
  .strict();

export const dailyReportResultSchema = z
  .object({
    reportId: z.string(),
    reviewTaskId: z.string(),
    status: z.literal("REVIEW_REQUIRED"),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    rowVersion: z.number().int().positive(),
    eventId: z.string(),
    auditId: z.string(),
    createdAt: z.string().datetime(),
    replayed: z.boolean(),
  })
  .strict();

export const artifactResultSchema = z
  .object({
    artifactId: z.string(),
    originalFileName: z.string(),
    mediaType: z.string(),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.literal("AVAILABLE"),
    eventId: z.string(),
    createdAt: z.string().datetime(),
    replayed: z.boolean(),
  })
  .strict();

export const a0IntakeResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string(),
    requestId: z.string(),
    status: z.literal("REVIEW_REQUIRED"),
    quantityVersionId: z.string(),
    estimateVersionId: z.string(),
    scheduleVersionId: z.string(),
    baselineVersionId: z.string(),
    reviewTaskIds: z
      .object({
        quantity: z.string(),
        estimate: z.string(),
        schedule: z.string(),
        baseline: z.string(),
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
    estimateTotalMnt: z.string(),
    plannedStart: z.string(),
    plannedFinish: z.string(),
    criticalActivityCodes: z.array(z.string()),
    warnings: z.array(z.string()),
    eventId: z.string(),
    auditId: z.string(),
    createdAt: z.string().datetime(),
    replayed: z.boolean(),
  })
  .strict();

export const a4AnswerSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["ANSWERED", "INSUFFICIENT_EVIDENCE"]),
    answer: z.string(),
    claims: z.array(z.object({ text: z.string(), sourceIds: z.array(z.string()).min(1) }).strict()),
    sources: z.array(
      z
        .object({
          sourceId: z.string(),
          entityType: z.string(),
          entityId: z.string(),
          field: z.string(),
          value: z.unknown(),
        })
        .strict(),
    ),
    toolNames: z.array(z.string()),
  })
  .strict();

export const authenticatedResultSchema = tokenPairSchema
  .extend({ status: z.literal("AUTHENTICATED") })
  .strict();

export const tenantChoiceSchema = z
  .object({ tenantSlug: z.string(), tenantName: z.string() })
  .strict();

export const tenantSelectionResultSchema = z
  .object({
    status: z.literal("TENANT_SELECTION_REQUIRED"),
    selectionToken: z.string(),
    expiresAt: z.string(),
    tenants: z.array(tenantChoiceSchema).min(2),
  })
  .strict();

export const loginResultSchema = z.discriminatedUnion("status", [
  authenticatedResultSchema,
  tenantSelectionResultSchema,
]);

export { tokenPairSchema };
export type TenantChoice = z.infer<typeof tenantChoiceSchema>;
export type LoginResult = z.infer<typeof loginResultSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type ProjectPage = z.infer<typeof projectPageSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type VersionComparison = z.infer<typeof versionComparisonSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type DailyReportResult = z.infer<typeof dailyReportResultSchema>;
export type ArtifactResult = z.infer<typeof artifactResultSchema>;
export type A0IntakeResult = z.infer<typeof a0IntakeResultSchema>;
export type A4Answer = z.infer<typeof a4AnswerSchema>;
