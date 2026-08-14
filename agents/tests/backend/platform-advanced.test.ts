import { describe, expect, it } from "vitest";
import { createPhase9Api } from "../../src/backend/api.js";
import { PlatformQualityService } from "../../src/backend/platform-quality-service.js";
import type {
  PlatformQualityData,
  PlatformQualityRange,
  PlatformQualityReadModel,
} from "../../src/backend/platform-quality-read-model.js";
import { PlatformSupportAccessService } from "../../src/backend/platform-support-access-service.js";
import {
  InMemoryPlatformSupportAccessStore,
  isSupportAccessActive,
  type PlatformSupportAccessGrantRecord,
} from "../../src/backend/platform-support-access-store.js";
import { InMemoryPlatformStore } from "../../src/backend/platform-store.js";
import type { PlatformAuthenticatedPrincipal } from "../../src/backend/platform-contracts.js";
import { loginPhase9, startPhase9TestServer } from "./phase9-fixtures.js";
import { buildPlatformTestFixture, loginPlatform } from "./platform-fixtures.js";

const AS_OF = new Date("2026-08-11T04:00:00.000Z");
const SECRET_SENTINEL = "super-secret-advanced-sentinel";

/* ------------------------------- AI quality ------------------------------ */

function emptyQuality(): PlatformQualityData {
  return { offline: [], production: [], humanFeedback: [], history: [] };
}

class StubQualityReadModel implements PlatformQualityReadModel {
  data: PlatformQualityData = emptyQuality();
  failure: unknown = null;
  lastRange: PlatformQualityRange | null = null;

  async queryQuality(range: PlatformQualityRange, _agentType: string | null) {
    this.lastRange = range;
    if (this.failure !== null) throw this.failure;
    return { data: this.data, source: "LIVE_QUERY" as const, freshAt: new Date(AS_OF) };
  }
}

function qualityServiceFor(readModel: StubQualityReadModel) {
  return new PlatformQualityService(readModel, () => new Date(AS_OF));
}

