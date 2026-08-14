import { createPhase9Api } from "../../src/backend/api.js";
import { TenantAccessPolicy } from "../../src/backend/tenant-access-policy.js";
import type {
  TenantAccessSnapshot,
  TenantAccessSnapshotReader,
} from "../../src/backend/tenant-access-policy.js";
import {
  classifyTenantAccessOperation,
  isTenantBillingPath,
  requestPathWithoutQuery,
} from "../../src/backend/tenant-access-routes.js";
import { BUILDWATCH_PLAN_CATALOG, findPlanCatalogEntry } from "../../src/backend/index.js";
import type { TenantLifecycleStatus } from "../../src/backend/billing-contracts.js";
import { buildPhase9TestFixture, loginPhase9, startPhase9TestServer } from "./phase9-fixtures.js";

const NOW = new Date("2026-08-12T09:00:00.000Z");

async function errorCodeOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? "";
}

function snapshotFor(
  lifecycleStatus: TenantLifecycleStatus,
  overrides: Partial<TenantAccessSnapshot> = {},
): TenantAccessSnapshot {
  return {
    tenantId: "tenant-alpha",
    lifecycleStatus,
    accessReason: null,
    subscriptionStatus: lifecycleStatus === "ACTIVE" ? "ACTIVE" : null,
    planCode: "starter",
    graceEndsAt: null,
    currentPeriodEnd: null,
    entitlements: findPlanCatalogEntry("starter")!.entitlements,
    ...overrides,
  };
}

class StubReader implements TenantAccessSnapshotReader {
  loads = 0;
  constructor(private snapshot: TenantAccessSnapshot | null) {}
  async load(): Promise<TenantAccessSnapshot | null> {
    this.loads += 1;
    return this.snapshot;
  }
  replace(snapshot: TenantAccessSnapshot | null) {
    this.snapshot = snapshot;
  }
}

function policyFor(
  snapshot: TenantAccessSnapshot | null,
  now: () => Date = () => NOW,
): { policy: TenantAccessPolicy; reader: StubReader; counters: Record<string, number> } {
  const reader = new StubReader(snapshot);
  const counters: Record<string, number> = {};
  const policy = new TenantAccessPolicy(reader, {
    now,
    metrics: {
      increment: (name, value = 1) => {
        counters[name] = (counters[name] ?? 0) + value;
      },
    },
  });
  return { policy, reader, counters };
}

