import { projectAnalysisResultSchema, type ProjectAnalysisResult } from "../analysis/analyze.js";
import { projectAnalysisDataSchema, type ProjectAnalysisData } from "../analysis/schema.js";
import { validateRecommendationGrounding } from "./grounding.js";
import {
  A2_GOLDEN_SUITE,
  a2GoldenCaseSchema,
  type A2GoldenCase,
  type A2ScoredField,
} from "./golden-cases.js";
import { recommendationReportSchema, type RecommendationReport } from "./schema.js";

export interface A2EvaluationOutput {
  data: ProjectAnalysisData;
  analysis: ProjectAnalysisResult;
  report: RecommendationReport;
}

export interface A2FieldResult {
  field: A2ScoredField;
  matched: boolean;
  expected: unknown;
  actual: unknown;
}

export interface A2SetMetrics {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
}

export interface A2CaseEvaluation {
  caseId: string;
  tags: string[];
  succeeded: boolean;
  passed: boolean;
  matchedFields: number;
  totalFields: number;
  groundingValid: boolean;
  observationKinds: A2SetMetrics;
  recommendationImpacts: A2SetMetrics;
  fields: A2FieldResult[];
  error: string | null;
}

export interface A2EvaluationReport {
  suite: typeof A2_GOLDEN_SUITE;
  generatedAt: string;
  totalCases: number;
  successfulCases: number;
  passedCases: number;
  groundedCases: number;
  matchedFields: number;
  totalFields: number;
  passRate: number;
  groundingRate: number;
  fieldAccuracy: number;
  observationKinds: A2SetMetrics;
  recommendationImpacts: A2SetMetrics;
  cases: A2CaseEvaluation[];
}

