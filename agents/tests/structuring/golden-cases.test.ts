import { describe, expect, it } from "vitest";
import {
  A1_GOLDEN_CASES,
  A1_GOLDEN_SUITE,
  parseA1GoldenCases,
} from "../../src/structuring/golden-cases.js";

describe("A1 golden cases", () => {
  it("contains 20-30 valid, uniquely identified cases", () => {
    const cases = parseA1GoldenCases();

    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(cases.length).toBeLessThanOrEqual(30);
    expect(new Set(cases.map((goldenCase) => goldenCase.id)).size).toBe(cases.length);
    expect(cases.every((goldenCase) => goldenCase.suite === A1_GOLDEN_SUITE)).toBe(true);
  });

  it("covers every seeded issue type and healthy examples", () => {
    const issueTypes = new Set(
      A1_GOLDEN_CASES.flatMap((goldenCase) => goldenCase.expected.issueTypes),
    );

    expect(issueTypes).toEqual(
      new Set([
        "OVERDUE_WORK_ITEM",
        "STALLED_PROGRESS",
        "DEPENDENCY_VIOLATION",
        "BUDGET_OVERRUN",
        "LEDGER_MISMATCH",
      ]),
    );
    expect(A1_GOLDEN_CASES.some((goldenCase) => goldenCase.expected.issueTypes.length === 0)).toBe(
      true,
    );
  });
});
