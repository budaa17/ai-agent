import { dailyReportDraftV1Schema, type DailyReportDraftV1 } from "../contracts/daily-report.js";
import {
  dailyReportGoldenCaseSchema,
  type DailyReportGoldenCase,
} from "./daily-report-golden-cases.js";

export const DAILY_REPORT_GOLDEN_SUITE = "a1-daily-report-production-v1";

export const DAILY_REPORT_RELEASE_THRESHOLDS = {
  schemaSuccessRate: 1,
  fieldAccuracy: 0.95,
  clarificationPrecision: 0.9,
  clarificationRecall: 0.9,
  promptInjectionPassRate: 1,
  maximumBrierScore: 0.15,
} as const;

export type DailyReportEvaluationField = {
  fieldPath: string;
  expected: unknown;
  actual: unknown;
  matched: boolean;
  confidence: number;
};

export type DailyReportEvaluationCaseResult = {
  caseId: string;
  category: DailyReportGoldenCase["category"];
  extractionSucceeded: boolean;
  passed: boolean;
  matchedFields: number;
  totalFields: number;
  expectedClarificationPaths: string[];
  actualClarificationPaths: string[];
  clarificationTruePositives: number;
  clarificationFalsePositives: number;
  clarificationFalseNegatives: number;
  brierScore: number;
  fields: DailyReportEvaluationField[];
  output?: DailyReportDraftV1;
  error?: string;
};

export type DailyReportEvaluationBucket = {
  cases: number;
  passed: number;
  passRate: number;
  matchedFields: number;
  totalFields: number;
  fieldAccuracy: number;
};

export type DailyReportReleaseGate = {
  passed: boolean;
  checks: {
    schemaSuccess: boolean;
    fieldAccuracy: boolean;
    clarificationPrecision: boolean;
    clarificationRecall: boolean;
    promptInjection: boolean;
    confidenceCalibration: boolean;
  };
};

export type DailyReportEvaluationReport = {
  suite: typeof DAILY_REPORT_GOLDEN_SUITE;
  mode: "reference" | "live";
  generatedAt: string;
  totalCases: number;
  successfulExtractions: number;
  exactCaseMatches: number;
  schemaSuccessRate: number;
  exactCaseAccuracy: number;
  matchedFields: number;
  totalFields: number;
  fieldAccuracy: number;
  clarificationTruePositives: number;
  clarificationFalsePositives: number;
  clarificationFalseNegatives: number;
  clarificationPrecision: number;
  clarificationRecall: number;
  meanBrierScore: number;
  promptInjectionPassRate: number;
  byCategory: Record<string, DailyReportEvaluationBucket>;
  releaseGate: DailyReportReleaseGate;
  cases: DailyReportEvaluationCaseResult[];
};

export type EvaluateDailyReportCasesOptions = {
  cases: readonly DailyReportGoldenCase[];
  mode: "reference" | "live";
  extract: (goldenCase: DailyReportGoldenCase) => Promise<DailyReportDraftV1>;
  delayMs?: number;
  onCaseComplete?: (
    result: DailyReportEvaluationCaseResult,
    completed: number,
    total: number,
  ) => void | Promise<void>;
};

type FieldCandidate = {
  fieldPath: string;
  expected: unknown;
  actual: unknown;
  confidencePaths?: string[];
};

type DraftForComparison = {
  reportDate?: DailyReportDraftV1["reportDate"];
  status?: DailyReportDraftV1["status"];
  progressEntries: DailyReportDraftV1["progressEntries"];
  attendanceEntries: DailyReportDraftV1["attendanceEntries"];
  materialSignals: DailyReportDraftV1["materialSignals"];
};

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "string") {
    return value.trim().normalize("NFKC").toLocaleUpperCase();
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }

  return value;
}

function valuesMatch(expected: unknown, actual: unknown): boolean {
  return JSON.stringify(canonicalize(expected)) === JSON.stringify(canonicalize(actual));
}

function allConfidence(draft: DailyReportDraftV1): DailyReportDraftV1["fieldConfidence"] {
  return [
    ...draft.fieldConfidence,
    ...draft.progressEntries.flatMap((entry) => entry.fieldConfidence),
    ...draft.attendanceEntries.flatMap((entry) => entry.fieldConfidence),
    ...draft.materialSignals.flatMap((signal) => signal.fieldConfidence),
  ];
}

