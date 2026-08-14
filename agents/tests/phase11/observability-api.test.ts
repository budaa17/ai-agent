import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { PrismaClient } from "@prisma/client";
import {
  createPhase9Api,
  collectPhase11OperationalGauges,
  TenantAccessPolicy,
  type Phase9ApiServices,
} from "../../src/backend/index.js";
import { AgentOperationalMetrics } from "../../src/runtime/logging.js";

/**
 * A production API refuses to start without the subscription access gate, so
 * even a metrics-only test has to supply one. Nothing here authenticates, so the
 * reader is never consulted.
 */
const tenantAccess = new TenantAccessPolicy({ load: async () => null });

async function start(app: ReturnType<typeof createPhase9Api>) {
  const server = createServer(app);
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())),
  };
}

describe("BuildWatch Phase 11 observability", () => {
  it("exposes authenticated Prometheus metrics with production security headers", async () => {
    const metrics = new AgentOperationalMetrics();
    metrics.increment("test_counter_total", 2);
    const app = createPhase9Api(
      {
        tenantAccess,
        operationalGauges: async () => ({ outbox_pending: 4 }),
      } as unknown as Phase9ApiServices,
      {
        nodeEnv: "production",
        metricsToken: "metrics-token-that-is-longer-than-thirty-two-bytes",
        metrics,
      },
    );
    const runtime = await start(app);
    try {
      const rejected = await fetch(`${runtime.baseUrl}/internal/metrics`, {
        headers: { authorization: "Bearer wrong" },
      });
      expect(rejected.status).toBe(401);
      const response = await fetch(`${runtime.baseUrl}/internal/metrics`, {
        headers: {
          authorization: "Bearer metrics-token-that-is-longer-than-thirty-two-bytes",
        },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("strict-transport-security")).toContain("max-age");
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
      const body = await response.text();
      expect(body).toContain("buildwatch_test_counter_total 2");
      expect(body).toContain("buildwatch_outbox_pending 4");
    } finally {
      await runtime.close();
    }
  });

  it("maps malformed JSON and generic rate limits to stable API envelopes", async () => {
    const app = createPhase9Api({} as Phase9ApiServices, {
      nodeEnv: "test",
      apiRateLimitMaxRequests: 1,
      authRateLimitMaxRequests: 10,
    });
    const runtime = await start(app);
    try {
      const malformed = await fetch(`${runtime.baseUrl}/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({
        error: { code: "VALIDATION_FAILED", message: "Request body is malformed" },
      });
      const limited = await fetch(`${runtime.baseUrl}/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).not.toBeNull();
      expect(await limited.json()).toMatchObject({ error: { code: "API_RATE_LIMITED" } });
    } finally {
      await runtime.close();
    }
  });

  it("aggregates queue, budget, failure, and forecast drift without tenant labels", async () => {
    const client = {
      outboxEvent: {
        groupBy: async () => [
          { status: "PENDING", _count: { _all: 4 } },
          { status: "DEAD_LETTER", _count: { _all: 1 } },
        ],
      },
      fileAsset: {
        groupBy: async () => [{ status: "QUARANTINED", _count: { _all: 2 } }],
      },
      reviewTask: { count: async () => 5 },
      agentUsageBudget: { aggregate: async () => ({ _sum: { usedMicroUsd: 900 } }) },
      agentRun: {
        aggregate: async () => ({
          _sum: { inputTokens: 100, outputTokens: 20, estimatedCostMicroUsd: 300 },
          _count: { _all: 6 },
        }),
        groupBy: async () => [
          { failureCategory: "IMAGE_DECODE_FAILED", _count: { _all: 2 } },
          { failureCategory: "QUANTITY_VALIDATION_FAILED", _count: { _all: 3 } },
        ],
      },
      forecastSnapshot: {
        findMany: async () => [
          { projectId: "secret-project-a", delayDays: { toString: () => "10" } },
          { projectId: "secret-project-b", delayDays: { toString: () => "2" } },
          { projectId: "secret-project-a", delayDays: { toString: () => "7" } },
          { projectId: "secret-project-b", delayDays: { toString: () => "4" } },
        ],
      },
    } as unknown as PrismaClient;
    const gauges = await collectPhase11OperationalGauges(
      client,
      new Date("2026-08-04T00:00:00.000Z"),
    );
    expect(gauges).toMatchObject({
      outbox_pending: 4,
      outbox_dead_letter: 1,
      artifact_quarantined: 2,
      review_backlog: 5,
      agent_monthly_cost_micro_usd: 900,
      agent_image_failures_24h: 2,
      agent_quantity_failures_24h: 3,
      forecast_drift_project_count: 2,
      forecast_drift_days_average: 2.5,
      forecast_drift_days_max: 3,
    });
    expect(JSON.stringify(gauges)).not.toContain("secret-project");
  });
});
