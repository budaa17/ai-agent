import type { Job, PgBoss } from "pg-boss";
import { z } from "zod";
import { createPgBossKey } from "../jobs/pg-boss-key.js";
import { A2_OBSERVATION_QUEUE } from "../jobs/queue-names.js";
import {
  ensureQueueWithDeadLetter,
  resolveWorkerRuntimeConfig,
  type WorkerRuntimeConfig,
} from "../runtime/index.js";
import { recommendationTriggerSchema } from "./schema.js";

export { A2_OBSERVATION_QUEUE };

export const a2ObservationJobPayloadSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(200),
    projectRef: z.string().trim().min(1).max(200),
    trigger: recommendationTriggerSchema,
    asOf: z.string().datetime().optional(),
    requestId: z.string().trim().min(1).max(200).optional(),
    eventType: z.string().trim().min(1).max(200).optional(),
    eventId: z.string().trim().min(1).max(200).optional(),
    maxSteps: z.number().int().min(2).max(15).default(8),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.trigger === "EVENT" && (!payload.eventType || !payload.eventId)) {
      context.addIssue({
        code: "custom",
        message: "EVENT trigger requires eventType and eventId",
        path: ["trigger"],
      });
    }

    if (payload.trigger !== "EVENT" && (payload.eventType || payload.eventId)) {
      context.addIssue({
        code: "custom",
        message: "Only EVENT trigger may define eventType or eventId",
        path: ["trigger"],
      });
    }
  });

export const a2NightlyScheduleSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(200),
    projectRef: z.string().trim().min(1).max(200),
    cron: z.string().trim().min(1).max(200),
    timezone: z.string().trim().min(1).max(100),
    maxSteps: z.number().int().min(2).max(15).default(8),
  })
  .strict();

export type A2ObservationJobPayload = z.infer<typeof a2ObservationJobPayloadSchema>;
export type A2ObservationJobInput = z.input<typeof a2ObservationJobPayloadSchema>;

export interface A2ObservationRunInput {
  tenantId: string;
  projectRef: string;
  asOf: string;
  requestId: string;
  trigger: "MANUAL" | "EVENT" | "NIGHTLY";
  eventType?: string;
  eventId?: string;
  maxSteps: number;
  jobId: string;
}

export type A2ObservationJobRunner = (input: A2ObservationRunInput) => Promise<unknown>;

export async function ensureA2ObservationQueue(
  boss: PgBoss,
  config = resolveWorkerRuntimeConfig(),
) {
  return ensureQueueWithDeadLetter(boss, A2_OBSERVATION_QUEUE, config);
}

export async function registerA2ObservationWorker(
  boss: PgBoss,
  runObservation: A2ObservationJobRunner,
  now: () => Date = () => new Date(),
  workerConfig?: WorkerRuntimeConfig,
) {
  const config = workerConfig ?? resolveWorkerRuntimeConfig();
  await ensureA2ObservationQueue(boss, config);

  const handler = async (jobs: Job<A2ObservationJobPayload>[]) => {
    const job = jobs[0];

    if (!job) {
      throw new Error("A2 observation worker received an empty job batch");
    }

    const payload = a2ObservationJobPayloadSchema.parse(job.data);

    return runObservation({
      tenantId: payload.tenantId,
      projectRef: payload.projectRef,
      asOf: payload.asOf ?? now().toISOString(),
      requestId: payload.requestId ?? `a2-job-${job.id}`,
      trigger: payload.trigger,
      eventType: payload.eventType,
      eventId: payload.eventId,
      maxSteps: payload.maxSteps,
      jobId: job.id,
    });
  };

  return workerConfig === undefined
    ? boss.work<A2ObservationJobPayload>(A2_OBSERVATION_QUEUE, handler)
    : boss.work<A2ObservationJobPayload>(
        A2_OBSERVATION_QUEUE,
        {
          localConcurrency: config.concurrency,
          heartbeatRefreshSeconds: Math.max(5, Math.floor(config.heartbeatSeconds / 2)),
        },
        handler,
      );
}

function observationSingletonKey(payload: A2ObservationJobPayload) {
  if (payload.trigger === "EVENT") {
    return createPgBossKey(
      A2_OBSERVATION_QUEUE,
      payload.tenantId,
      payload.projectRef,
      payload.eventType!,
      payload.eventId!,
    );
  }

  return createPgBossKey(
    A2_OBSERVATION_QUEUE,
    payload.tenantId,
    payload.projectRef,
    payload.trigger,
    payload.requestId ?? payload.asOf ?? "latest",
  );
}

export async function enqueueA2Observation(boss: PgBoss, input: A2ObservationJobInput) {
  const payload = a2ObservationJobPayloadSchema.parse(input);
  await ensureA2ObservationQueue(boss);

  return boss.send(A2_OBSERVATION_QUEUE, payload, {
    singletonKey: observationSingletonKey(payload),
  });
}

export async function scheduleA2NightlyObservation(
  boss: PgBoss,
  input: z.input<typeof a2NightlyScheduleSchema>,
) {
  const schedule = a2NightlyScheduleSchema.parse(input);
  const key = createPgBossKey(A2_OBSERVATION_QUEUE, schedule.tenantId, schedule.projectRef);
  const payload = a2ObservationJobPayloadSchema.parse({
    tenantId: schedule.tenantId,
    projectRef: schedule.projectRef,
    trigger: "NIGHTLY",
    maxSteps: schedule.maxSteps,
  });

  await ensureA2ObservationQueue(boss);
  await boss.schedule(A2_OBSERVATION_QUEUE, schedule.cron, payload, {
    key,
    tz: schedule.timezone,
  });

  return key;
}
