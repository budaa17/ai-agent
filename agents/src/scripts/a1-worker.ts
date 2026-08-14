import "dotenv/config";

import { PgBoss } from "pg-boss";
import { createChatModel } from "../agent/index.js";
import { prisma } from "../prisma.js";
import {
  registerA1IntakeWorker,
  registerProjectUpdateDraft,
  resolveA1ModelRuntimeConfig,
  sourceFromA1IntakeJob,
} from "../structuring/index.js";
import { startLangfuseTelemetry } from "../telemetry/index.js";
import {
  createAgentLogger,
  createProductionAgentRuntimeGuard,
  resolveWorkerRuntimeConfig,
  startSentryErrorReporter,
} from "../runtime/index.js";

async function main() {
  const logger = createAgentLogger({ service: "a1-worker" });
  const sentry = startSentryErrorReporter(process.env);
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to start the A1 intake worker");
  }

  const modelConfig = resolveA1ModelRuntimeConfig(process.env, {
    help: false,
  });
  const model = createChatModel(modelConfig);
  const telemetry = startLangfuseTelemetry(process.env);
  const workerConfig = resolveWorkerRuntimeConfig(process.env);
  const runtimeGuard = createProductionAgentRuntimeGuard(process.env, prisma);
  const boss = new PgBoss(connectionString);

  boss.on("error", (error) => {
    logger.error("queue.error", { message: error.message });
    sentry.captureException(error, { worker: "A1" });
  });

  await boss.start();
  const workerId = await registerA1IntakeWorker(
    boss,
    async (payload) => {
      const source = sourceFromA1IntakeJob(payload);
      const result = await registerProjectUpdateDraft({
        tenantRef: payload.tenantRef,
        projectRef: payload.projectRef,
        sourceText: source.text,
        sourceImage: source.image,
        referenceDate: payload.referenceDate,
        requestId: payload.requestId,
        model,
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
        runtimeGuard,
      });

      return {
        draftId: result.draftId,
        status: result.status,
        reused: result.reused,
      };
    },
    workerConfig,
  );

  logger.info("worker.started", {
    queue: "a1-register-project-update",
    workerId,
    concurrency: workerConfig.concurrency,
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await boss.stop({ graceful: true, timeout: 30_000 });
    await prisma.$disconnect();
    await telemetry.shutdown();
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
  reporter.captureException(error, { worker: "A1", phase: "startup" });
  console.error(`A1 worker failed: ${error instanceof Error ? error.message : String(error)}`);
  await reporter.flush();
  await prisma.$disconnect();
  process.exitCode = 1;
});
