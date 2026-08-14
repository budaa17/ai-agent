import { describe, expect, it } from "vitest";
import { buildBuildWatchSimulation } from "../../src/simulation/index.js";
import {
  dailyReportGoldenCases,
  evaluateDailyReportCases,
  finalizeDailyReportDraft,
} from "../../src/structuring/index.js";

describe("A1 daily-report golden evaluation", () => {
  it("contains 140 unique cases across 14 production categories", () => {
    expect(dailyReportGoldenCases).toHaveLength(140);
    expect(new Set(dailyReportGoldenCases.map((goldenCase) => goldenCase.caseId)).size).toBe(140);
    expect(new Set(dailyReportGoldenCases.map((goldenCase) => goldenCase.category)).size).toBe(14);
  });

  it("passes the offline reference release gate", async () => {
    const simulation = buildBuildWatchSimulation();
    const report = await evaluateDailyReportCases({
      cases: dailyReportGoldenCases,
      mode: "reference",
      extract: async (goldenCase) =>
        finalizeDailyReportDraft({
          tenantId: simulation.snapshot.tenantId,
          projectId: simulation.snapshot.projectId,
          requestId: `test-${goldenCase.caseId}`,
          sourceText: goldenCase.sourceText,
          referenceDate: goldenCase.referenceDate,
          modelOutput: goldenCase.modelOutput,
          projectSnapshot: simulation.snapshot,
          enforceSnapshotConsistency: false,
        }),
    });

    expect(report.successfulExtractions).toBe(140);
    expect(report.exactCaseMatches).toBe(140);
    expect(report.fieldAccuracy).toBe(1);
    expect(report.clarificationPrecision).toBe(1);
    expect(report.clarificationRecall).toBe(1);
    expect(report.promptInjectionPassRate).toBe(1);
    expect(report.releaseGate.passed).toBe(true);
  });

  it("keeps prompt instructions as inert source data", async () => {
    const simulation = buildBuildWatchSimulation();
    const injectionCases = dailyReportGoldenCases.filter(
      (goldenCase) => goldenCase.category === "PROMPT_INJECTION",
    );
    const report = await evaluateDailyReportCases({
      cases: injectionCases,
      mode: "reference",
      extract: async (goldenCase) =>
        finalizeDailyReportDraft({
          tenantId: simulation.snapshot.tenantId,
          projectId: simulation.snapshot.projectId,
          requestId: `security-${goldenCase.caseId}`,
          sourceText: goldenCase.sourceText,
          referenceDate: goldenCase.referenceDate,
          modelOutput: goldenCase.modelOutput,
          projectSnapshot: simulation.snapshot,
          enforceSnapshotConsistency: false,
        }),
    });

    expect(report.promptInjectionPassRate).toBe(1);
    expect(
      report.cases.every(
        (result) =>
          result.output?.tenantId === simulation.snapshot.tenantId &&
          result.output.projectId === simulation.snapshot.projectId,
      ),
    ).toBe(true);
  });
});
