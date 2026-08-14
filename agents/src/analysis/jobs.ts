import { PgBoss, type Job } from "pg-boss";
import { z } from "zod";
import { createPgBossKey } from "../jobs/pg-boss-key.js";
import { PROJECT_ANALYSIS_QUEUE } from "../jobs/queue-names.js";
import {
  ensureQueueWithDeadLetter,
  resolveWorkerRuntimeConfig,
  type WorkerRuntimeConfig,
} from "../runtime/index.js";
import {
  analyzeProjectFromDatabase,
  type AnalyzeProjectDatabaseInput,
  type ProjectAnalysisResult,
} from "./analyze.js";

export { PROJECT_ANALYSIS_QUEUE };

export const projectAnalysisJobPayloadSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    projectId: z.string().trim().min(1),
    asOf: z.string().datetime(),
  })
  .strict();

export type ProjectAnalysisJobPayload = z.infer<typeof projectAnalysisJobPayloadSchema>;

export type ProjectAnalysisJobRunner = (
  input: AnalyzeProjectDatabaseInput,
) => Promise<ProjectAnalysisResult>;

export async function ensureProjectAnalysisQueue(
  boss: PgBoss,
  config = resolveWorkerRuntimeConfig(),
) {
  return ensureQueueWithDeadLetter(boss, PROJECT_ANALYSIS_QUEUE, config);
}

export async function registerProjectAnalysisWorker(
  boss: PgBoss,
  runAnalysis: ProjectAnalysisJobRunner = analyzeProjectFromDatabase,
  workerConfig?: WorkerRuntimeConfig,
) {
  const config = workerConfig ?? resolveWorkerRuntimeConfig();
  await ensureProjectAnalysisQueue(boss, config);

  const handler = async (jobs: Job<ProjectAnalysisJobPayload>[]) => {
    const job = jobs[0];

    if (!job) {
      throw new Error("Analysis worker received an empty job batch");
    }

    const payload = projectAnalysisJobPayloadSchema.parse(job.data);

    return runAnalysis({
      tenantId: payload.tenantId,
      projectRef: payload.projectId,
      asOf: payload.asOf,
    });
  };

  return workerConfig === undefined
    ? boss.work<ProjectAnalysisJobPayload, ProjectAnalysisResult>(PROJECT_ANALYSIS_QUEUE, handler)
    : boss.work<ProjectAnalysisJobPayload, ProjectAnalysisResult>(
        PROJECT_ANALYSIS_QUEUE,
        {
          localConcurrency: config.concurrency,
          heartbeatRefreshSeconds: Math.max(5, Math.floor(config.heartbeatSeconds / 2)),
        },
        handler,
      );
}

export async function enqueueProjectAnalysis(boss: PgBoss, input: ProjectAnalysisJobPayload) {
  const payload = projectAnalysisJobPayloadSchema.parse(input);
  await ensureProjectAnalysisQueue(boss);

  return boss.send(PROJECT_ANALYSIS_QUEUE, payload, {
    singletonKey: createPgBossKey(
      PROJECT_ANALYSIS_QUEUE,
      payload.tenantId,
      payload.projectId,
      payload.asOf,
    ),
  });
}