function sortedUnique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function equalValues(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function setCounts(expectedValues: readonly string[], actualValues: readonly string[]) {
  const expected = new Set(expectedValues);
  const actual = new Set(actualValues);
  let truePositive = 0;

  for (const value of actual) {
    if (expected.has(value)) {
      truePositive += 1;
    }
  }

  return {
    truePositive,
    falsePositive: actual.size - truePositive,
    falseNegative: expected.size - truePositive,
  };
}

function finalizeSetMetrics(counts: {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
}): A2SetMetrics {
  const predicted = counts.truePositive + counts.falsePositive;
  const expected = counts.truePositive + counts.falseNegative;

  return {
    ...counts,
    precision: predicted === 0 ? (expected === 0 ? 1 : 0) : counts.truePositive / predicted,
    recall: expected === 0 ? (predicted === 0 ? 1 : 0) : counts.truePositive / expected,
  };
}

function evaluateCase(goldenCase: A2GoldenCase, outputInput: A2EvaluationOutput): A2CaseEvaluation {
  const data = projectAnalysisDataSchema.parse(outputInput.data);
  const analysis = projectAnalysisResultSchema.parse(outputInput.analysis);
  const report = recommendationReportSchema.parse(outputInput.report);
  const grounding = validateRecommendationGrounding(report, data, analysis);
  const actual = {
    tenantId: report.tenantId,
    projectId: report.projectId,
    asOf: report.asOf,
    riskPosture: report.riskBrief.posture,
    issueTypes: sortedUnique(analysis.issues.map((issue) => issue.type)),
    observationKinds: sortedUnique(
      report.riskBrief.observations.map((observation) => observation.kind),
    ),
    recommendationImpactRefs: sortedUnique(
      report.recommendations.map((recommendation) => recommendation.impactRef),
    ),
    groundingValid: grounding.valid,
  };
  const expected = {
    ...goldenCase.expected,
    issueTypes: sortedUnique(goldenCase.expected.issueTypes),
    observationKinds: sortedUnique(goldenCase.expected.observationKinds),
    recommendationImpactRefs: sortedUnique(goldenCase.expected.recommendationImpactRefs),
  };
  const fields = goldenCase.scoredFields.map((field): A2FieldResult => ({
    field,
    expected: expected[field],
    actual: actual[field],
    matched: equalValues(expected[field], actual[field]),
  }));
  const observationKinds = finalizeSetMetrics(
    setCounts(expected.observationKinds, actual.observationKinds),
  );
  const recommendationImpacts = finalizeSetMetrics(
    setCounts(expected.recommendationImpactRefs, actual.recommendationImpactRefs),
  );
  const matchedFields = fields.filter((field) => field.matched).length;

  return {
    caseId: goldenCase.id,
    tags: goldenCase.tags,
    succeeded: true,
    passed: matchedFields === fields.length,
    matchedFields,
    totalFields: fields.length,
    groundingValid: grounding.valid,
    observationKinds,
    recommendationImpacts,
    fields,
    error: null,
  };
}

function failedCase(goldenCase: A2GoldenCase, error: unknown): A2CaseEvaluation {
  const fields = goldenCase.scoredFields.map((field): A2FieldResult => ({
    field,
    expected: goldenCase.expected[field],
    actual: null,
    matched: false,
  }));

  return {
    caseId: goldenCase.id,
    tags: goldenCase.tags,
    succeeded: false,
    passed: false,
    matchedFields: 0,
    totalFields: fields.length,
    groundingValid: false,
    observationKinds: finalizeSetMetrics(setCounts(goldenCase.expected.observationKinds, [])),
    recommendationImpacts: finalizeSetMetrics(
      setCounts(goldenCase.expected.recommendationImpactRefs, []),
    ),
    fields,
    error: error instanceof Error ? error.message : String(error),
  };
}

export async function evaluateA2Cases(options: {
  cases: readonly A2GoldenCase[];
  observe: (goldenCase: A2GoldenCase) => Promise<A2EvaluationOutput>;
  generatedAt?: string;
  onCaseComplete?: (
    result: A2CaseEvaluation,
    completed: number,
    total: number,
  ) => Promise<void> | void;
}): Promise<A2EvaluationReport> {
  const cases = options.cases.map((goldenCase) => a2GoldenCaseSchema.parse(goldenCase));
  const results: A2CaseEvaluation[] = [];

  for (const [index, goldenCase] of cases.entries()) {
    let result: A2CaseEvaluation;

    try {
      result = evaluateCase(goldenCase, await options.observe(goldenCase));
    } catch (error) {
      result = failedCase(goldenCase, error);
    }

    results.push(result);
    await options.onCaseComplete?.(result, index + 1, cases.length);
  }

  const totalCases = results.length;
  const successfulCases = results.filter((result) => result.succeeded).length;
  const passedCases = results.filter((result) => result.passed).length;
  const groundedCases = results.filter((result) => result.groundingValid).length;
  const matchedFields = results.reduce((total, result) => total + result.matchedFields, 0);
  const totalFields = results.reduce((total, result) => total + result.totalFields, 0);
  const observationCounts = results.reduce(
    (total, result) => ({
      truePositive: total.truePositive + result.observationKinds.truePositive,
      falsePositive: total.falsePositive + result.observationKinds.falsePositive,
      falseNegative: total.falseNegative + result.observationKinds.falseNegative,
    }),
    { truePositive: 0, falsePositive: 0, falseNegative: 0 },
  );
  const recommendationCounts = results.reduce(
    (total, result) => ({
      truePositive: total.truePositive + result.recommendationImpacts.truePositive,
      falsePositive: total.falsePositive + result.recommendationImpacts.falsePositive,
      falseNegative: total.falseNegative + result.recommendationImpacts.falseNegative,
    }),
    { truePositive: 0, falsePositive: 0, falseNegative: 0 },
  );

  return {
    suite: A2_GOLDEN_SUITE,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    totalCases,
    successfulCases,
    passedCases,
    groundedCases,
    matchedFields,
    totalFields,
    passRate: totalCases === 0 ? 0 : passedCases / totalCases,
    groundingRate: totalCases === 0 ? 0 : groundedCases / totalCases,
    fieldAccuracy: totalFields === 0 ? 0 : matchedFields / totalFields,
    observationKinds: finalizeSetMetrics(observationCounts),
    recommendationImpacts: finalizeSetMetrics(recommendationCounts),
    cases: results,
  };
}

function percentage(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatA2EvaluationMarkdown(report: A2EvaluationReport) {
  const lines = [
    "# A2 Golden Dataset Evaluation",
    "",
    `- Suite: \`${report.suite}\``,
    `- Cases passed: ${report.passedCases}/${report.totalCases} (${percentage(report.passRate)})`,
    `- Grounding passed: ${report.groundedCases}/${report.totalCases} (${percentage(report.groundingRate)})`,
    `- Field accuracy: ${report.matchedFields}/${report.totalFields} (${percentage(report.fieldAccuracy)})`,
    `- Observation precision/recall: ${percentage(report.observationKinds.precision)} / ${percentage(report.observationKinds.recall)}`,
    `- Recommendation impact precision/recall: ${percentage(report.recommendationImpacts.precision)} / ${percentage(report.recommendationImpacts.recall)}`,
    "",
    "| Case | Result | Grounding | Fields | Error |",
    "|---|---:|---:|---:|---|",
  ];

  for (const result of report.cases) {
    lines.push(
      `| ${result.caseId} | ${result.passed ? "PASS" : "FAIL"} | ${result.groundingValid ? "PASS" : "FAIL"} | ${result.matchedFields}/${result.totalFields} | ${result.error ?? ""} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}
