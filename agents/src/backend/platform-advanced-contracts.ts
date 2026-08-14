import { z } from "zod";
import { phase9IdentifierSchema, phase9IsoDateTimeSchema } from "./contracts.js";
import {
  platformListPageSchema,
  platformListProblemSchema,
} from "./platform-drilldown-contracts.js";
import { platformOverviewSectionContextSchema } from "./platform-overview-contracts.js";

/**
 * Phase 8 contracts: AI quality and time-boxed support access.
 *
 * Quality is deliberately three separate metrics, never one blended score —
 * an offline suite result, a production validation pass rate and human
 * rejection/correction measure different things and must not be averaged.
 */

const nonnegativeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const percentageSchema = z.number().min(0).max(100);
const agentTypeSchema = z.string().trim().min(1).max(100);
const reasonSchema = z.string().trim().min(8).max(500);

export const PLATFORM_QUALITY_MINIMUM_SAMPLE = 20;

function envelope<Shape extends z.ZodRawShape>(schemaVersion: string, shape: Shape) {
  return z
    .object({
      schemaVersion: z.literal(schemaVersion),
      generatedAt: phase9IsoDateTimeSchema,
      asOf: phase9IsoDateTimeSchema,
      partial: z.boolean(),
      problems: z.array(platformListProblemSchema).max(10),
      ...shape,
    })
    .strict();
}

/* --------------------------------- AI quality ---------------------------- */

export const platformQualityQuerySchema = z
  .object({
    window: z.enum(["7d", "30d", "90d"]).optional(),
    agentType: agentTypeSchema.optional(),
  })
  .strict();

/**
 * Shared shape for every quality metric. `state` is what stops a two-case suite
 * from being reported as a percentage.
 */
