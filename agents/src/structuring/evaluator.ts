import { A1_GOLDEN_SUITE, a1GoldenCaseSchema, type A1GoldenCase } from "./golden-cases.js";
import {
  projectUpdateExtractionSchema,
  type ProjectUpdateExtraction,
  type ProjectUpdateField,
} from "./schema.js";

export interface A1FieldResult {
  field: ProjectUpdateField;
  expected: unknown;
  actual: unknown;
  matched: boolean;
}

export interface A1CaseResult {
  caseId: string;
  tags: string[];
  extractionSucceeded: boolean;
  passed: boolean;
  matchedFields: number;
  totalFields: number;
  fields: A1FieldResult[];
  output?: ProjectUpdateExtraction;
  error?: string;
}

export interface A1AccuracyBucket {
  matched: number;
  total: number;
  accuracy: number;
}

export interface A1EvaluationReport {
  suite: typeof A1_GOLDEN_SUITE;
  generatedAt: string;
  totalCases: number;
  successfulExtractions: number;
  exactCaseMatches: number;
  extractionSuccessRate: number;
  exactCaseAccuracy: number;
  fieldAccuracy: number;
  matchedFields: number;
  totalFields: number;
  byField: Partial<Record<ProjectUpdateField, A1AccuracyBucket>>;
  byTag: Record<string, A1AccuracyBucket>;
  cases: A1CaseResult[];
}

export interface EvaluateA1CasesOptions {
  cases: readonly A1GoldenCase[];
  extract: (goldenCase: A1GoldenCase) => Promise<ProjectUpdateExtraction>;
  onCaseComplete?: (result: A1CaseResult, completed: number, total: number) => void | Promise<void>;
  delayMs?: number;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "string") {
    return value.trim().normalize("NFKC");
  }

  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, canonicalize(nestedValue)]),
    );
  }

  return value;
}

function canonicalizeField(field: ProjectUpdateField, value: unknown) {
  const normalized = canonicalize(value);

  if (field === "workItemName" && typeof normalized === "string") {
    return normalized
      .replace(/\s+(?:ажил|work item)$/iu, "")
      .trim()
      .toLocaleLowerCase();
  }

  return normalized;
}

function valuesMatch(field: ProjectUpdateField, expected: unknown, actual: unknown) {
  return (
    JSON.stringify(canonicalizeField(field, expected)) ===
    JSON.stringify(canonicalizeField(field, actual))
  );
}

function accuracy(matched: number, total: number) {
  return total === 0 ? 0 : matched / total;
}

function compareCase(goldenCase: A1GoldenCase, actual: ProjectUpdateExtraction): A1CaseResult {
  const expectedRecord = goldenCase.expected as Record<ProjectUpdateField, unknown>;
  const actualRecord = actual as Record<ProjectUpdateField, unknown>;
  const fields = goldenCase.scoredFields.map((field): A1FieldResult => {
    const expected = expectedRecord[field];
    const actualValue = actualRecord[field];

    return {
      field,
      expected,
      actual: actualValue,
      matched: valuesMatch(field, expected, actualValue),
    };
  });
  const matchedFields = fields.filter((field) => field.matched).length;

  return {
    caseId: goldenCase.id,
    tags: goldenCase.tags,
    extractionSucceeded: true,
    passed: matchedFields === fields.length,
    matchedFields,
    totalFields: fields.length,
    fields,
    output: actual,
  };
}

function failedCase(goldenCase: A1GoldenCase, error: unknown): A1CaseResult {
  const expectedRecord = goldenCase.expected as Record<ProjectUpdateField, unknown>;

  return {
    caseId: goldenCase.id,
    tags: goldenCase.tags,
    extractionSucceeded: false,
    passed: false,
    matchedFields: 0,
    totalFields: goldenCase.scoredFields.length,
    fields: goldenCase.scoredFields.map((field) => ({
      field,
      expected: expectedRecord[field],
      actual: undefined,
      matched: false,
    })),
    error: toErrorMessage(error),
  };
}

function aggregateBuckets(
  results: readonly A1CaseResult[],
  selectKeys: (result: A1CaseResult) => readonly string[],
) {
  const buckets = new Map<string, { matched: number; total: number }>();

  for (const result of results) {
    for (const key of new Set(selectKeys(result))) {
      const current = buckets.get(key) ?? { matched: 0, total: 0 };
      current.matched += result.matchedFields;
      current.total += result.totalFields;
      buckets.set(key, current);
    }
  }

  return Object.fromEntries(
    [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, bucket]) => [
        key,
        {
          ...bucket,
          accuracy: accuracy(bucket.matched, bucket.total),
        },
      ]),
  );
}

