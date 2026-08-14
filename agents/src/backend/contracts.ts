import { z } from "zod";

export const phase9IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);

export const phase9IsoDateTimeSchema = z.string().datetime({ offset: true });

export const phase9RoleSchema = z.enum([
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "PROJECT_MANAGER",
  "ENGINEER",
  "SITE_SUPERVISOR",
  "STOREKEEPER",
  "OBSERVER",
]);

export const phase9PermissionSchema = z.enum([
  "TENANT_ADMIN",
  "USER_INVITE",
  "PROJECT_READ",
  "PROJECT_MANAGE",
  "DESIGN_READ",
  "DESIGN_APPROVE",
  "ESTIMATE_READ",
  "ESTIMATE_APPROVE",
  "PLAN_READ",
  "PLAN_APPROVE",
  "REPORT_READ",
  "REPORT_SUBMIT",
  "REPORT_APPROVE",
  "VERIFICATION_READ",
  "VERIFICATION_APPROVE",
  "INVENTORY_READ",
  "INVENTORY_WRITE",
  "FORECAST_READ",
  "AUDIT_READ",
  "ARTIFACT_READ",
  "ARTIFACT_UPLOAD",
  "CHAT_READ",
  "COMMAND_APPLY",
  "AGENT_RUN",
  "RULES_MANAGE",
  // Billing stays reachable while the workspace itself is gated, so a Company
  // Admin can always recover a failed payment (landing-page-roadmap.md §21).
  "TENANT_BILLING_READ",
  "TENANT_BILLING_MANAGE",
]);

export const phase9ErrorCodeSchema = z.enum([
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_ACCOUNT_LOCKED",
  "AUTH_TOKEN_INVALID",
  "AUTH_REFRESH_REUSED",
  "AUTH_FORBIDDEN",
  "AUTH_RATE_LIMITED",
  "API_RATE_LIMITED",
  // Subscription access boundary (landing-page-roadmap.md §6.2, §19.3). These are
  // deliberately distinct from AUTH_FORBIDDEN: the caller is authenticated and
  // authorised by role, but the tenant is not entitled to the operation.
  "TENANT_SUBSCRIPTION_REQUIRED",
  "TENANT_ACCESS_SUSPENDED",
  "FEATURE_NOT_INCLUDED",
  "PROJECT_LIMIT_REACHED",
  "USER_LIMIT_REACHED",
  "STORAGE_LIMIT_REACHED",
  "AI_USAGE_LIMIT_REACHED",
  "INVITATION_INVALID",
  "INVITATION_EXPIRED",
  "PROJECT_NOT_FOUND",
  "RESOURCE_NOT_FOUND",
  "VALIDATION_FAILED",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "OPTIMISTIC_LOCK_CONFLICT",
  "REVIEW_NOT_APPROVED",
  "SELF_APPROVAL_FORBIDDEN",
  "IMMUTABLE_VERSION",
  "ARTIFACT_ACCESS_DENIED",
  "ARTIFACT_REJECTED",
  "CURSOR_INVALID",
  "INTERNAL_ERROR",
]);

export const phase9ErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: phase9ErrorCodeSchema,
        message: z.string().trim().min(1).max(500),
        correlationId: phase9IdentifierSchema,
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();

export class Phase9ApiError extends Error {
  constructor(
    readonly code: z.infer<typeof phase9ErrorCodeSchema>,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "Phase9ApiError";
  }
}

