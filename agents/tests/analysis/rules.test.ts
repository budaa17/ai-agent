import { buildSeedData } from "../../prisma/seed-data.js";
import { describe, expect, it } from "vitest";
import { evaluateDeterministicRules } from "../../src/analysis/rules.js";
import { buildProjectAnalysisFixture } from "./fixtures.js";

describe("evaluateDeterministicRules", () => {
  it("detects exactly the five seeded Atlas issues", () => {
    const seed = buildSeedData();
    const data = buildProjectAnalysisFixture("project-atlas");
    const result = evaluateDeterministicRules(data);

    expect(result.evaluations).toHaveLength(5);
    expect(
      result.evaluations.every(
        (evaluation) =>
          evaluation.decisionVersion === 1 &&
          evaluation.hitPolicy === "COLLECT" &&
          evaluation.matchedCount === evaluation.outputs.length,
      ),
    ).toBe(true);
    expect(result.issues.map((issue) => [issue.type, issue.projectId, issue.workItemId])).toEqual(
      seed.answerKey.issues.map((issue) => [issue.type, issue.projectId, issue.workItemId]),
    );

    for (const expected of seed.answerKey.issues) {
      const detected = result.issues.find(
        (issue) =>
          issue.type === expected.type &&
          issue.projectId === expected.projectId &&
          issue.workItemId === expected.workItemId,
      );

      expect(detected).toBeDefined();
      expect(detected).toMatchObject({
        severity: expected.severity,
        effectiveFrom: expected.effectiveFrom,
      });
      expect(detected?.evidence).toMatchObject(expected.expectedEvidence);
    }
  });

  it("returns no false positives for the healthy River project", () => {
    const data = buildProjectAnalysisFixture("project-river");
    const result = evaluateDeterministicRules(data);

    expect(result.issues).toEqual([]);
    expect(result.evaluations.every((evaluation) => evaluation.matchedCount === 0)).toBe(true);
  });
});
