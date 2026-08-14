import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

export const phase11OutboxReplayRequestSchema = z
  .object({
    eventId: z.string().trim().min(1).max(200),
    tenantId: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(10).max(1_000),
    apply: z.boolean(),
    allowFailed: z.boolean().default(false),
  })
  .strict();

export async function replayPhase11OutboxEvent(
  client: PrismaClient,
  input: z.input<typeof phase11OutboxReplayRequestSchema>,
  now = new Date(),
) {
  const request = phase11OutboxReplayRequestSchema.parse(input);
  const event = await client.outboxEvent.findUnique({ where: { id: request.eventId } });
  if (event === null) throw new Error("Outbox event was not found");
  if (event.tenantId !== request.tenantId || event.projectId !== request.projectId) {
    throw new Error("Outbox replay scope does not match the event");
  }
  const allowedStatuses = request.allowFailed
    ? new Set(["DEAD_LETTER", "FAILED"])
    : new Set(["DEAD_LETTER"]);
  if (!allowedStatuses.has(event.status)) {
    throw new Error(`Outbox event status ${event.status} is not replayable`);
  }
  if (!request.apply) {
    return {
      eventId: event.id,
      previousStatus: event.status,
      status: event.status,
      applied: false,
    };
  }
  return client.$transaction(
    async (transaction) => {
      const updated = await transaction.outboxEvent.updateMany({
        where: {
          id: event.id,
          tenantId: request.tenantId,
          projectId: request.projectId,
          status: event.status,
        },
        data: {
          status: "PENDING",
          availableAt: now,
          publishedAt: null,
          retryCount: 0,
          lastErrorCode: null,
          lockedAt: null,
          lockedBy: null,
        },
      });
      if (updated.count !== 1) throw new Error("Outbox event changed during replay");
      await transaction.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId: request.tenantId,
          projectId: request.projectId,
          actorUserId: null,
          actorRole: null,
          action: "OUTBOX_EVENT_REPLAYED",
          entityType: "OUTBOX_EVENT",
          entityId: event.id,
          reason: request.reason,
          correlationId: `phase11-dlq-${randomUUID()}`,
          sourceVersion: "buildwatch-v22-phase11-dlq-v1",
          beforeHash: null,
          afterHash: null,
          metadata: {
            previousStatus: event.status,
            previousRetryCount: event.retryCount,
            previousLastErrorCode: event.lastErrorCode,
          } as Prisma.InputJsonValue,
        },
      });
      return {
        eventId: event.id,
        previousStatus: event.status,
        status: "PENDING" as const,
        applied: true,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
