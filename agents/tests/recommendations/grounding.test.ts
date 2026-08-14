import { describe, expect, it } from "vitest";
import {
  assertRecommendationGrounded,
  RecommendationGroundingError,
  validateRecommendationGrounding,
} from "../../src/recommendations/grounding.js";
import { recommendationReportSchema } from "../../src/recommendations/schema.js";
import { buildRecommendationFixture } from "./fixtures.js";

describe("recommendation grounding validator", () => {
  it("accepts exact DB references and Part 5 facts", () => {
    const fixture = buildRecommendationFixture();
    const validation = validateRecommendationGrounding(
      fixture.report,
      fixture.data,
      fixture.analysis,
    );

    expect(validation).toMatchObject({
      valid: true,
      checkedObservationCount: 3,
      checkedRecommendationCount: 1,
      checkedSourceCount: 11,
      issues: [],
    });
  });

  it("G-1 rejects a number absent from grounded sources", () => {
    const fixture = buildRecommendationFixture();
    const report = structuredClone(fixture.report);
    report.recommendations[0]!.action = "Ажлыг 999 хоногийн дотор заавал дуусга.";

    expect(() => assertRecommendationGrounded(report, fixture.data, fixture.analysis)).toThrow(
      RecommendationGroundingError,
    );

    const validation = validateRecommendationGrounding(report, fixture.data, fixture.analysis);
    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: "UNGROUNDED_NUMBER",
        path: "recommendations.0.action",
      }),
    );
  });

  it("accepts a numeric claim only when its exact Part 5 source is cited", () => {
    const fixture = buildRecommendationFixture();
    const report = structuredClone(fixture.report);
    const progressSource = fixture.grounding.facts.find(
      (source) =>
        source.sourceType === "ISSUE" &&
        source.sourceId === fixture.issue.id &&
        source.field === "evidence.progressPercent",
    )!;

    report.recommendations[0]!.sources.push(progressSource);
    report.recommendations[0]!.rationale = `Одоогийн явц ${progressSource.value} хувьтай байна.`;

    const validation = validateRecommendationGrounding(report, fixture.data, fixture.analysis);

    expect(validation.valid).toBe(true);
    expect(validation.groundedNumericClaimCount).toBe(1);
  });

  it("rejects a mismatched work-item name and an unknown date", () => {
    const fixture = buildRecommendationFixture();
    const report = structuredClone(fixture.report);

    report.recommendations[0]!.workItemName = "Зохиомол ажил";
    report.recommendations[0]!.action = "Арга хэмжээг 2030-01-01-нд эхлүүл.";

    const validation = validateRecommendationGrounding(report, fixture.data, fixture.analysis);

    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["WORK_ITEM_NAME_MISMATCH", "UNKNOWN_DATE"]),
    );
  });

  it("requires at least one source in the output schema", () => {
    const fixture = buildRecommendationFixture();
    const report = structuredClone(fixture.report);
    report.recommendations[0]!.sources = [];

    expect(() => recommendationReportSchema.parse(report)).toThrow();
  });

  it("rejects a risk posture below the deterministic severity", () => {
    const fixture = buildRecommendationFixture();
    const report = structuredClone(fixture.report);
    report.riskBrief.posture = "HIGH";

    const validation = validateRecommendationGrounding(report, fixture.data, fixture.analysis);

    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: "RISK_POSTURE_MISMATCH",
        path: "riskBrief.posture",
      }),
    );
  });

  it("requires repeated series evidence for a trend", () => {
    const fixture = buildRecommendationFixture();
    const report = structuredClone(fixture.report);
    const trend = report.riskBrief.observations.find(
      (observation) => observation.kind === "TREND",
    )!;
    trend.sources = trend.sources.filter((source) => source.sourceType === "ISSUE");

    const validation = validateRecommendationGrounding(report, fixture.data, fixture.analysis);

    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_TREND_SERIES",
      }),
    );
  });

  it("requires non-issue evidence for a root cause", () => {
    const fixture = buildRecommendationFixture();
    const report = structuredClone(fixture.report);
    const rootCause = report.riskBrief.observations.find(
      (observation) => observation.kind === "ROOT_CAUSE",
    )!;
    rootCause.sources = rootCause.sources.filter((source) => source.sourceType === "ISSUE");

    const validation = validateRecommendationGrounding(report, fixture.data, fixture.analysis);

    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_ROOT_CAUSE_EVIDENCE",
      }),
    );
  });
});
