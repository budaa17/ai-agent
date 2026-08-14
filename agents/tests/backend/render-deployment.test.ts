import { createPhase9Api } from "../../src/backend/api.js";
import { resolvePhase9BackendConfig } from "../../src/backend/config.js";
import { buildPhase9TestFixture, startPhase9TestServer } from "./phase9-fixtures.js";

describe("Render deployment integration", () => {
  it("uses Render host, port, public URL, and normalized CORS origins", () => {
    const config = resolvePhase9BackendConfig({
      NODE_ENV: "development",
      PHASE9_DEVELOPMENT_SECRET: "d".repeat(48),
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://buildwatch-api.onrender.com",
      PORT: "10000",
      PHASE9_CORS_ORIGINS: " https://buildwatch.vercel.app,https://preview.vercel.app ",
    });

    expect(config).toMatchObject({
      host: "0.0.0.0",
      port: 10_000,
      publicBaseUrl: "https://buildwatch-api.onrender.com",
      corsOrigins: ["https://buildwatch.vercel.app", "https://preview.vercel.app"],
    });
  });

  it("requires a complete Supabase storage configuration", () => {
    expect(() =>
      resolvePhase9BackendConfig({
        NODE_ENV: "development",
        PHASE9_DEVELOPMENT_SECRET: "d".repeat(48),
        PHASE9_ARTIFACT_STORAGE_PROVIDER: "supabase",
        SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toThrow(/SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET/u);

    const config = resolvePhase9BackendConfig({
      NODE_ENV: "development",
      PHASE9_DEVELOPMENT_SECRET: "d".repeat(48),
      PHASE9_ARTIFACT_STORAGE_PROVIDER: "supabase",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-value",
      SUPABASE_STORAGE_BUCKET: "buildwatch-artifacts",
    });
    expect(config).toMatchObject({
      artifactStorageProvider: "supabase",
      supabaseUrl: "https://example.supabase.co",
      supabaseStorageBucket: "buildwatch-artifacts",
    });
  });

  it("answers trusted preflight requests and rejects unknown origins", async () => {
    const fixture = await buildPhase9TestFixture();
    const app = createPhase9Api(
      {
        auth: fixture.auth,
        projects: fixture.projects,
        commands: fixture.commands,
        reviews: fixture.reviews,
        artifacts: fixture.artifacts,
        objectStore: fixture.objectStore,
      },
      { corsOrigins: ["https://buildwatch.vercel.app"] },
    );
    const runtime = await startPhase9TestServer(app);
    try {
      const allowed = await fetch(`${runtime.baseUrl}/v1/session`, {
        method: "OPTIONS",
        headers: {
          origin: "https://buildwatch.vercel.app",
          "access-control-request-method": "GET",
        },
      });
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get("access-control-allow-origin")).toBe(
        "https://buildwatch.vercel.app",
      );

      const denied = await fetch(`${runtime.baseUrl}/v1/session`, {
        method: "OPTIONS",
        headers: {
          origin: "https://untrusted.example",
          "access-control-request-method": "GET",
        },
      });
      expect(denied.status).toBe(403);
      expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      await runtime.close();
    }
  });
});