describe("tenant access lifecycle matrix", () => {
  const expectations: ReadonlyArray<{
    lifecycle: TenantLifecycleStatus;
    read: boolean;
    write: boolean;
    ai: boolean;
    billing: boolean;
  }> = [
    { lifecycle: "PENDING_PAYMENT", read: false, write: false, ai: false, billing: true },
    { lifecycle: "ACTIVE", read: true, write: true, ai: true, billing: true },
    { lifecycle: "PAYMENT_GRACE", read: true, write: true, ai: true, billing: true },
    { lifecycle: "SUSPENDED", read: true, write: false, ai: false, billing: true },
    { lifecycle: "ARCHIVED", read: false, write: false, ai: false, billing: false },
  ];

  it("matches the published access matrix exactly", async () => {
    for (const row of expectations) {
      const { policy } = policyFor(snapshotFor(row.lifecycle));
      expect((await policy.getDecision("tenant-alpha", "READ")).allowed).toBe(row.read);
      expect((await policy.getDecision("tenant-alpha", "WRITE")).allowed).toBe(row.write);
      expect((await policy.getDecision("tenant-alpha", "AI_JOB")).allowed).toBe(row.ai);
      expect((await policy.getDecision("tenant-alpha", "BILLING")).allowed).toBe(row.billing);
    }
  });

  it("keeps payment recovery reachable for a suspended tenant", async () => {
    const { policy } = policyFor(snapshotFor("SUSPENDED"));
    const billing = await policy.getDecision("tenant-alpha", "BILLING");
    expect(billing.allowed).toBe(true);

    const write = await policy.getDecision("tenant-alpha", "WRITE");
    expect(policy.toError(write).code).toBe("TENANT_ACCESS_SUSPENDED");
    expect(policy.toError(write).status).toBe(402);
  });

  it("asks an unpaid tenant to subscribe rather than reporting a suspension", async () => {
    const { policy } = policyFor(snapshotFor("PENDING_PAYMENT"));
    const decision = await policy.getDecision("tenant-alpha", "READ");
    expect(decision.reason).toBe("SUBSCRIPTION_REQUIRED");
    expect(policy.toError(decision).code).toBe("TENANT_SUBSCRIPTION_REQUIRED");
  });

  it("refuses an unknown tenant without leaking that it is unknown", async () => {
    const { policy } = policyFor(null);
    const decision = await policy.getDecision("tenant-ghost", "READ");
    expect(decision.allowed).toBe(false);
    expect(policy.toError(decision).code).toBe("TENANT_SUBSCRIPTION_REQUIRED");
  });

  it("reports the grace window so the console can warn the admin", async () => {
    const graceEndsAt = new Date(NOW.getTime() + 3 * 86_400_000);
    const { policy } = policyFor(snapshotFor("PAYMENT_GRACE", { graceEndsAt }));
    const decision = await policy.getDecision("tenant-alpha", "WRITE");
    expect(decision.allowed).toBe(true);
    expect(decision.warning).toEqual({ kind: "PAYMENT_GRACE", graceEndsAt });
  });

  it("treats an elapsed grace window as suspended even before the worker runs", async () => {
    // A stalled grace evaluator must not keep handing out unpaid write access.
    const graceEndsAt = new Date(NOW.getTime() - 1);
    const { policy } = policyFor(snapshotFor("PAYMENT_GRACE", { graceEndsAt }));
    const write = await policy.getDecision("tenant-alpha", "WRITE");
    expect(write.allowed).toBe(false);
    expect(write.effectiveLifecycle).toBe("SUSPENDED");
    expect((await policy.getDecision("tenant-alpha", "READ")).allowed).toBe(true);
  });

  it("counts every denial for the operational dashboard", async () => {
    const { policy, counters } = policyFor(snapshotFor("SUSPENDED"));
    await policy.getDecision("tenant-alpha", "WRITE");
    await policy.getDecision("tenant-alpha", "AI_JOB");
    expect(counters.tenant_access_denied_total).toBe(2);
    expect(counters.tenant_access_denied_access_suspended_total).toBe(2);
  });
});

describe("tenant access entitlements", () => {
  it("refuses a feature the plan does not include", async () => {
    const { policy } = policyFor(snapshotFor("ACTIVE"));
    await expect(policy.requireFeature("tenant-alpha", "API_ACCESS")).rejects.toMatchObject({
      code: "FEATURE_NOT_INCLUDED",
      status: 402,
    });
    await expect(
      policy.requireFeature("tenant-alpha", "AGENT_DAILY_REPORT"),
    ).resolves.toBeUndefined();
  });

  it("maps each limit onto its own error code", async () => {
    const business = findPlanCatalogEntry("business")!;
    const { policy } = policyFor(snapshotFor("ACTIVE", { entitlements: business.entitlements }));

    await expect(
      policy.requireLimit("tenant-alpha", "PROJECT_ACTIVE_MAX", 5),
    ).rejects.toMatchObject({ code: "PROJECT_LIMIT_REACHED" });
    await expect(policy.requireLimit("tenant-alpha", "USER_ACTIVE_MAX", 60)).rejects.toMatchObject({
      code: "USER_LIMIT_REACHED",
    });
    await expect(
      policy.requireLimit("tenant-alpha", "STORAGE_BYTES_MAX", 500n * 1_073_741_824n),
    ).rejects.toMatchObject({ code: "STORAGE_LIMIT_REACHED" });
    await expect(
      policy.requireLimit("tenant-alpha", "AI_MONTHLY_RUNS_INCLUDED", 900),
    ).rejects.toMatchObject({ code: "AI_USAGE_LIMIT_REACHED" });
  });

  it("allows the request that exactly fills the plan", async () => {
    const { policy } = policyFor(snapshotFor("ACTIVE"));
    // Starter allows one project: from zero, creating one must succeed.
    await expect(
      policy.requireLimit("tenant-alpha", "PROJECT_ACTIVE_MAX", 0),
    ).resolves.toBeUndefined();
    await expect(
      policy.requireLimit("tenant-alpha", "PROJECT_ACTIVE_MAX", 1),
    ).rejects.toMatchObject({
      code: "PROJECT_LIMIT_REACHED",
    });
  });

  it("refuses rather than inventing a zero when usage cannot be read", async () => {
    const { policy } = policyFor(snapshotFor("ACTIVE"));
    await expect(
      policy.requireLimit("tenant-alpha", "PROJECT_ACTIVE_MAX", null),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 503 });
  });

  it("leaves a grandfathered tenant unrestricted instead of locking it out", async () => {
    const { policy } = policyFor(
      snapshotFor("ACTIVE", { entitlements: null, accessReason: "GRANDFATHERED_PRE_BILLING" }),
    );
    await expect(policy.requireFeature("tenant-alpha", "API_ACCESS")).resolves.toBeUndefined();
    await expect(
      policy.requireLimit("tenant-alpha", "PROJECT_ACTIVE_MAX", 99),
    ).resolves.toBeUndefined();
  });

  it("lets an Enterprise contract exceed every published tier limit", async () => {
    const enterprise = BUILDWATCH_PLAN_CATALOG.find((plan) => plan.code === "enterprise")!;
    const { policy } = policyFor(snapshotFor("ACTIVE", { entitlements: enterprise.entitlements }));
    await expect(
      policy.requireLimit("tenant-alpha", "PROJECT_ACTIVE_MAX", 250),
    ).resolves.toBeUndefined();
  });
});

