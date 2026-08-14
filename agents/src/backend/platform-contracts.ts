import { z } from "zod";
import { phase9IdentifierSchema, phase9IsoDateTimeSchema } from "./contracts.js";

export const PLATFORM_TOKEN_ISSUER = "buildwatch-api";
export const PLATFORM_TOKEN_AUDIENCE = "buildwatch-platform";

export const platformRoleSchema = z.enum([
  "PLATFORM_SUPER_ADMIN",
  "PLATFORM_OPERATOR",
  "PLATFORM_AUDITOR",
]);

export const platformPermissionSchema = z.enum([
  "PLATFORM_OVERVIEW_READ",
  "PLATFORM_TENANT_HEALTH_READ",
  "PLATFORM_AGENT_HEALTH_READ",
  "PLATFORM_AGENT_RUN_DIAGNOSTICS_READ",
  "PLATFORM_REVIEW_MONITOR_READ",
  "PLATFORM_USAGE_READ",
  "PLATFORM_SYSTEM_HEALTH_READ",
  "PLATFORM_AUDIT_READ",
  "PLATFORM_INCIDENT_MANAGE",
  "PLATFORM_INTEGRATION_MANAGE",
  "PLATFORM_SETTINGS_MANAGE",
  "PLATFORM_AGENT_STATE_MANAGE",
  "PLATFORM_SUPPORT_ACCESS_GRANT",
  // Billing oversight. Reading is an auditor concern; confirming a payment or
  // granting an override changes what a tenant may do, so it is separate.
  "PLATFORM_BILLING_READ",
  "PLATFORM_BILLING_MANAGE",
  "PLATFORM_PLAN_MANAGE",
]);

export const platformPrincipalStatusSchema = z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]);

const platformRegisteredClaimsSchema = z.object({
  sub: phase9IdentifierSchema,
  principalKind: z.literal("PLATFORM"),
  sessionId: phase9IdentifierSchema,
  tokenUse: z.enum(["access", "refresh"]),
  jti: phase9IdentifierSchema,
  iss: z.literal(PLATFORM_TOKEN_ISSUER),
  aud: z.literal(PLATFORM_TOKEN_AUDIENCE),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

export const platformAccessClaimsSchema = platformRegisteredClaimsSchema
  .extend({
    tokenUse: z.literal("access"),
    platformRole: platformRoleSchema,
    tokenVersion: z.number().int().nonnegative(),
  })
  .strict();

export const platformRefreshClaimsSchema = platformRegisteredClaimsSchema
  .extend({
    tokenUse: z.literal("refresh"),
    familyId: phase9IdentifierSchema,
  })
  .strict();

export const platformLoginRequestSchema = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(12).max(200),
    deviceName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const platformRefreshRequestSchema = z
  .object({ refreshToken: z.string().trim().min(32).max(8_192) })
  .strict();

export const platformLogoutRequestSchema = platformRefreshRequestSchema;

export const platformTokenPairSchema = z
  .object({
    tokenType: z.literal("Bearer"),
    accessToken: z.string().min(32),
    accessExpiresAt: phase9IsoDateTimeSchema,
    refreshToken: z.string().min(32),
    refreshExpiresAt: phase9IsoDateTimeSchema,
  })
  .strict();

export const platformAuthenticatedPrincipalSchema = z
  .object({
    principalKind: z.literal("PLATFORM"),
    principalId: phase9IdentifierSchema,
    platformRole: platformRoleSchema,
    sessionId: phase9IdentifierSchema,
    tokenVersion: z.number().int().nonnegative(),
  })
  .strict();

export const platformSessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    principal: z
      .object({
        principalKind: z.literal("PLATFORM"),
        id: phase9IdentifierSchema,
        email: z.string().email().max(320),
        displayName: z.string().trim().min(1).max(200),
        role: platformRoleSchema,
      })
      .strict(),
    permissions: z.array(platformPermissionSchema),
  })
  .strict();

export type PlatformRole = z.infer<typeof platformRoleSchema>;
export type PlatformPermission = z.infer<typeof platformPermissionSchema>;
export type PlatformAccessClaims = z.infer<typeof platformAccessClaimsSchema>;
export type PlatformRefreshClaims = z.infer<typeof platformRefreshClaimsSchema>;
export type PlatformAuthenticatedPrincipal = z.infer<typeof platformAuthenticatedPrincipalSchema>;
export type PlatformSession = z.infer<typeof platformSessionSchema>;
