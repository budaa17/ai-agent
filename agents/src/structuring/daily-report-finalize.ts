import { createHash } from "node:crypto";
import {
  confidenceLevelFromScore,
  type ContractArtifactReference,
  type ContractFieldConfidence,
  type ContractValidationIssue,
} from "../contracts/common.js";
import {
  dailyReportDraftV1Schema,
  type DailyReportClarificationQuestion,
  type DailyReportDraftV1,
} from "../contracts/daily-report.js";
import type { ProjectAnalysisSnapshotV1 } from "../contracts/project-analysis-snapshot.js";
import { addCalendarDays } from "../production-analysis/calendar.js";
import { detectProjectUpdateLanguage } from "./extract.js";
import {
  dailyReportModelOutputSchema,
  type DailyReportModelConfidence,
  type DailyReportModelOutput,
} from "./daily-report-model.js";

export type FinalizeDailyReportOptions = {
  tenantId: string;
  projectId: string;
  requestId: string;
  sourceText?: string;
  sourceArtifacts?: readonly ContractArtifactReference[];
  referenceDate: string;
  modelOutput: DailyReportModelOutput;
  projectSnapshot?: ProjectAnalysisSnapshotV1;
  existingDrafts?: readonly DailyReportDraftV1[];
  enforceSnapshotConsistency?: boolean;
};

type AddIssue = (
  code: string,
  severity: ContractValidationIssue["severity"],
  fieldPaths: string[],
  message: string,
) => void;

