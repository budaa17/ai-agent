import type { Job, PgBoss } from "pg-boss";
import { z } from "zod";
import { createPgBossKey } from "../jobs/pg-boss-key.js";
import { A3_DOCUMENT_QUEUE } from "../jobs/queue-names.js";
import {
  ensureQueueWithDeadLetter,
  resolveWorkerRuntimeConfig,
  type WorkerRuntimeConfig,
} from "../runtime/index.js";

export { A3_DOCUMENT_QUEUE };

export const a3DocumentJobPayloadSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(200),
    projectRef: z.string().trim().min(1).max(200),
    trigger: z.enum(["REQUEST", "SCHEDULED"]),
    asOf: z.string().datetime().optional(),
    requestId: z.string().trim().min(1).max(200).optional(),
    noPdf: z.boolean().default(false),
    analysisOnly: z.boolean().default(false),
  })
  .strict();

export const a3DocumentScheduleSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(200),
    projectRef: z.string().trim().min(1).max(200),
    asOf: z.string().datetime().optional(),
    cron: z.string().trim().min(1).max(200),
    timezone: z.string().trim().min(1).max(100),
    noPdf: z.boolean().default(false),
    analysisOnly: z.boolean().default(false),
  })
  .strict();

export type A3DocumentJobPayload = z.infer<typeof a3DocumentJobPayloadSchema>;
export type A3DocumentJobInput = z.input<typeof a3DocumentJobPayloadSchema>;

export interface A3DocumentRunInput {
  tenantId: string;
  projectRef: string;
  asOf: string;
  requestId: string;
  trigger: "REQUEST" | "SCHEDULED";
  noPdf: boolean;
  analysisOnly: boolean;
  jobId: string;
}

export type A3DocumentJobRunner = (input: A3DocumentRunInput) => Promise<unknown>;

export async function ensureA3DocumentQueue(boss: PgBoss, config = resolveWorkerRuntimeConfig()) {
  return ensureQueueWithDeadLetter(boss, A3_DOCUMENT_QUEUE, config);
}

export async function registerA3DocumentWorker(
  boss: PgBoss,
  runDocuments: A3DocumentJobRunner,
  now: () => Date = () => new Date(),
  workerConfig?: WorkerRuntimeConfig,
) {
  const config = workerConfig ?? resolveWorkerRuntimeConfig();
  await ensureA3DocumentQueue(boss, config);

  const handler = async (jobs: Job<A3DocumentJobPayload>[]) => {
    const job = jobs[0];

    if (!job) {
      throw new Error("A3 document worker received an empty job batch");
    }

    const payload = a3DocumentJobPayloadSchema.parse(job.data);

    return runDocuments({
      tenantId: payload.tenantId,
      projectRef: payload.projectRef,
      asOf: payload.asOf ?? now().toISOString(),
      requestId: payload.requestId ?? `a3-job-${job.id}`,
      trigger: payload.trigger,
      noPdf: payload.noPdf,
      analysisOnly: payload.analysisOnly,
      jobId: job.id,
    });
  };

  return workerConfig === undefined
    ? boss.work<A3DocumentJobPayload>(A3_DOCUMENT_QUEUE, handler)
    : boss.work<A3DocumentJobPayload>(
        A3_DOCUMENT_QUEUE,
        {
          localConcurrency: config.concurrency,
          heartbeatRefreshSeconds: Math.max(5, Math.floor(config.heartbeatSeconds / 2)),
        },
        handler,
      );
}

export async function enqueueA3DocumentRequest(boss: PgBoss, input: A3DocumentJobInput) {
  const payload = a3DocumentJobPayloadSchema.parse(input);
  await ensureA3DocumentQueue(boss);

  return boss.send(A3_DOCUMENT_QUEUE, payload, {
    singletonKey: createPgBossKey(
      A3_DOCUMENT_QUEUE,
      payload.tenantId,
      payload.projectRef,
      payload.requestId ?? `${payload.trigger}:${payload.asOf ?? "latest"}`,
    ),
  });
}

export async function scheduleA3Documents(
  boss: PgBoss,
  input: z.input<typeof a3DocumentScheduleSchema>,
) {
  const schedule = a3DocumentScheduleSchema.parse(input);
  const key = createPgBossKey(A3_DOCUMENT_QUEUE, schedule.tenantId, schedule.projectRef);
  const payload = a3DocumentJobPayloadSchema.parse({
    tenantId: schedule.tenantId,
    projectRef: schedule.projectRef,
    trigger: "SCHEDULED",
    asOf: schedule.asOf,
    noPdf: schedule.noPdf,
    analysisOnly: schedule.analysisOnly,
  });

  await ensureA3DocumentQueue(boss);
  await boss.schedule(A3_DOCUMENT_QUEUE, schedule.cron, payload, {
    key,
    tz: schedule.timezone,
  });

  return key;
}
