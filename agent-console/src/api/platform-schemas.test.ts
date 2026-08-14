import { describe, expect, it } from "vitest";
import { platformOverviewFixture } from "../test/platform-overview-fixture";
import {
  platformOverviewQuerySchema,
  platformOverviewResponseSchema,
  platformSessionSchema,
} from "./platform-schemas";

const SESSION = {
  schemaVersion: 1,
  principal: {
    principalKind: "PLATFORM",
    id: "platform-principal-1",
    email: "operator@buildwatch.test",
    displayName: "Platform Operator",
    role: "PLATFORM_OPERATOR",
  },
  permissions: ["PLATFORM_OVERVIEW_READ", "PLATFORM_SYSTEM_HEALTH_READ"],
} as const;

describe("platform session runtime contract", () => {
  it("parses the strict platform principal discriminator and permissions", () => {
    expect(platformSessionSchema.parse(SESSION)).toEqual(SESSION);
  });

  it("rejects a tenant-shaped session", () => {
    expect(() =>
      platformSessionSchema.parse({
        schemaVersion: 1,
        user: { id: "tenant-user", tenantId: "tenant-1", tenantRole: "COMPANY_ADMIN" },
        tenantPermissions: ["TENANT_ADMIN"],
        projectMemberships: [],
      }),
    ).toThrow();
  });
});

describe("platform overview v1 runtime contract", () => {
  it("parses the exact strict overview response", () => {
    expect(platformOverviewResponseSchema.parse(platformOverviewFixture)).toEqual(
      platformOverviewFixture,
    );
  });

  it("accepts the forward-compatible persistent incident attention states", () => {
    const acknowledged = structuredClone(platformOverviewFixture);
    const first = acknowledged.attention.items[0];
    if (first === undefined) throw new Error("Fixture attention item missing");
    first.state = "ACKNOWLEDGED";

    expect(platformOverviewResponseSchema.parse(acknowledged).attention.items[0]?.state).toBe(
      "ACKNOWLEDGED",
    );
  });

  it("rejects unknown response fields instead of silently drifting", () => {
    expect(() =>
      platformOverviewResponseSchema.parse({ ...platformOverviewFixture, fakeMetric: 42 }),
    ).toThrow();
  });

  it("allows a preset or complete custom range but never both", () => {
    expect(platformOverviewQuerySchema.parse({ window: "7d", tenantId: "tenant-atlas" })).toEqual({
      window: "7d",
      tenantId: "tenant-atlas",
    });
    expect(
      platformOverviewQuerySchema.parse({
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-02T00:00:00.000Z",
      }),
    ).toBeDefined();
    expect(() =>
      platformOverviewQuerySchema.parse({
        window: "24h",
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-02T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects reversed, future and longer-than-90-day custom ranges", () => {
    expect(() =>
      platformOverviewQuerySchema.parse({
        from: "2026-08-02T00:00:00.000Z",
        to: "2026-08-01T00:00:00.000Z",
      }),
    ).toThrow(/эхлэл төгсгөлөөс өмнө/);
    expect(() =>
      platformOverviewQuerySchema.parse({
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-08-01T00:00:00.000Z",
      }),
    ).toThrow(/90 хоногоос урт/);
    expect(() =>
      platformOverviewQuerySchema.parse({
        from: new Date(Date.now() - 60_000).toISOString(),
        to: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toThrow(/ирээдүйд/);
  });
});
