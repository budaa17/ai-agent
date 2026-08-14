import type { PgBoss } from "pg-boss";
import {
  InMemoryPhase9Store,
  PgBossPhase9EventPublisher,
  Phase9AgentAdapterRegistry,
  Phase9OutboxRelay,
  consumePhase9Event,
  createPhase9CanonicalAgentAdapterRegistry,
  createPhase9NotificationForEvent,
  phase9AgentAdapterNameSchema,
  phase9JobDefinitions,
  registerPhase9JobWorkers,
  type Phase9OutboxRecord,
} from "../../src/backend/index.js";
import { AGENT_QUEUE_NAMES, PHASE9_JOB_QUEUE_NAMES } from "../../src/jobs/queue-names.js";

function outbox(overrides: Partial<Phase9OutboxRecord> = {}): Phase9OutboxRecord {
  return {
    id: "event-phase9-001",
    tenantId: "tenant-alpha",
    projectId: "project-alpha-main",
    eventType: "PROJECT_EXECUTION_APPROVED",
    aggregateType: "DAILY_REPORT",
    aggregateId: "report-alpha-001",
    aggregateVersion: 1,
    idempotencyKey: "outbox:tenant-alpha:report-alpha-001",
    payload: { reportId: "report-alpha-001" },
    headers: { correlationId: "event-correlation" },
    status: "PENDING",
    availableAt: "2026-08-03T08:00:00.000Z",
    publishedAt: null,
    retryCount: 0,
    lastErrorCode: null,
    lockedAt: null,
    lockedBy: null,
    createdAt: "2026-08-03T08:00:00.000Z",
    ...overrides,
  };
}

