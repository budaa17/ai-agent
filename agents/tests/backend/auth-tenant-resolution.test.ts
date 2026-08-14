import {
  InMemoryPhase9Store,
  Phase9ApiError,
  Phase9AuthService,
  Phase9TokenService,
  hashPhase9Password,
  type Phase9StoreState,
} from "../../src/backend/index.js";
import { phase9TestNow, phase9TestPassword, phase9TestSecret } from "./phase9-fixtures.js";

const OTHER_PASSWORD = "BuildWatch-Other-Password-2026!";
const SHARED_EMAIL = "engineer@shared.test";
const metadata = { correlationId: "tenant-resolution-test", ipAddress: "127.0.0.1" };

function user(
  id: string,
  tenantId: string,
  emailNormalized: string,
  status: "ACTIVE" | "SUSPENDED" = "ACTIVE",
) {
  return {
    id,
    tenantId,
    email: emailNormalized,
    emailNormalized,
    displayName: id,
    tenantRole: "ENGINEER" as const,
    status,
    tokenVersion: 1,
    emailVerifiedAt: phase9TestNow.toISOString(),
    lastLoginAt: null,
  };
}

async function buildFixture(
  options: {
    /** user id -> password. Absent means the shared test password. */
    passwords?: Record<string, string>;
    lockedUserIds?: readonly string[];
    inactiveUserIds?: readonly string[];
  } = {},
) {
  const shared = await hashPhase9Password(phase9TestPassword);
  const other = await hashPhase9Password(OTHER_PASSWORD);
  const userIds = ["user-nomad", "user-steppe", "user-solo"];
  const state: Partial<Phase9StoreState> = {
    tenants: [
      { id: "tenant-nomad", slug: "nomad-build", name: "Nomad Build LLC" },
      { id: "tenant-steppe", slug: "steppe-labs", name: "Steppe Labs LLC" },
      { id: "tenant-solo", slug: "solo-works", name: "Solo Works LLC" },
    ],
    users: [
      user(
        "user-nomad",
        "tenant-nomad",
        SHARED_EMAIL,
        options.inactiveUserIds?.includes("user-nomad") ? "SUSPENDED" : "ACTIVE",
      ),
      user(
        "user-steppe",
        "tenant-steppe",
        SHARED_EMAIL,
        options.inactiveUserIds?.includes("user-steppe") ? "SUSPENDED" : "ACTIVE",
      ),
      user("user-solo", "tenant-solo", "solo@shared.test"),
    ],
    credentials: userIds.map((userId) => ({
      userId,
      passwordHash: options.passwords?.[userId] === OTHER_PASSWORD ? other : shared,
      failedLoginCount: 0,
      lockedUntil: options.lockedUserIds?.includes(userId)
        ? new Date(phase9TestNow.getTime() + 10 * 60_000).toISOString()
        : null,
      passwordChangedAt: phase9TestNow.toISOString(),
    })),
  };
  const store = new InMemoryPhase9Store(state);
  const now = () => new Date(phase9TestNow);
  const tokens = new Phase9TokenService({
    secret: phase9TestSecret,
    issuer: "buildwatch-api",
    audience: "buildwatch-web",
    now,
  });
  return { store, tokens, auth: new Phase9AuthService(store, tokens, undefined, now) };
}

