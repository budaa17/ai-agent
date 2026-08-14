import type { Job, PgBoss } from "pg-boss";
import { z } from "zod";
import { createPgBossKey } from "../jobs/pg-boss-key.js";
import { A5_DAILY_PLAN_QUEUE } from "../jobs/queue-names.js";
import {
  ensureQueueWithDeadLetter,
  replayDeadLetterQueue,
  resolveWorkerRuntimeConfig,
  type WorkerRuntimeConfig,
} from "../runtime/index.js";

export { A5_DAILY_PLAN_QUEUE };

export const a5DailyPlanJobPayloadSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(200),
    planDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    timezone: z.string().trim().min(1).max(100),
    trigger: z.enum(["SCHEDULED_05_00", "MANAGER_REQUEST", "REPLAY"]),
    requestId: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.trigger === "MANAGER_REQUEST" && payload.planDate === undefined) {
      context.addIssue({
        code: "custom",
        message: "Manager-requested A5 jobs require a plan date",
        path: ["planDate"],
      });
    }
  });

export const a5DailyPlanScheduleSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(200),
    timezone: z.string().trim().min(1).max(100),
  })
  .strict();

export type A5DailyPlanJobPayload = z.infer<typeof a5DailyPlanJobPayloadSchema>;
export type A5DailyPlanJobInput = z.input<typeof a5DailyPlanJobPayloadSchema>;

export interface A5DailyPlanRunInput {
  tenantId: string;
  projectId: string;
  planDate: string;
  timezone: string;
  trigger: A5DailyPlanJobPayload["trigger"];
  requestId: string;
  idempotencyKey: string;
  jobId: string;
}

export type A5DailyPlanJobRunner = (input: A5DailyPlanRunInput) => Promise<unknown>;

export function dateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

export function a5DailyPlanIdempotencyKey(
  tenantId: string,
  projectId: string,
  planDate: string,
): string {
  return createPgBossKey(A5_DAILY_PLAN_QUEUE, tenantId, projectId, planDate);
}

export async function ensureA5DailyPlanQueue(boss: PgBoss, config = resolveWorkerRuntimeConfig()) {
  return ensureQueueWithDeadLetter(boss, A5_DAILY_PLAN_QUEUE, config);
}

export async function registerA5DailyPlanWorker(
  boss: PgBoss,
  runPlan: A5DailyPlanJobRunner,
  now: () => Date = () => new Date(),
  workerConfig?: WorkerRuntimeConfig,
) {
  const config = workerConfig ?? resolveWorkerRuntimeConfig();
  await ensureA5DailyPlanQueue(boss, config);
  const handler = async (jobs: Job<A5DailyPlanJobPayload>[]) => {
    const job = jobs[0];
    if (job === undefined) {
      throw new Error("A5 daily-plan worker received an empty job batch");
    }
    const payload = a5DailyPlanJobPayloadSchema.parse(job.data);
    const planDate = payload.planDate ?? dateInTimezone(now(), payload.timezone);
    return runPlan({
      tenantId: payload.tenantId,
      projectId: payload.projectId,
      planDate,
      timezone: payload.timezone,
      trigger: payload.trigger,
      requestId: payload.requestId ?? `a5-job-${job.id}`,
      idempotencyKey: a5DailyPlanIdempotencyKey(payload.tenantId, payload.projectId, planDate),
      jobId: job.id,
    });
  };
  return workerConfig === undefined
    ? boss.work<A5DailyPlanJobPayload>(A5_DAILY_PLAN_QUEUE, handler)
    : boss.work<A5DailyPlanJobPayload>(
        A5_DAILY_PLAN_QUEUE,
        {
          localConcurrency: config.concurrency,
          heartbeatRefreshSeconds: Math.max(5, Math.floor(config.heartbeatSeconds / 2)),
        },
        handler,
      );
}

export async function enqueueA5DailyPlan(boss: PgBoss, input: A5DailyPlanJobInput) {
  const payload = a5DailyPlanJobPayloadSchema.parse(input);
  const planDate = payload.planDate ?? dateInTimezone(new Date(), payload.timezone);
  await ensureA5DailyPlanQueue(boss);
  return boss.send(A5_DAILY_PLAN_QUEUE, payload, {
    singletonKey: a5DailyPlanIdempotencyKey(payload.tenantId, payload.projectId, planDate),
  });
}

export async function scheduleA5DailyPlanAtFive(
  boss: PgBoss,
  input: z.input<typeof a5DailyPlanScheduleSchema>,
) {
  const schedule = a5DailyPlanScheduleSchema.parse(input);
  const key = createPgBossKey(A5_DAILY_PLAN_QUEUE, schedule.tenantId, schedule.projectId, "05-00");
  const payload = a5DailyPlanJobPayloadSchema.parse({
    ...schedule,
    trigger: "SCHEDULED_05_00",
  });
  await ensureA5DailyPlanQueue(boss);
  await boss.schedule(A5_DAILY_PLAN_QUEUE, "0 5 * * *", payload, {
    key,
    tz: schedule.timezone,
  });
  return key;
}

export async function replayA5DailyPlanDeadLetters(boss: PgBoss) {
  return replayDeadLetterQueue(boss, A5_DAILY_PLAN_QUEUE);
}

export class A5IdempotentRunStore<T> {
  readonly #runs = new Map<string, Promise<T>>();

  run(idempotencyKey: string, execute: () => Promise<T>): Promise<T> {
    const existing = this.#runs.get(idempotencyKey);
    if (existing !== undefined) {
      return existing;
    }
    const pending = execute().catch((error: unknown) => {
      this.#runs.delete(idempotencyKey);
      throw error;
    });
    this.#runs.set(idempotencyKey, pending);
    return pending;
  }
}
