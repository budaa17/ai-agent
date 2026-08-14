import type { Job, PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";
import {
  A3_DOCUMENT_QUEUE,
  enqueueA3DocumentRequest,
  registerA3DocumentWorker,
  scheduleA3Documents,
  type A3DocumentJobPayload,
} from "../../src/reporting/jobs.js";

describe("A3 document pg-boss orchestration", () => {
  it("runs a scheduled document job with a stable request", async () => {
    let handler: ((jobs: Job<A3DocumentJobPayload>[]) => Promise<unknown>) | undefined;
    const boss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      work: vi.fn(async (_queue: string, registeredHandler: typeof handler) => {
        handler = registeredHandler;
        return "worker-a3-1";
      }),
    } as unknown as PgBoss;
    const runDocuments = vi.fn().mockResolvedValue({
      runId: "run-a3-1",
    });

    const workerId = await registerA3DocumentWorker(
      boss,
      runDocuments,
      () => new Date("2026-03-01T00:00:00.000Z"),
    );
    const output = await handler!([
      {
        id: "job-a3-1",
        data: {
          tenantId: "tenant-demo",
          projectRef: "project-atlas",
          trigger: "SCHEDULED",
          noPdf: true,
          analysisOnly: false,
        },
      } as Job<A3DocumentJobPayload>,
    ]);

    expect(workerId).toBe("worker-a3-1");
    expect(runDocuments).toHaveBeenCalledWith({
      tenantId: "tenant-demo",
      projectRef: "project-atlas",
      asOf: "2026-03-01T00:00:00.000Z",
      requestId: "a3-job-job-a3-1",
      trigger: "SCHEDULED",
      noPdf: true,
      analysisOnly: false,
      jobId: "job-a3-1",
    });
    expect(output).toEqual({ runId: "run-a3-1" });
  });

  it("enqueues an idempotent requested document job", async () => {
    const send = vi.fn().mockResolvedValue("job-a3-request");
    const boss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      send,
    } as unknown as PgBoss;

    await enqueueA3DocumentRequest(boss, {
      tenantId: "tenant-demo",
      projectRef: "project-atlas",
      trigger: "REQUEST",
      asOf: "2026-03-01T00:00:00.000Z",
      requestId: "request-a3-1",
    });

    expect(send).toHaveBeenCalledWith(
      A3_DOCUMENT_QUEUE,
      expect.objectContaining({
        requestId: "request-a3-1",
        noPdf: false,
        analysisOnly: false,
      }),
      {
        singletonKey: "a3-generate-documents/tenant-demo/project-atlas/request-a3-1",
      },
    );
  });

  it("registers a timezone-aware schedule", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      schedule,
    } as unknown as PgBoss;

    const key = await scheduleA3Documents(boss, {
      tenantId: "tenant-demo",
      projectRef: "project-atlas",
      asOf: "2026-03-01T00:00:00.000Z",
      cron: "0 7 * * 1",
      timezone: "Asia/Ulaanbaatar",
      noPdf: true,
      analysisOnly: false,
    });

    expect(key).toBe("a3-generate-documents/tenant-demo/project-atlas");
    expect(schedule).toHaveBeenCalledWith(
      A3_DOCUMENT_QUEUE,
      "0 7 * * 1",
      {
        tenantId: "tenant-demo",
        projectRef: "project-atlas",
        trigger: "SCHEDULED",
        asOf: "2026-03-01T00:00:00.000Z",
        noPdf: true,
        analysisOnly: false,
      },
      {
        key: "a3-generate-documents/tenant-demo/project-atlas",
        tz: "Asia/Ulaanbaatar",
      },
    );
  });
});
