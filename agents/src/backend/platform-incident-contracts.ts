import { z } from "zod";
import { phase9IdentifierSchema, phase9IsoDateTimeSchema } from "./contracts.js";
import { platformOverviewScopeSchema } from "./platform-overview-contracts.js";
import { platformListPageSchema, platformListProblemSchema } from "./platform-drilldown-contracts.js";

/**
 * Phase 6 incident contracts. Incidents are the persistent counterpart of the
 * overview's derived signals: the same `signalId` identity, but with lifecycle,
 * ownership and an append-only timeline.
 */

const nonnegativeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const reasonSchema = z.string().trim().min(8).max(500);
const noteSchema = z.string().trim().min(1).max(1_000);

export const platformIncidentSeveritySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const platformIncidentStateSchema = z.enum([
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
  "REOPENED",
]);
export const platformIncidentEventTypeSchema = z.enum([
  "OPENED",
  "SEVERITY_CHANGED",
  "ACKNOWLEDGED",
  "ASSIGNED",
  "RESOLVED",
  "AUTO_RESOLVED",
  "REOPENED",
]);

export const platformIncidentListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().trim().min(1).max(2_048).optional(),
    state: platformIncidentStateSchema.optional(),
    activeOnly: z.enum(["true", "false"]).optional(),
    severity: platformIncidentSeveritySchema.optional(),
    tenantId: phase9IdentifierSchema.optional(),
    agentType: z.string().trim().min(1).max(100).optional(),
    assignedToId: phase9IdentifierSchema.optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
  })
  .strict();