type AddQuestion = (
  fieldPath: string,
  reason: DailyReportClarificationQuestion["reason"],
  question: string,
  options?: DailyReportClarificationQuestion["options"],
) => void;

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function normalizeReference(value: string | null): string | null {
  return value?.trim().normalize("NFKC").toUpperCase() ?? null;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function sourceContainsQuote(sourceText: string, quote: string): boolean {
  return normalizeSearchText(sourceText).includes(normalizeSearchText(quote));
}

function relativeConfidencePath(basePath: string, rawFieldPath: string): string {
  const normalizedBasePath = basePath.replace(/\[(\d+)\]/g, ".$1");
  const normalizedRawFieldPath = rawFieldPath
    .trim()
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
  const relativePath = normalizedRawFieldPath.startsWith(`${normalizedBasePath}.`)
    ? normalizedRawFieldPath.slice(normalizedBasePath.length + 1)
    : normalizedRawFieldPath;
  const alias = basePath.startsWith("progressEntries.")
    ? {
        workItemCode: "workItem.code",
        workItemName: "workItem.name",
        candidateCodes: "workItem.candidateCodes",
      }[relativePath]
    : undefined;

  return alias ?? relativePath;
}

function normalizedConfidencePath(basePath: string, rawFieldPath: string): string {
  const relativePath = relativeConfidencePath(basePath, rawFieldPath);

  return relativePath.length === 0 ? basePath : `${basePath}.${relativePath}`;
}

function confidenceEntries(input: {
  raw: readonly DailyReportModelConfidence[];
  basePath: string;
  sourceText: string;
  sourceId: string;
  imageArtifacts: readonly ContractArtifactReference[];
  addIssue: AddIssue;
  addQuestion: AddQuestion;
  include?: (fieldPath: string) => boolean;
}): ContractFieldConfidence[] {
  return input.raw
    .filter(
      (confidence) =>
        input.include?.(relativeConfidencePath(input.basePath, confidence.fieldPath)) ?? true,
    )
    .map((confidence, index) => {
      const fieldPath = normalizedConfidencePath(input.basePath, confidence.fieldPath);
      const imageArtifact =
        confidence.sourceImageIndex === null
          ? undefined
          : input.imageArtifacts[confidence.sourceImageIndex];
      const textVerified =
        confidence.sourceImageIndex === null &&
        confidence.evidenceQuote !== null &&
        sourceContainsQuote(input.sourceText, confidence.evidenceQuote);
      const imageVerified =
        confidence.sourceImageIndex !== null &&
        imageArtifact !== undefined &&
        confidence.imageRegion !== null;
      const verified = textVerified || imageVerified;
      const score = verified ? confidence.score : Math.min(confidence.score, 0.49);

      if (
        (confidence.evidenceQuote !== null || confidence.sourceImageIndex !== null) &&
        !verified
      ) {
        input.addIssue(
          `UNVERIFIED_EVIDENCE_${input.basePath}_${index}`,
          "WARNING",
          [fieldPath],
          confidence.sourceImageIndex === null
            ? "Model evidence quote was not found in the source text."
            : "Model image evidence does not reference a supplied image and visible region.",
        );
      }

      if (score < 0.65) {
        input.addQuestion(
          fieldPath,
          verified ? "LOW_CONFIDENCE" : "UNREADABLE_SOURCE",
          `${fieldPath} утгыг эх тайлантай тулгаж баталгаажуулна уу.`,
        );
      }

      return {
        fieldPath,
        score,
        level: confidenceLevelFromScore(score),
        evidence: verified
          ? [
              imageVerified
                ? {
                    sourceType: "IMAGE" as const,
                    sourceId: imageArtifact!.artifactId,
                    fieldPath,
                    quote: confidence.evidenceQuote,
                    imageRegion: confidence.imageRegion,
                  }
                : {
                    sourceType: "TEXT" as const,
                    sourceId: input.sourceId,
                    fieldPath,
                    quote: confidence.evidenceQuote,
                    imageRegion: null,
                  },
            ]
          : [],
      };
    });
}

function ensureFieldConfidence(input: {
  entries: ContractFieldConfidence[];
  fieldPath: string;
  populated: boolean;
  sourceText: string;
  sourceId: string;
  addQuestion: AddQuestion;
}): void {
  if (
    !input.populated ||
    input.entries.some(
      (entry) =>
        entry.fieldPath === input.fieldPath || entry.fieldPath.endsWith(`.${input.fieldPath}`),
    )
  ) {
    return;
  }

  input.entries.push({
    fieldPath: input.fieldPath,
    score: 0.4,
    level: "LOW",
    evidence: [],
  });
  input.addQuestion(
    input.fieldPath,
    "LOW_CONFIDENCE",
    `${input.fieldPath} утгын эх сурвалж, зөв эсэхийг баталгаажуулна уу.`,
  );
}

function resolveRelativeReportDate(
  reportDate: string | null,
  sourceText: string,
  referenceDate: string,
): string | null {
  if (reportDate !== null) {
    return reportDate;
  }

  if (/(?:өнөөдөр|today)/iu.test(sourceText)) {
    return referenceDate;
  }

  if (/(?:өчигдөр|yesterday)/iu.test(sourceText)) {
    return addCalendarDays(referenceDate, -1);
  }

  return null;
}

function workItemOptions(
  snapshot: ProjectAnalysisSnapshotV1 | undefined,
  codes: readonly string[],
): DailyReportClarificationQuestion["options"] {
  if (snapshot === undefined) {
    return codes.map((code) => ({ value: code, label: code }));
  }

  const byCode = new Map(
    snapshot.workItems.map((workItem) => [workItem.code.toUpperCase(), workItem]),
  );
  return codes.map((code) => {
    const workItem = byCode.get(code.toUpperCase());
    return {
      value: code,
      label: workItem === undefined ? code : `${workItem.code} — ${workItem.name}`,
    };
  });
}

function resolveWorkItem(input: {
  code: string | null;
  name: string | null;
  candidateCodes: readonly string[];
  snapshot?: ProjectAnalysisSnapshotV1;
  fieldPath: string;
  addIssue: AddIssue;
  addQuestion: AddQuestion;
}): {
  code: string | null;
  name: string | null;
  candidateCodes: string[];
} {
  const explicitCode = normalizeReference(input.code);
  const explicitCandidates = [
    ...new Set(input.candidateCodes.map((code) => normalizeReference(code)!)),
  ];

  if (input.snapshot === undefined) {
    if (explicitCode === null) {
      input.addQuestion(
        `${input.fieldPath}.code`,
        "AMBIGUOUS_REFERENCE",
        "Ажлын кодыг сонгож баталгаажуулна уу.",
        workItemOptions(undefined, explicitCandidates),
      );
    }

    return {
      code: explicitCode,
      name: input.name,
      candidateCodes: explicitCandidates,
    };
  }

  const byCode = new Map(
    input.snapshot.workItems.map((workItem) => [workItem.code.toUpperCase(), workItem]),
  );

  if (explicitCode !== null) {
    const known = byCode.get(explicitCode);

    if (known === undefined) {
      input.addIssue(
        `UNKNOWN_WORK_ITEM_${input.fieldPath}`,
        "ERROR",
        [`${input.fieldPath}.code`],
        `Work item code ${explicitCode} is not present in the project snapshot.`,
      );
      input.addQuestion(
        `${input.fieldPath}.code`,
        "AMBIGUOUS_REFERENCE",
        `${explicitCode} кодыг зөв project work item-оор солино уу.`,
      );
    }

    return {
      code: explicitCode,
      name: input.name ?? known?.name ?? null,
      candidateCodes: explicitCandidates.filter((candidate) => candidate !== explicitCode),
    };
  }

  const normalizedName = input.name === null ? "" : normalizeSearchText(input.name);
  const nameCandidates =
    normalizedName.length === 0
      ? []
      : input.snapshot.workItems.filter((workItem) => {
          const knownName = normalizeSearchText(workItem.name);
          return (
            knownName === normalizedName ||
            knownName.includes(normalizedName) ||
            normalizedName.includes(knownName)
          );
        });
  const candidateCodes = [
    ...new Set([...explicitCandidates, ...nameCandidates.map((workItem) => workItem.code)]),
  ];

  if (candidateCodes.length === 1) {
    const known = byCode.get(candidateCodes[0]!)!;
    return {
      code: known.code,
      name: input.name ?? known.name,
      candidateCodes: [],
    };
  }

  input.addIssue(
    `UNRESOLVED_WORK_ITEM_${input.fieldPath}`,
    "ERROR",
    [`${input.fieldPath}.code`],
    "Progress entry could not be resolved to exactly one project work item.",
  );
  input.addQuestion(
    `${input.fieldPath}.code`,
    "AMBIGUOUS_REFERENCE",
    "Энэ ахиц аль ажлын мөрөнд хамаарахыг сонгоно уу.",
    workItemOptions(input.snapshot, candidateCodes),
  );

  return {
    code: null,
    name: input.name,
    candidateCodes,
  };
}

function resolveMaterial(input: {
  rawName: string;
  normalizedName: string | null;
  materialRef: string | null;
  snapshot?: ProjectAnalysisSnapshotV1;
}): {
  normalizedName: string | null;
  materialRef: string | null;
} {
  if (input.snapshot === undefined) {
    return {
      normalizedName: input.normalizedName,
      materialRef: normalizeReference(input.materialRef),
    };
  }

  const needle = normalizeSearchText(input.materialRef ?? input.normalizedName ?? input.rawName);
  const matches = input.snapshot.materials.filter((material) =>
    [material.materialId, material.code, material.name, ...material.aliases].some(
      (candidate) => normalizeSearchText(candidate) === needle,
    ),
  );

  if (matches.length !== 1) {
    return {
      normalizedName: input.normalizedName,
      materialRef: normalizeReference(input.materialRef),
    };
  }

  return {
    normalizedName: matches[0]!.name,
    materialRef: matches[0]!.materialId,
  };
}

function tokenSet(value: string | null): Set<string> {
  return new Set(
    normalizeSearchText(value ?? "")
      .split(" ")
      .filter((token) => token.length >= 2),
  );
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }

  const intersection = [...left].filter((value) => right.has(value)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function duplicateCandidates(
  draft: Pick<DailyReportDraftV1, "draftId" | "reportDate" | "rawText" | "progressEntries">,
  existingDrafts: readonly DailyReportDraftV1[],
): DailyReportDraftV1["duplicateCandidates"] {
  const currentCodes = new Set(
    draft.progressEntries
      .map((entry) => entry.workItem.code)
      .filter((code): code is string => code !== null),
  );
  const currentTokens = tokenSet(draft.rawText);

  return existingDrafts
    .filter((candidate) => candidate.draftId !== draft.draftId)
    .map((candidate) => {
      const candidateCodes = new Set(
        candidate.progressEntries
          .map((entry) => entry.workItem.code)
          .filter((code): code is string => code !== null),
      );
      const sameDate = draft.reportDate !== null && draft.reportDate === candidate.reportDate;
      const codeSimilarity = jaccard(currentCodes, candidateCodes);
      const textSimilarity = jaccard(currentTokens, tokenSet(candidate.rawText));
      const similarity = (sameDate ? 0.25 : 0) + codeSimilarity * 0.45 + textSimilarity * 0.3;
      const reasons = [
        ...(sameDate ? ["Ижил тайлангийн огноо"] : []),
        ...(codeSimilarity > 0 ? ["Давхцсан ажлын код"] : []),
        ...(textSimilarity >= 0.5 ? ["Төстэй эх текст"] : []),
      ];

      return {
        candidateReportId: candidate.draftId,
        similarity: Math.round(Math.min(1, similarity) * 10_000) / 10_000,
        reasons,
      };
    })
    .filter(
      (candidate) =>
        candidate.similarity >= 0.65 && candidate.reasons.includes("Ижил тайлангийн огноо"),
    )
    .sort(
      (left, right) =>
        right.similarity - left.similarity ||
        left.candidateReportId.localeCompare(right.candidateReportId),
    )
    .slice(0, 20);
}

function canonicalDuplicateCandidates(
  draft: Pick<DailyReportDraftV1, "reportDate" | "rawText" | "progressEntries">,
  snapshot: ProjectAnalysisSnapshotV1 | undefined,
): DailyReportDraftV1["duplicateCandidates"] {
  if (snapshot === undefined || draft.reportDate === null) {
    return [];
  }

  const workItemIdByCode = new Map(
    snapshot.workItems.map((workItem) => [workItem.code.toUpperCase(), workItem.workItemId]),
  );
  const currentWorkItemIds = new Set(
    draft.progressEntries
      .map((entry) =>
        entry.workItem.code === null
          ? undefined
          : workItemIdByCode.get(entry.workItem.code.toUpperCase()),
      )
      .filter((id): id is string => id !== undefined),
  );
  const progressByReport = new Map<string, Set<string>>();

  for (const progress of snapshot.progressEntries) {
    const workItemIds = progressByReport.get(progress.dailyReportId) ?? new Set<string>();
    workItemIds.add(progress.workItemId);
    progressByReport.set(progress.dailyReportId, workItemIds);
  }

  return snapshot.dailyReports
    .filter((report) => report.status === "APPROVED" && report.date === draft.reportDate)
    .map((report) => {
      const existingWorkItemIds = progressByReport.get(report.dailyReportId) ?? new Set<string>();
      const overlap = [...currentWorkItemIds].filter((id) => existingWorkItemIds.has(id)).length;
      const codeSimilarity = currentWorkItemIds.size === 0 ? 0 : overlap / currentWorkItemIds.size;
      const textSimilarity = jaccard(tokenSet(draft.rawText), tokenSet(report.rawText));
      const similarity = Math.min(1, 0.45 + codeSimilarity * 0.35 + textSimilarity * 0.2);

      return {
        candidateReportId: report.dailyReportId,
        similarity: Math.round(similarity * 10_000) / 10_000,
        reasons: [
          "Ижил тайлангийн огноо",
          ...(overlap > 0 ? ["Давхцсан ажлын код"] : []),
          ...(textSimilarity >= 0.5 ? ["Төстэй эх текст"] : []),
        ],
      };
    })
    .filter((candidate) => candidate.similarity >= 0.65 && candidate.reasons.length > 0);
}

function progressHistoryContext(
  snapshot: ProjectAnalysisSnapshotV1,
  workItemCode: string,
  reportDate: string,
) {
  const workItem = snapshot.workItems.find(
    (candidate) => candidate.code.toUpperCase() === workItemCode.toUpperCase(),
  );

  if (workItem === undefined) {
    return {
      workItem: undefined,
      latest: undefined,
      hasFutureProgress: false,
    };
  }

  const reportDateById = new Map(
    snapshot.dailyReports
      .filter((report) => report.status === "APPROVED")
      .map((report) => [report.dailyReportId, report.date]),
  );
  const entries = snapshot.progressEntries
    .filter(
      (entry) =>
        entry.workItemId === workItem.workItemId && reportDateById.has(entry.dailyReportId),
    )
    .map((entry) => ({
      entry,
      reportDate: reportDateById.get(entry.dailyReportId)!,
    }))
    .sort(
      (left, right) =>
        left.reportDate.localeCompare(right.reportDate) ||
        Date.parse(left.entry.capturedAt) - Date.parse(right.entry.capturedAt),
    );
  const historical = entries.filter((item) => item.reportDate <= reportDate);

  return {
    workItem,
    latest: historical.at(-1)?.entry,
    hasFutureProgress: entries.some((item) => item.reportDate > reportDate),
  };
}

export function finalizeDailyReportDraft(options: FinalizeDailyReportOptions): DailyReportDraftV1 {
  const modelOutput = dailyReportModelOutputSchema.parse(options.modelOutput);
  const sourceText = options.sourceText?.trim() ?? "";
  const sourceArtifacts = [...(options.sourceArtifacts ?? [])];
  const imageArtifacts = sourceArtifacts.filter((artifact) => artifact.kind === "SOURCE_IMAGE");
  const sourceId = stableId("source-text", `${options.requestId}:${sourceText}`);
  const draftId = stableId("daily-draft", options.requestId);
  const validationIssues: ContractValidationIssue[] = [];
  const clarificationQuestions: DailyReportClarificationQuestion[] = [];
  const issueKeys = new Set<string>();
  const questionPaths = new Set<string>();

  const addIssue: AddIssue = (code, severity, fieldPaths, message) => {
    const key = `${code}:${fieldPaths.join(",")}`;

    if (issueKeys.has(key)) {
      return;
    }

    issueKeys.add(key);
    validationIssues.push({
      code: code.slice(0, 100),
      severity,
      fieldPaths,
      message,
      deterministic: true,
    });
  };
  const addQuestion: AddQuestion = (fieldPath, reason, question, choices = []) => {
    if (questionPaths.has(fieldPath)) {
      return;
    }

    questionPaths.add(fieldPath);
    clarificationQuestions.push({
      questionId: `${draftId}-question-${String(clarificationQuestions.length + 1).padStart(
        3,
        "0",
      )}`,
      fieldPath,
      reason,
      question,
      options: choices,
      requiredForApproval: true,
    });
  };
  const reportDate = resolveRelativeReportDate(
    modelOutput.reportDate,
    sourceText,
    options.referenceDate,
  );

  if (reportDate === null) {
    addIssue(
      "MISSING_REPORT_DATE",
      "ERROR",
      ["reportDate"],
      "Daily report date is required before approval.",
    );
    addQuestion("reportDate", "MISSING_REQUIRED_VALUE", "Өдрийн тайлангийн огноог оруулна уу.");
  } else if (reportDate > options.referenceDate) {
    addIssue(
      "REPORT_DATE_IN_FUTURE",
      "WARNING",
      ["reportDate"],
      "Report date is after the supplied reference date.",
    );
  }

  const progressEntries = modelOutput.progressEntries
    .filter(
      (entry) =>
        entry.progressPercent !== null ||
        entry.quantityDone !== null ||
        entry.status !== null ||
        entry.blocker !== null ||
        entry.note !== null,
    )
    .map((entry, index) => {
      const basePath = `progressEntries.${index}`;
      const workItem = resolveWorkItem({
        code: entry.workItemCode,
        name: entry.workItemName,
        candidateCodes: entry.candidateCodes,
        snapshot: options.projectSnapshot,
        fieldPath: `${basePath}.workItem`,
        addIssue,
        addQuestion,
      });
      let status = entry.status;

      if (status === null && entry.progressPercent === 100) {
        status = "COMPLETED";
      } else if (status === null && entry.progressPercent !== null && entry.progressPercent > 0) {
        status = "IN_PROGRESS";
      }

      if (
        status === "COMPLETED" &&
        entry.progressPercent !== null &&
        entry.progressPercent !== 100
      ) {
        addIssue(
          `COMPLETED_PROGRESS_MISMATCH_${index}`,
          "ERROR",
          [`${basePath}.status`, `${basePath}.progressPercent`],
          "Completed work must have 100 percent progress.",
        );
        addQuestion(
          `${basePath}.progressPercent`,
          "LOGIC_CONFLICT",
          "Ажил дууссан эсэх эсвэл гүйцэтгэлийн хувийг засна уу.",
        );
      }

      if (
        entry.progressPercent === 100 &&
        status !== null &&
        !["COMPLETED", "CANCELLED"].includes(status)
      ) {
        addIssue(
          `FULL_PROGRESS_STATUS_MISMATCH_${index}`,
          "ERROR",
          [`${basePath}.status`, `${basePath}.progressPercent`],
          "One hundred percent progress conflicts with the status.",
        );
        addQuestion(
          `${basePath}.status`,
          "LOGIC_CONFLICT",
          "100% гүйцэтгэлийн төлөвийг баталгаажуулна уу.",
        );
      }

      if (entry.quantityDone !== null && entry.unit === null) {
        addIssue(
          `MISSING_PROGRESS_UNIT_${index}`,
          "ERROR",
          [`${basePath}.quantityDone`, `${basePath}.unit`],
          "Reported quantity requires an explicit unit.",
        );
        addQuestion(
          `${basePath}.unit`,
          "MISSING_REQUIRED_VALUE",
          "Гүйцэтгэсэн тоо хэмжээний нэгжийг оруулна уу.",
        );
      }

      if (entry.quantityDone !== null && entry.progressMode === "UNSPECIFIED") {
        addIssue(
          `MISSING_PROGRESS_MODE_${index}`,
          "ERROR",
          [`${basePath}.progressMode`],
          "Reported quantity must be cumulative or incremental.",
        );
        addQuestion(
          `${basePath}.progressMode`,
          "MISSING_REQUIRED_VALUE",
          "Тоо хэмжээ нь өнөөдрийн нэмэгдэл үү, эсвэл нийт хуримтлагдсан хэмжээ юу?",
          [
            {
              value: "INCREMENTAL",
              label: "Өнөөдрийн нэмэгдэл",
            },
            {
              value: "CUMULATIVE",
              label: "Нийт хуримтлагдсан",
            },
          ],
        );
      }

      if (
        options.enforceSnapshotConsistency !== false &&
        options.projectSnapshot !== undefined &&
        reportDate !== null &&
        workItem.code !== null
      ) {
        const history = progressHistoryContext(options.projectSnapshot, workItem.code, reportDate);
        const latestCumulative = Number(history.latest?.cumulativeQuantityDone ?? "0");
        const latestPercent = history.latest?.progressPercent ?? 0;
        const quantity = Number(entry.quantityDone);
        const plannedQuantity = Number(history.workItem?.plannedQuantity ?? "0");

        if (history.hasFutureProgress) {
          addIssue(
            `BACKDATED_PROGRESS_${index}`,
            "ERROR",
            [`${basePath}.progressPercent`],
            "A backdated progress report requires an explicit correction workflow.",
          );
          addQuestion(
            `${basePath}.progressPercent`,
            "LOGIC_CONFLICT",
            "Энэ огнооноос хойших ахиц бүртгэгдсэн байна. Correction хэлбэрээр шалгана уу.",
          );
        }

        if (
          entry.progressMode === "CUMULATIVE" &&
          entry.quantityDone !== null &&
          quantity + 0.000001 < latestCumulative
        ) {
          addIssue(
            `CUMULATIVE_QUANTITY_REGRESSION_${index}`,
            "ERROR",
            [`${basePath}.quantityDone`],
            `Cumulative quantity ${entry.quantityDone} is below the existing ${history.latest?.cumulativeQuantityDone}.`,
          );
          addQuestion(
            `${basePath}.quantityDone`,
            "LOGIC_CONFLICT",
            "Нийт хуримтлагдсан хэмжээг өмнөх бүртгэлтэй тулгаж засна уу.",
          );
        }

        if (entry.progressPercent !== null && entry.progressPercent + 0.01 < latestPercent) {
          addIssue(
            `PROGRESS_REGRESSION_${index}`,
            "ERROR",
            [`${basePath}.progressPercent`],
            `Progress ${entry.progressPercent}% is below the existing ${latestPercent}%.`,
          );
          addQuestion(
            `${basePath}.progressPercent`,
            "LOGIC_CONFLICT",
            "Явцын хувь өмнөх бүртгэлээс буурсан байна. Утгыг баталгаажуулна уу.",
          );
        }

        if (
          entry.quantityDone !== null &&
          entry.progressPercent !== null &&
          entry.progressMode !== "UNSPECIFIED" &&
          plannedQuantity > 0
        ) {
          const projectedCumulative =
            entry.progressMode === "INCREMENTAL" ? latestCumulative + quantity : quantity;
          const quantityPercent = (projectedCumulative / plannedQuantity) * 100;

          if (Math.abs(quantityPercent - entry.progressPercent) > 2) {
            addIssue(
              `QUANTITY_PERCENT_MISMATCH_${index}`,
              "ERROR",
              [`${basePath}.quantityDone`, `${basePath}.progressPercent`],
              `Quantity implies ${quantityPercent.toFixed(
                2,
              )}% but the report states ${entry.progressPercent}%.`,
            );
            addQuestion(
              `${basePath}.quantityDone`,
              "LOGIC_CONFLICT",
              "Тоо хэмжээ болон явцын хувь хоорондоо зөрж байна. Аль утга зөвийг шалгана уу.",
            );
          }
        }
      }

      if (status === "BLOCKED" && entry.blocker === null) {
        addIssue(
          `BLOCKED_WITHOUT_REASON_${index}`,
          "WARNING",
          [`${basePath}.status`, `${basePath}.blocker`],
          "Blocked status has no blocker explanation.",
        );
        addQuestion(
          `${basePath}.blocker`,
          "MISSING_REQUIRED_VALUE",
          "Саатлын шалтгааныг оруулна уу.",
        );
      }

      const confidence = confidenceEntries({
        raw: entry.confidence,
        basePath,
        sourceText,
        sourceId,
        imageArtifacts,
        addIssue,
        addQuestion,
      });
      ensureFieldConfidence({
        entries: confidence,
        fieldPath: `${basePath}.workItem.code`,
        populated: workItem.code !== null,
        sourceText,
        sourceId,
        addQuestion,
      });
      ensureFieldConfidence({
        entries: confidence,
        fieldPath: `${basePath}.progressPercent`,
        populated: entry.progressPercent !== null,
        sourceText,
        sourceId,
        addQuestion,
      });
      ensureFieldConfidence({
        entries: confidence,
        fieldPath: `${basePath}.quantityDone`,
        populated: entry.quantityDone !== null,
        sourceText,
        sourceId,
        addQuestion,
      });
      ensureFieldConfidence({
        entries: confidence,
        fieldPath: `${basePath}.status`,
        populated: status !== null,
        sourceText,
        sourceId,
        addQuestion,
      });

      return {
        entryId: `${draftId}-progress-${String(index + 1).padStart(3, "0")}`,
        workItem,
        progressMode: entry.progressMode,
        progressPercent: entry.progressPercent,
        quantityDone: entry.quantityDone,
        unit: entry.unit,
        status,
        blocker: entry.blocker,
        note: entry.note,
        fieldConfidence: confidence,
      };
    });

  const attendanceEntries = modelOutput.attendanceEntries.map((entry, index) => {
    const basePath = `attendanceEntries.${index}`;

    if (entry.teamRef === null && entry.teamName === null) {
      addIssue(
        `MISSING_ATTENDANCE_TEAM_${index}`,
        "ERROR",
        [`${basePath}.teamRef`, `${basePath}.teamName`],
        "Attendance requires a team reference or name.",
      );
      addQuestion(
        `${basePath}.teamName`,
        "MISSING_REQUIRED_VALUE",
        "Ирцийн багийн нэрийг оруулна уу.",
      );
    }

    if (
      entry.hoursPerPerson !== null &&
      entry.totalHours !== null &&
      Math.abs(entry.headcount * entry.hoursPerPerson - entry.totalHours) > 0.01
    ) {
      addIssue(
        `ATTENDANCE_HOURS_CONFLICT_${index}`,
        "ERROR",
        [`${basePath}.headcount`, `${basePath}.hoursPerPerson`, `${basePath}.totalHours`],
        "Attendance total hours conflict with headcount and hours.",
      );
      addQuestion(
        `${basePath}.totalHours`,
        "LOGIC_CONFLICT",
        "Нийт хүн-цагийн утгыг баталгаажуулна уу.",
      );
    }

    const confidence = confidenceEntries({
      raw: entry.confidence,
      basePath,
      sourceText,
      sourceId,
      imageArtifacts,
      addIssue,
      addQuestion,
    });
    ensureFieldConfidence({
      entries: confidence,
      fieldPath: `${basePath}.teamType`,
      populated: true,
      sourceText,
      sourceId,
      addQuestion,
    });
    const teamTypeConfidence = confidence.find((item) => item.fieldPath === `${basePath}.teamType`);
    const teamType =
      entry.teamType === "UNKNOWN" || (teamTypeConfidence?.score ?? 0) < 0.65
        ? "UNKNOWN"
        : entry.teamType;

    if (teamType === "UNKNOWN") {
      addIssue(
        `UNKNOWN_ATTENDANCE_TEAM_TYPE_${index}`,
        "ERROR",
        [`${basePath}.teamType`],
        "Attendance team type must be confirmed before approval.",
      );
      addQuestion(
        `${basePath}.teamType`,
        "MISSING_REQUIRED_VALUE",
        "Энэ нь өөрийн баг уу, эсвэл туслан гүйцэтгэгчийн баг уу?",
        [
          { value: "OWN", label: "Өөрийн баг" },
          {
            value: "SUBCONTRACTOR",
            label: "Туслан гүйцэтгэгч",
          },
        ],
      );
    }

    return {
      entryId: `${draftId}-attendance-${String(index + 1).padStart(3, "0")}`,
      teamType,
      teamRef: normalizeReference(entry.teamRef),
      teamName: entry.teamName,
      workItemCodes: [...new Set(entry.workItemCodes.map((code) => normalizeReference(code)!))],
      headcount: entry.headcount,
      hoursPerPerson: entry.hoursPerPerson,
      totalHours: entry.totalHours,
      fieldConfidence: confidence,
    };
  });

  const materialSignals = modelOutput.materialSignals.map((signal, index) => {
    const basePath = `materialSignals.${index}`;
    const material = resolveMaterial({
      rawName: signal.rawName,
      normalizedName: signal.normalizedName,
      materialRef: signal.materialRef,
      snapshot: options.projectSnapshot,
    });

    if (signal.quantity !== null && signal.unit === null) {
      addIssue(
        `MISSING_MATERIAL_UNIT_${index}`,
        "ERROR",
        [`${basePath}.quantity`, `${basePath}.unit`],
        "Material quantity requires an explicit unit.",
      );
      addQuestion(
        `${basePath}.unit`,
        "MISSING_REQUIRED_VALUE",
        "Материалын тоо хэмжээний нэгжийг оруулна уу.",
      );
    }

    if (signal.quantity !== null && material.materialRef === null) {
      addIssue(
        `UNRESOLVED_MATERIAL_${index}`,
        "WARNING",
        [`${basePath}.materialRef`],
        "Material signal could not be normalized to the project catalog.",
      );
      addQuestion(
        `${basePath}.materialRef`,
        "AMBIGUOUS_REFERENCE",
        "Материалын catalog мөрийг сонгоно уу.",
      );
    }

    return {
      signalId: `${draftId}-material-${String(index + 1).padStart(3, "0")}`,
      signalType: signal.signalType,
      rawName: signal.rawName,
      normalizedName: material.normalizedName,
      materialRef: material.materialRef,
      quantity: signal.quantity,
      unit: signal.unit,
      supplierName: signal.supplierName,
      workItemCodes: [...new Set(signal.workItemCodes.map((code) => normalizeReference(code)!))],
      note: signal.note,
      fieldConfidence: confidenceEntries({
        raw: signal.confidence,
        basePath,
        sourceText,
        sourceId,
        imageArtifacts,
        addIssue,
        addQuestion,
      }),
    };
  });

  const equipmentEntries = (modelOutput.equipmentEntries ?? []).map((entry, index) => {
    const basePath = `equipmentEntries.${index}`;
    if (entry.equipmentRef === null && entry.equipmentName === null) {
      addIssue(
        `MISSING_EQUIPMENT_REFERENCE_${index}`,
        "ERROR",
        [`${basePath}.equipmentRef`, `${basePath}.equipmentName`],
        "Equipment usage requires a reference or name.",
      );
      addQuestion(
        `${basePath}.equipmentName`,
        "MISSING_REQUIRED_VALUE",
        "Тоног төхөөрөмжийн код эсвэл нэрийг оруулна уу.",
      );
    }
    if (entry.usageQuantity !== null && entry.unit === null) {
      addIssue(
        `MISSING_EQUIPMENT_UNIT_${index}`,
        "ERROR",
        [`${basePath}.usageQuantity`, `${basePath}.unit`],
        "Equipment usage quantity requires an explicit unit.",
      );
      addQuestion(
        `${basePath}.unit`,
        "MISSING_REQUIRED_VALUE",
        "Тоног төхөөрөмжийн ашиглалтын нэгжийг оруулна уу.",
      );
    }
    return {
      entryId: `${draftId}-equipment-${String(index + 1).padStart(3, "0")}`,
      equipmentRef: normalizeReference(entry.equipmentRef),
      equipmentName: entry.equipmentName,
      workItemCodes: [...new Set(entry.workItemCodes.map((code) => normalizeReference(code)!))],
      hoursUsed: entry.hoursUsed,
      usageQuantity: entry.usageQuantity,
      unit: entry.unit,
      status: entry.status,
      note: entry.note,
      fieldConfidence: confidenceEntries({
        raw: entry.confidence,
        basePath,
        sourceText,
        sourceId,
        imageArtifacts,
        addIssue,
        addQuestion,
      }),
    };
  });

  const photoObservations = modelOutput.photoObservations.flatMap((observation, index) => {
    const basePath = `photoObservations.${index}`;
    const artifact = imageArtifacts[observation.sourceImageIndex];

    if (artifact === undefined) {
      addIssue(
        `UNKNOWN_PHOTO_SOURCE_${index}`,
        "ERROR",
        [`${basePath}.sourceImageIndex`],
        "Photo observation references an image that was not supplied.",
      );
      addQuestion(
        `${basePath}.sourceImageIndex`,
        "UNREADABLE_SOURCE",
        "Зургийн ажиглалт аль эх зурагт хамаарахыг баталгаажуулна уу.",
      );
      return [];
    }

    const requiresQuestion = [
      "PROGRESS_CONTRADICTION",
      "SAFETY_ADVISORY",
      "DELIVERY_CANDIDATE",
      "UNREADABLE",
    ].includes(observation.kind);
    const reviewQuestion =
      observation.reviewQuestion ??
      (requiresQuestion ? "Зураг дээрх ажиглалтыг хүнээр баталгаажуулна уу." : null);

    return [
      {
        observationId: `${draftId}-photo-${String(index + 1).padStart(3, "0")}`,
        photoArtifactId: artifact.artifactId,
        kind: observation.kind,
        statement: observation.statement,
        reviewQuestion,
        workItemCandidateCodes: [
          ...new Set(observation.workItemCandidateCodes.map((code) => normalizeReference(code)!)),
        ],
        confidence: observation.confidence,
        evidence: [
          {
            sourceType: "IMAGE" as const,
            sourceId: artifact.artifactId,
            fieldPath: basePath,
            quote: null,
            imageRegion: observation.imageRegion,
          },
        ],
        advisoryOnly: true as const,
      },
    ];
  });

  if (
    progressEntries.length === 0 &&
    attendanceEntries.length === 0 &&
    materialSignals.length === 0 &&
    photoObservations.length === 0
  ) {
    throw new Error("Daily report contains no facts or photo observations");
  }

  const topLevelConfidence = confidenceEntries({
    raw: modelOutput.topLevelConfidence,
    basePath: "dailyReport",
    sourceText,
    sourceId,
    imageArtifacts,
    addIssue,
    addQuestion,
    include: (fieldPath) => {
      if (fieldPath === "reportDate") {
        return reportDate !== null;
      }

      if (fieldPath === "location") {
        return Object.values(modelOutput.location).some((value) => value !== null);
      }

      if (fieldPath.startsWith("location.")) {
        const key = fieldPath.slice("location.".length) as keyof typeof modelOutput.location;
        return modelOutput.location[key] !== null;
      }

      return true;
    },
  });
  ensureFieldConfidence({
    entries: topLevelConfidence,
    fieldPath: "reportDate",
    populated: reportDate !== null,
    sourceText,
    sourceId,
    addQuestion,
  });
  for (const key of ["block", "stage", "floor", "zone"] as const) {
    ensureFieldConfidence({
      entries: topLevelConfidence,
      fieldPath: `dailyReport.location.${key}`,
      populated: modelOutput.location[key] !== null,
      sourceText,
      sourceId,
      addQuestion,
    });
  }
  const allConfidence = [
    ...topLevelConfidence,
    ...progressEntries.flatMap((entry) => entry.fieldConfidence),
    ...attendanceEntries.flatMap((entry) => entry.fieldConfidence),
    ...materialSignals.flatMap((signal) => signal.fieldConfidence),
  ];
  const confidenceScores = [
    ...allConfidence.map((confidence) => confidence.score),
    ...photoObservations.map((observation) => observation.confidence),
  ];
  const baseConfidence =
    confidenceScores.length === 0
      ? 0.3
      : confidenceScores.reduce((sum, confidence) => sum + confidence, 0) / confidenceScores.length;
  const overallConfidence = Math.max(
    0,
    Math.min(
      1,
      Math.round(
        (baseConfidence -
          validationIssues.filter((issue) => issue.severity === "ERROR").length * 0.08 -
          clarificationQuestions.length * 0.02) *
          10_000,
      ) / 10_000,
    ),
  );
  const confidenceLevel = confidenceLevelFromScore(overallConfidence);
  const partialDraft = {
    draftId,
    reportDate,
    rawText: sourceText || null,
    progressEntries,
  };
  const duplicateMap = new Map(
    [
      ...duplicateCandidates(partialDraft, options.existingDrafts ?? []),
      ...(options.enforceSnapshotConsistency === false
        ? []
        : canonicalDuplicateCandidates(partialDraft, options.projectSnapshot)),
    ].map((candidate) => [candidate.candidateReportId, candidate]),
  );
  const duplicates = [...duplicateMap.values()]
    .sort(
      (left, right) =>
        right.similarity - left.similarity ||
        left.candidateReportId.localeCompare(right.candidateReportId),
    )
    .slice(0, 20);

  if (duplicates.length > 0) {
    addIssue(
      "POSSIBLE_DUPLICATE_REPORT",
      "WARNING",
      ["duplicateCandidates"],
      "A similar daily-report draft already exists.",
    );
    addQuestion(
      "duplicateCandidates",
      "LOGIC_CONFLICT",
      "Энэ тайлан давхардсан эсэхийг шалгана уу.",
      duplicates.map((candidate) => ({
        value: candidate.candidateReportId,
        label: `${candidate.candidateReportId} (${Math.round(candidate.similarity * 100)}%)`,
      })),
    );
  }

  const hasErrors = validationIssues.some((issue) => issue.severity === "ERROR");
  const status =
    hasErrors || clarificationQuestions.length > 0 || confidenceLevel === "LOW"
      ? "NEEDS_CORRECTION"
      : "READY_FOR_REVIEW";

  return dailyReportDraftV1Schema.parse({
    schemaVersion: 1,
    draftType: "DAILY_REPORT",
    draftId,
    requestId: options.requestId,
    tenantId: options.tenantId,
    projectId: options.projectId,
    sourceArtifacts,
    rawText: sourceText || null,
    language:
      sourceText.length > 0 ? detectProjectUpdateLanguage(sourceText) : modelOutput.language,
    reportDate,
    location: modelOutput.location,
    progressEntries,
    attendanceEntries,
    materialSignals,
    equipmentEntries,
    photoObservations,
    clarificationQuestions,
    duplicateCandidates: duplicates,
    fieldConfidence: topLevelConfidence,
    overallConfidence,
    confidenceLevel,
    validationIssues,
    status,
    requiresHumanReview: true,
  });
}
