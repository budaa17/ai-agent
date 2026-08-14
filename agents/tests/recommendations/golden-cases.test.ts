import { describe, expect, it } from "vitest";
import {
  A2_GOLDEN_CASES,
  A2_GOLDEN_SUITE,
  parseA2GoldenCases,
} from "../../src/recommendations/golden-cases.js";

describe("A2 golden cases", () => {
  it("defines unique deterministic project observation cases", () => {
    const cases = parseA2GoldenCases();

    expect(cases).toHaveLength(3);
    expect(new Set(cases.map((goldenCase) => goldenCase.id)).size).toBe(cases.length);
    expect(cases.every((goldenCase) => goldenCase.suite === A2_GOLDEN_SUITE)).toBe(true);
  });

  it("covers risk, no-risk, and tenant-isolation behavior", () => {
    expect(
      A2_GOLDEN_CASES.some(
        (goldenCase) =>
          goldenCase.expected.riskPosture === "CRITICAL" &&
          goldenCase.expected.observationKinds.length === 3,
      ),
    ).toBe(true);
    expect(
      A2_GOLDEN_CASES.some(
        (goldenCase) =>
          goldenCase.expected.riskPosture === "NONE" && goldenCase.expected.issueTypes.length === 0,
      ),
    ).toBe(true);
    expect(A2_GOLDEN_CASES.some((goldenCase) => goldenCase.tags.includes("tenant-isolation"))).toBe(
      true,
    );
  });
});
