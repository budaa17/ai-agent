import { buildSeedData } from "../../prisma/seed-data.js";
import { describe, expect, it } from "vitest";
import { evaluateIssuesAgainstAnswerKey } from "../../src/analysis/answer-key-evaluation.js";
import { evaluateDeterministicRules } from "../../src/analysis/rules.js";
import { buildProjectAnalysisFixture } from "./fixtures.js";

describe("evaluateIssuesAgainstAnswerKey", () => {
  it("reports perfect seeded issue precision and recall", () => {
    const seed = buildSeedData();
    const data = buildProjectAnalysisFixture("project-atlas");
    const detected = evaluateDeterministicRules(data).issues;
    const evaluation = evaluateIssuesAgainstAnswerKey(detected, seed.answerKey, {
      tenantId: "tenant-demo",
      projectId: "project-atlas",
    });

    expect(evaluation).toMatchObject({
      expectedCount: 5,
      detectedCount: 5,
      truePositiveCount: 5,
      falsePositiveCount: 0,
      falseNegativeCount: 0,
      precision: 1,
      recall: 1,
      f1: 1,
      missing: [],
      unexpected: [],
    });
  });

  it("counts missing and unexpected issue identities", () => {
    const seed = buildSeedData();
    const data = buildProjectAnalysisFixture("project-atlas");
    const detected = evaluateDeterministicRules(data).issues;
    const changed = [
      ...detected.slice(0, -1),
      {
        ...detected[0]!,
        id: "unexpected",
        type: "LEDGER_MISMATCH" as const,
        workItemId: "wi-atlas-design",
      },
    ];
    const evaluation = evaluateIssuesAgainstAnswerKey(changed, seed.answerKey, {
      tenantId: "tenant-demo",
      projectId: "project-atlas",
    });

    expect(evaluation.truePositiveCount).toBe(4);
    expect(evaluation.falsePositiveCount).toBe(1);
    expect(evaluation.falseNegativeCount).toBe(1);
    expect(evaluation.precision).toBe(0.8);
    expect(evaluation.recall).toBe(0.8);
    expect(evaluation.f1).toBeCloseTo(0.8);
  });
});
