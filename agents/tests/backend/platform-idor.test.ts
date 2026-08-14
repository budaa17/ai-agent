import { loginPhase9, startPhase9TestServer } from "./phase9-fixtures.js";
import { buildPlatformTestFixture, loginPlatform } from "./platform-fixtures.js";

describe("BuildWatch platform and tenant HTTP token isolation", () => {
  it("denies a tenant bearer on platform routes", async () => {
    const fixture = await buildPlatformTestFixture();
    const runtime = await startPhase9TestServer(fixture.app);
    try {
      const tenant = await loginPhase9(runtime.baseUrl, "alpha", "admin@alpha.test");
      const response = await fetch(`${runtime.baseUrl}/platform/v1/session`, {
        headers: { authorization: `Bearer ${tenant.accessToken}` },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "AUTH_FORBIDDEN" } });

      // The billing routes are the newest platform surface and carry the most
      // sensitive action on the platform, so they are named explicitly here.
      for (const path of [
        "/platform/v1/billing/overview",
        "/platform/v1/billing/subscriptions",
        "/platform/v1/billing/invoices",
        "/platform/v1/billing/webhooks",
      ]) {
        const billing = await fetch(`${runtime.baseUrl}${path}`, {
          headers: { authorization: `Bearer ${tenant.accessToken}` },
        });
        expect(billing.status).toBe(403);
      }
    } finally {
      await runtime.close();
    }
  });

  it("denies a platform bearer on tenant session and project mutation routes", async () => {
    const fixture = await buildPlatformTestFixture();
    const runtime = await startPhase9TestServer(fixture.app);
    try {
      const platform = await loginPlatform(runtime.baseUrl);
      const headers = {
        authorization: `Bearer ${platform.accessToken}`,
        "content-type": "application/json",
        "idempotency-key": "platform-must-not-mutate-project",
      };
      const [session, mutation] = await Promise.all([
        fetch(`${runtime.baseUrl}/v1/session`, { headers }),
        fetch(`${runtime.baseUrl}/v1/projects`, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        }),
      ]);
      expect(session.status).toBe(403);
      expect(mutation.status).toBe(403);
      expect(await mutation.json()).toMatchObject({ error: { code: "AUTH_FORBIDDEN" } });
    } finally {
      await runtime.close();
    }
  });

  it("serves the strict platform session and publishes all platform auth paths", async () => {
    const fixture = await buildPlatformTestFixture();
    const runtime = await startPhase9TestServer(fixture.app);
    try {
      const platform = await loginPlatform(runtime.baseUrl);
      const [sessionResponse, openApiResponse] = await Promise.all([
        fetch(`${runtime.baseUrl}/platform/v1/session`, {
          headers: { authorization: `Bearer ${platform.accessToken}` },
        }),
        fetch(`${runtime.baseUrl}/openapi.json`),
      ]);
      expect(sessionResponse.status).toBe(200);
      expect(await sessionResponse.json()).toMatchObject({
        principal: { principalKind: "PLATFORM", role: "PLATFORM_SUPER_ADMIN" },
      });
      const openapi = (await openApiResponse.json()) as { paths: Record<string, unknown> };
      expect(Object.keys(openapi.paths)).toEqual(
        expect.arrayContaining([
          "/platform/v1/auth/login",
          "/platform/v1/auth/refresh",
          "/platform/v1/auth/logout",
          "/platform/v1/session",
        ]),
      );
    } finally {
      await runtime.close();
    }
  });
});
