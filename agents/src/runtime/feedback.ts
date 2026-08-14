import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { contractIdentifierSchema, contractIsoDateTimeSchema } from "../contracts/common.js";

export const agentFeedbackCategorySchema = z.enum([
  "GROUNDING",
  "MISSING_CONTEXT",
  "PROMPT",
  "RULE",
  "DATA_QUALITY",
  "UX",
]);

export const agentFeedbackV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    feedbackId: contractIdentifierSchema,
    agentType: z.enum(["A1", "A2", "A3", "A4", "ALERT"]),
    feedbackType: z.enum([
      "FIELD_EDIT",
      "APPROVE",
      "EDIT",
      "DISCARD",
      "REJECT",
      "HELPFUL",
      "INCORRECT",
      "TRUE_ALERT",
      "FALSE_ALERT",
    ]),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    artifactId: contractIdentifierSchema,
    fieldPath: z.string().trim().min(1).max(500).nullable(),
    beforeValue: z.unknown().nullable(),
    afterValue: z.unknown().nullable(),
    reason: z.string().trim().min(1).max(2_000),
    category: agentFeedbackCategorySchema,
    reviewerId: contractIdentifierSchema,
    reviewedAt: contractIsoDateTimeSchema,
    promptVersion: z.string().trim().min(1).max(200),
    modelVersion: z.string().trim().min(1).max(200).nullable(),
    toolBundleVersion: z.string().trim().min(1).max(200),
    dataSnapshotVersion: z.string().trim().min(1).max(500),
    regressionStatus: z.enum(["CANDIDATE", "ACCEPTED", "REJECTED"]),
  })
  .strict()
  .superRefine((feedback, context) => {
    if (
      feedback.feedbackType === "FIELD_EDIT" &&
      (feedback.fieldPath === null || feedback.beforeValue === null || feedback.afterValue === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Field-level edits require a field path and before/after values",
        path: ["fieldPath"],
      });
    }
  });

export type AgentFeedbackV1 = z.infer<typeof agentFeedbackV1Schema>;

