import { describe, expect, it } from "vitest";
import { createPhase9Api } from "../../src/backend/api.js";
import { PlatformAlertEvaluator } from "../../src/backend/platform-alert-evaluator.js";
import { PlatformIncidentService } from "../../src/backend/platform-incident-service.js";
import {
  InMemoryPlatformIncidentStore,
  type PlatformIncidentRecord,
} from "../../src/backend/platform-incident-store.js";
import type { PlatformOverviewAttentionItem } from "../../src/backend/platform-overview-contracts.js";
import type { PlatformOverviewSignalSnapshot } from "../../src/backend/platform-overview-service.js";
import { platformOverviewSignalId } from "../../src/backend/platform-overview-signals.js";
import { InMemoryPlatformStore } from "../../src/backend/platform-store.js";
import { hashPhase9Password } from "../../src/backend/security.js";
import type { PlatformAuthenticatedPrincipal } from "../../src/backend/platform-contracts.js";
import {
  loginPhase9,
  phase9TestPassword,
  startPhase9TestServer,
} from "./phase9-fixtures.js";
import { buildPlatformTestFixture, loginPlatform } from "./platform-fixtures.js";

const AS_OF = new Date("2026-08-11T04:00:00.000Z");
const SECRET_SENTINEL = "super-secret-incident-sentinel";

function scopeOf(overrides: Partial<PlatformOverviewAttentionItem["scope"]> = {}) {
  return {
    tenantId: "tenant-alpha",
    tenantName: "Alpha",
    agentType: null,
    component: null,
    ...overrides,
  };
}

function signal(
  overrides: Partial<PlatformOverviewAttentionItem> = {},
): PlatformOverviewAttentionItem {
  const ruleKey = overrides.ruleKey ?? "REVIEW_SLA_BREACH";
  const scope = overrides.scope ?? scopeOf();
  return {
    signalId: platformOverviewSignalId(ruleKey, scope),
    incidentId: null,
    ruleKey,
    ruleVersion: "platform-overview-rules.v1",
    severity: "HIGH",
    state: "OPEN",
    title: "Review SLA is breached",
    impact: "Human review tasks are waiting beyond their due time.",
    scope,
    firstEvidenceAt: "2026-08-10T00:00:00.000Z",
    lastEvidenceAt: AS_OF.toISOString(),
    evidence: [
      {
        metricKey: "review_sla_breached",
        value: 2,
        unit: "tasks",
        observedAt: AS_OF.toISOString(),
      },
    ],
    recommendedAction: "Ask the tenant review owner to triage overdue tasks.",
    diagnosticsHref: "/platform/review-quality?view=backlog&sla=BREACHED",
    freshness: {
      state: "FRESH",
      source: "LIVE_QUERY",
      checkedAt: AS_OF.toISOString(),
      freshAt: AS_OF.toISOString(),
      ageSeconds: 0,
      staleAfterSeconds: 60,
      reason: null,
    },
    ...overrides,
  };
}

class StubSignalSource {
  snapshot: PlatformOverviewSignalSnapshot = {
    signals: [],
    sourcesComplete: true,
    asOf: AS_OF.toISOString(),
  };

  async evaluateSignals() {
    return structuredClone(this.snapshot);
  }
}

function evaluatorFor(source: StubSignalSource, store: InMemoryPlatformIncidentStore) {
  let counter = 0;
  return new PlatformAlertEvaluator(
    { overview: source, incidents: store },
    () => new Date(AS_OF),
    () => `correlation-${(counter += 1)}`,
  );
}

const superAdmin: PlatformAuthenticatedPrincipal = {
  principalKind: "PLATFORM",
  principalId: "platform-principal-admin",
  platformRole: "PLATFORM_SUPER_ADMIN",
  sessionId: "session-1",
  tokenVersion: 1,
};

const auditor: PlatformAuthenticatedPrincipal = {
  ...superAdmin,
  principalId: "platform-principal-auditor",
  platformRole: "PLATFORM_AUDITOR",
};

