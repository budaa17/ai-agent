import { Phase9ApiError } from "./contracts.js";
import type {
  PlatformAuthenticatedPrincipal,
  PlatformPermission,
  PlatformRole,
} from "./platform-contracts.js";

const readPermissions = [
  "PLATFORM_OVERVIEW_READ",
  "PLATFORM_TENANT_HEALTH_READ",
  "PLATFORM_AGENT_HEALTH_READ",
  "PLATFORM_AGENT_RUN_DIAGNOSTICS_READ",
  "PLATFORM_REVIEW_MONITOR_READ",
  "PLATFORM_USAGE_READ",
  "PLATFORM_SYSTEM_HEALTH_READ",
  "PLATFORM_AUDIT_READ",
  "PLATFORM_BILLING_READ",
] as const satisfies readonly PlatformPermission[];

const rolePermissions: Readonly<Record<PlatformRole, readonly PlatformPermission[]>> = {
  PLATFORM_SUPER_ADMIN: [
    ...readPermissions,
    "PLATFORM_INCIDENT_MANAGE",
    "PLATFORM_INTEGRATION_MANAGE",
    "PLATFORM_SETTINGS_MANAGE",
    "PLATFORM_AGENT_STATE_MANAGE",
    "PLATFORM_SUPPORT_ACCESS_GRANT",
    "PLATFORM_BILLING_MANAGE",
    "PLATFORM_PLAN_MANAGE",
  ],
  PLATFORM_OPERATOR: [
    ...readPermissions,
    "PLATFORM_INCIDENT_MANAGE",
    "PLATFORM_AGENT_STATE_MANAGE",
    // An operator confirms a bank transfer; publishing a plan stays with the
    // super admin because it changes what every future buyer is charged.
    "PLATFORM_BILLING_MANAGE",
  ],
  PLATFORM_AUDITOR: readPermissions,
};

export function platformPermissionsForRole(role: PlatformRole): ReadonlySet<PlatformPermission> {
  return new Set(rolePermissions[role]);
}

export function platformRoleHasPermission(
  role: PlatformRole,
  permission: PlatformPermission,
): boolean {
  return platformPermissionsForRole(role).has(permission);
}

export function requirePlatformPermission(
  principal: PlatformAuthenticatedPrincipal,
  permission: PlatformPermission,
): void {
  if (!platformRoleHasPermission(principal.platformRole, permission)) {
    throw new Phase9ApiError("AUTH_FORBIDDEN", 403, "Access denied");
  }
}
