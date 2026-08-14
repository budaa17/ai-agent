import { createPhase9Api } from "../../src/backend/api.js";
import { TenantAccessPolicy } from "../../src/backend/tenant-access-policy.js";
import type {
  TenantAccessSnapshot,
  TenantAccessSnapshotReader,
} from "../../src/backend/tenant-access-policy.js";
import { findPlanCatalogEntry } from "../../src/backend/index.js";
import { buildPhase9TestFixture, loginPhase9, startPhase9TestServer } from "./phase9-fixtures.js";

/**
 * Cross-tenant billing isolation (landing-page-roadmap.md §24.3, §28).
 *
 * The billing routes are the newest authenticated surface, and they are reachable
 * while the rest of the workspace is gated. That combination is exactly where an
 * IDOR would hurt most, so the boundary is asserted rather than assumed.
 */

const NOW = new Date("2026-08-12T09:00:00.000Z");

function snapshotFor(tenantId: string): TenantAccessSnapshot {
  return {
    tenantId,
    lifecycleStatus: "ACTIVE",
    accessReason: null,
    subscriptionStatus: "ACTIVE",
    planCode: "starter",
    graceEndsAt: null,
    currentPeriodEnd: null,
    entitlements: findPlanCatalogEntry("starter")!.entitlements,
  };
}

class PerTenantReader implements TenantAccessSnapshotReader {
  async load(tenantId: string): Promise<TenantAccessSnapshot | null> {
    return snapshotFor(tenantId);
  }
}

/** Records which tenant the service was actually asked about. */
function recordingBillingService() {
  const seen: string[] = [];
  const answer = async (tenantId: string) => {
    seen.push(tenantId);
    return { tenantId };
  };
  return {
    seen,
    service: {
      subscription: answer,
      entitlements: answer,
      usage: answer,
      invoices: async (tenantId: string) => {
        seen.push(tenantId);
        return [];
      },
      portal: answer,
      cancel: answer,
    } as never,
  };
}

async function billingRuntime() {
  const fixture = await buildPhase9TestFixture();
  const recorder = recordingBillingService();
  const runtime = await startPhase9TestServer(
    createPhase9Api({
      ...fixture,
      tenantAccess: new TenantAccessPolicy(new PerTenantReader(), { now: () => NOW }),
      tenantBilling: recorder.service,
    }),
  );
  return { runtime, recorder };
}

describe("billing routes are bound to the caller's own tenant", () => {
  it("ignores any tenant identifier the client tries to supply", async () => {
    const { runtime, recorder } = await billingRuntime();
    try {
      const session = await loginPhase9(runtime.baseUrl, "alpha", "admin@alpha.test");
      const headers = { authorization: `Bearer ${session.accessToken}` };

      // Every shape a caller might reach for: query string, header, body.
      const attempts = [
        `${runtime.baseUrl}/v1/billing/subscription?tenantId=tenant-private`,
        `${runtime.baseUrl}/v1/billing/usage?tenantId=tenant-private`,
        `${runtime.baseUrl}/v1/billing/invoices?tenantId=tenant-private`,
        `${runtime.baseUrl}/v1/billing/entitlements?tenantId=tenant-private`,
      ];
      for (const url of attempts) {
        const response = await fetch(url, {
          headers: { ...headers, "x-tenant-id": "tenant-private" },
        });
        expect(response.status).toBe(200);
      }

      expect(recorder.seen).toHaveLength(attempts.length);
      // The tenant came from the verified token every single time.
      expect(new Set(recorder.seen)).toEqual(new Set(["tenant-alpha"]));
      expect(recorder.seen).not.toContain("tenant-private");
    } finally {
      await runtime.close();
    }
  });

  it("refuses a billing read without a token at all", async () => {
    const { runtime, recorder } = await billingRuntime();
    try {
      const response = await fetch(`${runtime.baseUrl}/v1/billing/subscription`);
      expect(response.status).toBe(401);
      expect(recorder.seen).toHaveLength(0);
    } finally {
      await runtime.close();
    }
  });

  it("refuses a billing action to a role without the manage permission", async () => {
    const { runtime, recorder } = await billingRuntime();
    try {
      // An engineer is a legitimate member of the same tenant; billing is still
      // not theirs to change.
      const session = await loginPhase9(runtime.baseUrl, "alpha", "engineer@alpha.test");
      const response = await fetch(`${runtime.baseUrl}/v1/billing/cancel`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "тест" }),
      });
      expect(response.status).toBe(403);
      expect(recorder.seen).toHaveLength(0);
    } finally {
      await runtime.close();
    }
  });

  it("refuses a billing read to a role without the read permission", async () => {
    const { runtime, recorder } = await billingRuntime();
    try {
      const session = await loginPhase9(runtime.baseUrl, "alpha", "engineer@alpha.test");
      const response = await fetch(`${runtime.baseUrl}/v1/billing/invoices`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      expect(response.status).toBe(403);
      expect(recorder.seen).toHaveLength(0);
    } finally {
      await runtime.close();
    }
  });

  // A tenant bearer on the platform billing API is covered by
  // platform-idor.test.ts, which has a fully configured platform fixture.
});