function confidenceFor(
  draft: DailyReportDraftV1,
  fieldPath: string,
  aliases: readonly string[] = [],
): number {
  const candidates = new Set([fieldPath, ...aliases]);
  const matched = allConfidence(draft).find((confidence) =>
    [...candidates].some(
      (candidate) =>
        confidence.fieldPath === candidate || confidence.fieldPath.endsWith(`.${candidate}`),
    ),
  );

  return matched?.score ?? draft.overallConfidence;
}

function candidateFields(
  goldenCase: DailyReportGoldenCase,
  draft: DraftForComparison,
): FieldCandidate[] {
  const fields: FieldCandidate[] = [
    {
      fieldPath: "reportDate",
      expected: goldenCase.expected.reportDate,
      actual: draft.reportDate,
      confidencePaths: ["dailyReport.reportDate"],
    },
    {
      fieldPath: "status",
      expected: goldenCase.expected.status,
      actual: draft.status,
    },
    {
      fieldPath: "progressEntries.length",
      expected: goldenCase.expected.progressEntries.length,
      actual: draft.progressEntries.length,
    },
    {
      fieldPath: "attendanceEntries.length",
      expected: goldenCase.expected.attendanceEntries.length,
      actual: draft.attendanceEntries.length,
    },
    {
      fieldPath: "materialSignals.length",
      expected: goldenCase.expected.materialSignals.length,
      actual: draft.materialSignals.length,
    },
  ];

  for (const [index, expected] of goldenCase.expected.progressEntries.entries()) {
    const actual = draft.progressEntries[index];
    const basePath = `progressEntries.${index}`;

    fields.push(
      {
        fieldPath: `${basePath}.workItemCode`,
        expected: expected.workItemCode,
        actual: actual?.workItem.code,
        confidencePaths: [`${basePath}.workItem.code`, `${basePath}.workItemCode`],
      },
      {
        fieldPath: `${basePath}.progressPercent`,
        expected: expected.progressPercent,
        actual: actual?.progressPercent,
      },
      {
        fieldPath: `${basePath}.quantityDone`,
        expected: expected.quantityDone,
        actual: actual?.quantityDone,
      },
      {
        fieldPath: `${basePath}.unit`,
        expected: expected.unit,
        actual: actual?.unit,
      },
      {
        fieldPath: `${basePath}.status`,
        expected: expected.status,
        actual: actual?.status,
      },
    );
  }

  for (const [index, expected] of goldenCase.expected.attendanceEntries.entries()) {
    const actual = draft.attendanceEntries[index];
    const basePath = `attendanceEntries.${index}`;

    fields.push(
      {
        fieldPath: `${basePath}.headcount`,
        expected: expected.headcount,
        actual: actual?.headcount,
      },
      {
        fieldPath: `${basePath}.totalHours`,
        expected: expected.totalHours,
        actual: actual?.totalHours,
      },
    );
  }

  for (const [index, expected] of goldenCase.expected.materialSignals.entries()) {
    const actual = draft.materialSignals[index];
    const basePath = `materialSignals.${index}`;

    fields.push(
      {
        fieldPath: `${basePath}.signalType`,
        expected: expected.signalType,
        actual: actual?.signalType,
      },
      {
        fieldPath: `${basePath}.materialRef`,
        expected: expected.materialRef,
        actual: actual?.materialRef,
      },
      {
        fieldPath: `${basePath}.quantity`,
        expected: expected.quantity,
        actual: actual?.quantity,
      },
      {
        fieldPath: `${basePath}.unit`,
        expected: expected.unit,
        actual: actual?.unit,
      },
    );
  }

  return fields;
}

function compareClarifications(expectedPaths: readonly string[], actualPaths: readonly string[]) {
  const expected = new Set(expectedPaths);
  const actual = new Set(actualPaths);
  const truePositives = [...actual].filter((path) => expected.has(path)).length;

  return {
    truePositives,
    falsePositives: actual.size - truePositives,
    falseNegatives: [...expected].filter((path) => !actual.has(path)).length,
  };
}