export const phase9AccessClaimsSchema = z
  .object({
    sub: phase9IdentifierSchema,
    tenantId: phase9IdentifierSchema,
    tenantRole: phase9RoleSchema,
    sessionId: phase9IdentifierSchema,
    tokenVersion: z.number().int().nonnegative(),
    tokenUse: z.literal("access"),
    jti: phase9IdentifierSchema,
    iss: z.string().trim().min(1),
    aud: z.string().trim().min(1),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .strict();

export const phase9RefreshClaimsSchema = z
  .object({
    sub: phase9IdentifierSchema,
    tenantId: phase9IdentifierSchema,
    sessionId: phase9IdentifierSchema,
    familyId: phase9IdentifierSchema,
    tokenUse: z.literal("refresh"),
    jti: phase9IdentifierSchema,
    iss: z.string().trim().min(1),
    aud: z.string().trim().min(1),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .strict();

/**
 * Proof that a password was already verified against a specific set of
 * accounts. Issued only when one email+password matched in more than one
 * tenant, and exchanged for tokens once the person picks an organization.
 * Short-lived because it is a bearer credential for those accounts.
 */
export const phase9TenantSelectionClaimsSchema = z
  .object({
    sub: z.string().trim().min(1).max(320),
    userIds: z.array(phase9IdentifierSchema).min(2).max(10),
    tokenUse: z.literal("tenant_selection"),
    jti: phase9IdentifierSchema,
    iss: z.string().trim().min(1),
    aud: z.string().trim().min(1),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .strict();

export const phase9LoginRequestSchema = z
  .object({
    // Optional: sign-in resolves the tenant from the email. Supplying it keeps
    // the single-tenant path for CLI/smoke callers and lets a person with
    // accounts in several tenants skip the organization step.
    tenantSlug: z.string().trim().min(2).max(100).optional(),
    email: z.string().trim().email().max(320),
    password: z.string().min(12).max(200),
    deviceName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const phase9TenantSelectionRequestSchema = z
  .object({
    selectionToken: z.string().trim().min(32).max(8_192),
    tenantSlug: z.string().trim().min(2).max(100),
    deviceName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const phase9TenantChoiceSchema = z
  .object({
    tenantSlug: z.string().trim().min(2).max(100),
    tenantName: z.string().trim().min(1).max(200),
  })
  .strict();

export const phase9TenantSelectionResultSchema = z
  .object({
    status: z.literal("TENANT_SELECTION_REQUIRED"),
    selectionToken: z.string().trim().min(1),
    expiresAt: z.string().datetime(),
    tenants: z.array(phase9TenantChoiceSchema).min(2),
  })
  .strict();

export const phase9RefreshRequestSchema = z
  .object({
    refreshToken: z.string().trim().min(32).max(8_192),
  })
  .strict();

export const phase9LogoutRequestSchema = phase9RefreshRequestSchema;

export const phase9TokenPairSchema = z
  .object({
    tokenType: z.literal("Bearer"),
    accessToken: z.string().min(32),
    accessExpiresAt: phase9IsoDateTimeSchema,
    refreshToken: z.string().min(32),
    refreshExpiresAt: phase9IsoDateTimeSchema,
  })
  .strict();

/**
 * Sign-in succeeded outright. A superset of TokenPair: existing callers that
 * read the token fields keep working, `status` distinguishes it from the
 * organization-choice response.
 */
export const phase9AuthenticatedResultSchema = phase9TokenPairSchema
  .extend({ status: z.literal("AUTHENTICATED") })
  .strict();

export const phase9LoginResultSchema = z.discriminatedUnion("status", [
  phase9AuthenticatedResultSchema,
  phase9TenantSelectionResultSchema,
]);

/**
 * Narrows a sign-in result for callers that always pass a tenant slug and so
 * can never receive the organization-choice branch.
 */
export function assertPhase9Authenticated(
  result: z.infer<typeof phase9LoginResultSchema>,
): z.infer<typeof phase9AuthenticatedResultSchema> {
  if (result.status !== "AUTHENTICATED") {
    throw new Phase9ApiError(
      "AUTH_INVALID_CREDENTIALS",
      401,
      "Sign-in needs an organization to be chosen",
    );
  }
  return result;
}

export const phase9InviteRequestSchema = z
  .object({
    email: z.string().trim().email().max(320),
    role: phase9RoleSchema.exclude(["SUPER_ADMIN"]),
    projectIds: z.array(phase9IdentifierSchema).max(100).default([]),
    expiresInHours: z.number().int().min(1).max(168).default(48),
  })
  .strict();

export const phase9InviteResultSchema = z
  .object({
    invitationId: phase9IdentifierSchema,
    invitationToken: z.string().min(32),
    expiresAt: phase9IsoDateTimeSchema,
  })
  .strict();

export const phase9AcceptInviteRequestSchema = z
  .object({
    invitationToken: z.string().min(32).max(1_024),
    displayName: z.string().trim().min(2).max(200),
    password: z.string().min(12).max(200),
  })
  .strict();

export const phase9AuthenticatedPrincipalSchema = z
  .object({
    userId: phase9IdentifierSchema,
    tenantId: phase9IdentifierSchema,
    tenantRole: phase9RoleSchema,
    sessionId: phase9IdentifierSchema,
    tokenVersion: z.number().int().nonnegative(),
  })
  .strict();

export const phase9CursorQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(2_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const phase9ProjectSummarySchema = z
  .object({
    id: phase9IdentifierSchema,
    code: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(300),
    status: z.enum(["PLANNED", "ACTIVE", "PAUSED", "COMPLETED"]),
    role: phase9RoleSchema,
    plannedStart: phase9IsoDateTimeSchema,
    plannedEnd: phase9IsoDateTimeSchema,
    rowVersion: z.number().int().positive(),
  })
  .strict();

export const phase9ProjectPageSchema = z
  .object({
    data: z.array(phase9ProjectSummarySchema),
    page: z
      .object({
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const phase10SessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    user: z
      .object({
        id: phase9IdentifierSchema,
        tenantId: phase9IdentifierSchema,
        email: z.string().email(),
        displayName: z.string().trim().min(1).max(200),
        tenantRole: phase9RoleSchema,
      })
      .strict(),
    tenantPermissions: z.array(phase9PermissionSchema),
    projectMemberships: z.array(
      z
        .object({
          projectId: phase9IdentifierSchema,
          role: phase9RoleSchema,
          permissions: z.array(phase9PermissionSchema),
        })
        .strict(),
    ),
  })
  .strict();

export const phase9ReviewTargetTypeSchema = z.enum([
  "REGISTRATION_DRAFT",
  "QUANTITY_TAKEOFF",
  "ESTIMATE",
  "SCHEDULE",
  "BASELINE",
  "DAILY_WORK_PLAN",
  "DAILY_REPORT",
  "PROGRESS_VERIFICATION",
  "RECOVERY_SCENARIO",
]);

export const phase9ApprovedCommandSchema = z
  .object({
    schemaVersion: z.literal(1),
    commandType: z.literal("APPLY_APPROVED_ARTIFACT"),
    reviewTaskId: phase9IdentifierSchema,
    targetType: phase9ReviewTargetTypeSchema,
    targetId: phase9IdentifierSchema,
    targetVersion: z.number().int().positive(),
    expectedRowVersion: z.number().int().positive(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(3).max(2_000),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const phase9AppliedCommandResultSchema = z
  .object({
    commandId: phase9IdentifierSchema,
    idempotencyKey: phase9IdentifierSchema,
    status: z.enum(["APPLIED", "REPLAYED"]),
    targetType: phase9ReviewTargetTypeSchema,
    targetId: phase9IdentifierSchema,
    targetVersion: z.number().int().positive(),
    eventId: phase9IdentifierSchema,
    auditId: phase9IdentifierSchema,
    appliedAt: phase9IsoDateTimeSchema,
  })
  .strict();

export const phase9ReviewDecisionRequestSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    expectedRowVersion: z.number().int().positive(),
    reason: z.string().trim().min(3).max(2_000),
    emergencyOverride: z.boolean().default(false),
  })
  .strict();

export const phase9ReviewDecisionResultSchema = z
  .object({
    decisionId: phase9IdentifierSchema,
    reviewTaskId: phase9IdentifierSchema,
    status: z.enum(["APPROVED", "REJECTED", "REPLAYED"]),
    rowVersion: z.number().int().positive(),
    eventId: phase9IdentifierSchema,
    decidedAt: phase9IsoDateTimeSchema,
  })
  .strict();

export const phase9SignedArtifactRequestSchema = z
  .object({
    expiresInSeconds: z.number().int().min(30).max(900).default(300),
  })
  .strict();

export const phase9SignedArtifactResultSchema = z
  .object({
    artifactId: phase9IdentifierSchema,
    url: z.string().url(),
    expiresAt: phase9IsoDateTimeSchema,
  })
  .strict();

export const phase9AuditEntrySchema = z
  .object({
    id: phase9IdentifierSchema,
    tenantId: phase9IdentifierSchema,
    projectId: phase9IdentifierSchema.nullable(),
    actorUserId: phase9IdentifierSchema.nullable(),
    actorRole: phase9RoleSchema.nullable(),
    action: z.string().trim().min(1).max(200),
    entityType: z.string().trim().min(1).max(200),
    entityId: phase9IdentifierSchema,
    reason: z.string().nullable(),
    correlationId: phase9IdentifierSchema,
    sourceVersion: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    occurredAt: phase9IsoDateTimeSchema,
  })
  .strict();

export type Phase9Role = z.infer<typeof phase9RoleSchema>;
export type Phase9Permission = z.infer<typeof phase9PermissionSchema>;
export type Phase9ErrorCode = z.infer<typeof phase9ErrorCodeSchema>;
export type Phase9AccessClaims = z.infer<typeof phase9AccessClaimsSchema>;
export type Phase9RefreshClaims = z.infer<typeof phase9RefreshClaimsSchema>;
export type Phase9TenantSelectionClaims = z.infer<typeof phase9TenantSelectionClaimsSchema>;
export type Phase9LoginResult = z.infer<typeof phase9LoginResultSchema>;
export type Phase9AuthenticatedPrincipal = z.infer<typeof phase9AuthenticatedPrincipalSchema>;
export type Phase9ApprovedCommand = z.infer<typeof phase9ApprovedCommandSchema>;
export type Phase9AppliedCommandResult = z.infer<typeof phase9AppliedCommandResultSchema>;