describe("tenant access snapshot caching", () => {
  it("reuses a snapshot within the TTL and reloads after it", async () => {
    let clock = NOW.getTime();
    const reader = new StubReader(snapshotFor("ACTIVE"));
    const policy = new TenantAccessPolicy(reader, {
      cacheTtlMs: 10_000,
      now: () => new Date(clock),
    });

    await policy.getDecision("tenant-alpha", "READ");
    await policy.getDecision("tenant-alpha", "WRITE");
    expect(reader.loads).toBe(1);

    clock += 10_001;
    await policy.getDecision("tenant-alpha", "READ");
    expect(reader.loads).toBe(2);
  });

  it("applies a suspension immediately once the webhook invalidates the tenant", async () => {
    const reader = new StubReader(snapshotFor("ACTIVE"));
    const policy = new TenantAccessPolicy(reader, { cacheTtlMs: 60_000, now: () => NOW });

    expect((await policy.getDecision("tenant-alpha", "WRITE")).allowed).toBe(true);
    reader.replace(snapshotFor("SUSPENDED"));
    expect((await policy.getDecision("tenant-alpha", "WRITE")).allowed).toBe(true);

    policy.invalidate("tenant-alpha");
    expect((await policy.getDecision("tenant-alpha", "WRITE")).allowed).toBe(false);
  });
});

describe("tenant access route classification", () => {
  it("classifies reads, writes and AI jobs", () => {
    expect(classifyTenantAccessOperation("GET", "/v1/projects")).toBe("READ");
    expect(classifyTenantAccessOperation("POST", "/v1/projects")).toBe("WRITE");
    expect(classifyTenantAccessOperation("PATCH", "/v1/projects/p1")).toBe("WRITE");
    expect(classifyTenantAccessOperation("POST", "/v1/projects/p1/a1-intakes")).toBe("AI_JOB");
    expect(classifyTenantAccessOperation("POST", "/v1/projects/p1/chat")).toBe("AI_JOB");
    expect(classifyTenantAccessOperation("GET", "/v1/projects/p1/chat")).toBe("READ");
  });

  it("keeps the billing allowlist reachable", () => {
    expect(classifyTenantAccessOperation("GET", "/v1/session")).toBe("BILLING");
    expect(classifyTenantAccessOperation("POST", "/v1/billing/checkout")).toBe("BILLING");
    expect(classifyTenantAccessOperation("GET", "/v1/billing/invoices")).toBe("BILLING");
  });

  it("refuses to grant billing classification through a traversal or encoded path", () => {
    for (const path of [
      "/v1/billing/../projects",
      "/v1/billing/%2e%2e/projects",
      "/v1/billing//projects",
      "/v1/session/../projects",
      "/v1/sessions",
    ]) {
      expect(isTenantBillingPath(path)).toBe(false);
      expect(classifyTenantAccessOperation("POST", path)).toBe("WRITE");
    }
  });

  it("strips the query string before classifying", () => {
    expect(requestPathWithoutQuery("/v1/projects?cursor=abc")).toBe("/v1/projects");
    expect(requestPathWithoutQuery("/v1/session")).toBe("/v1/session");
    expect(classifyTenantAccessOperation("GET", requestPathWithoutQuery("/v1/session?x=1"))).toBe(
      "BILLING",
    );
  });
});