async function serviceFixture(seed: PlatformIncidentRecord[] = []) {
  const incidents = new InMemoryPlatformIncidentStore({
    incidents: seed,
    principals: {
      "platform-principal-admin": "Platform Admin",
      "platform-principal-auditor": "Platform Auditor",
      "platform-principal-operator": "Platform Operator",
    },
  });
  const audit = new InMemoryPlatformStore();
  const passwordHash = await hashPhase9Password(phase9TestPassword);
  let counter = 0;
  const service = new PlatformIncidentService(
    {
      incidents,
      audit,
      credentials: {
        passwordHash: async (principalId) =>
          principalId === superAdmin.principalId ? passwordHash : null,
      },
    },
    () => new Date(AS_OF),
    () => `generated-${(counter += 1)}`,
  );
  return { incidents, audit, service };
}

function incidentRecord(overrides: Partial<PlatformIncidentRecord> = {}): PlatformIncidentRecord {
  return {
    id: "incident-1",
    signalId: "signal-1",
    ruleKey: "REVIEW_SLA_BREACH",
    ruleVersion: "platform-overview-rules.v1",
    severity: "MEDIUM",
    state: "OPEN",
    title: "Review SLA is breached",
    impact: "Human review tasks are waiting beyond their due time.",
    recommendedAction: "Triage overdue tasks.",
    diagnosticsHref: "/platform/review-quality?view=backlog",
    tenantId: "tenant-alpha",
    tenantName: "Alpha",
    agentType: null,
    component: null,
    evidence: [
      { metricKey: "review_sla_breached", value: 2, unit: "tasks", observedAt: AS_OF.toISOString() },
    ],
    firstEvidenceAt: "2026-08-10T00:00:00.000Z",
    lastEvidenceAt: AS_OF.toISOString(),
    openedAt: "2026-08-10T00:00:00.000Z",
    acknowledgedAt: null,
    acknowledgedById: null,
    assignedToId: null,
    assignedAt: null,
    resolvedAt: null,
    resolvedById: null,
    resolutionNote: null,
    autoResolvedAt: null,
    reopenCount: 0,
    rowVersion: 1,
    ...overrides,
  };
}

const action = { correlationId: "correlation-http", idempotencyKey: "idempotency-key-1" };

describe("platform alert evaluator", () => {
  it("opens one incident per signal and deduplicates on the next evaluation", async () => {
    const source = new StubSignalSource();
    const store = new InMemoryPlatformIncidentStore();
    source.snapshot.signals = [signal(), signal({ ruleKey: "OUTBOX_DEAD_LETTER" })];

    const evaluator = evaluatorFor(source, store);
    const first = await evaluator.evaluate();
    expect(first).toMatchObject({ opened: 2, reopened: 0, autoResolved: 0, activeAfter: 2 });

    const second = await evaluator.evaluate();
    expect(second).toMatchObject({ opened: 0, refreshed: 2, activeAfter: 2 });
    expect(store.snapshot().incidents).toHaveLength(2);
  });

  it("records a severity move on the timeline instead of opening a second incident", async () => {
    const source = new StubSignalSource();
    const store = new InMemoryPlatformIncidentStore();
    source.snapshot.signals = [signal({ severity: "MEDIUM" })];
    const evaluator = evaluatorFor(source, store);
    await evaluator.evaluate();

    source.snapshot.signals = [signal({ severity: "CRITICAL" })];
    const escalated = await evaluator.evaluate();

    expect(escalated).toMatchObject({ opened: 0, severityChanged: 1 });
    const state = store.snapshot();
    expect(state.incidents[0]).toMatchObject({ severity: "CRITICAL", state: "OPEN" });
    expect(state.events.map((event) => event.type)).toEqual(["OPENED", "SEVERITY_CHANGED"]);
    expect(state.events[1]?.metadata).toMatchObject({
      fromSeverity: "MEDIUM",
      toSeverity: "CRITICAL",
      escalated: true,
    });
  });

  it("auto-resolves a signal that stopped firing and keeps its history", async () => {
    const source = new StubSignalSource();
    const store = new InMemoryPlatformIncidentStore();
    source.snapshot.signals = [signal()];
    const evaluator = evaluatorFor(source, store);
    await evaluator.evaluate();

    source.snapshot.signals = [];
    const quiet = await evaluator.evaluate();

    expect(quiet).toMatchObject({ autoResolved: 1, activeAfter: 0 });
    const state = store.snapshot();
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]).toMatchObject({ state: "RESOLVED", autoResolvedAt: expect.any(String) });
    expect(state.events.map((event) => event.type)).toEqual(["OPENED", "AUTO_RESOLVED"]);
  });

  it("reopens the original incident when the same signal fires again", async () => {
    const source = new StubSignalSource();
    const store = new InMemoryPlatformIncidentStore();
    source.snapshot.signals = [signal()];
    const evaluator = evaluatorFor(source, store);
    await evaluator.evaluate();
    source.snapshot.signals = [];
    await evaluator.evaluate();

    source.snapshot.signals = [signal()];
    const again = await evaluator.evaluate();

    expect(again).toMatchObject({ opened: 0, reopened: 1, activeAfter: 1 });
    const state = store.snapshot();
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]).toMatchObject({
      state: "REOPENED",
      reopenCount: 1,
      resolvedAt: null,
      autoResolvedAt: null,
    });
    expect(state.events.map((event) => event.type)).toEqual([
      "OPENED",
      "AUTO_RESOLVED",
      "REOPENED",
    ]);
  });

  it("refuses to auto-resolve while any source is unreadable", async () => {
    const source = new StubSignalSource();
    const store = new InMemoryPlatformIncidentStore();
    source.snapshot.signals = [signal()];
    const evaluator = evaluatorFor(source, store);
    await evaluator.evaluate();

    source.snapshot.signals = [];
    source.snapshot.sourcesComplete = false;
    const degraded = await evaluator.evaluate();

    expect(degraded).toMatchObject({ autoResolved: 0, activeAfter: 1 });
    expect(store.snapshot().incidents[0]?.state).toBe("OPEN");
  });
});