describe("platform AI quality", () => {
  it("publishes three separate metrics and never a blended score", async () => {
    const readModel = new StubQualityReadModel();
    readModel.data = {
      offline: [
        {
          agentType: "A1_PROGRESS",
          agentRelease: null,
          caseCount: 120,
          passedCount: 108,
          runCount: 4,
          previousCaseCount: 100,
          previousPassedCount: 85,
          latestCompletedAt: new Date("2026-08-10T00:00:00.000Z"),
          suiteKey: "a1-regression",
          suiteVersion: "2026.08",
        },
      ],
      production: [
        {
          agentType: "A1_PROGRESS",
          agentRelease: null,
          promptVersion: null,
          modelId: null,
          provider: null,
          evaluated: 200,
          passed: 190,
          previousEvaluated: 180,
          previousPassed: 162,
          runs: 220,
          firstSeenAt: new Date("2026-08-05T00:00:00.000Z"),
          lastSeenAt: new Date("2026-08-11T03:00:00.000Z"),
        },
      ],
      humanFeedback: [
        {
          agentType: "A1_PROGRESS",
          agentRelease: null,
          reviewed: 60,
          accepted: 48,
          previousReviewed: 50,
          previousAccepted: 45,
          lastReviewedAt: new Date("2026-08-11T02:00:00.000Z"),
        },
      ],
      history: [],
    };

    const response = await qualityServiceFor(readModel).quality({});

    expect(response.metrics.items.map((item) => item.kind)).toEqual([
      "OFFLINE_EVALUATION",
      "PRODUCTION_VALIDATION",
      "HUMAN_FEEDBACK",
    ]);
    const [offline, production, human] = response.metrics.items;
    expect(offline).toMatchObject({
      state: "AVAILABLE",
      valuePercent: 90,
      sampleSize: 120,
      previousValuePercent: 85,
      deltaPercentagePoints: 5,
      source: "a1-regression@2026.08",
    });
    expect(production).toMatchObject({ state: "AVAILABLE", valuePercent: 95, sampleSize: 200 });
    expect(human).toMatchObject({ state: "AVAILABLE", valuePercent: 80, sampleSize: 60 });
    // Nothing anywhere in the response combines the three into one figure.
    expect(JSON.stringify(response)).not.toContain("qualityScore");
    expect(response.metrics.items.every((item) => item.definition.length > 0)).toBe(true);
  });

  it("withholds a percentage below the minimum sample", async () => {
    const readModel = new StubQualityReadModel();
    readModel.data = {
      ...emptyQuality(),
      offline: [
        {
          agentType: "A2_FORECAST",
          agentRelease: null,
          caseCount: 3,
          passedCount: 2,
          runCount: 1,
          previousCaseCount: 0,
          previousPassedCount: 0,
          latestCompletedAt: new Date("2026-08-10T00:00:00.000Z"),
          suiteKey: "a2-regression",
          suiteVersion: "2026.08",
        },
      ],
    };

    const response = await qualityServiceFor(readModel).quality({});

    const offline = response.metrics.items.find((item) => item.kind === "OFFLINE_EVALUATION");
    expect(offline).toMatchObject({
      state: "INSUFFICIENT_SAMPLE",
      valuePercent: null,
      sampleSize: 3,
      minimumSample: 20,
    });
    expect(response.byAgent.items[0]?.offline?.valuePercent).toBeNull();
  });

  it("reports NO_DATA rather than a zero score when nothing was measured", async () => {
    const response = await qualityServiceFor(new StubQualityReadModel()).quality({});

    for (const item of response.metrics.items) {
      expect(item.state).toBe("NO_DATA");
      expect(item.valuePercent).toBeNull();
    }
    expect(response.releases.items).toEqual([]);
  });

  it("compares agent releases on the same three metrics", async () => {
    const readModel = new StubQualityReadModel();
    readModel.data = {
      offline: [
        {
          agentType: "A1_PROGRESS",
          agentRelease: "a1.v3+tools.v2",
          caseCount: 100,
          passedCount: 95,
          runCount: 2,
          previousCaseCount: 0,
          previousPassedCount: 0,
          latestCompletedAt: new Date("2026-08-10T00:00:00.000Z"),
          suiteKey: "a1-regression",
          suiteVersion: "2026.08",
        },
      ],
      production: [
        {
          agentType: "A1_PROGRESS",
          agentRelease: "a1.v3+tools.v2",
          promptVersion: "a1.v3",
          modelId: "claude-sonnet-5",
          provider: "anthropic",
          evaluated: 120,
          passed: 114,
          previousEvaluated: 0,
          previousPassed: 0,
          runs: 130,
          firstSeenAt: new Date("2026-08-08T00:00:00.000Z"),
          lastSeenAt: new Date("2026-08-11T03:00:00.000Z"),
        },
        {
          agentType: "A1_PROGRESS",
          agentRelease: "a1.v2+tools.v1",
          promptVersion: "a1.v2",
          modelId: "claude-sonnet-5",
          provider: "anthropic",
          evaluated: 90,
          passed: 72,
          previousEvaluated: 0,
          previousPassed: 0,
          runs: 95,
          firstSeenAt: new Date("2026-08-01T00:00:00.000Z"),
          lastSeenAt: new Date("2026-08-07T00:00:00.000Z"),
        },
      ],
      humanFeedback: [],
      history: [],
    };

    const response = await qualityServiceFor(readModel).quality({ window: "30d" });

    expect(response.releases.items.map((item) => item.agentRelease)).toEqual([
      "a1.v3+tools.v2",
      "a1.v2+tools.v1",
    ]);
    expect(response.releases.items[0]).toMatchObject({
      promptVersion: "a1.v3",
      modelId: "claude-sonnet-5",
      runs: 130,
    });
    expect(response.releases.items[0]?.production?.valuePercent).toBe(95);
    expect(response.releases.items[0]?.offline?.valuePercent).toBe(95);
    expect(response.releases.items[1]?.production?.valuePercent).toBe(80);
    // The newer release has no human feedback rows, which is null not zero.
    expect(response.releases.items[0]?.humanFeedback).toBeNull();
  });

  it("lists persisted evaluation history and scores only a large enough suite", async () => {
    const readModel = new StubQualityReadModel();
    readModel.data = {
      ...emptyQuality(),
      history: [
        {
          id: "eval-large",
          suiteKey: "a1-regression",
          suiteVersion: "2026.08",
          agentType: "A1_PROGRESS",
          agentRelease: "a1.v3+tools.v2",
          caseCount: 100,
          passedCount: 91,
          failedCount: 9,
          skippedCount: 0,
          completedAt: new Date("2026-08-10T00:00:00.000Z"),
          sourceRef: "ci-1234",
        },
        {
          id: "eval-small",
          suiteKey: "a1-smoke",
          suiteVersion: "2026.08",
          agentType: "A1_PROGRESS",
          agentRelease: "a1.v3+tools.v2",
          caseCount: 4,
          passedCount: 4,
          failedCount: 0,
          skippedCount: 0,
          completedAt: new Date("2026-08-09T00:00:00.000Z"),
          sourceRef: null,
        },
      ],
    };

    const response = await qualityServiceFor(readModel).quality({});

    expect(response.evaluationHistory.items[0]).toMatchObject({
      runId: "eval-large",
      scorePercent: 91,
      sourceRef: "ci-1234",
    });
    expect(response.evaluationHistory.items[1]?.scorePercent).toBeNull();
  });

  it("degrades to UNKNOWN and sanitizes the error when the source rejects", async () => {
    const readModel = new StubQualityReadModel();
    readModel.failure = new Error(`quality store password=${SECRET_SENTINEL}`);

    const response = await qualityServiceFor(readModel).quality({});
    const serialized = JSON.stringify(response);

    expect(response.partial).toBe(true);
    expect(response.problems[0]).toMatchObject({ code: "SOURCE_UNAVAILABLE", retryable: true });
    for (const item of response.metrics.items) {
      expect(item.state).toBe("UNKNOWN");
      expect(item.valuePercent).toBeNull();
    }
    expect(serialized).not.toContain(SECRET_SENTINEL);
  });

  it("uses the previous equal-length window as the comparison baseline", async () => {
    const readModel = new StubQualityReadModel();

    await qualityServiceFor(readModel).quality({ window: "7d" });

    const range = readModel.lastRange!;
    expect(range.to.getTime() - range.from.getTime()).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(range.from.getTime() - range.previousFrom.getTime()).toBe(7 * 24 * 60 * 60 * 1_000);
  });
});

