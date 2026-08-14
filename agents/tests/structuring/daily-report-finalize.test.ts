import { describe, expect, it } from "vitest";
import { finalizeDailyReportDraft } from "../../src/structuring/index.js";
import { buildBuildWatchSimulation } from "../../src/simulation/index.js";
import {
  buildValidDailyReportModelOutput,
  validDailyReportSource,
} from "./daily-report-fixtures.js";

const snapshot = buildBuildWatchSimulation().snapshot;

function finalize(overrides: Partial<Parameters<typeof finalizeDailyReportDraft>[0]> = {}) {
  return finalizeDailyReportDraft({
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    requestId: "daily-request-001",
    sourceText: validDailyReportSource,
    referenceDate: "2026-03-30",
    modelOutput: buildValidDailyReportModelOutput(),
    projectSnapshot: snapshot,
    ...overrides,
  });
}

describe("A1 daily-report finalizer", () => {
  it("builds a normalized multi-entry review draft", () => {
    const draft = finalize();

    expect(draft.reportDate).toBe("2026-03-30");
    expect(draft.progressEntries[0]?.workItem.code).toBe("BW-017");
    expect(draft.attendanceEntries[0]?.totalHours).toBe(48);
    expect(draft.materialSignals[0]?.materialRef).toBe("material-brick");
    expect(draft.materialSignals[0]?.normalizedName).toBe("Барилгын тоосго");
    expect(draft.requiresHumanReview).toBe(true);
  });

  it("keeps explicit equipment usage in the review draft", () => {
    const modelOutput = buildValidDailyReportModelOutput();
    modelOutput.equipmentEntries = [
      {
        equipmentRef: "equipment-crane-01",
        equipmentName: "Цамхагт кран",
        workItemCodes: ["BW-017"],
        hoursUsed: 6,
        usageQuantity: null,
        unit: null,
        status: "USED",
        note: null,
        confidence: [],
      },
    ];
    const draft = finalize({ modelOutput });

    expect(draft.equipmentEntries).toEqual([
      expect.objectContaining({
        equipmentRef: "EQUIPMENT-CRANE-01",
        equipmentName: "Цамхагт кран",
        workItemCodes: ["BW-017"],
        hoursUsed: 6,
        status: "USED",
      }),
    ]);
  });

  it("routes an omitted unit to required clarification", () => {
    const modelOutput = buildValidDailyReportModelOutput();
    modelOutput.progressEntries[0]!.unit = null;
    const draft = finalize({ modelOutput });

    expect(draft.status).toBe("NEEDS_CORRECTION");
    expect(draft.validationIssues.some((issue) => issue.code === "MISSING_PROGRESS_UNIT_0")).toBe(
      true,
    );
    expect(
      draft.clarificationQuestions.some(
        (question) => question.fieldPath === "progressEntries.0.unit",
      ),
    ).toBe(true);
  });

  it("does not invent an unknown work-item code", () => {
    const modelOutput = buildValidDailyReportModelOutput();
    modelOutput.progressEntries[0]!.workItemCode = "UNKNOWN-999";
    const draft = finalize({ modelOutput });

    expect(draft.progressEntries[0]?.workItem.code).toBe("UNKNOWN-999");
    expect(draft.validationIssues.some((issue) => issue.code.startsWith("UNKNOWN_WORK_ITEM"))).toBe(
      true,
    );
    expect(draft.status).toBe("NEEDS_CORRECTION");
  });

  it("rejects model evidence that is absent from the source", () => {
    const modelOutput = buildValidDailyReportModelOutput();
    modelOutput.progressEntries[0]!.confidence[0]!.evidenceQuote = "Эхэд байхгүй зохиомол баримт";
    const draft = finalize({ modelOutput });
    const confidence = draft.progressEntries[0]?.fieldConfidence.find((entry) =>
      entry.fieldPath.endsWith("workItem.code"),
    );

    expect(confidence?.score).toBeLessThan(0.5);
    expect(confidence?.evidence).toEqual([]);
    expect(
      draft.clarificationQuestions.some(
        (question) => question.fieldPath === "progressEntries.0.workItem.code",
      ),
    ).toBe(true);
  });

  it("flags a repeated request as a duplicate candidate", () => {
    const first = finalize();
    const second = finalize({
      requestId: "daily-request-002",
      existingDrafts: [first],
    });

    expect(second.duplicateCandidates[0]?.candidateReportId).toBe(first.draftId);
    expect(second.status).toBe("NEEDS_CORRECTION");
  });

  it("does not mark a similar report on another date as duplicate", () => {
    const first = finalize();
    const second = finalize({
      requestId: "daily-request-next-day",
      referenceDate: "2026-03-31",
      existingDrafts: [first],
    });

    expect(second.reportDate).toBe("2026-03-31");
    expect(second.duplicateCandidates).toEqual([]);
  });

  it("normalizes live confidence aliases and asks only real questions", () => {
    const sourceText =
      "2026-03-28-нд BW-017 Шатны марш 60 хувь, 10 м3 гүйцэтгэсэн. Өрлөгийн баг 6 хүн 8 цаг ажилласан.";
    const modelOutput = buildValidDailyReportModelOutput();
    modelOutput.progressEntries[0]!.progressMode = "UNSPECIFIED";
    modelOutput.progressEntries[0]!.confidence = modelOutput.progressEntries[0]!.confidence.map(
      (confidence) => ({
        ...confidence,
        fieldPath: `progressEntries[0].${
          confidence.fieldPath === "workItem.code" ? "workItemCode" : confidence.fieldPath
        }`,
      }),
    );
    modelOutput.attendanceEntries[0]!.confidence = [
      {
        fieldPath: "attendanceEntries[0].teamType",
        score: 0.2,
        evidenceQuote: null,
        sourceImageIndex: null,
        imageRegion: null,
      },
      {
        fieldPath: "attendanceEntries[0].headcount",
        score: 0.99,
        evidenceQuote: "6 хүн",
        sourceImageIndex: null,
        imageRegion: null,
      },
      {
        fieldPath: "attendanceEntries[0].hoursPerPerson",
        score: 0.99,
        evidenceQuote: "8 цаг",
        sourceImageIndex: null,
        imageRegion: null,
      },
    ];
    modelOutput.topLevelConfidence.push({
      fieldPath: "location",
      score: 0.05,
      evidenceQuote: null,
      sourceImageIndex: null,
      imageRegion: null,
    });
    const draft = finalize({
      sourceText,
      modelOutput,
    });
    const questionPaths = draft.clarificationQuestions.map((question) => question.fieldPath);

    expect(
      draft.progressEntries[0]?.fieldConfidence.filter(
        (confidence) => confidence.fieldPath === "progressEntries.0.workItem.code",
      ),
    ).toHaveLength(1);
    expect(draft.attendanceEntries[0]?.teamType).toBe("UNKNOWN");
    expect(questionPaths).toContain("progressEntries.0.progressMode");
    expect(questionPaths).toContain("attendanceEntries.0.teamType");
    expect(questionPaths).not.toContain("progressEntries.0.workItem.code");
    expect(questionPaths).not.toContain("dailyReport.location");
  });

  it("blocks duplicate, regressing, and inconsistent cumulative progress", () => {
    const sourceText =
      "2026-03-28-нд BW-017 Шатны марш 60 хувь, нийт хуримтлагдсан гүйцэтгэл 10 м3. Манай Өрлөгийн баг 6 хүн 8 цаг ажиллав. 100 ш тоосго зарцуулсан.";
    const modelOutput = buildValidDailyReportModelOutput();
    modelOutput.reportDate = "2026-03-28";
    modelOutput.progressEntries[0]!.progressMode = "CUMULATIVE";
    modelOutput.progressEntries[0]!.progressPercent = 60;
    modelOutput.progressEntries[0]!.quantityDone = "10";
    modelOutput.progressEntries[0]!.confidence = [
      {
        fieldPath: "workItemCode",
        score: 0.99,
        evidenceQuote: "BW-017",
        sourceImageIndex: null,
        imageRegion: null,
      },
      {
        fieldPath: "progressPercent",
        score: 0.99,
        evidenceQuote: "60 хувь",
        sourceImageIndex: null,
        imageRegion: null,
      },
      {
        fieldPath: "quantityDone",
        score: 0.99,
        evidenceQuote: "10 м3",
        sourceImageIndex: null,
        imageRegion: null,
      },
      {
        fieldPath: "status",
        score: 0.95,
        evidenceQuote: "60 хувь",
        sourceImageIndex: null,
        imageRegion: null,
      },
    ];
    modelOutput.topLevelConfidence = [
      {
        fieldPath: "reportDate",
        score: 0.99,
        evidenceQuote: "2026-03-28-нд",
        sourceImageIndex: null,
        imageRegion: null,
      },
    ];
    const draft = finalize({
      sourceText,
      referenceDate: "2026-03-28",
      modelOutput,
    });
    const issueCodes = draft.validationIssues.map((issue) => issue.code);

    expect(issueCodes).toContain("CUMULATIVE_QUANTITY_REGRESSION_0");
    expect(issueCodes).toContain("PROGRESS_REGRESSION_0");
    expect(issueCodes).toContain("QUANTITY_PERCENT_MISMATCH_0");
    expect(draft.duplicateCandidates.length).toBeGreaterThan(0);
    expect(draft.status).toBe("NEEDS_CORRECTION");
  });
});
