import "dotenv/config";

import { PgBoss } from "pg-boss";
import { registerProjectAnalysisWorker } from "../analysis/index.js";
import { prisma } from "../prisma.js";
import {
  createAgentLogger,
  resolveWorkerRuntimeConfig,
  startSentryErrorReporter,
} from "../runtime/index.js";

async function main() {
  const logger = createAgentLogger({ service: "analysis-worker" });
  const sentry = startSentryErrorReporter(process.env);
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to start the analysis worker");
  }

  const boss = new PgBoss(connectionString);
  const workerConfig = resolveWorkerRuntimeConfig(process.env);
  boss.on("error", (error) => {
    logger.error("queue.error", { message: error.message });
    sentry.captureException(error, { worker: "ANALYSIS" });
  });

  await boss.start();
  const workerId = await registerProjectAnalysisWorker(boss, undefined, workerConfig);
  logger.info("worker.started", {
    queue: "analyze-project",
    workerId,
    concurrency: workerConfig.concurrency,
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await boss.stop({
      graceful: true,
      timeout: 30_000,
    });
    await prisma.$disconnect();
    await sentry.flush();
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch(async (error) => {
  const reporter = startSentryErrorReporter(process.env);
  reporter.captureException(error, {
    worker: "ANALYSIS",
    phase: "startup",
  });
  console.error(
    `Analysis worker failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  await reporter.flush();
  await prisma.$disconnect();
  process.exitCode = 1;
});