/* ----------------------------- Support access ---------------------------- */

const requester: PlatformAuthenticatedPrincipal = {
  principalKind: "PLATFORM",
  principalId: "platform-principal-admin",
  platformRole: "PLATFORM_SUPER_ADMIN",
  sessionId: "session-1",
  tokenVersion: 1,
};

const approver: PlatformAuthenticatedPrincipal = {
  ...requester,
  principalId: "platform-principal-second",
};

const operator: PlatformAuthenticatedPrincipal = {
  ...requester,
  principalId: "platform-principal-operator",
  platformRole: "PLATFORM_OPERATOR",
};

function grantRecord(
  overrides: Partial<PlatformSupportAccessGrantRecord> = {},
): PlatformSupportAccessGrantRecord {
  return {
    id: "grant-1",
    ticketReference: "SUP-1042",
    reason: "Investigating stalled outbox delivery reported by the tenant",
    tenantId: "tenant-alpha",
    tenantName: "Alpha",
    projectId: null,
    allowedOperations: ["READ_TENANT_HEALTH", "READ_SYSTEM_HEALTH"],
    maskedOnly: true,
    state: "REQUESTED",
    requestedById: requester.principalId,
    requestedAt: new Date(AS_OF.getTime() - 60_000).toISOString(),
    approvedById: null,
    approvedAt: null,
    startsAt: null,
    expiresAt: new Date(AS_OF.getTime() + 3_600_000).toISOString(),
    decisionReason: null,
    revokedById: null,
    revokedAt: null,
    useCount: 0,
    lastUsedAt: null,
    rowVersion: 1,
    ...overrides,
  };
}

function supportFixture(seed: PlatformSupportAccessGrantRecord[] = []) {
  const grants = new InMemoryPlatformSupportAccessStore({
    grants: seed,
    principals: {
      "platform-principal-admin": "Platform Admin",
      "platform-principal-second": "Second Approver",
      "platform-principal-operator": "Platform Operator",
    },
    tenants: ["tenant-alpha"],
  });
  const audit = new InMemoryPlatformStore();
  let counter = 0;
  const service = new PlatformSupportAccessService(
    { grants, audit },
    () => new Date(AS_OF),
    () => `generated-${(counter += 1)}`,
  );
  return { grants, audit, service };
}

const action = { correlationId: "correlation-support", idempotencyKey: "idempotency-support-1" };
const decision = { reason: "Verified the ticket with the tenant owner", rowVersion: 1 };

