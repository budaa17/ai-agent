import { buildSeedData } from "../../prisma/seed-data.js";
import { composeProjectReport } from "../../src/reporting/compose.js";
import { createDeterministicReportNarrative } from "../../src/reporting/narrative.js";
import { buildRecommendationFixture } from "../recommendations/fixtures.js";

export function buildProjectReportFixture() {
  const recommendationFixture = buildRecommendationFixture();
  const answerKey = buildSeedData().answerKey;
  const narrative = createDeterministicReportNarrative(true);
  const report = composeProjectReport({
    data: recommendationFixture.data,
    analysis: recommendationFixture.analysis,
    recommendations: recommendationFixture.report,
    narrative,
    answerKey,
    narrativeMode: "DETERMINISTIC",
    recommendationSource: "ARTIFACT",
    a2RunId: "run-a2-fixture",
    a2TraceId: "a".repeat(32),
    generatedAt: "2026-03-01T01:00:00.000Z",
  });

  return {
    ...recommendationFixture,
    answerKey,
    narrative,
    projectReport: report,
  };
}
