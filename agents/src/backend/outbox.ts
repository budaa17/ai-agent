import { once } from "node:events";
import amqp, { type ChannelModel, type ConfirmChannel } from "amqplib";
import { randomUUID } from "node:crypto";
import { phase9Sha256 } from "./security.js";
import type {
  Phase9ConsumedEventRecord,
  Phase9OutboxRecord,
  Phase9Store,
  Phase9StoreTransaction,
} from "./store.js";

export interface Phase9EventPublisher {
  publish(event: Phase9OutboxRecord): Promise<void>;
}

export class CompositePhase9EventPublisher implements Phase9EventPublisher {
  constructor(private readonly publishers: readonly Phase9EventPublisher[]) {}

  async publish(event: Phase9OutboxRecord): Promise<void> {
    for (const publisher of this.publishers) {
      await publisher.publish(event);
    }
  }
}

export class RabbitMqPhase9EventPublisher implements Phase9EventPublisher {
  #connection: ChannelModel | null = null;
  #channel: ConfirmChannel | null = null;

  constructor(
    private readonly url: string,
    private readonly exchange = "buildwatch.domain.v1",
  ) {}

  async #connect(): Promise<ConfirmChannel> {
    if (this.#channel !== null) return this.#channel;
    this.#connection = await amqp.connect(this.url);
    this.#channel = await this.#connection.createConfirmChannel();
    await this.#channel.assertExchange(this.exchange, "topic", {
      durable: true,
      autoDelete: false,
    });
    return this.#channel;
  }

  async publish(event: Phase9OutboxRecord): Promise<void> {
    const channel = await this.#connect();
    const accepted = channel.publish(
      this.exchange,
      event.eventType.toLocaleLowerCase("en-US").replaceAll("_", "."),
      Buffer.from(JSON.stringify(event.payload), "utf8"),
      {
        persistent: true,
        contentType: "application/json",
        contentEncoding: "utf-8",
        messageId: event.idempotencyKey,
        correlationId:
          typeof event.headers.correlationId === "string" ? event.headers.correlationId : event.id,
        timestamp: Math.floor(Date.parse(event.createdAt) / 1_000),
        type: event.eventType,
        headers: {
          ...event.headers,
          tenantId: event.tenantId,
          projectId: event.projectId,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          aggregateVersion: event.aggregateVersion,
        },
      },
    );
    if (!accepted) await once(channel, "drain");
    await channel.waitForConfirms();
  }

  async close(): Promise<void> {
    const channel = this.#channel;
    const connection = this.#connection;
    this.#channel = null;
    this.#connection = null;
    await channel?.close();
    await connection?.close();
  }
}

export interface Phase9OutboxRelayOptions {
  workerId?: string;
  batchSize?: number;
  maxRetries?: number;
  baseRetryMs?: number;
  now?: () => Date;
}

export class Phase9OutboxRelay {
  readonly #workerId: string;
  readonly #batchSize: number;
  readonly #maxRetries: number;
  readonly #baseRetryMs: number;
  readonly #now: () => Date;

  constructor(
    private readonly store: Phase9Store,
    private readonly publisher: Phase9EventPublisher,
    options: Phase9OutboxRelayOptions = {},
  ) {
    this.#workerId = options.workerId ?? `outbox-${randomUUID()}`;
    this.#batchSize = options.batchSize ?? 50;
    this.#maxRetries = options.maxRetries ?? 8;
    this.#baseRetryMs = options.baseRetryMs ?? 1_000;
    this.#now = options.now ?? (() => new Date());
  }

  async #claim(): Promise<Phase9OutboxRecord[]> {
    return this.store.transaction(async (transaction) => {
      const claimedAt = this.#now().toISOString();
      const due = await transaction.listDueOutbox(claimedAt, this.#batchSize);
      for (const event of due) {
        await transaction.updateOutbox({
          ...event,
          lockedAt: claimedAt,
          lockedBy: this.#workerId,
        });
      }
      return due.map((event) => ({
        ...event,
        lockedAt: claimedAt,
        lockedBy: this.#workerId,
      }));
    });
  }

  async processBatch(): Promise<{
    claimed: number;
    published: number;
    failed: number;
    deadLettered: number;
  }> {
    const claimed = await this.#claim();
    let published = 0;
    let failed = 0;
    let deadLettered = 0;
    for (const event of claimed) {
      try {
        await this.publisher.publish(event);
        await this.store.transaction(async (transaction) => {
          await transaction.updateOutbox({
            ...event,
            status: "PUBLISHED",
            publishedAt: this.#now().toISOString(),
            lockedAt: null,
            lockedBy: null,
            lastErrorCode: null,
          });
        });
        published += 1;
      } catch (error) {
        const retryCount = event.retryCount + 1;
        const dead = retryCount >= this.#maxRetries;
        await this.store.transaction(async (transaction) => {
          await transaction.updateOutbox({
            ...event,
            status: dead ? "DEAD_LETTER" : "FAILED",
            retryCount,
            lastErrorCode: phase9Sha256(
              error instanceof Error ? error.name : "UNKNOWN_PUBLISH_ERROR",
            ).slice(0, 24),
            availableAt: new Date(
              this.#now().getTime() + this.#baseRetryMs * 2 ** Math.min(retryCount - 1, 10),
            ).toISOString(),
            lockedAt: null,
            lockedBy: null,
          });
        });
        failed += 1;
        if (dead) deadLettered += 1;
      }
    }
    return { claimed: claimed.length, published, failed, deadLettered };
  }
}

export async function consumePhase9Event<T extends Record<string, unknown>>(
  store: Phase9Store,
  event: Phase9OutboxRecord,
  consumer: string,
  handler: (transaction: Phase9StoreTransaction, event: Phase9OutboxRecord) => Promise<T>,
): Promise<{ replayed: boolean; resultHash: string }> {
  return store.transaction(async (transaction) => {
    const existing = await transaction.findConsumedEvent(consumer, event.idempotencyKey);
    if (existing !== null) {
      return { replayed: true, resultHash: existing.resultHash };
    }
    const result = await handler(transaction, event);
    const resultHash = phase9Sha256(result);
    const consumed: Phase9ConsumedEventRecord = {
      id: randomUUID(),
      tenantId: event.tenantId,
      projectId: event.projectId,
      consumer,
      eventId: event.id,
      idempotencyKey: event.idempotencyKey,
      resultHash,
      consumedAt: new Date().toISOString(),
    };
    await transaction.createConsumedEvent(consumed);
    return { replayed: false, resultHash };
  });
}

export async function createPhase9NotificationForEvent(
  transaction: Phase9StoreTransaction,
  event: Phase9OutboxRecord,
): Promise<{ notificationId: string }> {
  const notificationId = randomUUID();
  const deliveredAt = new Date().toISOString();
  await transaction.createNotification({
    id: notificationId,
    tenantId: event.tenantId,
    projectId: event.projectId,
    userId: null,
    eventId: event.id,
    channel: "IN_APP",
    templateCode: event.eventType,
    payload: event.payload,
    // An IN_APP notification is delivered by the durable insert itself. Leaving
    // it PENDING would require a transport worker that does not exist and would
    // make the Control Tower report a false delivery outage.
    status: "SENT",
    sentAt: deliveredAt,
    createdAt: deliveredAt,
  });
  return { notificationId };
}
