import { distance } from "fastest-levenshtein";
import { z } from "zod";
import {
  contractConfidenceLevelSchema,
  contractValidationIssueSchema,
  confidenceLevelFromScore,
  type ContractValidationIssue,
} from "../contracts/common.js";
import {
  dailyReportBlockerCategorySchema,
  dailyReportDraftV1Schema,
  type DailyReportDraftV1,
} from "../contracts/daily-report.js";
import {
  projectAnalysisSnapshotV1Schema,
  type ProjectAnalysisSnapshotV1,
} from "../contracts/project-analysis-snapshot.js";

export const normalizationDomainSchema = z.enum([
  "BLOCKER",
  "MATERIAL",
  "TENANT_TERM",
  "DUPLICATE",
]);

export const normalizationMethodSchema = z.enum([
  "EXACT",
  "ALIAS",
  "TENANT_DICTIONARY",
  "KEYWORD_RULE",
  "FUZZY",
  "SIMILARITY",
  "NO_MATCH",
]);

export const normalizationRecordV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    recordId: z.string().trim().min(1).max(200),
    domain: normalizationDomainSchema,
    sourceValue: z.string().max(2_000),
    normalizedValue: z.string().max(2_000).nullable(),
    canonicalRef: z.string().trim().min(1).max(200).nullable(),
    method: normalizationMethodSchema,
    confidenceScore: z.number().finite().min(0).max(1),
    confidenceLevel: contractConfidenceLevelSchema,
    reversible: z.literal(true),
    requiresHumanReview: z.boolean(),
    provenance: z
      .object({
        snapshotId: z.string().trim().min(1).max(200),
        sourcePath: z.string().trim().min(1).max(300),
        matchedPath: z.string().trim().min(1).max(300).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.confidenceLevel !== confidenceLevelFromScore(record.confidenceScore)) {
      context.addIssue({
        code: "custom",
        message: "Normalization confidence level is inconsistent",
        path: ["confidenceLevel"],
      });
    }

    if (record.confidenceScore < 0.9 && !record.requiresHumanReview) {
      context.addIssue({
        code: "custom",
        message: "Low-confidence normalization must require human review",
        path: ["requiresHumanReview"],
      });
    }
  });

export const aiNormalizationSuggestionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    domain: normalizationDomainSchema,
    sourceValue: z.string().max(2_000),
    suggestedCanonicalRef: z.string().trim().min(1).max(200).nullable(),
    confidenceScore: z.number().finite().min(0).max(1),
  })
  .strict();

export const ai7ResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    draft: dailyReportDraftV1Schema,
    normalizations: z.array(normalizationRecordV1Schema).max(500),
    consistencyIssues: z.array(contractValidationIssueSchema).max(200),
  })
  .strict();

export type NormalizationRecordV1 = z.infer<typeof normalizationRecordV1Schema>;
export type AiNormalizationSuggestionV1 = z.infer<typeof aiNormalizationSuggestionV1Schema>;
export type Ai7ResultV1 = z.infer<typeof ai7ResultV1Schema>;

function normalizedText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("mn-MN")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function similarity(left: string, right: string) {
  const normalizedLeft = normalizedText(left);
  const normalizedRight = normalizedText(right);
  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);

  return maxLength === 0 ? 1 : 1 - distance(normalizedLeft, normalizedRight) / maxLength;
}

function record(input: {
  id: string;
  domain: z.infer<typeof normalizationDomainSchema>;
  sourceValue: string;
  normalizedValue: string | null;
  canonicalRef: string | null;
  method: z.infer<typeof normalizationMethodSchema>;
  confidenceScore: number;
  snapshotId: string;
  sourcePath: string;
  matchedPath: string | null;
}) {
  return normalizationRecordV1Schema.parse({
    schemaVersion: 1,
    recordId: input.id,
    domain: input.domain,
    sourceValue: input.sourceValue,
    normalizedValue: input.normalizedValue,
    canonicalRef: input.canonicalRef,
    method: input.method,
    confidenceScore: input.confidenceScore,
    confidenceLevel: confidenceLevelFromScore(input.confidenceScore),
    reversible: true,
    requiresHumanReview: input.confidenceScore < 0.9,
    provenance: {
      snapshotId: input.snapshotId,
      sourcePath: input.sourcePath,
      matchedPath: input.matchedPath,
    },
  });
}