describe("BuildWatch Phase 9 outbox, replay, and production jobs", () => {
  it("retries a failed publish and marks the replay published", async () => {
    let current = new Date("2026-08-03T08:00:00.000Z");
    let attempts = 0;
    const store = new InMemoryPhase9Store({ outboxEvents: [outbox()] });
    const relay = new Phase9OutboxRelay(
      store,
      {
        publish: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("temporary broker failure");
        },
      },
      { now: () => new Date(current), baseRetryMs: 1_000 },
    );
    expect(await relay.processBatch()).toMatchObject({ claimed: 1, failed: 1 });
    expect(store.snapshot().outboxEvents[0]).toMatchObject({
      status: "FAILED",
      retryCount: 1,
      lockedAt: null,
    });
    current = new Date("2026-08-03T08:00:02.000Z");
    expect(await relay.processBatch()).toMatchObject({ claimed: 1, published: 1 });
    expect(store.snapshot().outboxEvents[0]).toMatchObject({
      status: "PUBLISHED",
      retryCount: 1,
      lockedAt: null,
    });
  });

  it("recovers a stale lock after worker restart", async () => {
    const store = new InMemoryPhase9Store({
      outboxEvents: [
        outbox({
          lockedAt: "2026-08-03T07:50:00.000Z",
          lockedBy: "crashed-worker",
        }),
      ],
    });
    const published: string[] = [];
    const relay = new Phase9OutboxRelay(
      store,
      { publish: async (event) => void published.push(event.id) },
      { now: () => new Date("2026-08-03T08:00:00.000Z") },
    );
    expect(await relay.processBatch()).toMatchObject({ claimed: 1, published: 1 });
    expect(published).toEqual(["event-phase9-001"]);
  });

  it("deduplicates consumer side effects transactionally", async () => {
    const store = new InMemoryPhase9Store();
    let handlerCalls = 0;
    const handler = async (
      transaction: Parameters<typeof createPhase9NotificationForEvent>[0],
      event: Phase9OutboxRecord,
    ) => {
      handlerCalls += 1;
      return createPhase9NotificationForEvent(transaction, event);
    };
    const first = await consumePhase9Event(store, outbox(), "notification-consumer", handler);
    const replay = await consumePhase9Event(store, outbox(), "notification-consumer", handler);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.resultHash).toBe(first.resultHash);
    expect(handlerCalls).toBe(1);
    expect(store.snapshot().notifications).toHaveLength(1);
    expect(store.snapshot().notifications[0]).toMatchObject({
      channel: "IN_APP",
      status: "SENT",
    });
    expect(store.snapshot().notifications[0]?.sentAt).not.toBeNull();
    expect(store.snapshot().consumedEvents).toHaveLength(1);
  });

  it("defines all eight production jobs and routes one approved event idempotently", async () => {
    expect(phase9JobDefinitions).toHaveLength(8);
    expect(new Set(phase9JobDefinitions.map((definition) => definition.queue))).toHaveLength(8);
    expect(
      PHASE9_JOB_QUEUE_NAMES.some((queue) =>
        (AGENT_QUEUE_NAMES as readonly string[]).includes(queue),
      ),
    ).toBe(false);
    const createQueue = vi.fn(async (_name: string, _options: unknown) => undefined);
    const send = vi.fn(
      async (_queue: string, _payload: unknown, _options: { singletonKey?: string }) => "job-id",
    );
    const publisher = new PgBossPhase9EventPublisher({ createQueue, send } as unknown as PgBoss);
    await publisher.publish(outbox());
    expect(send).toHaveBeenCalledTimes(4);
    expect(
      send.mock.calls.every(
        ([, , options]) =>
          typeof options.singletonKey === "string" && !options.singletonKey.includes(" "),
      ),
    ).toBe(true);
  });

  it("registers one isolated consumer for every Phase 9 job", async () => {
    const createQueue = vi.fn(async () => undefined);
    const work = vi.fn(async (queue: string) => `worker:${queue}`);
    const run = vi.fn(async () => ({ ok: true }));
    const runners = Object.fromEntries(
      phase9JobDefinitions.map((definition) => [definition.purpose, run]),
    ) as unknown as Parameters<typeof registerPhase9JobWorkers>[1];
    const workerIds = await registerPhase9JobWorkers(
      { createQueue, work } as unknown as PgBoss,
      runners,
    );
    expect(workerIds).toHaveLength(8);
    expect(work).toHaveBeenCalledTimes(8);
    expect(work.mock.calls.map(([queue]) => queue).sort()).toEqual(
      [...PHASE9_JOB_QUEUE_NAMES].sort(),
    );
  });

  it("requires ready production adapters for A0 through A5 and keeps A4 read-only", () => {
    const run = async () => ({ ok: true });
    const registry = new Phase9AgentAdapterRegistry(
      phase9AgentAdapterNameSchema.options.map((name) => ({
        name,
        version: `buildwatch-${name.toLowerCase()}-production-v1`,
        mode: name === "A4" ? "REQUEST" : "JOB",
        readOnly: name === "A4",
        run,
      })),
    );
    expect(registry.readiness()).toHaveLength(6);
    expect(registry.readiness().every((adapter) => adapter.ready)).toBe(true);
    expect(registry.get("A4")).toMatchObject({ mode: "REQUEST", readOnly: true });
    expect(
      () =>
        new Phase9AgentAdapterRegistry(
          phase9AgentAdapterNameSchema.options
            .filter((name) => name !== "A5")
            .map((name) => ({
              name,
              version: "v1",
              mode: name === "A4" ? "REQUEST" : "JOB",
              readOnly: name === "A4",
              run,
            })),
        ),
    ).toThrow("A5");
  });

  it("runs canonical A0-A5 adapters with job idempotency and scope validation", async () => {
    const store = new InMemoryPhase9Store();
    const calls = new Map<string, number>();
    const runner = (name: string) => async () => {
      calls.set(name, (calls.get(name) ?? 0) + 1);
      return { adapter: name };
    };
    const registry = createPhase9CanonicalAgentAdapterRegistry(store, {
      A0: runner("A0"),
      A1: runner("A1"),
      A2: runner("A2"),
      A3: runner("A3"),
      A4: runner("A4"),
      A5: runner("A5"),
    });
    const payload = {
      schemaVersion: 1 as const,
      eventId: "canonical-adapter-event-001",
      eventType: "DESIGN_DOCUMENT_UPLOADED",
      tenantId: "tenant-alpha",
      projectId: "project-alpha-main",
      aggregateType: "DESIGN_DOCUMENT",
      aggregateId: "drawing-alpha-001",
      aggregateVersion: 1,
      idempotencyKey: "canonical-adapter-idempotency-001",
      payload: { tenantId: "tenant-alpha", projectId: "project-alpha-main" },
      headers: {},
    };
    const first = await registry.get("A0").run(payload);
    const replay = await registry.get("A0").run(payload);
    expect(first).toMatchObject({ replayed: false });
    expect(replay).toMatchObject({ replayed: true });
    expect(calls.get("A0")).toBe(1);
    await registry.get("A4").run({ ...payload, eventId: "a4-request-001" });
    await registry.get("A4").run({ ...payload, eventId: "a4-request-002" });
    expect(calls.get("A4")).toBe(2);
    expect(store.snapshot().consumedEvents).toHaveLength(1);
    await expect(
      registry.get("A5").run({
        ...payload,
        eventId: "scope-mismatch-event",
        idempotencyKey: "scope-mismatch-idempotency",
        payload: { tenantId: "tenant-private" },
      }),
    ).rejects.toThrow("scope mismatch");
  });
});
