import { a3DocumentBundleSchema, type A3DocumentBundle } from "./document.js";
import {
  A3_GOLDEN_SUITE,
  a3GoldenCaseSchema,
  type A3GoldenCase,
  type A3ScoredField,
} from "./golden-cases.js";
import { assertReportNarrativeHasNoNumbers } from "./narrative.js";
import { projectReportSchema, type ProjectReport } from "./schema.js";

export interface A3EvaluationOutput {
  report: ProjectReport;
  bundle: A3DocumentBundle;
  draftStatuses: string[];
}

export interface A3FieldResult {
  field: A3ScoredField;
  matched: boolean;
  expected: unknown;
  actual: unknown;
}

export interface A3CaseEvaluation {
  caseId: string;
  tags: string[];
  succeeded: boolean;
  passed: boolean;
  matchedFields: number;
  totalFields: number;
  fields: A3FieldResult[];
  error: string | null;
}

export interface A3EvaluationReport {
  suite: typeof A3_GOLDEN_SUITE;
  generatedAt: string;
  totalCases: number;
  successfulCases: number;
  passedCases: number;
  matchedFields: number;
  totalFields: number;
  passRate: number;
  fieldAccuracy: number;
  cases: A3CaseEvaluation[];
}

function sortedUnique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function evaluateCase(goldenCase: A3GoldenCase, outputInput: A3EvaluationOutput): A3CaseEvaluation {
  const report = projectReportSchema.parse(outputInput.report);
  const bundle = a3DocumentBundleSchema.parse(outputInput.bundle);
  assertReportNarrativeHasNoNumbers(report.narrative);
  const actual = {
    tenantId: report.project.tenantId,
    projectId: report.project.projectId,
    asOf: report.project.asOf,
    documentTypes: sortedUnique(bundle.documents.map((document) => document.type)),
    workItemCount: report.analysis.summary.workItemCount,
    issueCount: report.analysis.summary.issueCount,
    projectDurationDays: report.analysis.summary.projectDurationDays,
    riskPosture: report.recommendations.riskBrief.posture,
    precision: report.metrics.issueDetection.precision,
    recall: report.metrics.issueDetection.recall,
    forecastErrorDays: report.metrics.forecastErrorDays,
    draftStatus:
      new Set(outputInput.draftStatuses).size === 1 ? outputInput.draftStatuses[0] : "MIXED",
    numericNarrativeSafe: true,
  };
  const expected = {
    ...goldenCase.expected,
    documentTypes: sortedUnique(goldenCase.expected.documentTypes),
  };
  const fields = goldenCase.scoredFields.map((field): A3FieldResult => ({
    field,
    expected: expected[field],
    actual: actual[field],
    matched: JSON.stringify(expected[field]) === JSON.stringify(actual[field]),
  }));
  const matchedFields = fields.filter((field) => field.matched).length;

  return {
    caseId: goldenCase.id,
    tags: goldenCase.tags,
    succeeded: true,
    passed: matchedFields === fields.length,
    matchedFields,
    totalFields: fields.length,
    fields,
    error: null,
  };
}

function failedCase(goldenCase: A3GoldenCase, error: unknown): A3CaseEvaluation {
  const fields = goldenCase.scoredFields.map((field): A3FieldResult => ({
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
    fields,
    error: error instanceof Error ? error.message : String(error),
  };
}

export async function evaluateA3Cases(options: {
  cases: readonly A3GoldenCase[];
  generate: (goldenCase: A3GoldenCase) => Promise<A3EvaluationOutput>;
  generatedAt?: string;
  onCaseComplete?: (
    result: A3CaseEvaluation,
    completed: number,
    total: number,
  ) => Promise<void> | void;
}): Promise<A3EvaluationReport> {
  const cases = options.cases.map((goldenCase) => a3GoldenCaseSchema.parse(goldenCase));
  const results: A3CaseEvaluation[] = [];

  for (const [index, goldenCase] of cases.entries()) {
    let result: A3CaseEvaluation;

    try {
      result = evaluateCase(goldenCase, await options.generate(goldenCase));
    } catch (error) {
      result = failedCase(goldenCase, error);
    }

    results.push(result);
    await options.onCaseComplete?.(result, index + 1, cases.length);
  }

  const totalCases = results.length;
  const successfulCases = results.filter((result) => result.succeeded).length;
  const passedCases = results.filter((result) => result.passed).length;
  const matchedFields = results.reduce((total, result) => total + result.matchedFields, 0);
  const totalFields = results.reduce((total, result) => total + result.totalFields, 0);

  return {
    suite: A3_GOLDEN_SUITE,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    totalCases,
    successfulCases,
    passedCases,
    matchedFields,
    totalFields,
    passRate: totalCases === 0 ? 0 : passedCases / totalCases,
    fieldAccuracy: totalFields === 0 ? 0 : matchedFields / totalFields,
    cases: results,
  };
}

function percentage(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatA3EvaluationMarkdown(report: A3EvaluationReport) {
  const lines = [
    "# A3 Golden Dataset Evaluation",
    "",
    `- Suite: \`${report.suite}\``,
    `- Cases passed: ${report.passedCases}/${report.totalCases} (${percentage(report.passRate)})`,
    `- Field accuracy: ${report.matchedFields}/${report.totalFields} (${percentage(report.fieldAccuracy)})`,
    "",
    "| Case | Result | Fields | Error |",
    "|---|---:|---:|---|",
  ];

  for (const result of report.cases) {
    lines.push(
      `| ${result.caseId} | ${result.passed ? "PASS" : "FAIL"} | ${result.matchedFields}/${result.totalFields} | ${result.error ?? ""} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}
