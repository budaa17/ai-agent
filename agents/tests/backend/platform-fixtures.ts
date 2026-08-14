import {
  InMemoryPlatformStore,
  PlatformAuthService,
  PlatformTokenService,
  createPhase9Api,
  hashPhase9Password,
  type PlatformStoreState,
} from "../../src/backend/index.js";
import {
  buildPhase9TestFixture,
  phase9TestNow,
  phase9TestPassword,
  phase9TestSecret,
} from "./phase9-fixtures.js";

export const platformTestEmail = "platform.admin@buildwatch.test";

export async function buildPlatformTestFixture(seed: Partial<PlatformStoreState> = {}) {
  const tenant = await buildPhase9TestFixture();
  const passwordHash = await hashPhase9Password(phase9TestPassword);
  const platformStore = new InMemoryPlatformStore({
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
        // Enrolled so the production MFA gate is exercised only where a test
        // explicitly turns it on with an unenrolled principal.
        mfaEnrolledAt: phase9TestNow.toISOString(),
      },
    ],
    credentials: [
      {
        principalId: "platform-principal-admin",
        passwordHash,
        passwordChangedAt: phase9TestNow.toISOString(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    ],
    ...seed,
  });
  const platformTokens = new PlatformTokenService({
    secret: phase9TestSecret,
    now: () => new Date(phase9TestNow),
  });
  const platformAuth = new PlatformAuthService(
    platformStore,
    platformTokens,
    undefined,
    () => new Date(phase9TestNow),
  );
  const app = createPhase9Api({
    auth: tenant.auth,
    platformAuth,
    projects: tenant.projects,
    commands: tenant.commands,
    reviews: tenant.reviews,
    artifacts: tenant.artifacts,
    objectStore: tenant.objectStore,
  });
  return { tenant, platformStore, platformTokens, platformAuth, app };
}

export async function loginPlatform(baseUrl: string) {
  const response = await fetch(`${baseUrl}/platform/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "platform-test-login" },
    body: JSON.stringify({
      email: platformTestEmail,
      password: phase9TestPassword,
      deviceName: "vitest",
    }),
  });
  if (!response.ok) throw new Error(`Platform test login failed: ${response.status}`);
  return (await response.json()) as { accessToken: string; refreshToken: string };
}
