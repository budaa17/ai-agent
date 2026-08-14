import { validateA4Grounding, type A4GroundingResult, type A4ToolEvidence } from "./grounding.js";
import {
  A4_GOLDEN_SUITE,
  a4GoldenCaseSchema,
  type A4GoldenCase,
  type A4RequiredSource,
  type A4ScoredField,
} from "./golden-cases.js";
import { a4AnswerSchema, type A4Answer } from "./schema.js";

export interface A4EvaluationOutput {
  answer: A4Answer;
  toolResults: ReadonlyArray<A4ToolEvidence>;
}

export interface A4SetMetrics {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
}

export interface A4FieldResult {
  field: A4ScoredField;
  matched: boolean;
  expected: unknown;
  actual: unknown;
}

export interface A4CaseEvaluation {
  caseId: string;
  tags: string[];
  succeeded: boolean;
  passed: boolean;
  matchedFields: number;
  totalFields: number;
  groundingValid: boolean;
  tools: A4SetMetrics;
  sources: A4SetMetrics;
  answer: A4Answer | null;
  expectedSources: A4RequiredSource[];
  actualSources: Array<{
    toolName: string;
    sourceId: string;
    field: string;
    value: unknown;
  }>;
  missingRequiredSources: A4RequiredSource[];
  fields: A4FieldResult[];
  error: string | null;
}

export interface A4EvaluationReport {
  suite: typeof A4_GOLDEN_SUITE;
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
  tools: A4SetMetrics;
  sources: A4SetMetrics;
  cases: A4CaseEvaluation[];
}

function sortedUnique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function equalValues(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sourceIdentity(source: {
  toolName: string;
  sourceId: string;
  field: string;
  value: unknown;
}) {
  return [source.toolName, source.sourceId, source.field, JSON.stringify(source.value)].join(
    "\u0000",
  );
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
}): A4SetMetrics {
  const predicted = counts.truePositive + counts.falsePositive;
  const expected = counts.truePositive + counts.falseNegative;

  return {
    ...counts,
    precision: predicted === 0 ? (expected === 0 ? 1 : 0) : counts.truePositive / predicted,
    recall: expected === 0 ? (predicted === 0 ? 1 : 0) : counts.truePositive / expected,
  };
}

function requiredSourceCoverage(
  required: readonly A4RequiredSource[],
  validation: A4GroundingResult,
) {
  const actual = new Set(validation.resolvedSources.map(sourceIdentity));

  return required.every((source) => actual.has(sourceIdentity(source)));
}

function uniqueResolvedSources(validation: A4GroundingResult) {
  const unique = new Map<
    string,
    {
      toolName: string;
      sourceId: string;
      field: string;
      value: unknown;
    }
  >();

  for (const source of validation.resolvedSources) {
    const normalized = {
      toolName: source.toolName,
      sourceId: source.sourceId,
      field: source.field,
      value: source.value,
    };
    unique.set(sourceIdentity(normalized), normalized);
  }

  return [...unique.values()];
}

function evaluateCase(goldenCase: A4GoldenCase, outputInput: A4EvaluationOutput): A4CaseEvaluation {
  const answer = a4AnswerSchema.parse(outputInput.answer);
  const validation = validateA4Grounding(answer, outputInput.toolResults);
  const actualTools = sortedUnique(outputInput.toolResults.map((result) => result.toolName));
  const expectedTools = sortedUnique(goldenCase.expected.requiredToolNames);
  const citedSourceIds = new Set(validation.resolvedSources.map((source) => source.sourceId));
  const expectedValues = {
    language: "mn",
    answerStatus: goldenCase.expected.answerStatus,
    requiredToolCoverage: true,
    requiredSourceCoverage: true,
    forbiddenSourcesExcluded: true,
    groundingValid: true,
  };
  const actualValues = {
    language: answer.language,
    answerStatus: answer.status,
    requiredToolCoverage: expectedTools.every((toolName) => actualTools.includes(toolName)),
    requiredSourceCoverage: requiredSourceCoverage(goldenCase.expected.requiredSources, validation),
    forbiddenSourcesExcluded: goldenCase.expected.forbiddenSourceIds.every(
      (sourceId) => !citedSourceIds.has(sourceId),
    ),
    groundingValid: validation.valid,
  };
  const fields = goldenCase.scoredFields.map((field): A4FieldResult => ({
    field,
    expected: expectedValues[field],
    actual: actualValues[field],
    matched: equalValues(expectedValues[field], actualValues[field]),
  }));
  const matchedFields = fields.filter((field) => field.matched).length;
  const tools = finalizeSetMetrics(setCounts(expectedTools, actualTools));
  const sources = finalizeSetMetrics(
    setCounts(
      goldenCase.expected.requiredSources.map(sourceIdentity),
      validation.resolvedSources.map(sourceIdentity),
    ),
  );
  const actualSources = uniqueResolvedSources(validation);
  const actualSourceIds = new Set(actualSources.map(sourceIdentity));
  const missingRequiredSources = goldenCase.expected.requiredSources.filter(
    (source) => !actualSourceIds.has(sourceIdentity(source)),
  );

  return {
    caseId: goldenCase.id,
    tags: goldenCase.tags,
    succeeded: true,
    passed: matchedFields === fields.length,
    matchedFields,
    totalFields: fields.length,
    groundingValid: validation.valid,
    tools,
    sources,
    answer,
    expectedSources: goldenCase.expected.requiredSources,
    actualSources,
    missingRequiredSources,
    fields,
    error: null,
  };
}