export const platformQualityMetricSchema = z
  .object({
    kind: z.enum(["OFFLINE_EVALUATION", "PRODUCTION_VALIDATION", "HUMAN_FEEDBACK"]),
    label: z.string().trim().min(1).max(120),
    definition: z.string().trim().min(1).max(300),
    state: z.enum(["AVAILABLE", "NO_DATA", "INSUFFICIENT_SAMPLE", "UNKNOWN"]),
    valuePercent: percentageSchema.nullable(),
    passed: nonnegativeIntegerSchema.nullable(),
    total: nonnegativeIntegerSchema.nullable(),
    sampleSize: nonnegativeIntegerSchema,
    minimumSample: nonnegativeIntegerSchema,
    window: z
      .object({
        from: phase9IsoDateTimeSchema,
        to: phase9IsoDateTimeSchema,
        timeZone: z.literal("UTC"),
      })
      .strict(),
    freshAt: phase9IsoDateTimeSchema.nullable(),
    /** Delta against the previous comparable window, when one exists. */
    previousValuePercent: percentageSchema.nullable(),
    deltaPercentagePoints: z.number().nullable(),
    /** Suite or source identity, so a number is always attributable. */
    source: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

export const platformQualityReleaseSchema = z
  .object({
    agentRelease: z.string().trim().min(1).max(200),
    promptVersion: z.string().trim().min(1).max(60),
    modelId: z.string().trim().min(1).max(120),
    provider: z.string().trim().min(1).max(60),
    firstSeenAt: phase9IsoDateTimeSchema,
    lastSeenAt: phase9IsoDateTimeSchema,
    offline: platformQualityMetricSchema.nullable(),
    production: platformQualityMetricSchema.nullable(),
    humanFeedback: platformQualityMetricSchema.nullable(),
    runs: nonnegativeIntegerSchema,
  })
  .strict();

export const platformQualityResponseSchema = envelope("platform-quality.v1", {
  filters: z
    .object({
      window: z.enum(["7d", "30d", "90d"]),
      agentType: agentTypeSchema.nullable(),
    })
    .strict(),
  /** Platform-wide, one entry per metric kind. Never combined into a score. */
  metrics: z
    .object({
      context: platformOverviewSectionContextSchema,
      items: z.array(platformQualityMetricSchema).max(3),
    })
    .strict(),
  byAgent: z
    .object({
      context: platformOverviewSectionContextSchema,
      items: z
        .array(
          z
            .object({
              agentType: agentTypeSchema,
              offline: platformQualityMetricSchema.nullable(),
              production: platformQualityMetricSchema.nullable(),
              humanFeedback: platformQualityMetricSchema.nullable(),
              detailHref: z.string().startsWith("/platform/"),
            })
            .strict(),
        )
        .max(50),
    })
    .strict(),
  /** Release comparison: the same three metrics, per agent release. */
  releases: z
    .object({
      context: platformOverviewSectionContextSchema,
      total: nonnegativeIntegerSchema,
      truncated: z.boolean(),
      items: z.array(platformQualityReleaseSchema).max(25),
    })
    .strict(),
  evaluationHistory: z
    .object({
      context: platformOverviewSectionContextSchema,
      total: nonnegativeIntegerSchema,
      items: z
        .array(
          z
            .object({
              runId: phase9IdentifierSchema,
              suiteKey: z.string().trim().min(1).max(120),
              suiteVersion: z.string().trim().min(1).max(60),
              agentType: agentTypeSchema,
              agentRelease: z.string().trim().min(1).max(200),
              caseCount: nonnegativeIntegerSchema,
              passedCount: nonnegativeIntegerSchema,
              failedCount: nonnegativeIntegerSchema,
              skippedCount: nonnegativeIntegerSchema,
              scorePercent: percentageSchema.nullable(),
              completedAt: phase9IsoDateTimeSchema,
              sourceRef: z.string().trim().min(1).max(200).nullable(),
            })
            .strict(),
        )
        .max(50),
    })
    .strict(),
});

/* ----------------------------- Support access ---------------------------- */

export const platformSupportAccessStateSchema = z.enum([
  "REQUESTED",
  "APPROVED",
  "DENIED",
  "REVOKED",
  "EXPIRED",
]);

export const platformSupportAccessOperationSchema = z.enum([
  "READ_TENANT_HEALTH",
  "READ_AGENT_RUNS",
  "READ_RUN_DIAGNOSTICS",
  "READ_REVIEW_BACKLOG",
  "READ_SYSTEM_HEALTH",
]);

const principalRefSchema = z
  .object({
    principalId: phase9IdentifierSchema,
    displayName: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

export const platformSupportAccessGrantSchema = z
  .object({
    grantId: phase9IdentifierSchema,
    ticketReference: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(500),
    tenantId: phase9IdentifierSchema,
    tenantName: z.string().trim().min(1).max(200).nullable(),
    projectId: phase9IdentifierSchema.nullable(),
    allowedOperations: z.array(platformSupportAccessOperationSchema).min(1).max(5),
    maskedOnly: z.literal(true),
    state: platformSupportAccessStateSchema,
    /** True only while approved and inside its window. */
    active: z.boolean(),
    requestedBy: principalRefSchema,
    requestedAt: phase9IsoDateTimeSchema,
    approvedBy: principalRefSchema.nullable(),
    approvedAt: phase9IsoDateTimeSchema.nullable(),
    startsAt: phase9IsoDateTimeSchema.nullable(),
    expiresAt: phase9IsoDateTimeSchema,
    expiresInSeconds: z.number().int().nullable(),
    decisionReason: z.string().trim().min(1).max(500).nullable(),
    revokedBy: principalRefSchema.nullable(),
    revokedAt: phase9IsoDateTimeSchema.nullable(),
    useCount: nonnegativeIntegerSchema,
    lastUsedAt: phase9IsoDateTimeSchema.nullable(),
    detailHref: z.string().startsWith("/platform/"),
    rowVersion: z.number().int().min(1),
  })
  .strict();

export const platformSupportAccessEventSchema = z
  .object({
    eventId: phase9IdentifierSchema,
    type: z.enum(["REQUESTED", "APPROVED", "DENIED", "REVOKED", "EXPIRED", "USED"]),
    fromState: platformSupportAccessStateSchema.nullable(),
    toState: platformSupportAccessStateSchema,
    actor: principalRefSchema.nullable(),
    actorRole: z.string().trim().min(1).max(100).nullable(),
    reason: z.string().trim().min(1).max(500).nullable(),
    correlationId: phase9IdentifierSchema,
    occurredAt: phase9IsoDateTimeSchema,
  })
  .strict();

export const platformSupportAccessListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().trim().min(1).max(2_048).optional(),
    state: platformSupportAccessStateSchema.optional(),
    activeOnly: z.enum(["true", "false"]).optional(),
    tenantId: phase9IdentifierSchema.optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict();

export const platformSupportAccessListResponseSchema = envelope("platform-support-access.v1", {
  filters: z
    .object({
      state: platformSupportAccessStateSchema.nullable(),
      activeOnly: z.boolean(),
      tenantId: phase9IdentifierSchema.nullable(),
    })
    .strict(),
  page: platformListPageSchema,
  totals: z
    .object({
      requested: nonnegativeIntegerSchema,
      approved: nonnegativeIntegerSchema,
      active: nonnegativeIntegerSchema,
      expired: nonnegativeIntegerSchema,
      revoked: nonnegativeIntegerSchema,
      denied: nonnegativeIntegerSchema,
    })
    .strict(),
  items: z.array(platformSupportAccessGrantSchema).max(100),
});

export const platformSupportAccessDetailResponseSchema = envelope(
  "platform-support-access-detail.v1",
  {
    grant: platformSupportAccessGrantSchema,
    timeline: z
      .object({
        total: nonnegativeIntegerSchema,
        truncated: z.boolean(),
        items: z.array(platformSupportAccessEventSchema).max(200),
      })
      .strict(),
    allowedActions: z.array(z.enum(["APPROVE", "DENY", "REVOKE"])).max(3),
    /** False when the viewer requested it: approval needs a second person. */
    canApprove: z.boolean(),
  },
);

const MAX_GRANT_SECONDS = 8 * 60 * 60;

export const platformSupportAccessRequestSchema = z
  .object({
    ticketReference: z.string().trim().min(1).max(120),
    reason: reasonSchema,
    tenantId: phase9IdentifierSchema,
    projectId: phase9IdentifierSchema.optional(),
    allowedOperations: z.array(platformSupportAccessOperationSchema).min(1).max(5),
    /** Bounded so an operator cannot request an effectively permanent grant. */
    durationSeconds: z.number().int().min(300).max(MAX_GRANT_SECONDS),
  })
  .strict();

export const platformSupportAccessDecisionSchema = z
  .object({ reason: reasonSchema, rowVersion: z.number().int().min(1) })
  .strict();

export const platformSupportAccessMutationResponseSchema = envelope(
  "platform-support-access-mutation.v1",
  {
    grant: platformSupportAccessGrantSchema,
    event: platformSupportAccessEventSchema,
    change: z
      .object({
        beforeHash: z.string().regex(/^[a-f0-9]{64}$/),
        afterHash: z.string().regex(/^[a-f0-9]{64}$/),
        summary: z.string().trim().min(1).max(300),
        idempotent: z.boolean(),
        correlationId: phase9IdentifierSchema,
      })
      .strict(),
  },
);

export type PlatformQualityQuery = z.infer<typeof platformQualityQuerySchema>;
export type PlatformQualityResponse = z.infer<typeof platformQualityResponseSchema>;
export type PlatformQualityMetric = z.infer<typeof platformQualityMetricSchema>;
export type PlatformSupportAccessState = z.infer<typeof platformSupportAccessStateSchema>;
export type PlatformSupportAccessOperation = z.infer<
  typeof platformSupportAccessOperationSchema
>;
export type PlatformSupportAccessGrant = z.infer<typeof platformSupportAccessGrantSchema>;
export type PlatformSupportAccessEvent = z.infer<typeof platformSupportAccessEventSchema>;
export type PlatformSupportAccessListResponse = z.infer<
  typeof platformSupportAccessListResponseSchema
>;
export type PlatformSupportAccessDetailResponse = z.infer<
  typeof platformSupportAccessDetailResponseSchema
>;
export type PlatformSupportAccessMutationResponse = z.infer<
  typeof platformSupportAccessMutationResponseSchema
>;