export class FileAgentFeedbackStore {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = path.resolve(directory);
  }

  #target(feedbackId: string) {
    if (!/^[A-Za-z0-9._-]+$/u.test(feedbackId)) {
      throw new Error("Unsafe feedback ID");
    }

    return path.join(this.#directory, `${feedbackId}.json`);
  }

  async save(input: AgentFeedbackV1) {
    const feedback = agentFeedbackV1Schema.parse(input);
    const target = this.#target(feedback.feedbackId);
    await mkdir(this.#directory, { recursive: true });

    try {
      return agentFeedbackV1Schema.parse(JSON.parse(await readFile(target, "utf8")));
    } catch (error) {
      const missing =
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT";

      if (!missing) {
        throw error;
      }
    }

    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(feedback, null, 2)}\n`, "utf8");
    await rename(temporary, target);
    return feedback;
  }

  async list() {
    await mkdir(this.#directory, { recursive: true });
    const files = (await readdir(this.#directory)).filter((name) => name.endsWith(".json")).sort();

    return Promise.all(
      files.map(async (name) =>
        agentFeedbackV1Schema.parse(
          JSON.parse(await readFile(path.join(this.#directory, name), "utf8")),
        ),
      ),
    );
  }
}

function prismaJson(value: unknown) {
  if (value === null) {
    return Prisma.JsonNull;
  }

  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new Error("Feedback values must be JSON serializable");
  }

  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

export class PrismaAgentFeedbackStore {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient = prisma) {
    this.#client = client;
  }

  async save(input: AgentFeedbackV1, options: { agentRunId?: string } = {}) {
    const feedback = agentFeedbackV1Schema.parse(input);
    const create = {
      id: feedback.feedbackId,
      agentRunId: options.agentRunId,
      tenantId: feedback.tenantId,
      projectId: feedback.projectId,
      agentType: feedback.agentType,
      feedbackType: feedback.feedbackType,
      artifactId: feedback.artifactId,
      fieldPath: feedback.fieldPath,
      beforeValue: prismaJson(feedback.beforeValue),
      afterValue: prismaJson(feedback.afterValue),
      reason: feedback.reason,
      category: feedback.category,
      reviewerId: feedback.reviewerId,
      reviewedAt: new Date(feedback.reviewedAt),
      promptVersion: feedback.promptVersion,
      modelVersion: feedback.modelVersion,
      toolBundleVersion: feedback.toolBundleVersion,
      dataSnapshotVersion: feedback.dataSnapshotVersion,
      regressionStatus: feedback.regressionStatus,
    };
    const record = await this.#client.agentFeedback.upsert({
      where: { id: feedback.feedbackId },
      create,
      update: {},
    });

    return agentFeedbackV1Schema.parse({
      schemaVersion: 1,
      feedbackId: record.id,
      agentType: record.agentType,
      feedbackType: record.feedbackType,
      tenantId: record.tenantId,
      projectId: record.projectId,
      artifactId: record.artifactId,
      fieldPath: record.fieldPath,
      beforeValue: record.beforeValue,
      afterValue: record.afterValue,
      reason: record.reason,
      category: record.category,
      reviewerId: record.reviewerId,
      reviewedAt: record.reviewedAt.toISOString(),
      promptVersion: record.promptVersion,
      modelVersion: record.modelVersion,
      toolBundleVersion: record.toolBundleVersion,
      dataSnapshotVersion: record.dataSnapshotVersion,
      regressionStatus: record.regressionStatus,
    });
  }

  async list(input: {
    tenantId: string;
    projectId: string;
    agentType?: AgentFeedbackV1["agentType"];
    regressionStatus?: AgentFeedbackV1["regressionStatus"];
    limit?: number;
  }) {
    const tenantId = contractIdentifierSchema.parse(input.tenantId);
    const projectId = contractIdentifierSchema.parse(input.projectId);
    const limit = z
      .number()
      .int()
      .min(1)
      .max(1_000)
      .parse(input.limit ?? 100);
    const records = await this.#client.agentFeedback.findMany({
      where: {
        tenantId,
        projectId,
        agentType: input.agentType,
        regressionStatus: input.regressionStatus,
      },
      orderBy: { reviewedAt: "desc" },
      take: limit,
    });

    return records.map((record) =>
      agentFeedbackV1Schema.parse({
        schemaVersion: 1,
        feedbackId: record.id,
        agentType: record.agentType,
        feedbackType: record.feedbackType,
        tenantId: record.tenantId,
        projectId: record.projectId,
        artifactId: record.artifactId,
        fieldPath: record.fieldPath,
        beforeValue: record.beforeValue,
        afterValue: record.afterValue,
        reason: record.reason,
        category: record.category,
        reviewerId: record.reviewerId,
        reviewedAt: record.reviewedAt.toISOString(),
        promptVersion: record.promptVersion,
        modelVersion: record.modelVersion,
        toolBundleVersion: record.toolBundleVersion,
        dataSnapshotVersion: record.dataSnapshotVersion,
        regressionStatus: record.regressionStatus,
      }),
    );
  }
}

export function feedbackId(input: {
  agentType: AgentFeedbackV1["agentType"];
  artifactId: string;
  reviewerId: string;
  reviewedAt: string;
}) {
  return `feedback-${createHash("sha256")
    .update(`${input.agentType}:${input.artifactId}:${input.reviewerId}:${input.reviewedAt}`)
    .digest("hex")
    .slice(0, 20)}`;
}

export const autonomyFeatureFlagsSchema = z
  .object({
    lowRiskNormalizationAutoSave: z.boolean().default(false),
    internalReportAutoSend: z.boolean().default(false),
    routineNotificationAutoSend: z.boolean().default(false),
  })
  .strict();

export const autonomyMetricsSchema = z
  .object({
    goldenAccuracy: z.number().min(0).max(1),
    productionAccuracy: z.number().min(0).max(1),
    productionObservationWeeks: z.number().int().nonnegative(),
    humanEditRate: z.number().min(0).max(1),
    humanEditObservationWeeks: z.number().int().nonnegative(),
    falseAlertRate: z.number().min(0).max(1),
  })
  .strict();

export function evaluateAutonomyGate(
  metricsInput: z.input<typeof autonomyMetricsSchema>,
  flagsInput: z.input<typeof autonomyFeatureFlagsSchema> = {},
) {
  const metrics = autonomyMetricsSchema.parse(metricsInput);
  const flags = autonomyFeatureFlagsSchema.parse(flagsInput);

  return {
    L1_CLASSIFICATION_METRICS_ALERT_DRAFT: true,
    L2_LOW_RISK_NORMALIZATION:
      flags.lowRiskNormalizationAutoSave &&
      metrics.goldenAccuracy >= 0.97 &&
      metrics.productionObservationWeeks >= 4 &&
      metrics.productionAccuracy >= 0.95,
    L3_INTERNAL_REPORT_AUTO_SEND:
      flags.internalReportAutoSend &&
      metrics.humanEditObservationWeeks >= 4 &&
      metrics.humanEditRate < 0.1,
    L4_ROUTINE_NOTIFICATION_AUTO_SEND:
      flags.routineNotificationAutoSend && metrics.falseAlertRate < 0.05,
    SCHEDULE_CONTRACT_FINANCE_EXTERNAL_ACTION: false,
  } as const;
}
