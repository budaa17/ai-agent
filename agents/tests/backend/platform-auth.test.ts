import { Phase9ApiError } from "../../src/backend/index.js";
import { phase9TestPassword } from "./phase9-fixtures.js";
import { buildPlatformTestFixture, platformTestEmail } from "./platform-fixtures.js";

describe("BuildWatch platform identity authentication", () => {
  it("issues strict platform claims and returns a platform-only session", async () => {
    const fixture = await buildPlatformTestFixture();
    const pair = await fixture.platformAuth.login(
      { email: platformTestEmail, password: phase9TestPassword, deviceName: "vitest" },
      { correlationId: "platform-login", ipAddress: "127.0.0.1" },
    );
    const claims = fixture.platformTokens.verifyAccess(pair.accessToken);
    expect(claims).toMatchObject({
      principalKind: "PLATFORM",
      platformRole: "PLATFORM_SUPER_ADMIN",
      aud: "buildwatch-platform",
      tokenUse: "access",
    });
    expect(claims).not.toHaveProperty("tenantId");

    const principal = await fixture.platformAuth.authenticateAccess(pair.accessToken);
    const session = await fixture.platformAuth.session(principal);
    expect(session).toMatchObject({
      schemaVersion: 1,
      principal: {
        principalKind: "PLATFORM",
        id: "platform-principal-admin",
        role: "PLATFORM_SUPER_ADMIN",
      },
    });
    expect(session.permissions).toContain("PLATFORM_OVERVIEW_READ");
    expect(session.permissions.some((permission) => !permission.startsWith("PLATFORM_"))).toBe(
      false,
    );
  });

  it("rotates refresh tokens and revokes the family when an old token is reused", async () => {
    const fixture = await buildPlatformTestFixture();
    const first = await fixture.platformAuth.login(
      { email: platformTestEmail, password: phase9TestPassword },
      { correlationId: "platform-login" },
    );
    const rotated = await fixture.platformAuth.refresh(
      { refreshToken: first.refreshToken },
      { correlationId: "platform-refresh" },
    );
    expect(rotated.refreshToken).not.toBe(first.refreshToken);

    await expect(
      fixture.platformAuth.refresh(
        { refreshToken: first.refreshToken },
        { correlationId: "platform-refresh-reuse" },
      ),
    ).rejects.toMatchObject({ code: "AUTH_REFRESH_REUSED" });
    await expect(
      fixture.platformAuth.authenticateAccess(rotated.accessToken),
    ).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
    const snapshot = fixture.platformStore.snapshot();
    expect(snapshot.sessions.every((session) => session.revokedAt !== null)).toBe(true);
    expect(snapshot.auditLogs.at(-1)).toMatchObject({
      action: "PLATFORM_AUTH_REFRESH_REUSE_DETECTED",
      result: "DENIED",
      tenantId: null,
    });
  });

  it("revokes the backing session on logout", async () => {
    const fixture = await buildPlatformTestFixture();
    const pair = await fixture.platformAuth.login(
      { email: platformTestEmail, password: phase9TestPassword },
      { correlationId: "platform-login" },
    );
    await fixture.platformAuth.logout(
      { refreshToken: pair.refreshToken },
      { correlationId: "platform-logout" },
    );
    await expect(fixture.platformAuth.authenticateAccess(pair.accessToken)).rejects.toEqual(
      expect.any(Phase9ApiError),
    );
  });
});
