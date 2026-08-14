import type { PgBoss } from "pg-boss";
import { z } from "zod";

export const workerRuntimeConfigSchema = z
  .object({
    concurrency: z.number().int().min(1).max(100),
    retryLimit: z.number().int().min(0).max(20),
    retryDelaySeconds: z.number().int().min(1).max(3_600),
    heartbeatSeconds: z.number().int().min(10).max(3_600),
  })
  .strict();

export type WorkerRuntimeConfig = z.infer<typeof workerRuntimeConfigSchema>;

export function resolveWorkerRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerRuntimeConfig {
  return workerRuntimeConfigSchema.parse({
    concurrency: Number(environment.AGENT_WORKER_CONCURRENCY ?? "1"),
    retryLimit: Number(environment.AGENT_JOB_RETRY_LIMIT ?? "3"),
    retryDelaySeconds: Number(environment.AGENT_JOB_RETRY_DELAY_SECONDS ?? "30"),
    heartbeatSeconds: Number(environment.AGENT_JOB_HEARTBEAT_SECONDS ?? "60"),
  });
}

export function deadLetterQueueName(queueName: string) {
  return `${queueName}-dead-letter`;
}

export async function ensureQueueWithDeadLetter(
  boss: PgBoss,
  queueName: string,
  config: WorkerRuntimeConfig,
) {
  const deadLetter = deadLetterQueueName(queueName);
  await boss.createQueue(deadLetter, {
    retryLimit: 0,
    warningQueueSize: 1,
  });
  await boss.createQueue(queueName, {
    retryLimit: config.retryLimit,
    retryDelay: config.retryDelaySeconds,
    retryBackoff: true,
    retryDelayMax: config.retryDelaySeconds * 16,
    heartbeatSeconds: config.heartbeatSeconds,
    deadLetter,
    warningQueueSize: Math.max(10, config.concurrency * 20),
    notify: true,
  });
  return deadLetter;
}

export async function replayDeadLetterQueue(boss: PgBoss, sourceQueue: string) {
  const deadLetter = deadLetterQueueName(sourceQueue);
  return boss.redrive(deadLetter, {
    destination: sourceQueue,
  });
}
