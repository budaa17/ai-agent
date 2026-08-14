import type { Job, PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";
import {
  A2_OBSERVATION_QUEUE,
  enqueueA2Observation,
  registerA2ObservationWorker,
  scheduleA2NightlyObservation,
  type A2ObservationJobPayload,
} from "../../src/recommendations/jobs.js";

describe("A2 observation pg-boss orchestration", () => {
  it("runs a nightly job with execution-time scope metadata", async () => {
    let handler: ((jobs: Job<A2ObservationJobPayload>[]) => Promise<unknown>) | undefined;
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const work = vi.fn(async (_queue: string, registeredHandler: typeof handler) => {
      handler = registeredHandler;
      return "worker-a2-1";
    });
    const boss = { createQueue, work } as unknown as PgBoss;
    const runObservation = vi.fn().mockResolvedValue({
      runId: "run-a2-1",
    });

    const workerId = await registerA2ObservationWorker(
      boss,
      runObservation,
      () => new Date("2026-03-02T17:00:00.000Z"),
    );
    const output = await handler!([
      {
        id: "job-a2-nightly",
        data: {
          tenantId: "tenant-demo",
          projectRef: "project-atlas",
          trigger: "NIGHTLY",
          maxSteps: 8,
        },
      } as Job<A2ObservationJobPayload>,
    ]);

    expect(workerId).toBe("worker-a2-1");
    expect(createQueue).toHaveBeenCalledWith(
      A2_OBSERVATION_QUEUE,
      expect.objectContaining({ retryLimit: 3 }),
    );
    expect(runObservation).toHaveBeenCalledWith({
      tenantId: "tenant-demo",
      projectRef: "project-atlas",
      asOf: "2026-03-02T17:00:00.000Z",
      requestId: "a2-job-job-a2-nightly",
      trigger: "NIGHTLY",
      eventType: undefined,
      eventId: undefined,
      maxSteps: 8,
      jobId: "job-a2-nightly",
    });
    expect(output).toEqual({ runId: "run-a2-1" });
  });

  it("enqueues an event idempotently", async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue("job-a2-event");
    const boss = { createQueue, send } as unknown as PgBoss;

    const jobId = await enqueueA2Observation(boss, {
      tenantId: "tenant-demo",
      projectRef: "project-atlas",
      trigger: "EVENT",
      asOf: "2026-03-01T00:00:00.000Z",
      requestId: "event-project-updated-1",
      eventType: "PROJECT_UPDATED",
      eventId: "event-project-updated-1",
    });

    expect(jobId).toBe("job-a2-event");
    expect(send).toHaveBeenCalledWith(
      A2_OBSERVATION_QUEUE,
      expect.objectContaining({
        trigger: "EVENT",
        maxSteps: 8,
      }),
      {
        singletonKey:
          "a2-observe-project/tenant-demo/project-atlas/PROJECT_UPDATED/event-project-updated-1",
      },
    );
  });

  it("registers a timezone-aware nightly schedule", async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = { createQueue, schedule } as unknown as PgBoss;

    const key = await scheduleA2NightlyObservation(boss, {
      tenantId: "tenant-demo",
      projectRef: "project-atlas",
      cron: "0 1 * * *",
      timezone: "Asia/Ulaanbaatar",
    });

    expect(key).toBe("a2-observe-project/tenant-demo/project-atlas");
    expect(schedule).toHaveBeenCalledWith(
      A2_OBSERVATION_QUEUE,
      "0 1 * * *",
      {
        tenantId: "tenant-demo",
        projectRef: "project-atlas",
        trigger: "NIGHTLY",
        maxSteps: 8,
      },
      {
        key: "a2-observe-project/tenant-demo/project-atlas",
        tz: "Asia/Ulaanbaatar",
      },
    );
  });
});
