import { createHash } from "node:crypto";
import type { Job, PgBoss } from "pg-boss";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  A1_INTAKE_QUEUE,
  createA1IntakeJobPayload,
  enqueueA1Intake,
  registerA1IntakeWorker,
  sourceFromA1IntakeJob,
  type A1IntakeJobPayload,
} from "../../src/structuring/jobs.js";
import { preprocessProjectUpdateImage } from "../../src/structuring/source.js";

describe("A1 intake pg-boss trigger", () => {
  const payload = createA1IntakeJobPayload({
    requestId: "request-a1-queue",
    tenantRef: "tenant-demo",
    projectRef: "project-atlas",
    referenceDate: "2026-03-01",
    source: { text: "AT-001 completed" },
  });

  it("enqueues an idempotent intake event", async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue("job-a1-1");
    const boss = { createQueue, send } as unknown as PgBoss;

    const jobId = await enqueueA1Intake(boss, payload);

    expect(jobId).toBe("job-a1-1");
    expect(send).toHaveBeenCalledWith(A1_INTAKE_QUEUE, payload, {
      singletonKey: "a1-register-project-update/request-a1-queue",
    });
  });

  it("validates a queued event before running the intake pipeline", async () => {
    let handler: ((jobs: Job<A1IntakeJobPayload>[]) => Promise<unknown>) | undefined;
    const boss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      work: vi.fn(async (_queue: string, registeredHandler: typeof handler) => {
        handler = registeredHandler;
        return "worker-a1-1";
      }),
    } as unknown as PgBoss;
    const runIntake = vi.fn().mockResolvedValue({ draftId: "draft-a1" });

    const workerId = await registerA1IntakeWorker(boss, runIntake);
    const output = await handler!([{ data: payload } as Job<A1IntakeJobPayload>]);

    expect(workerId).toBe("worker-a1-1");
    expect(runIntake).toHaveBeenCalledWith(payload);
    expect(output).toEqual({ draftId: "draft-a1" });
  });

  it("preserves image preprocessing provenance through the queue", async () => {
    const data = await sharp({
      create: {
        width: 320,
        height: 240,
        channels: 3,
        background: "#204060",
      },
    })
      .png()
      .toBuffer();
    const image = await preprocessProjectUpdateImage({
      data,
      mediaType: "image/png",
      fileName: "queue.png",
      sha256: createHash("sha256").update(data).digest("hex"),
    });
    const imagePayload = createA1IntakeJobPayload({
      requestId: "request-a1-image-queue",
      tenantRef: "tenant-demo",
      projectRef: "project-atlas",
      referenceDate: "2026-03-01",
      source: { image },
    });
    const roundTrip = sourceFromA1IntakeJob(imagePayload);

    expect(roundTrip.image?.data).toEqual(image.data);
    expect(roundTrip.image?.preprocessing).toEqual(image.preprocessing);
  });
});
