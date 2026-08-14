import type { Job, PgBoss } from "pg-boss";
import { phase9JobPayloadSchema, type Phase9JobPayload } from "../backend/jobs.js";
import { dateInTimezone, enqueueA5DailyPlan } from "../planning/jobs.js";
import { enqueueA2Observation } from "../recommendations/jobs.js";
import { enqueueA3DocumentRequest } from "../reporting/jobs.js";
import {
  ensureQueueWithDeadLetter,
  resolveWorkerRuntimeConfig,
  type WorkerRuntimeConfig,
} from "../runtime/index.js";
import {
  PHASE9_A2_OBSERVATION_QUEUE,
  PHASE9_A3_DOCUMENT_QUEUE,
  PHASE9_A5_DAILY_PLAN_QUEUE,
} from "./queue-names.js";

/**
 * Anti-corruption layer between the Phase 9 canonical event model and the agent
 * job model the deployed workers consume.
 *
 * The outbox relay publishes Phase9JobPayload onto the buildwatch-v22-phase9-*
 * queues (see backend/jobs.ts eventRoutes), while a2-worker/a3-worker and the
 * A5 planning worker listen on their own queues with their own payload shapes.
 * Nothing connected the two, so every event the outbox published landed in a
 * queue with no consumer. This translates and forwards them.
 *
 * Only the three agents that have a real worker are routed. A0 parse/extract,
 * quantity recalculation, evening reminder, progress verification and rolling
 * forecast have no consumer yet and are intentionally left unrouted rather than
 * silently dropped -- see UNROUTED_PHASE9_QUEUES.
 */

export const PHASE9_BRIDGE_QUEUES = [
  PHASE9_A2_OBSERVATION_QUEUE,
  PHASE9_A3_DOCUMENT_QUEUE,
  PHASE9_A5_DAILY_PLAN_QUEUE,
] as const;

/** Phase 9 queues with no agent worker behind them yet. */
export const UNROUTED_PHASE9_QUEUES = [
  "buildwatch-v22-phase9-a0-parse-extract-design",
  "buildwatch-v22-phase9-recalculate-quantity",
  "buildwatch-v22-phase9-send-evening-reminder",
  "buildwatch-v22-phase9-verify-progress",
  "buildwatch-v22-phase9-calculate-rolling-forecast",
] as const;

export const DEFAULT_BRIDGE_TIMEZONE = "Asia/Ulaanbaatar";

function optionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * The Phase 9 payload carries no timezone, but A5 daily planning needs one to
 * resolve the plan date. Prefer a timezone the event itself carried, then the
 * deployment default.
 */
function resolveTimezone(payload: Phase9JobPayload, environment: NodeJS.ProcessEnv): string {
  return (
    optionalString(payload.payload, "timezone") ??
    optionalString(environment as Record<string, unknown>, "A5_TIMEZONE") ??
    optionalString(environment as Record<string, unknown>, "A2_TIMEZONE") ??
    DEFAULT_BRIDGE_TIMEZONE
  );
}

export async function forwardPhase9Job(
  boss: PgBoss,
  queue: string,
  payload: Phase9JobPayload,
  environment: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): Promise<void> {
  switch (queue) {
    case PHASE9_A2_OBSERVATION_QUEUE:
      await enqueueA2Observation(boss, {
        tenantId: payload.tenantId,
        projectRef: payload.projectId,
        trigger: "EVENT",
        eventType: payload.eventType,
        eventId: payload.eventId,
      });
      return;
    case PHASE9_A3_DOCUMENT_QUEUE:
      await enqueueA3DocumentRequest(boss, {
        tenantId: payload.tenantId,
        projectRef: payload.projectId,
        trigger: "REQUEST",
        requestId: payload.eventId,
      });
      return;
    case PHASE9_A5_DAILY_PLAN_QUEUE: {
      // MANAGER_REQUEST rejects a missing plan date, and an event-driven replan
      // always targets the current day in the project's timezone.
      const timezone = resolveTimezone(payload, environment);
      await enqueueA5DailyPlan(boss, {
        tenantId: payload.tenantId,
        projectId: payload.projectId,
        planDate: optionalString(payload.payload, "planDate") ?? dateInTimezone(now(), timezone),
        timezone,
        trigger: "MANAGER_REQUEST",
        requestId: payload.eventId,
      });
      return;
    }
    default:
      throw new Error(`No Phase 9 bridge route registered for queue ${queue}`);
  }
}

export async function ensurePhase9BridgeQueues(
  boss: PgBoss,
  config: WorkerRuntimeConfig,
): Promise<void> {
  for (const queue of PHASE9_BRIDGE_QUEUES) {
    await ensureQueueWithDeadLetter(boss, queue, config);
  }
}

export async function registerPhase9BridgeWorker(
  boss: PgBoss,
  workerConfig?: WorkerRuntimeConfig,
): Promise<string[]> {
  const config = workerConfig ?? resolveWorkerRuntimeConfig();
  await ensurePhase9BridgeQueues(boss, config);

  const workerIds: string[] = [];
  for (const queue of PHASE9_BRIDGE_QUEUES) {
    const handler = async (jobs: Job<Phase9JobPayload>[]) => {
      for (const job of jobs) {
        await forwardPhase9Job(boss, queue, phase9JobPayloadSchema.parse(job.data));
      }
    };
    workerIds.push(
      await boss.work<Phase9JobPayload>(
        queue,
        {
          localConcurrency: config.concurrency,
          heartbeatRefreshSeconds: Math.max(5, Math.floor(config.heartbeatSeconds / 2)),
        },
        handler,
      ),
    );
  }
  return workerIds;
}
