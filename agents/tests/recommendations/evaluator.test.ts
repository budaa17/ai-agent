import { describe, expect, it } from "vitest";
import { analyzeProjectData } from "../../src/analysis/analyze.js";
import {
  evaluateA2Cases,
  formatA2EvaluationMarkdown,
} from "../../src/recommendations/evaluator.js";
import { A2_GOLDEN_CASES } from "../../src/recommendations/golden-cases.js";
import { buildRecommendationGroundingContext } from "../../src/recommendations/grounding.js";
import { recommendationReportSchema } from "../../src/recommendations/schema.js";
import { buildProjectAnalysisFixture } from "../analysis/fixtures.js";
import { buildRecommendationFixture } from "./fixtures.js";

function perfectOutput(projectId: string) {
  const data = buildProjectAnalysisFixture(projectId);
  const analysis = analyzeProjectData(data);

  if (projectId !== "project-atlas") {
    return {
      data,
      analysis,
      report: recommendationReportSchema.parse({
        schemaVersion: 1,
        language: "mn",
        tenantId: data.tenantId,
        projectId: data.projectId,
        projectCode: data.projectCode,
        projectName: data.projectName,
        asOf: data.asOf,
        executiveSummary: "Одоогийн өгөгдлөөс баталгаажсан эрсдэл илрээгүй.",
        riskBrief: {
          posture: "NONE",
          summary: "Нэмэлт ажиглалт болон зөвлөмж шаардах нотолгоо илрээгүй.",
          observations: [],
        },
        recommendations: [],
      }),
    };
  }

  const fixture = buildRecommendationFixture();
  const grounding = buildRecommendationGroundingContext(fixture.data, fixture.analysis);
  const report = structuredClone(fixture.report);
  report.recommendations = fixture.analysis.issues.map((issue) => {
    const workItem = fixture.data.workItems.find((candidate) => candidate.id === issue.workItemId)!;
    const source = grounding.facts.find(
      (candidate) =>
        candidate.sourceType === "ISSUE" &&
        candidate.sourceId === issue.id &&
        candidate.field === "type",
    )!;

    return {
      id: `rec-${issue.id}`,
      priority: issue.severity,
      workItemId: workItem.id,
      workItemName: workItem.name,
      title: "Эрсдэлийн хариу арга хэмжээг төлөвлөх",
      action: "Хариуцагчийг тодорхойлж, баталгаажсан саадыг арилгах ажлыг төлөвлө.",
      rationale: "Детерминистик шинжилгээгээр хариу арга хэмжээ шаардсан асуудал илэрсэн.",
      impactRef: issue.id,
      sources: [source],
    };
  });

  return {
    data: fixture.data,
    analysis: fixture.analysis,
    report: recommendationReportSchema.parse(report),
  };
}

describe("A2 evaluator", () => {
  it("reports perfect grounding and structural coverage", async () => {
    const report = await evaluateA2Cases({
      cases: A2_GOLDEN_CASES,
      generatedAt: "2026-03-01T00:00:00.000Z",
      observe: async (goldenCase) => perfectOutput(goldenCase.expected.projectId),
    });

    expect(report.passedCases).toBe(3);
    expect(report.groundedCases).toBe(3);
    expect(report.fieldAccuracy).toBe(1);
    expect(report.observationKinds).toMatchObject({
      precision: 1,
      recall: 1,
    });
    expect(report.recommendationImpacts).toMatchObject({
      precision: 1,
      recall: 1,
    });
    expect(formatA2EvaluationMarkdown(report)).toContain("A2 Golden Dataset Evaluation");
  });

  it("records one failed case without aborting the suite", async () => {
    const cases = A2_GOLDEN_CASES.slice(0, 2);
    const report = await evaluateA2Cases({
      cases,
      observe: async (goldenCase) => {
        if (goldenCase.id === cases[1]!.id) {
          throw new Error("stored A2 run not found");
        }

        return perfectOutput(goldenCase.expected.projectId);
      },
    });

    expect(report.successfulCases).toBe(1);
    expect(report.passedCases).toBe(1);
    expect(report.cases[1]?.error).toContain("stored A2 run not found");
  });
});
