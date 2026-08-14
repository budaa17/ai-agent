import { projectAnalysisResultSchema, type ProjectAnalysisResult } from "../analysis/analyze.js";
import { projectAnalysisDataSchema, type ProjectAnalysisData } from "../analysis/schema.js";
import { answerKeySchema, type AnswerKey } from "../answer-key.js";
import { assertRecommendationGrounded } from "../recommendations/grounding.js";
import {
  deriveRecommendationRiskPosture,
  recommendationReportSchema,
  type RecommendationReport,
} from "../recommendations/schema.js";
import { assertReportNarrativeHasNoNumbers } from "./narrative.js";
import { evaluateProjectMetrics } from "./metrics.js";
import {
  projectReportSchema,
  type ProjectReport,
  type ReportNarrative,
  type ReportNarrativeMode,
  type ReportRecommendationSource,
} from "./schema.js";

export function createAnalysisOnlyRecommendationReport(
  dataInput: ProjectAnalysisData,
  analysisInput: ProjectAnalysisResult,
): RecommendationReport {
  const data = projectAnalysisDataSchema.parse(dataInput);
  const analysis = projectAnalysisResultSchema.parse(analysisInput);

  if (
    data.tenantId !== analysis.tenantId ||
    data.projectId !== analysis.projectId ||
    data.asOf !== analysis.asOf
  ) {
    throw new Error("Analysis-only recommendation scope mismatch");
  }

  return recommendationReportSchema.parse({
    schemaVersion: 1,
    language: "mn",
    tenantId: data.tenantId,
    projectId: data.projectId,
    projectCode: data.projectCode,
    projectName: data.projectName,
    asOf: data.asOf,
    executiveSummary:
      "Зөвлөмжийн агент ажиллуулаагүй тул детерминистик шинжилгээний тайлан бэлтгэв.",
    riskBrief: {
      posture: deriveRecommendationRiskPosture(analysis.issues.map((issue) => issue.severity)),
      summary:
        "Зөвлөмжийн агент ажиллуулаагүй тул зөвхөн детерминистик эрсдэлийн төлөвийг ашиглав.",
      observations: [],
    },
    recommendations: [],
  });
}

export interface ComposeProjectReportOptions {
  data: ProjectAnalysisData;
  analysis: ProjectAnalysisResult;
  recommendations: RecommendationReport;
  narrative: ReportNarrative;
  answerKey: AnswerKey;
  narrativeMode: ReportNarrativeMode;
  recommendationSource: ReportRecommendationSource;
  a2RunId?: string | null;
  a2TraceId?: string | null;
  a3TraceId?: string | null;
  generatedAt?: string;
}

export function composeProjectReport(options: ComposeProjectReportOptions): ProjectReport {
  const data = projectAnalysisDataSchema.parse(options.data);
  const analysis = projectAnalysisResultSchema.parse(options.analysis);
  const recommendations = recommendationReportSchema.parse(options.recommendations);
  const answerKey = answerKeySchema.parse(options.answerKey);
  const narrative = assertReportNarrativeHasNoNumbers(options.narrative);

  if (
    analysis.tenantId !== data.tenantId ||
    analysis.projectId !== data.projectId ||
    analysis.asOf !== data.asOf
  ) {
    throw new Error("Report analysis scope mismatch");
  }

  assertRecommendationGrounded(recommendations, data, analysis);

  return projectReportSchema.parse({
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    project: {
      tenantId: data.tenantId,
      projectId: data.projectId,
      projectCode: data.projectCode,
      projectName: data.projectName,
      asOf: data.asOf,
    },
    narrative,
    analysis,
    recommendations,
    metrics: evaluateProjectMetrics(analysis, answerKey),
    provenance: {
      narrativeMode: options.narrativeMode,
      recommendationSource: options.recommendationSource,
      a2RunId: options.a2RunId ?? null,
      a2TraceId: options.a2TraceId ?? null,
      a3TraceId: options.a3TraceId ?? null,
    },
  });
}
