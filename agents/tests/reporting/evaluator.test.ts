import { describe, expect, it } from "vitest";
import { buildSeedData } from "../../prisma/seed-data.js";
import { analyzeProjectData } from "../../src/analysis/analyze.js";
import {
  composeProjectReport,
  createAnalysisOnlyRecommendationReport,
} from "../../src/reporting/compose.js";
import { createA3DocumentBundle } from "../../src/reporting/document.js";
import { evaluateA3Cases, formatA3EvaluationMarkdown } from "../../src/reporting/evaluator.js";
import { A3_GOLDEN_CASES } from "../../src/reporting/golden-cases.js";
import { createDeterministicReportNarrative } from "../../src/reporting/narrative.js";
import { buildProjectAnalysisFixture } from "../analysis/fixtures.js";

function perfectOutput(projectId: string, requestId: string) {
  const data = buildProjectAnalysisFixture(projectId);
  const analysis = analyzeProjectData(data);
  const recommendations = createAnalysisOnlyRecommendationReport(data, analysis);
  const report = composeProjectReport({
    data,
    analysis,
    recommendations,
    narrative: createDeterministicReportNarrative(false),
    answerKey: buildSeedData().answerKey,
    narrativeMode: "DETERMINISTIC",
    recommendationSource: "ANALYSIS_ONLY",
    generatedAt: "2026-03-01T01:00:00.000Z",
  });

  return {
    report,
    bundle: createA3DocumentBundle(report, { requestId }),
    draftStatuses: ["PENDING_APPROVAL", "PENDING_APPROVAL", "PENDING_APPROVAL"],
  };
}

describe("A3 evaluator", () => {
  it("reports perfect deterministic document accuracy", async () => {
    const report = await evaluateA3Cases({
      cases: A3_GOLDEN_CASES,
      generatedAt: "2026-03-01T02:00:00.000Z",
      generate: async (goldenCase) => perfectOutput(goldenCase.expected.projectId, goldenCase.id),
    });

    expect(report.passedCases).toBe(3);
    expect(report.fieldAccuracy).toBe(1);
    expect(formatA3EvaluationMarkdown(report)).toContain("A3 Golden Dataset Evaluation");
  });

  it("records a generation failure without aborting other cases", async () => {
    const cases = A3_GOLDEN_CASES.slice(0, 2);
    const report = await evaluateA3Cases({
      cases,
      generate: async (goldenCase) => {
        if (goldenCase.id === cases[1]!.id) {
          throw new Error("template unavailable");
        }

        return perfectOutput(goldenCase.expected.projectId, goldenCase.id);
      },
    });

    expect(report.successfulCases).toBe(1);
    expect(report.passedCases).toBe(1);
    expect(report.cases[1]?.error).toContain("template unavailable");
  });
});