describe("platform support diagnostic access", () => {
  it("records a scoped, read-only, time-boxed request with an audit entry", async () => {
    const { service, audit, grants } = supportFixture();

    const result = await service.request(
      requester,
      {
        ticketReference: "SUP-1042",
        reason: "Investigating stalled outbox delivery reported by the tenant",
        tenantId: "tenant-alpha",
        allowedOperations: ["READ_TENANT_HEALTH", "READ_SYSTEM_HEALTH"],
        durationSeconds: 3_600,
      },
      action,
    );

    expect(result.grant).toMatchObject({
      state: "REQUESTED",
      active: false,
      maskedOnly: true,
      tenantId: "tenant-alpha",
      allowedOperations: ["READ_TENANT_HEALTH", "READ_SYSTEM_HEALTH"],
    });
    expect(result.grant.expiresInSeconds).toBe(3_600);
    expect(audit.snapshot().auditLogs[0]).toMatchObject({
      action: "PLATFORM_SUPPORT_ACCESS_REQUEST",
      entityType: "PLATFORM_SUPPORT_ACCESS",
      result: "SUCCESS",
    });
    expect(grants.snapshot().events[0]).toMatchObject({ type: "REQUESTED", toState: "REQUESTED" });
  });

  it("refuses a request for an unknown tenant", async () => {
    const { service } = supportFixture();

    await expect(
      service.request(
        requester,
        {
          ticketReference: "SUP-1",
          reason: "Investigating something on a tenant that does not exist",
          tenantId: "tenant-missing",
          allowedOperations: ["READ_TENANT_HEALTH"],
          durationSeconds: 900,
        },
        action,
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404 });
  });

  it("blocks self-approval and records the refusal", async () => {
    const { service, audit } = supportFixture([grantRecord()]);

    await expect(service.approve(requester, "grant-1", decision, action)).rejects.toMatchObject({
      code: "SELF_APPROVAL_FORBIDDEN",
      status: 403,
    });

    const denied = audit.snapshot().auditLogs.filter((log) => log.result === "DENIED");
    expect(denied).toHaveLength(1);
    expect(denied[0]?.reason).toContain("Two-person approval");
  });

  it("approves through a second principal and activates the window", async () => {
    const { service, grants, audit } = supportFixture([grantRecord()]);

    const result = await service.approve(approver, "grant-1", decision, action);

    expect(result.grant).toMatchObject({
      state: "APPROVED",
      active: true,
      approvedBy: { principalId: approver.principalId, displayName: "Second Approver" },
    });
    expect(result.change.beforeHash).not.toBe(result.change.afterHash);
    expect(grants.snapshot().events.map((event) => event.type)).toEqual(["APPROVED"]);
    expect(audit.snapshot().auditLogs[0]).toMatchObject({
      action: "PLATFORM_SUPPORT_ACCESS_APPROVE",
      result: "SUCCESS",
    });
  });

  it("treats an approved grant past its deadline as expired without a worker", async () => {
    const expired = grantRecord({
      state: "APPROVED",
      approvedById: approver.principalId,
      approvedAt: new Date(AS_OF.getTime() - 7_200_000).toISOString(),
      startsAt: new Date(AS_OF.getTime() - 7_200_000).toISOString(),
      expiresAt: new Date(AS_OF.getTime() - 60_000).toISOString(),
      rowVersion: 2,
    });
    const { service } = supportFixture([expired]);

    expect(isSupportAccessActive(expired, AS_OF)).toBe(false);
    const detail = await service.detail(requester, "grant-1");
    expect(detail.grant).toMatchObject({ state: "EXPIRED", active: false });
    expect(detail.grant.expiresInSeconds).toBeLessThan(0);
    expect(detail.allowedActions).toEqual([]);

    await expect(
      service.revoke(approver, "grant-1", { ...decision, rowVersion: 2 }, action),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("revokes an active grant before expiry", async () => {
    const active = grantRecord({
      state: "APPROVED",
      approvedById: approver.principalId,
      approvedAt: new Date(AS_OF.getTime() - 60_000).toISOString(),
      startsAt: new Date(AS_OF.getTime() - 60_000).toISOString(),
      rowVersion: 2,
    });
    const { service } = supportFixture([active]);

    const result = await service.revoke(
      approver,
      "grant-1",
      { reason: "Ticket resolved earlier than expected", rowVersion: 2 },
      action,
    );

    expect(result.grant).toMatchObject({ state: "REVOKED", active: false });
    expect(result.event).toMatchObject({ type: "REVOKED", fromState: "APPROVED" });
  });

  it("replays a retried decision instead of recording a second one", async () => {
    const { service, grants } = supportFixture([grantRecord()]);

    const first = await service.approve(approver, "grant-1", decision, action);
    const replay = await service.approve(approver, "grant-1", decision, action);

    expect(first.change.idempotent).toBe(false);
    expect(replay.change.idempotent).toBe(true);
    expect(grants.snapshot().events).toHaveLength(1);
  });

  it("rejects a stale rowVersion", async () => {
    const { service } = supportFixture([grantRecord({ rowVersion: 4 })]);

    await expect(service.approve(approver, "grant-1", decision, action)).rejects.toMatchObject({
      code: "OPTIMISTIC_LOCK_CONFLICT",
      status: 409,
    });
  });

  it("denies an operator without the support grant permission and audits it", async () => {
    const { service, audit } = supportFixture([grantRecord()]);

    await expect(service.approve(operator, "grant-1", decision, action)).rejects.toMatchObject({
      code: "AUTH_FORBIDDEN",
      status: 403,
    });
    expect(audit.snapshot().auditLogs[0]).toMatchObject({
      action: "PLATFORM_SUPPORT_ACCESS_APPROVE",
      result: "DENIED",
    });
  });

  it("hides the approve action from the requester on the detail view", async () => {
    const { service } = supportFixture([grantRecord()]);

    const asRequester = await service.detail(requester, "grant-1");
    const asApprover = await service.detail(approver, "grant-1");

    expect(asRequester.canApprove).toBe(false);
    expect(asRequester.allowedActions).toEqual(["DENY"]);
    expect(asApprover.canApprove).toBe(true);
    expect(asApprover.allowedActions).toEqual(["APPROVE", "DENY"]);
  });

  it("counts an approved but elapsed grant as expired in the totals", async () => {
    const { service } = supportFixture([
      grantRecord({ id: "grant-open" }),
      grantRecord({
        id: "grant-active",
        state: "APPROVED",
        approvedById: approver.principalId,
        startsAt: new Date(AS_OF.getTime() - 60_000).toISOString(),
        rowVersion: 2,
      }),
      grantRecord({
        id: "grant-elapsed",
        state: "APPROVED",
        approvedById: approver.principalId,
        startsAt: new Date(AS_OF.getTime() - 7_200_000).toISOString(),
        expiresAt: new Date(AS_OF.getTime() - 60_000).toISOString(),
        rowVersion: 2,
      }),
    ]);

    const list = await service.list(requester, {});

    expect(list.totals).toMatchObject({ requested: 1, active: 1, expired: 1 });
    const activeOnly = await service.list(requester, { activeOnly: "true" });
    expect(activeOnly.items.map((item) => item.grantId)).toEqual(["grant-active"]);
  });
});

describe("platform advanced boundary", () => {
  it("denies a Company Admin on quality and support access routes", async () => {
    const fixture = await buildPlatformTestFixture();
    const { service } = supportFixture([grantRecord()]);
    const app = createPhase9Api({
      auth: fixture.tenant.auth,
      platformAuth: fixture.platformAuth,
      platformQuality: qualityServiceFor(new StubQualityReadModel()),
      platformSupportAccess: service,
      projects: fixture.tenant.projects,
      commands: fixture.tenant.commands,
      reviews: fixture.tenant.reviews,
      artifacts: fixture.tenant.artifacts,
      objectStore: fixture.tenant.objectStore,
    });
    const runtime = await startPhase9TestServer(app);
    try {
      const companyAdmin = await loginPhase9(runtime.baseUrl, "alpha", "admin@alpha.test");
      const headers = {
        authorization: `Bearer ${companyAdmin.accessToken}`,
        "content-type": "application/json",
        "idempotency-key": "idempotency-http-1",
      };
      for (const path of [
        "/platform/v1/quality",
        "/platform/v1/support-access",
        "/platform/v1/support-access/grant-1",
      ]) {
        const response = await fetch(`${runtime.baseUrl}${path}`, { headers });
        expect(response.status, path).toBe(403);
      }

      const platform = await loginPlatform(runtime.baseUrl);
      for (const path of ["/platform/v1/quality", "/platform/v1/support-access"]) {
        const allowed = await fetch(`${runtime.baseUrl}${path}`, {
          headers: { authorization: `Bearer ${platform.accessToken}` },
        });
        expect(allowed.status, path).toBe(200);
      }

      const document = (await (await fetch(`${runtime.baseUrl}/openapi.json`)).json()) as {
        paths: Record<string, unknown>;
      };
      expect(Object.keys(document.paths)).toEqual(
        expect.arrayContaining([
          "/platform/v1/quality",
          "/platform/v1/support-access",
          "/platform/v1/support-access/{grantId}",
          "/platform/v1/support-access/{grantId}/approve",
          "/platform/v1/support-access/{grantId}/deny",
          "/platform/v1/support-access/{grantId}/revoke",
        ]),
      );
    } finally {
      await runtime.close();
    }
  });
});