describe("tenant access gate over HTTP", () => {
  it("refuses to build a production API without the access policy", () => {
    expect(() =>
      createPhase9Api({} as never, { nodeEnv: "production", metricsToken: null }),
    ).toThrow(/tenant subscription access policy is required in production/);
  });

  it("stops a suspended tenant from mutating or starting an AI job, whatever the client does", async () => {
    const fixture = await buildPhase9TestFixture();
    const policy = new TenantAccessPolicy(new StubReader(snapshotFor("SUSPENDED")), {
      now: () => NOW,
    });
    const runtime = await startPhase9TestServer(
      createPhase9Api({ ...fixture, tenantAccess: policy }),
    );
    try {
      const session = await loginPhase9(runtime.baseUrl, "alpha", "admin@alpha.test");
      const authorized = {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
        "idempotency-key": "phase2-gate-test",
      };

      const created = await fetch(`${runtime.baseUrl}/v1/projects`, {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({ code: "BYPASS", name: "Bypass attempt" }),
      });
      expect(created.status).toBe(402);
      expect(await errorCodeOf(created)).toBe("TENANT_ACCESS_SUSPENDED");

      const aiJob = await fetch(`${runtime.baseUrl}/v1/projects/project-alpha/a1-intakes`, {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({ text: "өнөөдөр 40 м3 бетон" }),
      });
      expect(aiJob.status).toBe(402);
      expect(await errorCodeOf(aiJob)).toBe("TENANT_ACCESS_SUSPENDED");

      // Reads and the billing allowlist stay open so the admin can pay and export.
      const session2 = await fetch(`${runtime.baseUrl}/v1/session`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      expect(session2.status).toBe(200);

      const projects = await fetch(`${runtime.baseUrl}/v1/projects`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      expect(projects.status).toBe(200);
    } finally {
      await runtime.close();
    }
  });

  it("blocks an unpaid tenant from reading business data but not its own session", async () => {
    const fixture = await buildPhase9TestFixture();
    const policy = new TenantAccessPolicy(new StubReader(snapshotFor("PENDING_PAYMENT")), {
      now: () => NOW,
    });
    const runtime = await startPhase9TestServer(
      createPhase9Api({ ...fixture, tenantAccess: policy }),
    );
    try {
      const session = await loginPhase9(runtime.baseUrl, "alpha", "admin@alpha.test");
      const headers = { authorization: `Bearer ${session.accessToken}` };

      const projects = await fetch(`${runtime.baseUrl}/v1/projects`, { headers });
      expect(projects.status).toBe(402);
      expect(await errorCodeOf(projects)).toBe("TENANT_SUBSCRIPTION_REQUIRED");

      expect((await fetch(`${runtime.baseUrl}/v1/session`, { headers })).status).toBe(200);
    } finally {
      await runtime.close();
    }
  });

  it("announces the grace window in a response header", async () => {
    const graceEndsAt = new Date(NOW.getTime() + 86_400_000);
    const fixture = await buildPhase9TestFixture();
    const policy = new TenantAccessPolicy(
      new StubReader(snapshotFor("PAYMENT_GRACE", { graceEndsAt })),
      { now: () => NOW },
    );
    const runtime = await startPhase9TestServer(
      createPhase9Api({ ...fixture, tenantAccess: policy }),
    );
    try {
      const session = await loginPhase9(runtime.baseUrl, "alpha", "admin@alpha.test");
      const response = await fetch(`${runtime.baseUrl}/v1/projects`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("x-buildwatch-billing-state")).toBe("PAYMENT_GRACE");
      expect(response.headers.get("x-buildwatch-billing-grace-ends-at")).toBe(
        graceEndsAt.toISOString(),
      );
    } finally {
      await runtime.close();
    }
  });

  it("still lets an active tenant work normally", async () => {
    const fixture = await buildPhase9TestFixture();
    const policy = new TenantAccessPolicy(new StubReader(snapshotFor("ACTIVE")), {
      now: () => NOW,
    });
    const runtime = await startPhase9TestServer(
      createPhase9Api({ ...fixture, tenantAccess: policy }),
    );
    try {
      const session = await loginPhase9(runtime.baseUrl, "alpha", "admin@alpha.test");
      const response = await fetch(`${runtime.baseUrl}/v1/projects`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("x-buildwatch-billing-state")).toBeNull();
    } finally {
      await runtime.close();
    }
  });
});
