import { z } from "zod";

export const recommendationPrioritySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

export const recommendationRiskPostureSchema = z.enum([
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "NONE",
]);

export const recommendationObservationKindSchema = z.enum(["PATTERN", "ROOT_CAUSE", "TREND"]);

export const recommendationObservationConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

export const recommendationTrendDirectionSchema = z.enum([
  "IMPROVING",
  "STABLE",
  "DETERIORATING",
  "MIXED",
  "UNKNOWN",
]);

export const recommendationTriggerSchema = z.enum(["MANUAL", "EVENT", "NIGHTLY"]);

export const recommendationSourceTypeSchema = z.enum([
  "PROJECT",
  "WORK_ITEM",
  "DEPENDENCY",
  "PROGRESS_SNAPSHOT",
  "COST_ENTRY",
  "ANALYSIS_SUMMARY",
  "CPM_PROJECT",
  "CPM_TASK",
  "ISSUE",
]);

export const recommendationSourceValueSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
]);

export const recommendationSourceSchema = z
  .object({
    sourceType: recommendationSourceTypeSchema,
    sourceId: z.string().trim().min(1).max(200),
    field: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(
        /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/,
        "Source field must be a dotted fact path",
      ),
    value: recommendationSourceValueSchema,
  })
  .strict();

export const recommendationObservationSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    kind: recommendationObservationKindSchema,
    priority: recommendationPrioritySchema,
    confidence: recommendationObservationConfidenceSchema,
    direction: recommendationTrendDirectionSchema.nullable(),
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(1_500),
    workItemIds: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
    impactRefs: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
    sources: z.array(recommendationSourceSchema).min(1).max(30),
  })
  .strict()
  .superRefine((observation, context) => {
    if (observation.kind === "TREND" && observation.direction === null) {
      context.addIssue({
        code: "custom",
        message: "TREND observation requires a direction",
        path: ["direction"],
      });
    }

    if (observation.kind !== "TREND" && observation.direction !== null) {
      context.addIssue({
        code: "custom",
        message: "Only TREND observations may define a direction",
        path: ["direction"],
      });
    }

    if (new Set(observation.workItemIds).size !== observation.workItemIds.length) {
      context.addIssue({
        code: "custom",
        message: "Observation workItemIds must be unique",
        path: ["workItemIds"],
      });
    }

    if (new Set(observation.impactRefs).size !== observation.impactRefs.length) {
      context.addIssue({
        code: "custom",
        message: "Observation impactRefs must be unique",
        path: ["impactRefs"],
      });
    }
  });

export const recommendationRiskBriefSchema = z
  .object({
    posture: recommendationRiskPostureSchema,
    summary: z.string().trim().min(1).max(2_000),
    observations: z.array(recommendationObservationSchema).max(20),
  })
  .strict();

export const recommendationItemSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    priority: recommendationPrioritySchema,
    workItemId: z.string().trim().min(1).max(200),
    workItemName: z.string().trim().min(1).max(500),
    title: z.string().trim().min(1).max(300),
    action: z.string().trim().min(1).max(1_500),
    rationale: z.string().trim().min(1).max(1_500),
    impactRef: z.string().trim().min(1).max(200),
    sources: z.array(recommendationSourceSchema).min(1).max(20),
  })
  .strict();

export const recommendationReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    language: z.literal("mn"),
    tenantId: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(200),
    projectCode: z.string().trim().min(1).max(100),
    projectName: z.string().trim().min(1).max(500),
    asOf: z.string().datetime(),
    executiveSummary: z.string().trim().min(1).max(2_000),
    riskBrief: recommendationRiskBriefSchema,
    recommendations: z.array(recommendationItemSchema).max(20),
  })
  .strict()
  .superRefine((report, context) => {
    const recommendationIds = new Set<string>();
    const impactRefs = new Set<string>();
    const observationIds = new Set<string>();

    for (const [index, observation] of report.riskBrief.observations.entries()) {
      if (observationIds.has(observation.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate observation id: ${observation.id}`,
          path: ["riskBrief", "observations", index, "id"],
        });
      }

      observationIds.add(observation.id);
    }

    for (const [index, recommendation] of report.recommendations.entries()) {
      if (recommendationIds.has(recommendation.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate recommendation id: ${recommendation.id}`,
          path: ["recommendations", index, "id"],
        });
      }

      if (impactRefs.has(recommendation.impactRef)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate impactRef: ${recommendation.impactRef}`,
          path: ["recommendations", index, "impactRef"],
        });
      }

      recommendationIds.add(recommendation.id);
      impactRefs.add(recommendation.impactRef);
    }
  });

export type RecommendationPriority = z.infer<typeof recommendationPrioritySchema>;
export type RecommendationRiskPosture = z.infer<typeof recommendationRiskPostureSchema>;
export type RecommendationObservationKind = z.infer<typeof recommendationObservationKindSchema>;
export type RecommendationObservation = z.infer<typeof recommendationObservationSchema>;
export type RecommendationTrigger = z.infer<typeof recommendationTriggerSchema>;
export type RecommendationRiskBrief = z.infer<typeof recommendationRiskBriefSchema>;
export type RecommendationSourceType = z.infer<typeof recommendationSourceTypeSchema>;
export type RecommendationSourceValue = z.infer<typeof recommendationSourceValueSchema>;
export type RecommendationSource = z.infer<typeof recommendationSourceSchema>;
export type RecommendationItem = z.infer<typeof recommendationItemSchema>;
export type RecommendationReport = z.infer<typeof recommendationReportSchema>;

const recommendationPriorityRank: Record<RecommendationPriority, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export function deriveRecommendationRiskPosture(
  priorities: Iterable<RecommendationPriority>,
): RecommendationRiskPosture {
  let highest: RecommendationPriority | null = null;

  for (const priority of priorities) {
    if (
      highest === null ||
      recommendationPriorityRank[priority] > recommendationPriorityRank[highest]
    ) {
      highest = priority;
    }
  }

  return highest ?? "NONE";
}

export function parseRecommendationReport(
  input: unknown,
  legacyRiskPosture: RecommendationRiskPosture = "NONE",
): RecommendationReport {
  if (input && typeof input === "object" && !Array.isArray(input) && !("riskBrief" in input)) {
    const legacy = input as Record<string, unknown>;
    const summary =
      typeof legacy.executiveSummary === "string" && legacy.executiveSummary.trim()
        ? legacy.executiveSummary
        : "Өмнөх хувилбарын эрсдэлийн товч мэдээлэл байхгүй.";

    return recommendationReportSchema.parse({
      ...legacy,
      riskBrief: {
        posture: legacyRiskPosture,
        summary,
        observations: [],
      },
    });
  }

  return recommendationReportSchema.parse(input);
}
