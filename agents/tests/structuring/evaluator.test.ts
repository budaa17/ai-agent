import { describe, expect, it } from "vitest";
import { evaluateA1Cases, formatA1EvaluationMarkdown } from "../../src/structuring/evaluator.js";
import { A1_GOLDEN_CASES } from "../../src/structuring/golden-cases.js";

describe("A1 evaluator", () => {
  it("reports perfect exact-case and field accuracy", async () => {
    const cases = A1_GOLDEN_CASES.slice(0, 3);
    const report = await evaluateA1Cases({
      cases,
      extract: async (goldenCase) => ({
        ...goldenCase.expected,
        workItemName: goldenCase.expected.workItemName
          ? `${goldenCase.expected.workItemName} ажил`
          : null,
      }),
    });

    expect(report.totalCases).toBe(3);
    expect(report.successfulExtractions).toBe(3);
    expect(report.exactCaseMatches).toBe(3);
    expect(report.extractionSuccessRate).toBe(1);
    expect(report.exactCaseAccuracy).toBe(1);
    expect(report.fieldAccuracy).toBe(1);
  });

  it("counts field mismatches and schema failures without aborting the suite", async () => {
    const cases = A1_GOLDEN_CASES.slice(0, 2);
    const firstFieldCount = cases[0]!.scoredFields.length;
    const secondFieldCount = cases[1]!.scoredFields.length;
    const report = await evaluateA1Cases({
      cases,
      extract: async (goldenCase) => {
        if (goldenCase.id === cases[1]!.id) {
          throw new Error("model unavailable");
        }

        return {
          ...goldenCase.expected,
          progressPercent: 74,
        };
      },
    });

    expect(report.successfulExtractions).toBe(1);
    expect(report.exactCaseMatches).toBe(0);
    expect(report.matchedFields).toBe(firstFieldCount - 1);
    expect(report.totalFields).toBe(firstFieldCount + secondFieldCount);
    expect(report.cases[1]?.error).toContain("model unavailable");
    expect(formatA1EvaluationMarkdown(report)).toContain("Failed Fields");
  });
});
