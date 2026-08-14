import type { Job, PgBoss } from "pg-boss";
import { z } from "zod";
import {
  PHASE9_A0_DESIGN_PARSE_QUEUE,
  PHASE9_A2_OBSERVATION_QUEUE,
  PHASE9_A3_DOCUMENT_QUEUE,
  PHASE9_A5_DAILY_PLAN_QUEUE,
  PHASE9_EVENING_REMINDER_QUEUE,
  PHASE9_JOB_QUEUE_NAMES,
  PHASE9_PROGRESS_VERIFICATION_QUEUE,
  PHASE9_QUANTITY_RECALCULATION_QUEUE,
  PHASE9_ROLLING_FORECAST_QUEUE,
} from "../jobs/queue-names.js";
import { createPgBossKey } from "../jobs/pg-boss-key.js";
import { ensureQueueWithDeadLetter, resolveWorkerRuntimeConfig } from "../runtime/index.js";
import type { Phase9EventPublisher } from "./outbox.js";
import type { Phase9OutboxRecord } from "./store.js";

export const phase9JobPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().trim().min(1).max(200),
    eventType: z.string().trim().min(1).max(200),
    tenantId: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(200),
    aggregateType: z.string().trim().min(1).max(200),
    aggregateId: z.string().trim().min(1).max(200),
    aggregateVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(500),
    payload: z.record(z.string(), z.unknown()),
    headers: z.record(z.string(), z.unknown()),
  })
  .strict();

export type Phase9JobPayload = z.infer<typeof phase9JobPayloadSchema>;
export type Phase9JobRunner = (payload: Phase9JobPayload) => Promise<unknown>;

export const phase9JobDefinitions = Object.freeze([
  { queue: PHASE9_A0_DESIGN_PARSE_QUEUE, adapter: "A0", purpose: "PARSE_EXTRACT" },
  { queue: PHASE9_QUANTITY_RECALCULATION_QUEUE, adapter: "A0", purpose: "QUANTITY_RECALCULATION" },
  { queue: PHASE9_A5_DAILY_PLAN_QUEUE, adapter: "A5", purpose: "DAILY_PLAN" },
  { queue: PHASE9_EVENING_REMINDER_QUEUE, adapter: "A1", purpose: "EVENING_REMINDER" },
  { queue: PHASE9_PROGRESS_VERIFICATION_QUEUE, adapter: "A5", purpose: "PROGRESS_VERIFICATION" },
  { queue: PHASE9_ROLLING_FORECAST_QUEUE, adapter: "A5", purpose: "ROLLING_FORECAST" },
  { queue: PHASE9_A2_OBSERVATION_QUEUE, adapter: "A2", purpose: "OBSERVATION" },
  { queue: PHASE9_A3_DOCUMENT_QUEUE, adapter: "A3", purpose: "REPORT" },
] as const);

const eventRoutes: Readonly<Record<string, readonly string[]>> = {
  DESIGN_DOCUMENT_UPLOADED: [PHASE9_A0_DESIGN_PARSE_QUEUE],
  DRAWING_SCALE_VERIFIED: [PHASE9_QUANTITY_RECALCULATION_QUEUE],
  QUANTITY_TAKEOFF_APPLIED: [PHASE9_QUANTITY_RECALCULATION_QUEUE],
  BASELINE_APPLIED: [PHASE9_A5_DAILY_PLAN_QUEUE, PHASE9_A2_OBSERVATION_QUEUE],
  EVENING_REMINDER_DUE: [PHASE9_EVENING_REMINDER_QUEUE],
  PHOTO_EVIDENCE_LINKED: [PHASE9_PROGRESS_VERIFICATION_QUEUE],
  PROJECT_EXECUTION_APPROVED: [
    PHASE9_PROGRESS_VERIFICATION_QUEUE,
    PHASE9_ROLLING_FORECAST_QUEUE,
    PHASE9_A2_OBSERVATION_QUEUE,
    PHASE9_A3_DOCUMENT_QUEUE,
  ],
  PROGRESS_VERIFICATION_APPLIED: [PHASE9_ROLLING_FORECAST_QUEUE, PHASE9_A2_OBSERVATION_QUEUE],
  FORECAST_UPDATED: [PHASE9_A2_OBSERVATION_QUEUE, PHASE9_A3_DOCUMENT_QUEUE],
};

function jobPayload(event: Phase9OutboxRecord): Phase9JobPayload {
  return phase9JobPayloadSchema.parse({
    schemaVersion: 1,
    eventId: event.id,
    eventType: event.eventType,
    tenantId: event.tenantId,
    projectId: event.projectId,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion,
    idempotencyKey: event.idempotencyKey,
    payload: event.payload,
    headers: event.headers,
  });
}

export class PgBossPhase9EventPublisher implements Phase9EventPublisher {
  constructor(private readonly boss: PgBoss) {}

  async publish(event: Phase9OutboxRecord): Promise<void> {
    const queues = eventRoutes[event.eventType] ?? [];
    const payload = jobPayload(event);
    const config = resolveWorkerRuntimeConfig();
    for (const queue of queues) {
      await ensureQueueWithDeadLetter(this.boss, queue, config);
      await this.boss.send(queue, payload, {
        singletonKey: createPgBossKey(queue, event.idempotencyKey),
      });
    }
  }
}

export async function ensurePhase9JobQueues(boss: PgBoss): Promise<void> {
  const config = resolveWorkerRuntimeConfig();
  for (const queue of PHASE9_JOB_QUEUE_NAMES) {
    await ensureQueueWithDeadLetter(boss, queue, config);
  }
}

export async function registerPhase9JobWorkers(
  boss: PgBoss,
  runners: Readonly<Record<(typeof phase9JobDefinitions)[number]["purpose"], Phase9JobRunner>>,
): Promise<Array<string | void>> {
  await ensurePhase9JobQueues(boss);
  const workerIds: Array<string | void> = [];
  for (const definition of phase9JobDefinitions) {
    const runner = runners[definition.purpose];
    workerIds.push(
      await boss.work<Phase9JobPayload>(definition.queue, async (jobs: Job<Phase9JobPayload>[]) => {
        const job = jobs[0];
        if (job === undefined) throw new Error("Phase 9 worker received an empty batch");
        return runner(phase9JobPayloadSchema.parse(job.data));
      }),
    );
  }
  return workerIds;
}