function aggregateFields(results: readonly A1CaseResult[]) {
  const buckets = new Map<ProjectUpdateField, { matched: number; total: number }>();

  for (const result of results) {
    for (const field of result.fields) {
      const current = buckets.get(field.field) ?? { matched: 0, total: 0 };
      current.matched += field.matched ? 1 : 0;
      current.total += 1;
      buckets.set(field.field, current);
    }
  }

  return Object.fromEntries(
    [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([field, bucket]) => [
        field,
        {
          ...bucket,
          accuracy: accuracy(bucket.matched, bucket.total),
        },
      ]),
  );
}

async function wait(delayMs: number) {
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export async function evaluateA1Cases(
  options: EvaluateA1CasesOptions,
): Promise<A1EvaluationReport> {
  const cases = options.cases.map((goldenCase) => a1GoldenCaseSchema.parse(goldenCase));
  const results: A1CaseResult[] = [];

  for (const [index, goldenCase] of cases.entries()) {
    let result: A1CaseResult;

    try {
      const extracted = projectUpdateExtractionSchema.parse(await options.extract(goldenCase));
      result = compareCase(goldenCase, extracted);
    } catch (error) {
      result = failedCase(goldenCase, error);
    }

    results.push(result);
    await options.onCaseComplete?.(result, index + 1, cases.length);

    if (index < cases.length - 1) {
      await wait(options.delayMs ?? 0);
    }
  }

  const matchedFields = results.reduce((total, result) => total + result.matchedFields, 0);
  const totalFields = results.reduce((total, result) => total + result.totalFields, 0);
  const successfulExtractions = results.filter((result) => result.extractionSucceeded).length;
  const exactCaseMatches = results.filter((result) => result.passed).length;

  return {
    suite: A1_GOLDEN_SUITE,
    generatedAt: new Date().toISOString(),
    totalCases: results.length,
    successfulExtractions,
    exactCaseMatches,
    extractionSuccessRate: accuracy(successfulExtractions, results.length),
    exactCaseAccuracy: accuracy(exactCaseMatches, results.length),
    fieldAccuracy: accuracy(matchedFields, totalFields),
    matchedFields,
    totalFields,
    byField: aggregateFields(results),
    byTag: aggregateBuckets(results, (result) => result.tags),
    cases: results,
  };
}

function percentage(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatA1EvaluationMarkdown(
  report: A1EvaluationReport,
  metadata?: { provider?: string; model?: string },
) {
  const lines = [
    "# A1 Structured Extraction Evaluation",
    "",
    `- Suite: \`${report.suite}\``,
    `- Generated: ${report.generatedAt}`,
    ...(metadata?.provider ? [`- Provider: \`${metadata.provider}\``] : []),
    ...(metadata?.model ? [`- Model: \`${metadata.model}\``] : []),
    `- Cases: ${report.totalCases}`,
    `- Schema success: ${report.successfulExtractions}/${report.totalCases} (${percentage(report.extractionSuccessRate)})`,
    `- Exact cases: ${report.exactCaseMatches}/${report.totalCases} (${percentage(report.exactCaseAccuracy)})`,
    `- Field accuracy: ${report.matchedFields}/${report.totalFields} (${percentage(report.fieldAccuracy)})`,
    "",
    "## Field Accuracy",
    "",
    "| Field | Matched | Total | Accuracy |",
    "| --- | ---: | ---: | ---: |",
    ...Object.entries(report.byField).map(
      ([field, bucket]) =>
        `| ${field} | ${bucket.matched} | ${bucket.total} | ${percentage(bucket.accuracy)} |`,
    ),
    "",
    "## Failed Fields",
    "",
  ];
  const failedFields = report.cases.flatMap((result) =>
    result.fields
      .filter((field) => !field.matched)
      .map(
        (field) =>
          `- \`${result.caseId}.${field.field}\`: expected \`${JSON.stringify(field.expected)}\`, actual \`${JSON.stringify(field.actual)}\``,
      ),
  );

  lines.push(...(failedFields.length > 0 ? failedFields : ["- None"]));

  return `${lines.join("\n")}\n`;
}
