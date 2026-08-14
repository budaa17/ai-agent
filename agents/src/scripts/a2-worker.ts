import "dotenv/config";

import { PgBoss } from "pg-boss";
import { createChatModel } from "../agent/index.js";
import { prisma } from "../prisma.js";
import {
  registerA2ObservationWorker,
  enqueueA2Observation,
  resolveRecommendationRuntimeConfig,
  runRecommendationAgent,
  scheduleA2NightlyObservation,
} from "../recommendations/index.js";
import { startLangfuseTelemetry } from "../telemetry/index.js";
import { calculateNightlyCatchUpRuns } from "../phase2/index.js";
import {
  createAgentLogger,
  createProductionAgentRuntimeGuard,
  resolveWorkerRuntimeConfig,
  startSentryErrorReporter,
} from "../runtime/index.js";

async function scheduledProjects(value: string | undefined, fallback: string, tenantId: string) {
  if (value?.trim()) {
    return [
      ...new Set(
        value
          .split(",")
          .map((project) => project.trim())
          .filter(Boolean),
      ),
    ];
  }

  const projects = await prisma.project.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
    },
    select: {
      id: true,
    },
  });

  return projects.length > 0 ? projects.map((project) => project.id) : [fallback];
}

async function main() {
  const logger = createAgentLogger({ service: "a2-worker" });
  const sentry = startSentryErrorReporter(process.env);
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to start the A2 worker");
  }

  const config = resolveRecommendationRuntimeConfig(process.env, {
    help: false,
  });
  const model = createChatModel(config);
  const telemetry = startLangfuseTelemetry(process.env);
  const workerConfig = resolveWorkerRuntimeConfig(process.env);
  const runtimeGuard = createProductionAgentRuntimeGuard(process.env, prisma);
  const boss = new PgBoss(connectionString);
  const cron = process.env.A2_NIGHTLY_CRON?.trim() || "0 1 * * *";
  const timezone = process.env.A2_TIMEZONE?.trim() || "Asia/Ulaanbaatar";
  const scheduleRefreshMs = Number(process.env.A2_SCHEDULE_REFRESH_MS ?? "300000");

  boss.on("error", (error) => {
    logger.error("queue.error", { message: error.message });
    sentry.captureException(error, { worker: "A2" });
  });

  await boss.start();
  const scheduled = new Set<string>();
  const refreshSchedules = async () => {
    const projects = await scheduledProjects(
      process.env.A2_SCHEDULE_PROJECTS,
      config.projectRef,
      config.tenantId,
    );

    for (const projectRef of projects) {
      const scheduleKey = await scheduleA2NightlyObservation(boss, {
        tenantId: config.tenantId,
        projectRef,
        cron,
        timezone,
        maxSteps: config.maxSteps,
      });

      if (!scheduled.has(projectRef)) {
        scheduled.add(projectRef);
        logger.info("schedule.registered", {
          projectRef,
          cron,
          timezone,
          scheduleKey,
        });

        const project = await prisma.project.findFirst({
          where: {
            tenantId: config.tenantId,
            OR: [{ id: projectRef }, { code: projectRef }],
          },
          select: { id: true },
        });
        const latest =
          project === null
            ? null
            : await prisma.agentRun.findFirst({
                where: {
                  tenantId: config.tenantId,
                  projectId: project.id,
                  agentType: {
                    in: ["A2", "A2_RECOMMENDATION"],
                  },
                  status: "COMPLETED",
                },
                orderBy: { completedAt: "desc" },
                select: { completedAt: true },
              });
        const cronHour = Number(cron.trim().split(/\s+/u)[1]);

        if (latest?.completedAt && Number.isInteger(cronHour) && cronHour >= 0 && cronHour <= 23) {
          const now = new Date();
          const catchUps = calculateNightlyCatchUpRuns({
            lastSuccessfulAt: latest.completedAt.toISOString(),
            now: now.toISOString(),
            timezone,
            localHour: cronHour,
            maxRuns: 7,
          });

          for (const asOf of catchUps) {
            await enqueueA2Observation(boss, {
              tenantId: config.tenantId,
              projectRef,
              trigger: "NIGHTLY",
              asOf,
              requestId: `catch-up-${asOf}`,
              maxSteps: config.maxSteps,
            });
          }
        }
      }
    }
  };
  await refreshSchedules();
  const refreshTimer = setInterval(
    () => {
      void refreshSchedules().catch((error) => {
        logger.error("schedule.refresh_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        sentry.captureException(error, { worker: "A2" });
      });
    },
    Math.max(60_000, scheduleRefreshMs),
  );

  const workerId = await registerA2ObservationWorker(
    boss,
    async (job) => {
      const result = await telemetry.runWithTrace("a2-observation-job", (traceId) =>
        runRecommendationAgent({
          tenantId: job.tenantId,
          projectRef: job.projectRef,
          asOf: job.asOf,
          requestId: job.requestId,
          trigger: job.trigger,
          eventType: job.eventType,
          eventId: job.eventId,
          maxSteps: job.maxSteps,
          model,
          langfuseTraceId: traceId,
          recordTelemetryContent: config.recordTelemetryContent,
          runtimeGuard,
        }),
      );

      return {
        runId: result.runId,
        posture: result.report.riskBrief.posture,
        observationCount: result.report.riskBrief.observations.length,
        recommendationCount: result.report.recommendations.length,
      };
    },
    undefined,
    workerConfig,
  );

  logger.info("worker.started", {
    queue: "a2-observe-project",
    workerId,
    concurrency: workerConfig.concurrency,
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    clearInterval(refreshTimer);
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
  reporter.captureException(error, { worker: "A2", phase: "startup" });
  console.error(`A2 worker failed: ${error instanceof Error ? error.message : String(error)}`);
  await reporter.flush();
  await prisma.$disconnect();
  process.exitCode = 1;
});
