import {
  Phase9ApiError,
  type Phase9AuthenticatedPrincipal,
  type Phase9Permission,
  type Phase9Role,
} from "./contracts.js";

const rolePermissions: Readonly<Record<Phase9Role, readonly Phase9Permission[]>> = {
  SUPER_ADMIN: [
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
    "TENANT_BILLING_READ",
    "TENANT_BILLING_MANAGE",
  ],
  COMPANY_ADMIN: [
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
    "TENANT_BILLING_READ",
    "TENANT_BILLING_MANAGE",
  ],
  PROJECT_MANAGER: [
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
    "FORECAST_READ",
    "AUDIT_READ",
    "ARTIFACT_READ",
    "ARTIFACT_UPLOAD",
    "CHAT_READ",
    "COMMAND_APPLY",
    "AGENT_RUN",
  ],
  ENGINEER: [
    "PROJECT_READ",
    "DESIGN_READ",
    "DESIGN_APPROVE",
    "ESTIMATE_READ",
    "PLAN_READ",
    "REPORT_READ",
    "REPORT_SUBMIT",
    "VERIFICATION_READ",
    "FORECAST_READ",
    "ARTIFACT_READ",
    "ARTIFACT_UPLOAD",
    "CHAT_READ",
    "AGENT_RUN",
  ],
  SITE_SUPERVISOR: [
    "PROJECT_READ",
    "DESIGN_READ",
    "PLAN_READ",
    "REPORT_READ",
    "REPORT_SUBMIT",
    "VERIFICATION_READ",
    "INVENTORY_READ",
    "ARTIFACT_READ",
    "ARTIFACT_UPLOAD",
    "CHAT_READ",
    "AGENT_RUN",
  ],
  STOREKEEPER: [
    "PROJECT_READ",
    "PLAN_READ",
    "REPORT_READ",
    "INVENTORY_READ",
    "INVENTORY_WRITE",
    "ARTIFACT_READ",
    "ARTIFACT_UPLOAD",
  ],
  OBSERVER: [
    "PROJECT_READ",
    "DESIGN_READ",
    "ESTIMATE_READ",
    "PLAN_READ",
    "REPORT_READ",
    "VERIFICATION_READ",
    "FORECAST_READ",
    "ARTIFACT_READ",
    "CHAT_READ",
  ],
};

export function permissionsForRole(role: Phase9Role): ReadonlySet<Phase9Permission> {
  return new Set(rolePermissions[role]);
}

export function roleHasPermission(role: Phase9Role, permission: Phase9Permission): boolean {
  return permissionsForRole(role).has(permission);
}

export function requireTenantPermission(
  principal: Phase9AuthenticatedPrincipal,
  permission: Phase9Permission,
): void {
  if (!roleHasPermission(principal.tenantRole, permission)) {
    throw new Phase9ApiError("AUTH_FORBIDDEN", 403, "Access denied");
  }
}

export function effectiveProjectRole(
  principal: Phase9AuthenticatedPrincipal,
  membershipRole: Phase9Role | null,
): Phase9Role | null {
  if (principal.tenantRole === "SUPER_ADMIN" || principal.tenantRole === "COMPANY_ADMIN") {
    return principal.tenantRole;
  }
  return membershipRole;
}

export function requireProjectPermission(
  principal: Phase9AuthenticatedPrincipal,
  membershipRole: Phase9Role | null,
  permission: Phase9Permission,
): Phase9Role {
  const role = effectiveProjectRole(principal, membershipRole);
  if (role === null || !roleHasPermission(role, permission)) {
    throw new Phase9ApiError("PROJECT_NOT_FOUND", 404, "Project not found");
  }
  return role;
}
