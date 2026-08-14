import "dotenv/config";

import { resolve } from "node:path";
import { PgBoss } from "pg-boss";
import { prisma } from "../prisma.js";
import {
  registerA3DocumentWorker,
  resolveReportRuntimeConfig,
  runAutomatedA3Documents,
  scheduleA3Documents,
} from "../reporting/index.js";
import {
  createAgentLogger,
  resolveWorkerRuntimeConfig,
  startSentryErrorReporter,
} from "../runtime/index.js";

function environmentBoolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function scheduledProjects(value: string | undefined, fallback: string) {
  return [
    ...new Set(
      (value ?? fallback)
        .split(",")
        .map((project) => project.trim())
        .filter(Boolean),
    ),
  ];
}

function automatedOutputDirectory(
  root: string | undefined,
  projectRef: string,
  asOf: string,
  requestId: string,
) {
  if (!root?.trim()) {
    return undefined;
  }

  return resolve(process.cwd(), root, `${projectRef}-${asOf.slice(0, 10)}-${requestId}`);
}

async function main() {
  const logger = createAgentLogger({ service: "a3-worker" });
  const sentry = startSentryErrorReporter(process.env);
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to start the A3 worker");
  }

  const config = resolveReportRuntimeConfig(process.env, {
    help: false,
  });
  const cron = process.env.A3_SCHEDULE_CRON?.trim() || "0 7 * * 1";
  const timezone = process.env.A3_TIMEZONE?.trim() || "Asia/Ulaanbaatar";
  const noPdf = environmentBoolean(process.env.A3_NO_PDF);
  const projects = scheduledProjects(process.env.A3_SCHEDULE_PROJECTS, config.projectRef);
  const boss = new PgBoss(connectionString);
  const workerConfig = resolveWorkerRuntimeConfig(process.env);

  boss.on("error", (error) => {
    logger.error("queue.error", { message: error.message });
    sentry.captureException(error, { worker: "A3" });
  });
  await boss.start();

  for (const projectRef of projects) {
    const scheduleKey = await scheduleA3Documents(boss, {
      tenantId: config.tenantId,
      projectRef,
      asOf: process.env.A3_SCHEDULE_AS_OF?.trim(),
      cron,
      timezone,
      noPdf,
      analysisOnly: config.analysisOnly,
    });
    logger.info("schedule.registered", {
      projectRef,
      cron,
      timezone,
      scheduleKey,
    });
  }

  const workerId = await registerA3DocumentWorker(
    boss,
    async (job) => {
      const result = await runAutomatedA3Documents({
        tenantId: job.tenantId,
        projectRef: job.projectRef,
        asOf: job.asOf,
        answerKeyPath: config.answerKeyPath,
        requestId: job.requestId,
        trigger: job.trigger,
        noPdf: job.noPdf,
        analysisOnly: job.analysisOnly,
        outputDirectory: automatedOutputDirectory(
          process.env.A3_AUTOMATION_OUTPUT_ROOT,
          job.projectRef,
          job.asOf,
          job.requestId,
        ),
      });

      return {
        runId: result.persisted.runId,
        draftIds: result.persisted.draftIds,
        outputDirectory: result.paths.outputDirectory,
      };
    },
    undefined,
    workerConfig,
  );
  logger.info("worker.started", {
    queue: "a3-generate-documents",
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
  reporter.captureException(error, { worker: "A3", phase: "startup" });
  console.error(`A3 worker failed: ${error instanceof Error ? error.message : String(error)}`);
  await reporter.flush();
  await prisma.$disconnect();
  process.exitCode = 1;
});
