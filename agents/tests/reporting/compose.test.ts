import { describe, expect, it } from "vitest";
import {
  composeProjectReport,
  createAnalysisOnlyRecommendationReport,
} from "../../src/reporting/compose.js";
import {
  ReportNarrativeGroundingError,
  createDeterministicReportNarrative,
} from "../../src/reporting/narrative.js";
import { buildProjectReportFixture } from "./fixtures.js";

describe("A3 report composition", () => {
  it("keeps deterministic analysis and grounded A2 output intact", () => {
    const fixture = buildProjectReportFixture();

    expect(fixture.projectReport.analysis).toEqual(fixture.analysis);
    expect(fixture.projectReport.recommendations).toEqual(fixture.report);
    expect(fixture.projectReport.metrics.forecastErrorDays).toBe(3);
    expect(fixture.projectReport.provenance).toMatchObject({
      narrativeMode: "DETERMINISTIC",
      recommendationSource: "ARTIFACT",
      a2RunId: "run-a2-fixture",
    });
  });

  it("supports an explicit analysis-only report when A2 quota is unavailable", () => {
    const fixture = buildProjectReportFixture();
    const recommendations = createAnalysisOnlyRecommendationReport(fixture.data, fixture.analysis);
    const report = composeProjectReport({
      data: fixture.data,
      analysis: fixture.analysis,
      recommendations,
      narrative: createDeterministicReportNarrative(false),
      answerKey: fixture.answerKey,
      narrativeMode: "DETERMINISTIC",
      recommendationSource: "ANALYSIS_ONLY",
      generatedAt: "2026-03-01T01:00:00.000Z",
    });

    expect(report.recommendations.recommendations).toEqual([]);
    expect(report.analysis.summary.issueCount).toBe(5);
  });

  it("rejects numeric claims from a narrative paragraph", () => {
    const fixture = buildProjectReportFixture();
    const narrative = {
      ...fixture.narrative,
      conclusion: "Тайлан 999 хувийн баталгаатай.",
    };

    expect(() =>
      composeProjectReport({
        data: fixture.data,
        analysis: fixture.analysis,
        recommendations: fixture.report,
        narrative,
        answerKey: fixture.answerKey,
        narrativeMode: "LLM",
        recommendationSource: "ARTIFACT",
      }),
    ).toThrow(ReportNarrativeGroundingError);
  });
});
