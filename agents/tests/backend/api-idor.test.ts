import { BuildWatchPhase9Client } from "../../src/backend/index.js";
import {
  buildPhase9TestFixture,
  loginPhase9,
  phase9ArtifactBody,
  startPhase9TestServer,
} from "./phase9-fixtures.js";

describe("BuildWatch Phase 9 HTTP API and tenant isolation", () => {
  it("serves health, readiness, and the OpenAPI contract", async () => {
    const fixture = await buildPhase9TestFixture();
    const runtime = await startPhase9TestServer(fixture.app);
    try {
      const [live, ready, openapi] = await Promise.all([
        fetch(`${runtime.baseUrl}/health/live`),
        fetch(`${runtime.baseUrl}/health/ready`),
        fetch(`${runtime.baseUrl}/openapi.json`),
      ]);
      expect(live.status).toBe(200);
      expect(ready.status).toBe(200);
      expect((await openapi.json()) as { openapi: string }).toMatchObject({ openapi: "3.1.0" });
    } finally {
      await runtime.close();
    }
  });

  it("uses the typed client against real Express routes and cursor pagination", async () => {
    const fixture = await buildPhase9TestFixture();
    const runtime = await startPhase9TestServer(fixture.app);
    try {
      const client = new BuildWatchPhase9Client(runtime.baseUrl);
      await client.login({
        tenantSlug: "alpha",
        email: "admin@alpha.test",
        password: "BuildWatch-Test-Password-2026!",
      });
      const first = await client.listProjects({ limit: 1 });
      expect(first.data).toHaveLength(1);
      expect(first.page.hasMore).toBe(true);
      const second = await client.listProjects({
        limit: 1,
        cursor: first.page.nextCursor!,
      });
      expect(second.data).toHaveLength(1);
      expect(second.data[0]!.id).not.toBe(first.data[0]!.id);
      expect(JSON.stringify([first, second])).not.toContain("TENANT-PRIVATE-ONLY");
    } finally {
      await runtime.close();
    }
  });

  it("returns the same non-disclosing 404 for cross-tenant project, audit, and artifact IDOR", async () => {
    const fixture = await buildPhase9TestFixture();
    const runtime = await startPhase9TestServer(fixture.app);
    try {
      const pair = await loginPhase9(runtime.baseUrl, "alpha", "manager@alpha.test");
      const headers = {
        authorization: `Bearer ${pair.accessToken}`,
        "content-type": "application/json",
        "x-tenant-id": "tenant-private",
      };
      const responses = await Promise.all([
        fetch(`${runtime.baseUrl}/v1/projects/project-private-only`, { headers }),
        fetch(`${runtime.baseUrl}/v1/projects/project-private-only/audit`, { headers }),
        fetch(
          `${runtime.baseUrl}/v1/projects/project-private-only/artifacts/artifact-private-001/signed-url`,
          { method: "POST", headers, body: JSON.stringify({ expiresInSeconds: 60 }) },
        ),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(404);
        const body = JSON.stringify(await response.json());
        expect(body).not.toContain("tenant-private");
        expect(body).not.toContain("TENANT-PRIVATE-ONLY");
      }
    } finally {
      await runtime.close();
    }
  });

  it("queries authorized version comparison and latest forecast", async () => {
    const fixture = await buildPhase9TestFixture();
    const runtime = await startPhase9TestServer(fixture.app);
    try {
      const pair = await loginPhase9(runtime.baseUrl, "alpha", "manager@alpha.test");
      const headers = { authorization: `Bearer ${pair.accessToken}` };
      const comparison = await fetch(
        `${runtime.baseUrl}/v1/projects/project-alpha-main/versions/compare?leftId=baseline-alpha-v1&rightId=baseline-alpha-v2`,
        { headers },
      );
      expect(comparison.status).toBe(200);
      expect(
        ((await comparison.json()) as { differences: unknown[] }).differences.length,
      ).toBeGreaterThan(0);
      const forecast = await fetch(
        `${runtime.baseUrl}/v1/projects/project-alpha-main/forecast/latest?asOf=2026-08-03T08:00:00.000Z`,
        { headers },
      );
      expect(forecast.status).toBe(200);
      expect((await forecast.json()) as { projectedFinish: string }).toMatchObject({
        projectedFinish: "2027-01-10T00:00:00.000Z",
      });
    } finally {
      await runtime.close();
    }
  });

  it("downloads only a valid short-lived signed artifact URL", async () => {
    const fixture = await buildPhase9TestFixture();
    const runtime = await startPhase9TestServer(fixture.app);
    try {
      const pair = await loginPhase9(runtime.baseUrl, "alpha", "manager@alpha.test");
      const issued = await fetch(
        `${runtime.baseUrl}/v1/projects/project-alpha-main/artifacts/artifact-alpha-001/signed-url`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${pair.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ expiresInSeconds: 120 }),
        },
      );
      expect(issued.status).toBe(200);
      const issuedBody = (await issued.json()) as { url: string };
      const signedUrl = new URL(issuedBody.url);
      const testUrl = `${runtime.baseUrl}${signedUrl.pathname}${signedUrl.search}`;
      const content = await fetch(testUrl);
      expect(content.status).toBe(200);
      expect(Buffer.from(await content.arrayBuffer())).toEqual(phase9ArtifactBody);
      signedUrl.searchParams.set("pid", "project-private-only");
      const tampered = await fetch(`${runtime.baseUrl}${signedUrl.pathname}${signedUrl.search}`);
      expect(tampered.status).toBe(403);
    } finally {
      await runtime.close();
    }
  });
});