export function normalizeMaterialAlias(
  snapshotInput: ProjectAnalysisSnapshotV1,
  rawName: string,
  sourcePath = "materialSignals",
): NormalizationRecordV1 {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(snapshotInput);
  const target = normalizedText(rawName);
  const candidates = snapshot.materials.flatMap((material, materialIndex) => [
    {
      material,
      value: material.code,
      method: "EXACT" as const,
      matchedPath: `materials.${materialIndex}.code`,
    },
    {
      material,
      value: material.name,
      method: "EXACT" as const,
      matchedPath: `materials.${materialIndex}.name`,
    },
    ...material.aliases.map((alias, aliasIndex) => ({
      material,
      value: alias,
      method: "ALIAS" as const,
      matchedPath: `materials.${materialIndex}.aliases.${aliasIndex}`,
    })),
  ]);
  const exact = candidates.find((candidate) => normalizedText(candidate.value) === target);

  if (exact !== undefined) {
    return record({
      id: `normalize-material-${sourcePath.replaceAll(/[^A-Za-z0-9.-]/gu, "-")}`,
      domain: "MATERIAL",
      sourceValue: rawName,
      normalizedValue: exact.material.name,
      canonicalRef: exact.material.materialId,
      method: exact.method,
      confidenceScore: exact.method === "EXACT" ? 1 : 0.98,
      snapshotId: snapshot.snapshotId,
      sourcePath,
      matchedPath: exact.matchedPath,
    });
  }

  const fuzzy = candidates
    .map((candidate) => ({
      ...candidate,
      score: similarity(rawName, candidate.value),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.material.materialId.localeCompare(right.material.materialId),
    )[0];

  if (fuzzy !== undefined && fuzzy.score >= 0.75) {
    return record({
      id: `normalize-material-${sourcePath.replaceAll(/[^A-Za-z0-9.-]/gu, "-")}`,
      domain: "MATERIAL",
      sourceValue: rawName,
      normalizedValue: fuzzy.material.name,
      canonicalRef: fuzzy.material.materialId,
      method: "FUZZY",
      confidenceScore: Math.min(0.89, fuzzy.score),
      snapshotId: snapshot.snapshotId,
      sourcePath,
      matchedPath: fuzzy.matchedPath,
    });
  }

  return record({
    id: `normalize-material-${sourcePath.replaceAll(/[^A-Za-z0-9.-]/gu, "-")}`,
    domain: "MATERIAL",
    sourceValue: rawName,
    normalizedValue: null,
    canonicalRef: null,
    method: "NO_MATCH",
    confidenceScore: 0,
    snapshotId: snapshot.snapshotId,
    sourcePath,
    matchedPath: null,
  });
}

const blockerKeywords: Array<{
  category: z.infer<typeof dailyReportBlockerCategorySchema>;
  keywords: string[];
}> = [
  {
    category: "MATERIAL",
    keywords: ["материал", "цемент", "арматур", "тоосго"],
  },
  {
    category: "WEATHER",
    keywords: ["бороо", "цас", "салхи", "хүйтэн", "weather"],
  },
  {
    category: "LABOR",
    keywords: ["ажилчин", "хүн хүч", "labor", "crew"],
  },
  {
    category: "EQUIPMENT",
    keywords: ["техник", "кран", "тоног", "equipment"],
  },
  {
    category: "DESIGN",
    keywords: ["зураг", "drawing", "design"],
  },
  {
    category: "APPROVAL",
    keywords: ["зөвшөөрөл", "approval", "баталгаа"],
  },
  {
    category: "SAFETY",
    keywords: ["аюул", "safety", "осол"],
  },
  {
    category: "SUBCONTRACTOR",
    keywords: ["туслан", "subcontractor"],
  },
  {
    category: "QUALITY",
    keywords: ["чанар", "quality", "дефект"],
  },
];

export function normalizeBlockerTaxonomy(
  snapshotInput: ProjectAnalysisSnapshotV1,
  description: string,
  sourcePath = "progressEntries.blocker",
): NormalizationRecordV1 {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(snapshotInput);
  const text = normalizedText(description);
  const match = blockerKeywords.find((candidate) =>
    candidate.keywords.some((keyword) => text.includes(normalizedText(keyword))),
  );
  const category = match?.category ?? "UNKNOWN";
  const score = match === undefined ? 0.4 : 0.96;

  return record({
    id: `normalize-blocker-${sourcePath.replaceAll(/[^A-Za-z0-9.-]/gu, "-")}`,
    domain: "BLOCKER",
    sourceValue: description,
    normalizedValue: category,
    canonicalRef: category,
    method: match === undefined ? "NO_MATCH" : "KEYWORD_RULE",
    confidenceScore: score,
    snapshotId: snapshot.snapshotId,
    sourcePath,
    matchedPath: match === undefined ? null : `blockerTaxonomy.${category}`,
  });
}

export function normalizeTenantTerm(
  snapshotInput: ProjectAnalysisSnapshotV1,
  value: string,
  sourcePath = "tenantTerm",
): NormalizationRecordV1 {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(snapshotInput);
  const match = Object.entries(snapshot.tenantProfile.terminology).find(
    ([canonical, preferred]) =>
      normalizedText(canonical) === normalizedText(value) ||
      normalizedText(preferred) === normalizedText(value),
  );

  return record({
    id: `normalize-term-${sourcePath.replaceAll(/[^A-Za-z0-9.-]/gu, "-")}`,
    domain: "TENANT_TERM",
    sourceValue: value,
    normalizedValue: match?.[1] ?? null,
    canonicalRef: match?.[0] ?? null,
    method: match === undefined ? "NO_MATCH" : "TENANT_DICTIONARY",
    confidenceScore: match === undefined ? 0 : 1,
    snapshotId: snapshot.snapshotId,
    sourcePath,
    matchedPath: match === undefined ? null : `tenantProfile.terminology.${match[0]}`,
  });
}

export function detectDuplicateDailyReport(
  snapshotInput: ProjectAnalysisSnapshotV1,
  reportDate: string | null,
  sourceText: string | null,
): NormalizationRecordV1[] {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(snapshotInput);

  if (reportDate === null || sourceText === null) {
    return [];
  }

  return snapshot.dailyReports
    .filter((report) => report.date === reportDate && report.rawText !== null)
    .map((report) => ({
      report,
      score: similarity(sourceText, report.rawText!),
    }))
    .filter((candidate) => candidate.score >= 0.82)
    .map((candidate, index) =>
      record({
        id: `normalize-duplicate-${index + 1}`,
        domain: "DUPLICATE",
        sourceValue: sourceText,
        normalizedValue: candidate.report.dailyReportId,
        canonicalRef: candidate.report.dailyReportId,
        method: "SIMILARITY",
        confidenceScore: candidate.score,
        snapshotId: snapshot.snapshotId,
        sourcePath: "rawText",
        matchedPath: `dailyReports.${snapshot.dailyReports.indexOf(candidate.report)}.rawText`,
      }),
    );
}

function issue(
  code: string,
  severity: ContractValidationIssue["severity"],
  fieldPaths: string[],
  message: string,
): ContractValidationIssue {
  return contractValidationIssueSchema.parse({
    code,
    severity,
    fieldPaths,
    message,
    deterministic: true,
  });
}

export function validateAi7Consistency(
  draftInput: DailyReportDraftV1,
  snapshotInput: ProjectAnalysisSnapshotV1,
): ContractValidationIssue[] {
  const draft = dailyReportDraftV1Schema.parse(draftInput);
  const snapshot = projectAnalysisSnapshotV1Schema.parse(snapshotInput);
  const issues: ContractValidationIssue[] = [];
  const workItemsByCode = new Map(snapshot.workItems.map((workItem) => [workItem.code, workItem]));

  if (
    draft.reportDate !== null &&
    (draft.reportDate < snapshot.activeBaseline.plannedStart ||
      draft.reportDate > snapshot.activeBaseline.plannedEnd)
  ) {
    issues.push(
      issue(
        "AI7_REPORT_OUTSIDE_PROJECT_PERIOD",
        "ERROR",
        ["reportDate"],
        "Daily-report date is outside the active baseline period",
      ),
    );
  }

  draft.progressEntries.forEach((entry, index) => {
    if (
      entry.progressPercent !== null &&
      entry.progressPercent > 0 &&
      entry.quantityDone === null
    ) {
      issues.push(
        issue(
          "AI7_PROGRESS_WITHOUT_QUANTITY",
          "WARNING",
          [`progressEntries.${index}.quantityDone`],
          "Progress is reported without a supporting quantity",
        ),
      );
    }

    const workItem =
      entry.workItem.code === null ? undefined : workItemsByCode.get(entry.workItem.code);

    if (
      entry.status === "COMPLETED" &&
      workItem !== undefined &&
      entry.quantityDone !== null &&
      Number(entry.quantityDone) < Number(workItem.plannedQuantity)
    ) {
      issues.push(
        issue(
          "AI7_COMPLETED_WITH_UNFINISHED_QUANTITY",
          "ERROR",
          [`progressEntries.${index}.status`, `progressEntries.${index}.quantityDone`],
          "Completed status conflicts with unfinished planned quantity",
        ),
      );
    }

    if (
      workItem !== undefined &&
      /(бетон|concrete)/iu.test(workItem.name) &&
      !draft.materialSignals.some((signal) =>
        /(бетон|цемент|concrete|cement)/iu.test(signal.rawName),
      )
    ) {
      issues.push(
        issue(
          "AI7_CONCRETE_WITHOUT_MATERIAL_SIGNAL",
          "WARNING",
          [`progressEntries.${index}.workItem`, "materialSignals"],
          "Concrete work is reported without concrete material evidence",
        ),
      );
    }
  });

  if (draft.reportDate !== null) {
    const reportIds = new Set(
      snapshot.dailyReports
        .filter((report) => report.date === draft.reportDate)
        .map((report) => report.dailyReportId),
    );
    const hasLaborCost = snapshot.costEntries.some(
      (entry) =>
        entry.category === "LABOR" &&
        entry.dailyReportId !== null &&
        reportIds.has(entry.dailyReportId),
    );

    if (hasLaborCost && draft.attendanceEntries.length === 0) {
      issues.push(
        issue(
          "AI7_LABOR_COST_WITHOUT_ATTENDANCE",
          "WARNING",
          ["attendanceEntries"],
          "Labor cost exists for the date but attendance is absent",
        ),
      );
    }
  }

  draft.materialSignals.forEach((signal, index) => {
    if (
      signal.signalType !== "CONSUMED" ||
      signal.materialRef === null ||
      draft.reportDate === null
    ) {
      return;
    }

    const movementExists = snapshot.stockMovements.some(
      (movement) =>
        movement.kind === "ISSUE" &&
        movement.materialId === signal.materialRef &&
        movement.occurredAt.slice(0, 10) === draft.reportDate,
    );

    if (!movementExists) {
      issues.push(
        issue(
          "AI7_STOCK_ISSUE_MOVEMENT_MISMATCH",
          "WARNING",
          [`materialSignals.${index}`],
          "Material consumption has no matching stock issue movement",
        ),
      );
    }
  });

  return issues;
}

export function validateAiNormalizationSuggestion(
  snapshotInput: ProjectAnalysisSnapshotV1,
  suggestionInput: AiNormalizationSuggestionV1,
): NormalizationRecordV1 {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(snapshotInput);
  const suggestion = aiNormalizationSuggestionV1Schema.parse(suggestionInput);

  if (suggestion.domain === "MATERIAL") {
    const deterministic = normalizeMaterialAlias(snapshot, suggestion.sourceValue, "aiSuggestion");

    if (suggestion.suggestedCanonicalRef !== deterministic.canonicalRef) {
      return record({
        id: "normalize-ai-suggestion-rejected",
        domain: "MATERIAL",
        sourceValue: suggestion.sourceValue,
        normalizedValue: null,
        canonicalRef: null,
        method: "NO_MATCH",
        confidenceScore: 0,
        snapshotId: snapshot.snapshotId,
        sourcePath: "aiSuggestion",
        matchedPath: null,
      });
    }

    return deterministic;
  }

  if (suggestion.domain === "BLOCKER") {
    return normalizeBlockerTaxonomy(snapshot, suggestion.sourceValue, "aiSuggestion");
  }

  return normalizeTenantTerm(snapshot, suggestion.sourceValue, "aiSuggestion");
}

export function applyAi7Normalization(
  draftInput: DailyReportDraftV1,
  snapshotInput: ProjectAnalysisSnapshotV1,
): Ai7ResultV1 {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(snapshotInput);
  const draft = structuredClone(dailyReportDraftV1Schema.parse(draftInput));
  const normalizations: NormalizationRecordV1[] = [];

  draft.materialSignals.forEach((signal, index) => {
    const normalization = normalizeMaterialAlias(
      snapshot,
      signal.rawName,
      `materialSignals.${index}.rawName`,
    );
    normalizations.push(normalization);

    if (normalization.canonicalRef !== null && !normalization.requiresHumanReview) {
      signal.materialRef = normalization.canonicalRef;
      signal.normalizedName = normalization.normalizedValue;
    }
  });

  draft.progressEntries.forEach((entry, index) => {
    if (entry.blocker === null) {
      return;
    }

    const normalization = normalizeBlockerTaxonomy(
      snapshot,
      entry.blocker.description,
      `progressEntries.${index}.blocker.description`,
    );
    normalizations.push(normalization);

    if (normalization.canonicalRef !== null && !normalization.requiresHumanReview) {
      entry.blocker.category = dailyReportBlockerCategorySchema.parse(normalization.canonicalRef);
    }
  });

  const duplicates = detectDuplicateDailyReport(snapshot, draft.reportDate, draft.rawText);
  normalizations.push(...duplicates);
  draft.duplicateCandidates = duplicates.map((duplicate) => ({
    candidateReportId: duplicate.canonicalRef!,
    similarity: duplicate.confidenceScore,
    reasons: ["AI-7 deterministic text similarity match", "same date"],
  }));

  normalizations
    .filter(
      (normalization) => normalization.requiresHumanReview && normalization.domain !== "DUPLICATE",
    )
    .forEach((normalization, index) => {
      draft.clarificationQuestions.push({
        questionId: `ai7-review-${index + 1}-${draft.draftId}`.slice(0, 200),
        fieldPath: normalization.provenance.sourcePath,
        reason: "LOW_CONFIDENCE",
        question: `“${normalization.sourceValue}” утгын стандарт тохирлыг хүн шалгана уу.`,
        options:
          normalization.normalizedValue === null
            ? []
            : [
                {
                  value: normalization.normalizedValue,
                  label: normalization.normalizedValue,
                },
              ],
        requiredForApproval: true,
      });
    });

  if (draft.clarificationQuestions.some((question) => question.requiredForApproval)) {
    draft.status = "NEEDS_CORRECTION";
  }

  const consistencyIssues = validateAi7Consistency(draft, snapshot);
  draft.validationIssues = [...draft.validationIssues, ...consistencyIssues];
  const needsCorrection =
    draft.validationIssues.some((validationIssue) => validationIssue.severity === "ERROR") ||
    draft.clarificationQuestions.some((question) => question.requiredForApproval) ||
    draft.confidenceLevel === "LOW";
  draft.status = needsCorrection ? "NEEDS_CORRECTION" : "READY_FOR_REVIEW";

  return ai7ResultV1Schema.parse({
    schemaVersion: 1,
    draft,
    normalizations,
    consistencyIssues,
  });
}
