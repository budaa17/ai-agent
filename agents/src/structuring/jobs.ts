import type { Job, PgBoss } from "pg-boss";
import { z } from "zod";
import { createPgBossKey } from "../jobs/pg-boss-key.js";
import { A1_INTAKE_QUEUE } from "../jobs/queue-names.js";
import {
  ensureQueueWithDeadLetter,
  resolveWorkerRuntimeConfig,
  type WorkerRuntimeConfig,
} from "../runtime/index.js";
import { isoDateSchema } from "./schema.js";
import { projectUpdateImageSecurityV1Schema } from "../artifacts/index.js";
import {
  normalizeProjectUpdateSource,
  projectUpdateImageMediaTypeSchema,
  projectUpdateImagePreprocessingSchema,
  type ProjectUpdateSource,
} from "./source.js";

export { A1_INTAKE_QUEUE };

const queuedImageSchema = z
  .object({
    dataBase64: z.string().min(1).max(14_000_000),
    mediaType: projectUpdateImageMediaTypeSchema,
    fileName: z.string().trim().min(1).max(500),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    preprocessing: projectUpdateImagePreprocessingSchema.optional(),
    security: projectUpdateImageSecurityV1Schema.optional(),
  })
  .strict();

export const a1IntakeJobPayloadSchema = z
  .object({
    requestId: z.string().trim().min(1).max(200),
    tenantRef: z.string().trim().min(1).max(200),
    projectRef: z.string().trim().min(1).max(200).optional(),
    referenceDate: isoDateSchema,
    sourceText: z.string().trim().min(1).max(20_000).optional(),
    sourceImage: queuedImageSchema.optional(),
  })
  .strict()
  .refine((payload) => payload.sourceText || payload.sourceImage, {
    message: "Either sourceText or sourceImage is required",
  });

export type A1IntakeJobPayload = z.infer<typeof a1IntakeJobPayloadSchema>;
export type A1IntakeJobRunner = (payload: A1IntakeJobPayload) => Promise<unknown>;

export function createA1IntakeJobPayload(input: {
  requestId: string;
  tenantRef: string;
  projectRef?: string;
  referenceDate: string;
  source: ProjectUpdateSource;
}): A1IntakeJobPayload {
  const source = normalizeProjectUpdateSource(input.source);

  return a1IntakeJobPayloadSchema.parse({
    requestId: input.requestId,
    tenantRef: input.tenantRef,
    projectRef: input.projectRef,
    referenceDate: input.referenceDate,
    sourceText: source.text,
    sourceImage: source.image
      ? {
          dataBase64: Buffer.from(source.image.data).toString("base64"),
          mediaType: source.image.mediaType,
          fileName: source.image.fileName,
          sha256: source.image.sha256,
          preprocessing: source.image.preprocessing,
          security: source.image.security,
        }
      : undefined,
  });
}

export function sourceFromA1IntakeJob(payloadInput: A1IntakeJobPayload): ProjectUpdateSource {
  const payload = a1IntakeJobPayloadSchema.parse(payloadInput);

  return normalizeProjectUpdateSource({
    text: payload.sourceText,
    image: payload.sourceImage
      ? {
          data: Buffer.from(payload.sourceImage.dataBase64, "base64"),
          mediaType: payload.sourceImage.mediaType,
          fileName: payload.sourceImage.fileName,
          sha256: payload.sourceImage.sha256,
          preprocessing: payload.sourceImage.preprocessing,
          security: payload.sourceImage.security,
        }
      : undefined,
  });
}

export async function ensureA1IntakeQueue(boss: PgBoss, config = resolveWorkerRuntimeConfig()) {
  return ensureQueueWithDeadLetter(boss, A1_INTAKE_QUEUE, config);
}

export async function registerA1IntakeWorker(
  boss: PgBoss,
  runIntake: A1IntakeJobRunner,
  workerConfig?: WorkerRuntimeConfig,
) {
  const config = workerConfig ?? resolveWorkerRuntimeConfig();
  await ensureA1IntakeQueue(boss, config);

  const handler = async (jobs: Job<A1IntakeJobPayload>[]) => {
    const job = jobs[0];

    if (!job) {
      throw new Error("A1 intake worker received an empty job batch");
    }

    return runIntake(a1IntakeJobPayloadSchema.parse(job.data));
  };

  return workerConfig === undefined
    ? boss.work<A1IntakeJobPayload>(A1_INTAKE_QUEUE, handler)
    : boss.work<A1IntakeJobPayload>(
        A1_INTAKE_QUEUE,
        {
          localConcurrency: config.concurrency,
          heartbeatRefreshSeconds: Math.max(5, Math.floor(config.heartbeatSeconds / 2)),
        },
        handler,
      );
}

export async function enqueueA1Intake(boss: PgBoss, input: A1IntakeJobPayload) {
  const payload = a1IntakeJobPayloadSchema.parse(input);
  await ensureA1IntakeQueue(boss);

  return boss.send(A1_INTAKE_QUEUE, payload, {
    singletonKey: createPgBossKey(A1_INTAKE_QUEUE, payload.requestId),
  });
}