describe("Sign-in without a tenant slug", () => {
  it("signs in directly when the email belongs to exactly one organization", async () => {
    const { auth } = await buildFixture();

    const result = await auth.login(
      { email: "solo@shared.test", password: phase9TestPassword },
      metadata,
    );

    expect(result.status).toBe("AUTHENTICATED");
    if (result.status !== "AUTHENTICATED") throw new Error("unreachable");
    const principal = await auth.authenticateAccess(result.accessToken);
    expect(principal.tenantId).toBe("tenant-solo");
  });

  it("asks which organization when the password unlocks several", async () => {
    const { auth } = await buildFixture();

    const result = await auth.login(
      { email: SHARED_EMAIL, password: phase9TestPassword },
      metadata,
    );

    expect(result.status).toBe("TENANT_SELECTION_REQUIRED");
    if (result.status !== "TENANT_SELECTION_REQUIRED") throw new Error("unreachable");
    expect(result.tenants).toEqual([
      { tenantSlug: "nomad-build", tenantName: "Nomad Build LLC" },
      { tenantSlug: "steppe-labs", tenantName: "Steppe Labs LLC" },
    ]);
  });

  it("exchanges the selection for tokens scoped to the chosen organization", async () => {
    const { auth } = await buildFixture();
    const first = await auth.login({ email: SHARED_EMAIL, password: phase9TestPassword }, metadata);
    if (first.status !== "TENANT_SELECTION_REQUIRED") throw new Error("expected a choice");

    const completed = await auth.completeTenantSelection(
      { selectionToken: first.selectionToken, tenantSlug: "steppe-labs" },
      metadata,
    );

    const principal = await auth.authenticateAccess(completed.accessToken);
    expect(principal.tenantId).toBe("tenant-steppe");
  });

  // The whole point of verifying the password before showing the list: an
  // attacker must not be able to use the sign-in form to discover where
  // somebody works.
  it("does not reveal any organization when the password is wrong", async () => {
    const { auth } = await buildFixture();

    await expect(
      auth.login({ email: SHARED_EMAIL, password: "Completely-Wrong-Password-1" }, metadata),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS", status: 401 });
  });

  it("lists only the organizations the password actually unlocked", async () => {
    const { auth } = await buildFixture({ passwords: { "user-steppe": OTHER_PASSWORD } });

    const result = await auth.login(
      { email: SHARED_EMAIL, password: phase9TestPassword },
      metadata,
    );

    // Only nomad matched, so this is an outright sign-in and steppe is never mentioned.
    expect(result.status).toBe("AUTHENTICATED");
    if (result.status !== "AUTHENTICATED") throw new Error("unreachable");
    expect((await auth.authenticateAccess(result.accessToken)).tenantId).toBe("tenant-nomad");
  });

  it("does not charge a failed attempt to the other tenant during a normal sign-in", async () => {
    const { auth, store } = await buildFixture({ passwords: { "user-steppe": OTHER_PASSWORD } });

    await auth.login({ email: SHARED_EMAIL, password: phase9TestPassword }, metadata);

    const steppe = store.snapshot().credentials.find((value) => value.userId === "user-steppe");
    expect(steppe?.failedLoginCount).toBe(0);
  });

  it("counts a failure against every candidate when nothing matched", async () => {
    const { auth, store } = await buildFixture();

    await expect(
      auth.login({ email: SHARED_EMAIL, password: "Completely-Wrong-Password-1" }, metadata),
    ).rejects.toBeInstanceOf(Phase9ApiError);

    const counts = store
      .snapshot()
      .credentials.filter((value) => value.userId !== "user-solo")
      .map((value) => value.failedLoginCount);
    expect(counts).toEqual([1, 1]);
  });

  it("skips a locked account and signs in with the one that is not locked", async () => {
    const { auth } = await buildFixture({ lockedUserIds: ["user-nomad"] });

    const result = await auth.login(
      { email: SHARED_EMAIL, password: phase9TestPassword },
      metadata,
    );

    expect(result.status).toBe("AUTHENTICATED");
    if (result.status !== "AUTHENTICATED") throw new Error("unreachable");
    expect((await auth.authenticateAccess(result.accessToken)).tenantId).toBe("tenant-steppe");
  });

  it("ignores accounts that are not active", async () => {
    const { auth } = await buildFixture({ inactiveUserIds: ["user-nomad"] });

    const result = await auth.login(
      { email: SHARED_EMAIL, password: phase9TestPassword },
      metadata,
    );

    expect(result.status).toBe("AUTHENTICATED");
    if (result.status !== "AUTHENTICATED") throw new Error("unreachable");
    expect((await auth.authenticateAccess(result.accessToken)).tenantId).toBe("tenant-steppe");
  });

  it("still honours an explicit tenant slug", async () => {
    const { auth } = await buildFixture();

    const result = await auth.login(
      { tenantSlug: "nomad-build", email: SHARED_EMAIL, password: phase9TestPassword },
      metadata,
    );

    expect(result.status).toBe("AUTHENTICATED");
    if (result.status !== "AUTHENTICATED") throw new Error("unreachable");
    expect((await auth.authenticateAccess(result.accessToken)).tenantId).toBe("tenant-nomad");
  });

  it("refuses a selection token pointed at an organization it never unlocked", async () => {
    const { auth } = await buildFixture();
    const first = await auth.login({ email: SHARED_EMAIL, password: phase9TestPassword }, metadata);
    if (first.status !== "TENANT_SELECTION_REQUIRED") throw new Error("expected a choice");

    await expect(
      auth.completeTenantSelection(
        { selectionToken: first.selectionToken, tenantSlug: "solo-works" },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
  });

  it("refuses a forged selection token", async () => {
    const { auth } = await buildFixture();
    const forged = new Phase9TokenService({
      secret: "a-different-secret-that-is-long-enough-0123",
      issuer: "buildwatch-api",
      audience: "buildwatch-web",
      now: () => new Date(phase9TestNow),
    }).issueTenantSelection({
      emailNormalized: SHARED_EMAIL,
      userIds: ["user-nomad", "user-steppe"],
    });

    await expect(
      auth.completeTenantSelection(
        { selectionToken: forged.token, tenantSlug: "nomad-build" },
        metadata,
      ),
    ).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
  });

  it("rate limits on email and address so a tenant guess cannot buy more attempts", async () => {
    const { auth } = await buildFixture();

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(
        auth.login(
          { tenantSlug: `guess-${attempt}`, email: SHARED_EMAIL, password: "Wrong-Password-1234" },
          metadata,
        ),
      ).rejects.toBeInstanceOf(Phase9ApiError);
    }

    await expect(
      auth.login({ email: SHARED_EMAIL, password: phase9TestPassword }, metadata),
    ).rejects.toMatchObject({ code: "AUTH_RATE_LIMITED", status: 429 });
  });
});