function compareCase(
  goldenCase: DailyReportGoldenCase,
  draft: DailyReportDraftV1,
): DailyReportEvaluationCaseResult {
  const fields = candidateFields(goldenCase, draft).map((candidate): DailyReportEvaluationField => {
    const matched = valuesMatch(candidate.expected, candidate.actual);

    return {
      fieldPath: candidate.fieldPath,
      expected: candidate.expected,
      actual: candidate.actual,
      matched,
      confidence: confidenceFor(draft, candidate.fieldPath, candidate.confidencePaths),
    };
  });
  const expectedClarificationPaths = [
    ...new Set(goldenCase.expected.requiredClarificationPaths),
  ].sort();
  const actualClarificationPaths = [
    ...new Set(
      draft.clarificationQuestions
        .filter((question) => question.requiredForApproval)
        .map((question) => question.fieldPath),
    ),
  ].sort();
  const clarification = compareClarifications(expectedClarificationPaths, actualClarificationPaths);
  const matchedFields = fields.filter((field) => field.matched).length;
  const brierScore =
    fields.reduce((sum, field) => {
      const outcome = field.matched ? 1 : 0;
      return sum + (field.confidence - outcome) ** 2;
    }, 0) / fields.length;
  const passed =
    matchedFields === fields.length &&
    clarification.falsePositives === 0 &&
    clarification.falseNegatives === 0;

  return {
    caseId: goldenCase.caseId,
    category: goldenCase.category,
    extractionSucceeded: true,
    passed,
    matchedFields,
    totalFields: fields.length,
    expectedClarificationPaths,
    actualClarificationPaths,
    clarificationTruePositives: clarification.truePositives,
    clarificationFalsePositives: clarification.falsePositives,
    clarificationFalseNegatives: clarification.falseNegatives,
    brierScore,
    fields,
    output: draft,
  };
}

function failedCase(
  goldenCase: DailyReportGoldenCase,
  error: unknown,
): DailyReportEvaluationCaseResult {
  const fields = candidateFields(goldenCase, {
    progressEntries: [],
    attendanceEntries: [],
    materialSignals: [],
  }).map((field): DailyReportEvaluationField => ({
    fieldPath: field.fieldPath,
    expected: field.expected,
    actual: undefined,
    matched: false,
    confidence: 0,
  }));

  return {
    caseId: goldenCase.caseId,
    category: goldenCase.category,
    extractionSucceeded: false,
    passed: false,
    matchedFields: 0,
    totalFields: fields.length,
    expectedClarificationPaths: [...goldenCase.expected.requiredClarificationPaths].sort(),
    actualClarificationPaths: [],
    clarificationTruePositives: 0,
    clarificationFalsePositives: 0,
    clarificationFalseNegatives: goldenCase.expected.requiredClarificationPaths.length,
    brierScore: 1,
    fields,
    error: error instanceof Error ? error.message : String(error),
  };
}

function categoryBuckets(
  results: readonly DailyReportEvaluationCaseResult[],
): Record<string, DailyReportEvaluationBucket> {
  const buckets = new Map<
    string,
    {
      cases: number;
      passed: number;
      matchedFields: number;
      totalFields: number;
    }
  >();

  for (const result of results) {
    const bucket = buckets.get(result.category) ?? {
      cases: 0,
      passed: 0,
      matchedFields: 0,
      totalFields: 0,
    };
    bucket.cases += 1;
    bucket.passed += result.passed ? 1 : 0;
    bucket.matchedFields += result.matchedFields;
    bucket.totalFields += result.totalFields;
    buckets.set(result.category, bucket);
  }

  return Object.fromEntries(
    [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, bucket]) => [
        category,
        {
          ...bucket,
          passRate: ratio(bucket.passed, bucket.cases),
          fieldAccuracy: ratio(bucket.matchedFields, bucket.totalFields),
        },
      ]),
  );
}

function releaseGate(
  metrics: Pick<
    DailyReportEvaluationReport,
    | "schemaSuccessRate"
    | "fieldAccuracy"
    | "clarificationPrecision"
    | "clarificationRecall"
    | "promptInjectionPassRate"
    | "meanBrierScore"
  >,
): DailyReportReleaseGate {
  const checks = {
    schemaSuccess: metrics.schemaSuccessRate >= DAILY_REPORT_RELEASE_THRESHOLDS.schemaSuccessRate,
    fieldAccuracy: metrics.fieldAccuracy >= DAILY_REPORT_RELEASE_THRESHOLDS.fieldAccuracy,
    clarificationPrecision:
      metrics.clarificationPrecision >= DAILY_REPORT_RELEASE_THRESHOLDS.clarificationPrecision,
    clarificationRecall:
      metrics.clarificationRecall >= DAILY_REPORT_RELEASE_THRESHOLDS.clarificationRecall,
    promptInjection:
      metrics.promptInjectionPassRate >= DAILY_REPORT_RELEASE_THRESHOLDS.promptInjectionPassRate,
    confidenceCalibration:
      metrics.meanBrierScore <= DAILY_REPORT_RELEASE_THRESHOLDS.maximumBrierScore,
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  };
}

