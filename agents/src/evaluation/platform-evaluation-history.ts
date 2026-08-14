import { z } from "zod";

const platformEvaluationRunInputSchema = z
  .object({
    suiteKey: z.string().trim().min(1).max(120),
    suiteVersion: z.string().trim().min(1).max(100),
    agentType: z.string().trim().min(1).max(100),
    agentRelease: z.string().trim().min(1).max(300),
    promptVersion: z.string().trim().min(1).max(200),
    toolBundleVersion: z.string().trim().min(1).max(200),
    provider: z.string().trim().min(1).max(100),
    modelId: z.string().trim().min(1).max(200),
    caseCount: z.number().int().positive(),
    passedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative().default(0),
    startedAt: z.date(),
    completedAt: z.date(),
    sourceRef: z.string().trim().min(1).max(500).nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.passedCount + value.failedCount + value.skippedCount !== value.caseCount) {
      context.addIssue({
        code: "custom",
        path: ["caseCount"],
        message: "passed, failed and skipped counts must equal caseCount",
      });
    }
    if (value.completedAt.getTime() < value.startedAt.getTime()) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "completedAt cannot be before startedAt",
      });
    }
  });

export type PlatformEvaluationRunInput = z.input<typeof platformEvaluationRunInputSchema>;

export interface PlatformEvaluationRunWriter {
  platformEvaluationRun: {
    create(input: { data: z.output<typeof platformEvaluationRunInputSchema> }): Promise<unknown>;
  };
}

/**
 * Persists only aggregate evaluation evidence. Case inputs, outputs, prompts,
 * errors and file content never cross into the platform monitoring read model.
 */
export async function persistPlatformEvaluationRun(
  writer: PlatformEvaluationRunWriter,
  input: PlatformEvaluationRunInput,
): Promise<void> {
  const data = platformEvaluationRunInputSchema.parse(input);
  await writer.platformEvaluationRun.create({ data });
}