function failedCase(goldenCase: A4GoldenCase, error: unknown): A4CaseEvaluation {
  const fields = goldenCase.scoredFields.map((field): A4FieldResult => ({
    field,
    expected:
      field === "answerStatus"
        ? goldenCase.expected.answerStatus
        : field === "language"
          ? "mn"
          : true,
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
    tools: finalizeSetMetrics(setCounts(goldenCase.expected.requiredToolNames, [])),
    sources: finalizeSetMetrics(
      setCounts(goldenCase.expected.requiredSources.map(sourceIdentity), []),
    ),
    answer: null,
    expectedSources: goldenCase.expected.requiredSources,
    actualSources: [],
    missingRequiredSources: goldenCase.expected.requiredSources,
    fields,
    error: error instanceof Error ? error.message : String(error),
  };
}

export async function evaluateA4Cases(options: {
  cases: readonly A4GoldenCase[];
  answer: (goldenCase: A4GoldenCase) => Promise<A4EvaluationOutput>;
  generatedAt?: string;
  onCaseComplete?: (
    result: A4CaseEvaluation,
    completed: number,
    total: number,
  ) => Promise<void> | void;
}): Promise<A4EvaluationReport> {
  const cases = options.cases.map((goldenCase) => a4GoldenCaseSchema.parse(goldenCase));
  const results: A4CaseEvaluation[] = [];

  for (const [index, goldenCase] of cases.entries()) {
    let result: A4CaseEvaluation;

    try {
      result = evaluateCase(goldenCase, await options.answer(goldenCase));
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
  const toolCounts = results.reduce(
    (total, result) => ({
      truePositive: total.truePositive + result.tools.truePositive,
      falsePositive: total.falsePositive + result.tools.falsePositive,
      falseNegative: total.falseNegative + result.tools.falseNegative,
    }),
    { truePositive: 0, falsePositive: 0, falseNegative: 0 },
  );
  const sourceCounts = results.reduce(
    (total, result) => ({
      truePositive: total.truePositive + result.sources.truePositive,
      falsePositive: total.falsePositive + result.sources.falsePositive,
      falseNegative: total.falseNegative + result.sources.falseNegative,
    }),
    { truePositive: 0, falsePositive: 0, falseNegative: 0 },
  );

  return {
    suite: A4_GOLDEN_SUITE,
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
    tools: finalizeSetMetrics(toolCounts),
    sources: finalizeSetMetrics(sourceCounts),
    cases: results,
  };
}

function percentage(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatA4EvaluationMarkdown(report: A4EvaluationReport) {
  const lines = [
    "# A4 Golden Dataset Evaluation",
    "",
    `- Suite: \`${report.suite}\``,
    `- Cases passed: ${report.passedCases}/${report.totalCases} (${percentage(report.passRate)})`,
    `- Grounding passed: ${report.groundedCases}/${report.totalCases} (${percentage(report.groundingRate)})`,
    `- Field accuracy: ${report.matchedFields}/${report.totalFields} (${percentage(report.fieldAccuracy)})`,
    `- Tool precision/recall: ${percentage(report.tools.precision)} / ${percentage(report.tools.recall)}`,
    `- Source precision/recall: ${percentage(report.sources.precision)} / ${percentage(report.sources.recall)}`,
    "",
    "| Case | Result | Grounding | Fields | Sources | Error |",
    "|---|---:|---:|---:|---:|---|",
  ];

  for (const result of report.cases) {
    lines.push(
      `| ${result.caseId} | ${result.passed ? "PASS" : "FAIL"} | ${result.groundingValid ? "PASS" : "FAIL"} | ${result.matchedFields}/${result.totalFields} | ${result.sources.truePositive}/${result.sources.truePositive + result.sources.falseNegative} | ${result.error ?? ""} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}
