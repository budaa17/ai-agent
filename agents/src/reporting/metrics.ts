import { differenceInCalendarDays } from "date-fns";
import { answerKeySchema, type AnswerKey, type AnswerKeyIssue } from "../answer-key.js";
import { evaluateIssuesAgainstAnswerKey } from "../analysis/answer-key-evaluation.js";
import { projectAnalysisResultSchema, type ProjectAnalysisResult } from "../analysis/analyze.js";
import { projectEvaluationMetricsSchema, type ProjectEvaluationMetrics } from "./schema.js";

function issueIdentity(
  issue: Pick<
    AnswerKeyIssue | ProjectAnalysisResult["issues"][number],
    "type" | "projectId" | "workItemId"
  >,
) {
  return `${issue.type}:${issue.projectId}:${issue.workItemId}`;
}

function mean(values: readonly number[]) {
  if (values.length === 0) {
    return null;
  }

  const value = values.reduce((total, current) => total + current, 0) / values.length;
  return Math.round(value * 100) / 100;
}

export function evaluateProjectMetrics(
  analysisInput: ProjectAnalysisResult,
  answerKeyInput: AnswerKey,
): ProjectEvaluationMetrics {
  const analysis = projectAnalysisResultSchema.parse(analysisInput);
  const answerKey = answerKeySchema.parse(answerKeyInput);

  if (answerKey.asOf !== analysis.asOf) {
    throw new Error(
      `Answer-key asOf ${answerKey.asOf} does not match analysis asOf ${analysis.asOf}`,
    );
  }

  const issueDetection = evaluateIssuesAgainstAnswerKey(analysis.issues, answerKey, {
    tenantId: analysis.tenantId,
    projectId: analysis.projectId,
  });
  const expectedByIdentity = new Map(
    answerKey.issues
      .filter(
        (issue) => issue.tenantId === analysis.tenantId && issue.projectId === analysis.projectId,
      )
      .map((issue) => [issueIdentity(issue), issue]),
  );
  const detectionLagDays: number[] = [];
  const effectiveDateErrors: number[] = [];

  for (const detected of analysis.issues) {
    const expected = expectedByIdentity.get(issueIdentity(detected));

    if (!expected) {
      continue;
    }

    detectionLagDays.push(
      Math.max(
        0,
        differenceInCalendarDays(new Date(analysis.asOf), new Date(expected.effectiveFrom)),
      ),
    );
    effectiveDateErrors.push(
      Math.abs(
        differenceInCalendarDays(
          new Date(detected.effectiveFrom),
          new Date(expected.effectiveFrom),
        ),
      ),
    );
  }

  const outcome = answerKey.projectOutcomes.find(
    (candidate) =>
      candidate.tenantId === analysis.tenantId && candidate.projectId === analysis.projectId,
  );
  const forecastErrorDays = outcome
    ? Math.abs(
        differenceInCalendarDays(
          new Date(analysis.cpm.projectFinish),
          new Date(outcome.actualFinish),
        ),
      )
    : null;

  return projectEvaluationMetricsSchema.parse({
    tenantId: analysis.tenantId,
    projectId: analysis.projectId,
    asOf: analysis.asOf,
    issueDetection,
    meanDetectionLagDays: mean(detectionLagDays),
    meanEffectiveDateErrorDays: mean(effectiveDateErrors),
    forecastFinish: analysis.cpm.projectFinish,
    actualFinish: outcome?.actualFinish ?? null,
    forecastErrorDays,
  });
}

function percentage(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function metricDays(value: number | null) {
  return value === null ? "N/A" : value.toFixed(2);
}

export function formatProjectMetricsMarkdown(metrics: readonly ProjectEvaluationMetrics[]) {
  return [
    "# Agent Evaluation Metrics",
    "",
    "| Project | Precision | Recall | F1 | Mean detection lag (days) | Effective-date MAE (days) | Forecast error (days) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...metrics.map(
      (metric) =>
        `| ${metric.projectId} | ${percentage(metric.issueDetection.precision)} | ${percentage(metric.issueDetection.recall)} | ${percentage(metric.issueDetection.f1)} | ${metricDays(metric.meanDetectionLagDays)} | ${metricDays(metric.meanEffectiveDateErrorDays)} | ${metricDays(metric.forecastErrorDays)} |`,
    ),
    "",
    "Detection lag is measured from the answer-key effective date to the analysis cutoff. Forecast error is the absolute calendar-day difference between CPM finish and hidden actual finish.",
    "",
  ].join("\n");
}