describe("platform incident service", () => {
  it("acknowledges with a reason and writes a SUCCESS audit with before/after hashes", async () => {
    const { service, incidents, audit } = await serviceFixture([incidentRecord()]);

    const result = await service.acknowledge(
      superAdmin,
      "incident-1",
      { reason: "Triaging the overdue review backlog now", rowVersion: 1 },
      action,
    );

    expect(result.incident).toMatchObject({
      state: "ACKNOWLEDGED",
      rowVersion: 2,
      acknowledgedBy: { principalId: superAdmin.principalId, displayName: "Platform Admin" },
    });
    expect(result.event).toMatchObject({ type: "ACKNOWLEDGED", fromState: "OPEN" });
    expect(result.change.idempotent).toBe(false);
    expect(result.change.beforeHash).not.toBe(result.change.afterHash);

    const auditLogs = audit.snapshot().auditLogs;
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      action: "PLATFORM_INCIDENT_ACKNOWLEDGE",
      entityType: "PLATFORM_INCIDENT",
      entityId: "incident-1",
      result: "SUCCESS",
      actorPrincipalId: superAdmin.principalId,
      correlationId: "correlation-http",
    });
    expect(incidents.snapshot().events).toHaveLength(1);
  });

  it("replays a retried request instead of appending a second transition", async () => {
    const { service, incidents } = await serviceFixture([incidentRecord()]);
    const body = { reason: "Triaging the overdue review backlog now", rowVersion: 1 };

    const first = await service.acknowledge(superAdmin, "incident-1", body, action);
    const replay = await service.acknowledge(superAdmin, "incident-1", body, action);

    expect(first.change.idempotent).toBe(false);
    expect(replay.change.idempotent).toBe(true);
    expect(replay.incident.rowVersion).toBe(2);
    expect(incidents.snapshot().events).toHaveLength(1);
  });

  it("rejects a stale rowVersion instead of overwriting a concurrent change", async () => {
    const { service } = await serviceFixture([incidentRecord({ rowVersion: 3 })]);

    await expect(
      service.acknowledge(
        superAdmin,
        "incident-1",
        { reason: "Working the overdue review backlog", rowVersion: 1 },
        action,
      ),
    ).rejects.toMatchObject({ code: "OPTIMISTIC_LOCK_CONFLICT", status: 409 });
  });

  it("denies an auditor and records the denial in the audit trail", async () => {
    const { service, audit, incidents } = await serviceFixture([incidentRecord()]);

    await expect(
      service.acknowledge(
        auditor,
        "incident-1",
        { reason: "Attempting to acknowledge without permission", rowVersion: 1 },
        action,
      ),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN", status: 403 });

    expect(audit.snapshot().auditLogs[0]).toMatchObject({
      action: "PLATFORM_INCIDENT_ACKNOWLEDGE",
      result: "DENIED",
      actorPrincipalId: auditor.principalId,
    });
    expect(incidents.snapshot().events).toHaveLength(0);
  });

  it("assigns an owner and refuses an unknown assignee", async () => {
    const { service } = await serviceFixture([incidentRecord()]);

    const assigned = await service.assign(
      superAdmin,
      "incident-1",
      {
        reason: "Handing the backlog to the on-call operator",
        rowVersion: 1,
        assigneePrincipalId: "platform-principal-operator",
      },
      action,
    );
    expect(assigned.incident.assignedTo).toMatchObject({
      principalId: "platform-principal-operator",
      displayName: "Platform Operator",
    });

    await expect(
      service.assign(
        superAdmin,
        "incident-1",
        {
          reason: "Handing the backlog to a stranger",
          rowVersion: 2,
          assigneePrincipalId: "not-a-principal",
        },
        { ...action, idempotencyKey: "idempotency-key-2" },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
  });

  it("requires a step-up password before resolving a high-severity incident", async () => {
    const { service, audit } = await serviceFixture([incidentRecord({ severity: "CRITICAL" })]);
    const body = {
      reason: "Provider recovered and the backlog drained",
      rowVersion: 1,
      resolutionNote: "Provider capacity restored; backlog cleared.",
    };

    await expect(service.resolve(superAdmin, "incident-1", body, action)).rejects.toMatchObject({
      code: "AUTH_FORBIDDEN",
      status: 403,
    });
    await expect(
      service.resolve(
        superAdmin,
        "incident-1",
        { ...body, stepUpPassword: `${SECRET_SENTINEL}-wrong` },
        { ...action, idempotencyKey: "idempotency-key-2" },
      ),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN", status: 403 });

    const denials = audit.snapshot().auditLogs.filter((log) => log.result === "DENIED");
    expect(denials).toHaveLength(2);
    expect(denials.every((log) => log.action === "PLATFORM_INCIDENT_RESOLVE")).toBe(true);
    expect(JSON.stringify(denials)).not.toContain(SECRET_SENTINEL);

    const resolved = await service.resolve(
      superAdmin,
      "incident-1",
      { ...body, stepUpPassword: phase9TestPassword },
      { ...action, idempotencyKey: "idempotency-key-3" },
    );
    expect(resolved.incident).toMatchObject({
      state: "RESOLVED",
      autoResolved: false,
      resolutionNote: "Provider capacity restored; backlog cleared.",
    });
  });

  it("resolves a medium incident without a step-up and blocks acting on it afterwards", async () => {
    const { service } = await serviceFixture([incidentRecord()]);

    const resolved = await service.resolve(
      superAdmin,
      "incident-1",
      {
        reason: "Backlog drained after the tenant triaged it",
        rowVersion: 1,
        resolutionNote: "Tenant cleared the overdue tasks.",
      },
      action,
    );
    expect(resolved.incident.state).toBe("RESOLVED");

    await expect(
      service.acknowledge(
        superAdmin,
        "incident-1",
        { reason: "Trying to acknowledge a resolved incident", rowVersion: 2 },
        { ...action, idempotencyKey: "idempotency-key-2" },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("lists active incidents by default and exposes the timeline on the detail", async () => {
    const { service, incidents } = await serviceFixture([
      incidentRecord(),
      incidentRecord({ id: "incident-2", signalId: "signal-2", state: "RESOLVED" }),
    ]);
    await service.acknowledge(
      superAdmin,
      "incident-1",
      { reason: "Taking ownership of the review backlog", rowVersion: 1 },
      action,
    );

    const list = await service.list(superAdmin, {});
    expect(list.items.map((item) => item.incidentId)).toEqual(["incident-1"]);
    expect(list.filters.activeOnly).toBe(true);
    expect(list.totals).toMatchObject({ acknowledged: 1, resolved: 1 });

    const all = await service.list(superAdmin, { activeOnly: "false" });
    expect(all.items).toHaveLength(2);

    const detail = await service.detail(superAdmin, "incident-1");
    expect(detail.timeline.items.map((event) => event.type)).toEqual(["ACKNOWLEDGED"]);
    expect(detail.allowedActions).toEqual(["ASSIGN", "RESOLVE"]);
    expect(detail.resolveRequiresStepUp).toBe(false);
    expect(incidents.snapshot().events).toHaveLength(1);
  });

  it("offers no actions to a read-only auditor", async () => {
    const { service } = await serviceFixture([incidentRecord()]);

    const detail = await service.detail(auditor, "incident-1");

    expect(detail.allowedActions).toEqual([]);
  });

  it("404s an unknown incident", async () => {
    const { service } = await serviceFixture();

    await expect(service.detail(superAdmin, "incident-missing")).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      status: 404,
    });
  });
});

describe("platform incident boundary", () => {
  async function buildApi() {
    const fixture = await buildPlatformTestFixture();
    const { service } = await serviceFixture([incidentRecord()]);
    const app = createPhase9Api({
      auth: fixture.tenant.auth,
      platformAuth: fixture.platformAuth,
      platformIncidents: service,
      projects: fixture.tenant.projects,
      commands: fixture.tenant.commands,
      reviews: fixture.tenant.reviews,
      artifacts: fixture.tenant.artifacts,
      objectStore: fixture.tenant.objectStore,
    });
    return startPhase9TestServer(app);
  }

  it("denies a Company Admin on every incident route", async () => {
    const runtime = await buildApi();
    try {
      const companyAdmin = await loginPhase9(runtime.baseUrl, "alpha", "admin@alpha.test");
      const headers = {
        authorization: `Bearer ${companyAdmin.accessToken}`,
        "content-type": "application/json",
        "idempotency-key": "idempotency-key-http",
      };
      const responses = await Promise.all([
        fetch(`${runtime.baseUrl}/platform/v1/incidents`, { headers }),
        fetch(`${runtime.baseUrl}/platform/v1/incidents/incident-1`, { headers }),
        fetch(`${runtime.baseUrl}/platform/v1/incidents/incident-1/acknowledge`, {
          method: "POST",
          headers,
          body: JSON.stringify({ reason: "Company admin should not reach this", rowVersion: 1 }),
        }),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: "AUTH_FORBIDDEN" } });
      }
    } finally {
      await runtime.close();
    }
  });

  it("requires an Idempotency-Key on every incident mutation", async () => {
    const runtime = await buildApi();
    try {
      const platform = await loginPlatform(runtime.baseUrl);
      const response = await fetch(
        `${runtime.baseUrl}/platform/v1/incidents/incident-1/acknowledge`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${platform.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ reason: "Missing the idempotency header", rowVersion: 1 }),
        },
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "IDEMPOTENCY_KEY_REQUIRED" },
      });
    } finally {
      await runtime.close();
    }
  });

  it("serves the incident lifecycle over HTTP and publishes its OpenAPI paths", async () => {
    const runtime = await buildApi();
    try {
      const platform = await loginPlatform(runtime.baseUrl);
      const headers = {
        authorization: `Bearer ${platform.accessToken}`,
        "content-type": "application/json",
        "idempotency-key": "idempotency-key-http",
      };
      const acknowledged = await fetch(
        `${runtime.baseUrl}/platform/v1/incidents/incident-1/acknowledge`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ reason: "Taking ownership over HTTP", rowVersion: 1 }),
        },
      );
      expect(acknowledged.status).toBe(200);
      expect(await acknowledged.json()).toMatchObject({
        schemaVersion: "platform-incident-mutation.v1",
        incident: { state: "ACKNOWLEDGED" },
      });

      const document = (await (await fetch(`${runtime.baseUrl}/openapi.json`)).json()) as {
        paths: Record<string, unknown>;
      };
      expect(Object.keys(document.paths)).toEqual(
        expect.arrayContaining([
          "/platform/v1/incidents",
          "/platform/v1/incidents/{incidentId}",
          "/platform/v1/incidents/{incidentId}/acknowledge",
          "/platform/v1/incidents/{incidentId}/assign",
          "/platform/v1/incidents/{incidentId}/resolve",
        ]),
      );
    } finally {
      await runtime.close();
    }
  });
});
