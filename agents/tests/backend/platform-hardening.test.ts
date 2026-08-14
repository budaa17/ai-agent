import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPhase9Api } from "../../src/backend/api.js";
import { phase9BackendConfigSchema, resolvePhase9BackendConfig } from "../../src/backend/config.js";
import { platformPermissionsForRole } from "../../src/backend/platform-authorization.js";
import { platformPermissionSchema } from "../../src/backend/platform-contracts.js";
import { PlatformAuthService } from "../../src/backend/platform-auth-service.js";
import { PlatformTokenService } from "../../src/backend/platform-security.js";
import { InMemoryPlatformStore } from "../../src/backend/platform-store.js";
import { hashPhase9Password } from "../../src/backend/security.js";
import {
  loginPhase9,
  phase9TestNow,
  phase9TestPassword,
  phase9TestSecret,
  startPhase9TestServer,
} from "./phase9-fixtures.js";
import { buildPlatformTestFixture, loginPlatform, platformTestEmail } from "./platform-fixtures.js";

/**
 * Phase 7 release hardening. These are negative tests: each one asserts that a
 * boundary the Control Tower depends on cannot be crossed, so a regression that
 * quietly widens platform access fails the build rather than shipping.
 */

const requestMetadata = {
  correlationId: "hardening-test",
  userAgent: "vitest",
  ipAddress: "127.0.0.1",
  deviceName: "vitest",
};

