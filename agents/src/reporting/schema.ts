import { z } from "zod";
import { projectAnalysisResultSchema } from "../analysis/analyze.js";
import { answerKeyEvaluationSchema } from "../analysis/answer-key-evaluation.js";
import { recommendationReportSchema } from "../recommendations/schema.js";

export const reportNarrativeSchema = z
  .object({
    language: z.literal("mn"),
    executiveOverview: z.string().trim().min(1).max(3_000),
    riskNarrative: z.string().trim().min(1).max(3_000),
    recommendationNarrative: z.string().trim().min(1).max(3_000),
    conclusion: z.string().trim().min(1).max(3_000),
  })
  .strict();

export const reportNarrativeModeSchema = z.enum(["DETERMINISTIC", "LLM"]);

export const reportRecommendationSourceSchema = z.enum(["ANALYSIS_ONLY", "AGENT_RUN", "ARTIFACT"]);

export const projectEvaluationMetricsSchema = z
  .object({
    tenantId: z.string().min(1),
    projectId: z.string().min(1),
    asOf: z.string().datetime(),
    issueDetection: answerKeyEvaluationSchema,
    meanDetectionLagDays: z.number().nonnegative().nullable(),
    meanEffectiveDateErrorDays: z.number().nonnegative().nullable(),
    forecastFinish: z.string().datetime(),
    actualFinish: z.string().datetime().nullable(),
    forecastErrorDays: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const projectReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().datetime(),
    project: z
      .object({
        tenantId: z.string().min(1),
        projectId: z.string().min(1),
        projectCode: z.string().min(1),
        projectName: z.string().min(1),
        asOf: z.string().datetime(),
      })
      .strict(),
    narrative: reportNarrativeSchema,
    analysis: projectAnalysisResultSchema,
    recommendations: recommendationReportSchema,
    metrics: projectEvaluationMetricsSchema,
    provenance: z
      .object({
        narrativeMode: reportNarrativeModeSchema,
        recommendationSource: reportRecommendationSourceSchema,
        a2RunId: z.string().min(1).nullable(),
        a2TraceId: z.string().min(1).nullable(),
        a3TraceId: z.string().min(1).nullable(),
      })
      .strict(),
  })
  .strict();

export type ReportNarrative = z.infer<typeof reportNarrativeSchema>;
export type ReportNarrativeMode = z.infer<typeof reportNarrativeModeSchema>;
export type ReportRecommendationSource = z.infer<typeof reportRecommendationSourceSchema>;
export type ProjectEvaluationMetrics = z.infer<typeof projectEvaluationMetricsSchema>;
export type ProjectReport = z.infer<typeof projectReportSchema>;
