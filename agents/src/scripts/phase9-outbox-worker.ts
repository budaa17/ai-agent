import "dotenv/config";
import { PgBoss } from "pg-boss";
import { prisma } from "../prisma.js";
import {
  CompositePhase9EventPublisher,
  PgBossPhase9EventPublisher,
  Phase9OutboxRelay,
  PrismaPhase9Store,
  RabbitMqPhase9EventPublisher,
} from "../backend/index.js";
import {
  AgentOperationalMetrics,
  createAgentLogger,
  startSentryErrorReporter,
} from "../runtime/logging.js";

async function main() {
  const logger = createAgentLogger({ service: "buildwatch-outbox-worker" });
  const errorReporter = startSentryErrorReporter();
  const metrics = new AgentOperationalMetrics();
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString.trim() === "") {
    throw new Error("DATABASE_URL is required");
  }
  const boss = new PgBoss(connectionString);
  await boss.start();
  const rabbit =
    process.env.RABBITMQ_URL === undefined
      ? null
      : new RabbitMqPhase9EventPublisher(process.env.RABBITMQ_URL);
  if (process.env.NODE_ENV === "production" && rabbit === null) {
    throw new Error("RABBITMQ_URL is required in production");
  }
  const publisher = new CompositePhase9EventPublisher([
    new PgBossPhase9EventPublisher(boss),
    ...(rabbit === null ? [] : [rabbit]),
  ]);
  const relay = new Phase9OutboxRelay(new PrismaPhase9Store(prisma), publisher, {
    workerId: `phase9-outbox-${process.pid}`,
  });
  let stopping = false;
  let consecutiveFailures = 0;
  let lastMetricsLogAt = 0;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await rabbit?.close();
    await boss.stop({ graceful: true, timeout: 30_000 });
    await prisma.$disconnect();
    await errorReporter.flush();
    logger.info("outbox_worker_stopped");
  };
  process.once("SIGINT", () => {
    stop().catch(() => (process.exitCode = 1));
  });
  process.once("SIGTERM", () => {
    stop().catch(() => (process.exitCode = 1));
  });
  logger.info("outbox_worker_started", {
    workerId: `phase9-outbox-${process.pid}`,
    rabbitMqEnabled: rabbit !== null,
    sentryEnabled: errorReporter.enabled,
  });
  while (!stopping) {
    try {
      const startedAt = performance.now();
      const result = await relay.processBatch();
      consecutiveFailures = 0;
      metrics.increment("outbox_batches_total");
      metrics.increment("outbox_claimed_total", result.claimed);
      metrics.increment("outbox_published_total", result.published);
      metrics.increment("outbox_failed_total", result.failed);
      metrics.increment("outbox_dead_lettered_total", result.deadLettered);
      metrics.observe("outbox_batch_duration_ms", performance.now() - startedAt);
      if (result.claimed > 0) logger.info("outbox_batch_completed", result);
      if (Date.now() - lastMetricsLogAt >= 60_000) {
        lastMetricsLogAt = Date.now();
        logger.info("outbox_metrics_snapshot", metrics.snapshot());
      }
      if (result.claimed === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    } catch (error) {
      consecutiveFailures += 1;
      metrics.increment("outbox_worker_errors_total");
      errorReporter.captureException(error, { consecutiveFailures });
      logger.error("outbox_batch_failed", {
        consecutiveFailures,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      if (consecutiveFailures >= 5) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(30_000, 1_000 * 2 ** consecutiveFailures)),
      );
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Phase 9 outbox worker failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