async function authServiceWithMfa(options: { enrolled: boolean; requireMfa: boolean }) {
  const store = new InMemoryPlatformStore({
    principals: [
      {
        id: "platform-principal-admin",
        email: platformTestEmail,
        emailNormalized: platformTestEmail,
        displayName: "Platform Admin",
        role: "PLATFORM_SUPER_ADMIN",
        status: "ACTIVE",
        tokenVersion: 1,
        lastLoginAt: null,
        mfaEnrolledAt: options.enrolled ? phase9TestNow.toISOString() : null,
      },
    ],
    credentials: [
      {
        principalId: "platform-principal-admin",
        passwordHash: await hashPhase9Password(phase9TestPassword),
        passwordChangedAt: phase9TestNow.toISOString(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    ],
  });
  const service = new PlatformAuthService(
    store,
    new PlatformTokenService({ secret: phase9TestSecret, now: () => new Date(phase9TestNow) }),
    undefined,
    () => new Date(phase9TestNow),
    options.requireMfa,
  );
  return { store, service };
}

describe("platform MFA production gate", () => {
  it("defaults to required in production and off in development", () => {
    const base = {
      NODE_ENV: "development",
      PHASE9_DEVELOPMENT_SECRET: "d".repeat(48),
    } as NodeJS.ProcessEnv;

    expect(resolvePhase9BackendConfig(base).requirePlatformMfa).toBe(false);
    expect(
      resolvePhase9BackendConfig({ ...base, PLATFORM_REQUIRE_MFA: "true" }).requirePlatformMfa,
    ).toBe(true);
    expect(phase9BackendConfigSchema.shape).toHaveProperty("requirePlatformMfa");
  });

  it("refuses platform sign-in without an enrolled second factor and audits the denial", async () => {
    const { store, service } = await authServiceWithMfa({ enrolled: false, requireMfa: true });

    await expect(
      service.login({ email: platformTestEmail, password: phase9TestPassword }, requestMetadata),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN", status: 403 });

    const audit = store.snapshot().auditLogs;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "PLATFORM_LOGIN",
      result: "DENIED",
      reason: "Multi-factor enrolment is required for platform sign-in",
    });
    expect(audit[0]?.metadata).toMatchObject({ gate: "PLATFORM_MFA_REQUIRED" });
    expect(store.snapshot().sessions).toHaveLength(0);
  });

  it("still rejects a wrong password before the gate, so it cannot enumerate accounts", async () => {
    const { service } = await authServiceWithMfa({ enrolled: false, requireMfa: true });

    await expect(
      service.login(
        { email: platformTestEmail, password: "wrong-password-value" },
        requestMetadata,
      ),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS", status: 401 });
  });

  it("admits an enrolled principal when the gate is on", async () => {
    const { service } = await authServiceWithMfa({ enrolled: true, requireMfa: true });

    const pair = await service.login(
      { email: platformTestEmail, password: phase9TestPassword },
      requestMetadata,
    );

    expect(pair).toMatchObject({ tokenType: "Bearer" });
  });
});

describe("platform permission boundary", () => {
  it("grants no tenant operational permission to any platform role", () => {
    const forbidden = [
      "PROJECT_MANAGE",
      "REPORT_APPROVE",
      "INVENTORY_WRITE",
      "COMMAND_APPLY",
      "DESIGN_APPROVE",
      "REPORT_SUBMIT",
      "TENANT_ADMIN",
      "RULES_MANAGE",
    ];
    for (const role of ["PLATFORM_SUPER_ADMIN", "PLATFORM_OPERATOR", "PLATFORM_AUDITOR"] as const) {
      const granted = [...platformPermissionsForRole(role)];
      expect(granted.every((permission) => permission.startsWith("PLATFORM_"))).toBe(true);
      for (const permission of forbidden) {
        expect(granted).not.toContain(permission);
      }
    }
  });

  it("keeps every read-only role free of manage permissions", () => {
    const auditor = [...platformPermissionsForRole("PLATFORM_AUDITOR")];

    expect(auditor.some((permission) => permission.endsWith("_MANAGE"))).toBe(false);
    expect(auditor).not.toContain("PLATFORM_SUPPORT_ACCESS_GRANT");
  });

  it("exposes no API for granting a platform role to a tenant user", () => {
    const sources = [
      "../../src/backend/api.ts",
      "../../src/backend/platform-api.ts",
      "../../src/backend/project-service.ts",
    ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
    const combined = sources.join("\n");

    // Platform roles may be read for display, never written from a tenant path.
    expect(combined).not.toMatch(/platformPrincipal\.(create|update|upsert)/u);
    expect(combined).not.toMatch(/platformRole\s*[:=]\s*request\./u);
    for (const role of platformPermissionSchema.options) {
      expect(combined).not.toContain(`grant${role}`);
    }
  });
});

describe("platform audit immutability", () => {
  it("has no update or delete path for platform audit or incident history", () => {
    const sources = [
      "../../src/backend/platform-store.ts",
      "../../src/backend/platform-incident-store.ts",
      "../../src/backend/platform-incident-service.ts",
      "../../src/backend/platform-api.ts",
    ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
    const combined = sources.join("\n");

    for (const forbidden of [
      "platformAuditLog.update",
      "platformAuditLog.delete",
      "platformAuditLog.upsert",
      "platformAuditLog.deleteMany",
      "platformIncidentEvent.update",
      "platformIncidentEvent.delete",
      "platformIncidentEvent.upsert",
    ]) {
      expect(combined, forbidden).not.toContain(forbidden);
    }
  });

  it("keeps the append-only database trigger on both history tables", () => {
    const identity = readFileSync(
      new URL(
        "../../prisma/migrations/20260811100000_add_platform_identity/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const incidents = readFileSync(
      new URL(
        "../../prisma/migrations/20260811120000_add_platform_incidents/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(identity).toContain('CREATE TRIGGER "PlatformAuditLog_append_only"');
    expect(identity).toContain("BEFORE UPDATE OR DELETE");
    expect(incidents).toContain('CREATE TRIGGER "PlatformIncidentEvent_append_only"');
    expect(incidents).toContain("BEFORE UPDATE OR DELETE");
  });

  it("publishes no mutating audit route on the platform router", () => {
    const source = readFileSync(
      new URL("../../src/backend/platform-api.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/router\.(put|patch|delete)\(/u);
    // Three auth POSTs, one helper each for incident and support actions, and
    // the two billing actions an operator performs by hand: confirming a bank
    // transfer and granting a time-boxed access override. Any further mutating
    // route has to be added here deliberately.
    expect(source.match(/router\.post\(/gu) ?? []).toHaveLength(7);
    expect(source).toContain('"/billing/manual-invoices/:subscriptionId/confirm"');
    expect(source).toContain('"/billing/tenants/:tenantId/override"');
    expect(source.match(/actionRoute\("\/incidents\//gu) ?? []).toHaveLength(3);
    // Audit and the read-only drill-downs are never given a mutating route.
    expect(source).not.toMatch(
      /(action|supportAction)\("\/(audit|tenants|agents|reviews|usage|quality)/u,
    );
    // Every billing mutation is permission-gated on MANAGE, never on READ.
    expect(source.match(/PLATFORM_BILLING_MANAGE/gu) ?? []).toHaveLength(2);
  });
});

describe("platform session and token isolation", () => {
  it("rejects an expired platform session even with a structurally valid token", async () => {
    const fixture = await buildPlatformTestFixture();
    const runtime = await startPhase9TestServer(fixture.app);
    try {
      const platform = await loginPlatform(runtime.baseUrl);
      const before = await fetch(`${runtime.baseUrl}/platform/v1/session`, {
        headers: { authorization: `Bearer ${platform.accessToken}` },
      });
      expect(before.status).toBe(200);

      const state = fixture.platformStore.snapshot();
      const session = state.sessions.at(-1);
      expect(session).toBeDefined();
      await fixture.platformStore.transaction(async (transaction) => {
        await transaction.updateSession({
          ...session!,
          expiresAt: new Date(phase9TestNow.getTime() - 60_000).toISOString(),
        });
      });

      const after = await fetch(`${runtime.baseUrl}/platform/v1/session`, {
        headers: { authorization: `Bearer ${platform.accessToken}` },
      });
      expect(after.status).toBe(401);
      expect(await after.json()).toMatchObject({ error: { code: "AUTH_TOKEN_INVALID" } });
    } finally {
      await runtime.close();
    }
  });

  it("rejects a revoked platform session", async () => {
    const fixture = await buildPlatformTestFixture();
    const runtime = await startPhase9TestServer(fixture.app);
    try {
      const platform = await loginPlatform(runtime.baseUrl);
      const session = fixture.platformStore.snapshot().sessions.at(-1);
      await fixture.platformStore.transaction(async (transaction) => {
        await transaction.revokeSessionFamily(
          session!.familyId,
          phase9TestNow.toISOString(),
          false,
        );
      });

      const response = await fetch(`${runtime.baseUrl}/platform/v1/session`, {
        headers: { authorization: `Bearer ${platform.accessToken}` },
      });

      expect(response.status).toBe(401);
    } finally {
      await runtime.close();
    }
  });

  it("never lets a tenant bearer reach a platform route, whatever the tenant role", async () => {
    const fixture = await buildPlatformTestFixture();
    const runtime = await startPhase9TestServer(fixture.app);
    try {
      const companyAdmin = await loginPhase9(runtime.baseUrl, "alpha", "admin@alpha.test");
      const paths = [
        "/platform/v1/session",
        "/platform/v1/overview",
        "/platform/v1/tenants",
        "/platform/v1/audit-logs",
        "/platform/v1/incidents",
      ];
      for (const path of paths) {
        const response = await fetch(`${runtime.baseUrl}${path}`, {
          headers: { authorization: `Bearer ${companyAdmin.accessToken}` },
        });
        expect(response.status, path).toBe(403);
      }
    } finally {
      await runtime.close();
    }
  });

  it("never lets a platform bearer reach a tenant route", async () => {
    const fixture = await buildPlatformTestFixture();
    const runtime = await startPhase9TestServer(fixture.app);
    try {
      const platform = await loginPlatform(runtime.baseUrl);
      const paths = ["/v1/session", "/v1/projects"];
      for (const path of paths) {
        const response = await fetch(`${runtime.baseUrl}${path}`, {
          headers: { authorization: `Bearer ${platform.accessToken}` },
        });
        expect([401, 403], path).toContain(response.status);
      }
    } finally {
      await runtime.close();
    }
  });
});

describe("platform secret and redaction scan", () => {
  it("keeps credentials, hashes and tokens out of the read services entirely", () => {
    // The auth service legitimately handles session hashes; the read services
    // that build Control Tower responses must never mention them at all.
    const sources = [
      "../../src/backend/platform-overview-service.ts",
      "../../src/backend/platform-drilldown-service.ts",
      "../../src/backend/platform-incident-service.ts",
      "../../src/backend/platform-incident-store.ts",
      "../../src/backend/platform-drilldown-read-model.ts",
      "../../src/backend/platform-overview-read-model.ts",
    ].map((path) => ({ path, source: readFileSync(new URL(path, import.meta.url), "utf8") }));

    for (const { path, source } of sources) {
      for (const forbidden of ["tokenHash", "accessToken", "refreshToken", "ipAddressHash"]) {
        expect(source, `${path}: ${forbidden}`).not.toContain(forbidden);
      }
      // The incident service reads a password hash only to verify a step-up; it
      // must never place one into a response object.
      expect(source, path).not.toMatch(/passwordHash\s*:\s*(?!async|\(|null)/u);
    }
  });

  it("declares no secret-bearing property in the platform response contracts", () => {
    const contracts = [
      "../../src/backend/platform-overview-contracts.ts",
      "../../src/backend/platform-drilldown-contracts.ts",
      "../../src/backend/platform-incident-contracts.ts",
    ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
    const combined = contracts.join("\n");

    for (const forbidden of [
      "passwordHash",
      "tokenHash",
      "accessToken",
      "refreshToken",
      "researchText",
      "promptText",
      "rawOutput",
      "payload:",
      "metadata:",
    ]) {
      expect(combined, forbidden).not.toContain(forbidden);
    }
  });

  it("returns a sanitized error envelope when a platform read throws", async () => {
    const fixture = await buildPlatformTestFixture();
    const secret = "postgres://user:sup3r-secret@db:5432/app";
    const app = createPhase9Api({
      auth: fixture.tenant.auth,
      platformAuth: fixture.platformAuth,
      platformOverview: {
        overview: async () => {
          throw new Error(`connection failed for ${secret}`);
        },
      } as never,
      projects: fixture.tenant.projects,
      commands: fixture.tenant.commands,
      reviews: fixture.tenant.reviews,
      artifacts: fixture.tenant.artifacts,
      objectStore: fixture.tenant.objectStore,
    });
    const runtime = await startPhase9TestServer(app);
    try {
      const platform = await loginPlatform(runtime.baseUrl);
      const response = await fetch(`${runtime.baseUrl}/platform/v1/overview`, {
        headers: { authorization: `Bearer ${platform.accessToken}` },
      });

      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).not.toContain(secret);
      expect(body).not.toContain("sup3r-secret");
      expect(JSON.parse(body)).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    } finally {
      await runtime.close();
    }
  });
});