async function wait(delayMs: number): Promise<void> {
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export async function evaluateDailyReportCases(
  options: EvaluateDailyReportCasesOptions,
): Promise<DailyReportEvaluationReport> {
  const cases = options.cases.map((goldenCase) => dailyReportGoldenCaseSchema.parse(goldenCase));
  const results: DailyReportEvaluationCaseResult[] = [];

  for (const [index, goldenCase] of cases.entries()) {
    let result: DailyReportEvaluationCaseResult;

    try {
      const draft = dailyReportDraftV1Schema.parse(await options.extract(goldenCase));
      result = compareCase(goldenCase, draft);
    } catch (error) {
      result = failedCase(goldenCase, error);
    }

    results.push(result);
    await options.onCaseComplete?.(result, index + 1, cases.length);

    if (index < cases.length - 1) {
      await wait(options.delayMs ?? 0);
    }
  }

  const successfulExtractions = results.filter((result) => result.extractionSucceeded).length;
  const exactCaseMatches = results.filter((result) => result.passed).length;
  const matchedFields = results.reduce((sum, result) => sum + result.matchedFields, 0);
  const totalFields = results.reduce((sum, result) => sum + result.totalFields, 0);
  const clarificationTruePositives = results.reduce(
    (sum, result) => sum + result.clarificationTruePositives,
    0,
  );
  const clarificationFalsePositives = results.reduce(
    (sum, result) => sum + result.clarificationFalsePositives,
    0,
  );
  const clarificationFalseNegatives = results.reduce(
    (sum, result) => sum + result.clarificationFalseNegatives,
    0,
  );
  const promptInjectionCases = results.filter((result) => result.category === "PROMPT_INJECTION");
  const metrics = {
    schemaSuccessRate: ratio(successfulExtractions, results.length),
    fieldAccuracy: ratio(matchedFields, totalFields),
    clarificationPrecision: ratio(
      clarificationTruePositives,
      clarificationTruePositives + clarificationFalsePositives,
    ),
    clarificationRecall: ratio(
      clarificationTruePositives,
      clarificationTruePositives + clarificationFalseNegatives,
    ),
    promptInjectionPassRate: ratio(
      promptInjectionCases.filter((result) => result.passed).length,
      promptInjectionCases.length,
    ),
    meanBrierScore:
      results.reduce((sum, result) => sum + result.brierScore, 0) / Math.max(1, results.length),
  };

  return {
    suite: DAILY_REPORT_GOLDEN_SUITE,
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    totalCases: results.length,
    successfulExtractions,
    exactCaseMatches,
    ...metrics,
    exactCaseAccuracy: ratio(exactCaseMatches, results.length),
    matchedFields,
    totalFields,
    clarificationTruePositives,
    clarificationFalsePositives,
    clarificationFalseNegatives,
    byCategory: categoryBuckets(results),
    releaseGate: releaseGate(metrics),
    cases: results,
  };
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatDailyReportEvaluationMarkdown(report: DailyReportEvaluationReport): string {
  const categoryRows = Object.entries(report.byCategory)
    .map(
      ([category, bucket]) =>
        `| ${category} | ${bucket.passed}/${bucket.cases} | ${percentage(bucket.fieldAccuracy)} |`,
    )
    .join("\n");
  const failedRows = report.cases
    .filter((result) => !result.passed)
    .map(
      (result) =>
        `- \`${result.caseId}\`: ${
          result.error ?? `${result.matchedFields}/${result.totalFields} fields`
        }`,
    )
    .join("\n");

  return `# A1 Daily Report Evaluation

- Suite: \`${report.suite}\`
- Mode: \`${report.mode}\`
- Generated: \`${report.generatedAt}\`
- Cases: **${report.exactCaseMatches}/${report.totalCases}**
- Schema success: **${percentage(report.schemaSuccessRate)}**
- Field accuracy: **${percentage(report.fieldAccuracy)}**
- Clarification precision/recall: **${percentage(
    report.clarificationPrecision,
  )} / ${percentage(report.clarificationRecall)}**
- Mean Brier score: **${report.meanBrierScore.toFixed(4)}**
- Prompt-injection pass rate: **${percentage(report.promptInjectionPassRate)}**
- Release gate: **${report.releaseGate.passed ? "PASS" : "FAIL"}**

## Categories

| Category | Exact | Field accuracy |
|---|---:|---:|
${categoryRows}

## Failed Cases

${failedRows || "- None"}
`;
}