const principalRefSchema = z
  .object({
    principalId: phase9IdentifierSchema,
    displayName: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

export const platformIncidentSchema = z
  .object({
    incidentId: phase9IdentifierSchema,
    signalId: phase9IdentifierSchema,
    ruleKey: phase9IdentifierSchema,
    ruleVersion: z.string().trim().min(1).max(100),
    severity: platformIncidentSeveritySchema,
    state: platformIncidentStateSchema,
    active: z.boolean(),
    title: z.string().trim().min(1).max(200),
    impact: z.string().trim().min(1).max(500),
    recommendedAction: z.string().trim().min(1).max(500),
    scope: platformOverviewScopeSchema,
    diagnosticsHref: z.string().startsWith("/platform/"),
    detailHref: z.string().startsWith("/platform/"),
    evidence: z
      .array(
        z
          .object({
            metricKey: phase9IdentifierSchema,
            value: z.union([z.number(), z.string(), z.boolean()]),
            unit: z.string().trim().min(1).max(50),
            observedAt: phase9IsoDateTimeSchema,
          })
          .strict(),
      )
      .max(10),
    firstEvidenceAt: phase9IsoDateTimeSchema.nullable(),
    lastEvidenceAt: phase9IsoDateTimeSchema,
    openedAt: phase9IsoDateTimeSchema,
    acknowledgedAt: phase9IsoDateTimeSchema.nullable(),
    acknowledgedBy: principalRefSchema.nullable(),
    assignedAt: phase9IsoDateTimeSchema.nullable(),
    assignedTo: principalRefSchema.nullable(),
    resolvedAt: phase9IsoDateTimeSchema.nullable(),
    resolvedBy: principalRefSchema.nullable(),
    resolutionNote: z.string().trim().min(1).max(1_000).nullable(),
    autoResolved: z.boolean(),
    reopenCount: nonnegativeIntegerSchema,
    rowVersion: z.number().int().min(1),
  })
  .strict();

export const platformIncidentEventSchema = z
  .object({
    eventId: phase9IdentifierSchema,
    type: platformIncidentEventTypeSchema,
    fromState: platformIncidentStateSchema.nullable(),
    toState: platformIncidentStateSchema,
    actor: principalRefSchema.nullable(),
    actorRole: z.string().trim().min(1).max(100).nullable(),
    reason: z.string().trim().min(1).max(500).nullable(),
    note: z.string().trim().min(1).max(1_000).nullable(),
    correlationId: phase9IdentifierSchema,
    occurredAt: phase9IsoDateTimeSchema,
  })
  .strict();

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

export const platformIncidentListResponseSchema = envelope("platform-incidents.v1", {
  filters: z
    .object({
      state: platformIncidentStateSchema.nullable(),
      activeOnly: z.boolean(),
      severity: platformIncidentSeveritySchema.nullable(),
      tenantId: phase9IdentifierSchema.nullable(),
      agentType: z.string().trim().min(1).max(100).nullable(),
      assignedToId: phase9IdentifierSchema.nullable(),
    })
    .strict(),
  page: platformListPageSchema,
  totals: z
    .object({
      open: nonnegativeIntegerSchema,
      acknowledged: nonnegativeIntegerSchema,
      reopened: nonnegativeIntegerSchema,
      resolved: nonnegativeIntegerSchema,
      critical: nonnegativeIntegerSchema,
      high: nonnegativeIntegerSchema,
    })
    .strict(),
  items: z.array(platformIncidentSchema).max(100),
});

export const platformIncidentDetailResponseSchema = envelope("platform-incident-detail.v1", {
  incident: platformIncidentSchema,
  timeline: z
    .object({
      total: nonnegativeIntegerSchema,
      truncated: z.boolean(),
      items: z.array(platformIncidentEventSchema).max(200),
    })
    .strict(),
  /** Tells the console which actions this principal may attempt right now. */
  allowedActions: z
    .array(z.enum(["ACKNOWLEDGE", "ASSIGN", "RESOLVE"]))
    .max(3),
  /** True when resolving requires a password re-entry because of severity. */
  resolveRequiresStepUp: z.boolean(),
});

const mutationBaseShape = {
  reason: reasonSchema,
  /** Optimistic lock: the client echoes the version it rendered. */
  rowVersion: z.number().int().min(1),
} as const;

export const platformIncidentAcknowledgeRequestSchema = z
  .object({ ...mutationBaseShape })
  .strict();

export const platformIncidentAssignRequestSchema = z
  .object({ ...mutationBaseShape, assigneePrincipalId: phase9IdentifierSchema })
  .strict();

export const platformIncidentResolveRequestSchema = z
  .object({
    ...mutationBaseShape,
    resolutionNote: noteSchema,
    /**
     * Step-up confirmation for CRITICAL and HIGH incidents: the caller's own
     * password, verified against the platform credential before the write.
     */
    stepUpPassword: z.string().min(12).max(200).optional(),
  })
  .strict();

export const platformIncidentMutationResponseSchema = envelope("platform-incident-mutation.v1", {
  incident: platformIncidentSchema,
  event: platformIncidentEventSchema,
  /** Present so the operator can see exactly what the action changed. */
  change: z
    .object({
      beforeHash: z.string().regex(/^[a-f0-9]{64}$/),
      afterHash: z.string().regex(/^[a-f0-9]{64}$/),
      summary: z.string().trim().min(1).max(300),
      idempotent: z.boolean(),
      correlationId: phase9IdentifierSchema,
    })
    .strict(),
});

export const platformIncidentEvaluationSchema = z
  .object({
    evaluatedAt: phase9IsoDateTimeSchema,
    ruleSetVersion: z.string().trim().min(1).max(100),
    opened: nonnegativeIntegerSchema,
    reopened: nonnegativeIntegerSchema,
    severityChanged: nonnegativeIntegerSchema,
    refreshed: nonnegativeIntegerSchema,
    autoResolved: nonnegativeIntegerSchema,
    activeAfter: nonnegativeIntegerSchema,
  })
  .strict();

export type PlatformIncidentSeverity = z.infer<typeof platformIncidentSeveritySchema>;
export type PlatformIncidentState = z.infer<typeof platformIncidentStateSchema>;
export type PlatformIncidentEventType = z.infer<typeof platformIncidentEventTypeSchema>;
export type PlatformIncident = z.infer<typeof platformIncidentSchema>;
export type PlatformIncidentEvent = z.infer<typeof platformIncidentEventSchema>;
export type PlatformIncidentListQuery = z.infer<typeof platformIncidentListQuerySchema>;
export type PlatformIncidentListResponse = z.infer<typeof platformIncidentListResponseSchema>;
export type PlatformIncidentDetailResponse = z.infer<typeof platformIncidentDetailResponseSchema>;
export type PlatformIncidentMutationResponse = z.infer<
  typeof platformIncidentMutationResponseSchema
>;
export type PlatformIncidentEvaluation = z.infer<typeof platformIncidentEvaluationSchema>;
