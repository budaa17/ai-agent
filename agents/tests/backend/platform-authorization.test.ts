import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  platformPermissionsForRole,
  platformRoleHasPermission,
  requirePlatformPermission,
  type PlatformAuthenticatedPrincipal,
} from "../../src/backend/index.js";

describe("BuildWatch platform authorization boundary", () => {
  const auditor: PlatformAuthenticatedPrincipal = {
    principalKind: "PLATFORM",
    principalId: "platform-auditor",
    platformRole: "PLATFORM_AUDITOR",
    sessionId: "platform-session",
    tokenVersion: 1,
  };

  it("uses a platform-only, default-deny permission namespace", () => {
    const permissions = [...platformPermissionsForRole("PLATFORM_SUPER_ADMIN")];
    expect(permissions).toContain("PLATFORM_SETTINGS_MANAGE");
    expect(permissions.every((permission) => permission.startsWith("PLATFORM_"))).toBe(true);
    expect(platformRoleHasPermission("PLATFORM_AUDITOR", "PLATFORM_AUDIT_READ")).toBe(true);
    expect(platformRoleHasPermission("PLATFORM_AUDITOR", "PLATFORM_INCIDENT_MANAGE")).toBe(false);
    expect(() => requirePlatformPermission(auditor, "PLATFORM_INCIDENT_MANAGE")).toThrow(
      "Access denied",
    );
  });

  it("keeps the Prisma migration additive and platform audit append-only", async () => {
    const [schema, migration] = await Promise.all([
      readFile(resolve("prisma/schema.prisma"), "utf8"),
      readFile(
        resolve("prisma/migrations/20260811100000_add_platform_identity/migration.sql"),
        "utf8",
      ),
    ]);
    for (const model of [
      "PlatformPrincipal",
      "PlatformCredential",
      "PlatformRefreshSession",
      "PlatformAuditLog",
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
    expect(schema).not.toContain("principalKind String");
    expect(migration).not.toMatch(/DROP TABLE|DROP TYPE|ALTER TYPE.*IdentityRole/is);
    expect(migration).toContain('CREATE TRIGGER "PlatformAuditLog_append_only"');
    expect(migration).toContain('"tenantId" TEXT');
    expect(migration).toContain('"result" "PlatformAuditResult"');
  });
});
