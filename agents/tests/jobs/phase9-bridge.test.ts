import type { PgBoss } from "pg-boss";
import { phase9JobPayloadSchema, type Phase9JobPayload } from "../../src/backend/jobs.js";
import {
  DEFAULT_BRIDGE_TIMEZONE,
  PHASE9_BRIDGE_QUEUES,
  UNROUTED_PHASE9_QUEUES,
  forwardPhase9Job,
  registerPhase9BridgeWorker,
} from "../../src/jobs/phase9-bridge.js";
import {
  A2_OBSERVATION_QUEUE,
  A3_DOCUMENT_QUEUE,
  A5_DAILY_PLAN_QUEUE,
  PHASE9_A2_OBSERVATION_QUEUE,
  PHASE9_A3_DOCUMENT_QUEUE,
  PHASE9_A5_DAILY_PLAN_QUEUE,
  PHASE9_JOB_QUEUE_NAMES,
} from "../../src/jobs/queue-names.js";

function phase9Job(overrides: Partial<Phase9JobPayload> = {}): Phase9JobPayload {
  return phase9JobPayloadSchema.parse({
    schemaVersion: 1,
    eventId: "event-phase9-001",
    eventType: "PROJECT_EXECUTION_APPROVED",
    tenantId: "tenant-alpha",
    projectId: "project-alpha-main",
    aggregateType: "DAILY_REPORT",
    aggregateId: "report-alpha-001",
    aggregateVersion: 1,
    idempotencyKey: "outbox:tenant-alpha:report-alpha-001",
    payload: { reportId: "report-alpha-001" },
    headers: { correlationId: "event-correlation" },
    ...overrides,
  });
}

function fakeBoss() {
  const createQueue = vi.fn(async (_name: string, _options?: unknown) => undefined);
  const send = vi.fn(
    async (_queue: string, _payload: unknown, _options?: { singletonKey?: string }) => "job-id",
  );
  const work = vi.fn(
    async (queue: string, _options?: unknown, _handler?: unknown) => `worker:${queue}`,
  );
  return {
    createQueue,
    send,
    work,
    boss: { createQueue, send, work } as unknown as PgBoss,
  };
}

describe("Phase 9 bridge", () => {
  it("routes only queues that have an agent worker behind them", () => {
    expect([...PHASE9_BRIDGE_QUEUES, ...UNROUTED_PHASE9_QUEUES].sort()).toEqual(
      [...PHASE9_JOB_QUEUE_NAMES].sort(),
    );
  });

  it("forwards an observation event onto the A2 worker queue", async () => {
    const { boss, send } = fakeBoss();

    await forwardPhase9Job(boss, PHASE9_A2_OBSERVATION_QUEUE, phase9Job());

    expect(send).toHaveBeenCalledTimes(1);
    const [queue, payload] = send.mock.calls[0]!;
    expect(queue).toBe(A2_OBSERVATION_QUEUE);
    expect(payload).toMatchObject({
      tenantId: "tenant-alpha",
      projectRef: "project-alpha-main",
      trigger: "EVENT",
      eventType: "PROJECT_EXECUTION_APPROVED",
      eventId: "event-phase9-001",
    });
  });

  it("forwards a document event onto the A3 worker queue", async () => {
    const { boss, send } = fakeBoss();

    await forwardPhase9Job(boss, PHASE9_A3_DOCUMENT_QUEUE, phase9Job());

    const [queue, payload] = send.mock.calls[0]!;
    expect(queue).toBe(A3_DOCUMENT_QUEUE);
    expect(payload).toMatchObject({
      tenantId: "tenant-alpha",
      projectRef: "project-alpha-main",
      trigger: "REQUEST",
      requestId: "event-phase9-001",
    });
  });

  it("forwards a daily-plan event with the event timezone when it carries one", async () => {
    const { boss, send } = fakeBoss();

    await forwardPhase9Job(
      boss,
      PHASE9_A5_DAILY_PLAN_QUEUE,
      phase9Job({ payload: { timezone: "Asia/Tokyo" } }),
      {},
      () => new Date("2026-08-06T20:00:00.000Z"),
    );

    const [queue, payload] = send.mock.calls[0]!;
    expect(queue).toBe(A5_DAILY_PLAN_QUEUE);
    expect(payload).toMatchObject({
      tenantId: "tenant-alpha",
      projectId: "project-alpha-main",
      timezone: "Asia/Tokyo",
      trigger: "MANAGER_REQUEST",
      // 2026-08-06T20:00Z is already the 7th in Tokyo
      planDate: "2026-08-07",
    });
  });

  it("falls back to the deployment timezone when the event carries none", async () => {
    const { boss, send } = fakeBoss();

    await forwardPhase9Job(
      boss,
      PHASE9_A5_DAILY_PLAN_QUEUE,
      phase9Job(),
      {},
      () => new Date("2026-08-06T20:00:00.000Z"),
    );

    expect(send.mock.calls[0]![1]).toMatchObject({
      timezone: DEFAULT_BRIDGE_TIMEZONE,
      planDate: "2026-08-07",
    });
  });

  it("prefers a plan date the event carried over today", async () => {
    const { boss, send } = fakeBoss();

    await forwardPhase9Job(
      boss,
      PHASE9_A5_DAILY_PLAN_QUEUE,
      phase9Job({ payload: { planDate: "2026-09-01" } }),
      {},
      () => new Date("2026-08-06T20:00:00.000Z"),
    );

    expect(send.mock.calls[0]![1]).toMatchObject({ planDate: "2026-09-01" });
  });

  it("keeps tenant and project scope from the canonical envelope, not the event body", async () => {
    const { boss, send } = fakeBoss();

    await forwardPhase9Job(
      boss,
      PHASE9_A2_OBSERVATION_QUEUE,
      phase9Job({ payload: { tenantId: "tenant-attacker", projectId: "project-attacker" } }),
    );

    expect(send.mock.calls[0]![1]).toMatchObject({
      tenantId: "tenant-alpha",
      projectRef: "project-alpha-main",
    });
  });

  it("refuses to forward a queue it has no route for", async () => {
    const { boss } = fakeBoss();

    await expect(forwardPhase9Job(boss, UNROUTED_PHASE9_QUEUES[0], phase9Job())).rejects.toThrow(
      /No Phase 9 bridge route/u,
    );
  });

  it("registers one consumer per bridged queue", async () => {
    const { boss, work } = fakeBoss();

    const workerIds = await registerPhase9BridgeWorker(boss);

    expect(workerIds).toHaveLength(PHASE9_BRIDGE_QUEUES.length);
    expect(work.mock.calls.map(([queue]) => queue).sort()).toEqual(
      [...PHASE9_BRIDGE_QUEUES].sort(),
    );
  });
});
