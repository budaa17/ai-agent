import {
  Phase9ApiError,
  assertPhase9Authenticated,
  hashPhase9Password,
  phase9Sha256,
  resolvePhase9BackendConfig,
  verifyPhase9Password,
} from "../../src/backend/index.js";
import { buildPhase9TestFixture, phase9TestPassword } from "./phase9-fixtures.js";

describe("BuildWatch Phase 9 identity and token security", () => {
  it("normalizes blank optional env values and isolates production signing keys", () => {
    const development = resolvePhase9BackendConfig({
      NODE_ENV: "development",
      PHASE9_DEVELOPMENT_SECRET: "d".repeat(32),
      PHASE9_JWT_SECRET: "",
      PHASE9_CURSOR_SECRET: "",
      PHASE9_ARTIFACT_SIGNING_SECRET: "",
      PHASE9_EMAIL_VERIFICATION_SECRET: "",
      RABBITMQ_URL: "",
    });
    expect(development.rabbitMqUrl).toBeNull();
    expect(development.jwtSecret).toBe("d".repeat(32));
    expect(development.emailVerificationSecret).toBe("d".repeat(32));
    expect(development.maxArtifactBytes).toBe(100 * 1024 * 1024);
    expect(() =>
      resolvePhase9BackendConfig({
        NODE_ENV: "production",
        PHASE9_JWT_SECRET: "s".repeat(32),
        PHASE9_CURSOR_SECRET: "s".repeat(32),
        PHASE9_ARTIFACT_SIGNING_SECRET: "s".repeat(32),
        PHASE9_EMAIL_VERIFICATION_SECRET: "s".repeat(32),
      }),
    ).toThrow("Production signing secrets must be independent");
  });

  it("uses salted scrypt password hashes and constant-result verification", async () => {
    const first = await hashPhase9Password(phase9TestPassword);
    const second = await hashPhase9Password(phase9TestPassword);
    expect(first).not.toBe(second);
    expect(await verifyPhase9Password(phase9TestPassword, first)).toBe(true);
    expect(await verifyPhase9Password("Wrong-Password-2026!", first)).toBe(false);
  });

  it("logs in, validates access JWT, rotates refresh, and revokes a reused family", async () => {
    const fixture = await buildPhase9TestFixture();
    const metadata = { correlationId: "auth-rotation-test", ipAddress: "127.0.0.1" };
    const first = assertPhase9Authenticated(
      await fixture.auth.login(
        {
          tenantSlug: "alpha",
          email: "manager@alpha.test",
          password: phase9TestPassword,
        },
        metadata,
      ),
    );
    const principal = await fixture.auth.authenticateAccess(first.accessToken);
    expect(principal.tenantId).toBe("tenant-alpha");
    const rotated = await fixture.auth.refresh(
      { refreshToken: first.refreshToken },
      { correlationId: "auth-refresh-test" },
    );
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    await expect(
      fixture.auth.refresh(
        { refreshToken: first.refreshToken },
        { correlationId: "auth-reuse-test" },
      ),
    ).rejects.toMatchObject({ code: "AUTH_REFRESH_REUSED" });
    await expect(fixture.auth.authenticateAccess(rotated.accessToken)).rejects.toMatchObject({
      code: "AUTH_TOKEN_INVALID",
    });
    expect(
      fixture.store
        .snapshot()
        .sessions.filter(
          (session) => session.familyId === fixture.store.snapshot().sessions[0]!.familyId,
        )
        .every((session) => session.revokedAt !== null),
    ).toBe(true);
  });

  it("rejects tampered JWTs without exposing claims", async () => {
    const fixture = await buildPhase9TestFixture();
    const pair = assertPhase9Authenticated(
      await fixture.auth.login(
        {
          tenantSlug: "alpha",
          email: "manager@alpha.test",
          password: phase9TestPassword,
        },
        { correlationId: "jwt-tamper" },
      ),
    );
    const tampered = `${pair.accessToken.slice(0, -1)}${pair.accessToken.endsWith("a") ? "b" : "a"}`;
    await expect(fixture.auth.authenticateAccess(tampered)).rejects.toEqual(
      expect.any(Phase9ApiError),
    );
  });

  it("creates and accepts tenant/project-scoped invitations", async () => {
    const fixture = await buildPhase9TestFixture();
    const pair = assertPhase9Authenticated(
      await fixture.auth.login(
        {
          tenantSlug: "alpha",
          email: "admin@alpha.test",
          password: phase9TestPassword,
        },
        { correlationId: "invite-admin-login" },
      ),
    );
    const principal = await fixture.auth.authenticateAccess(pair.accessToken);
    const invite = await fixture.auth.invite(
      principal,
      {
        email: "new.engineer@alpha.test",
        role: "ENGINEER",
        projectIds: ["project-alpha-main"],
      },
      { correlationId: "invite-create" },
    );
    const accepted = await fixture.auth.acceptInvitation(
      {
        invitationToken: invite.invitationToken,
        displayName: "New Engineer",
        password: "New-Engineer-Password-2026!",
      },
      { correlationId: "invite-accept" },
    );
    const state = fixture.store.snapshot();
    expect(state.users.find((user) => user.id === accepted.userId)?.tenantRole).toBe("ENGINEER");
    expect(
      state.memberships.some(
        (membership) =>
          membership.userId === accepted.userId &&
          membership.projectId === "project-alpha-main" &&
          membership.role === "ENGINEER",
      ),
    ).toBe(true);
    expect(state.invitations[0]?.tokenHash).toBe(phase9Sha256(invite.invitationToken));
  });
});
