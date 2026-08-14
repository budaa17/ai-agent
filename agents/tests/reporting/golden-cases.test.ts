import { describe, expect, it } from "vitest";
import { A3_GOLDEN_SUITE, parseA3GoldenCases } from "../../src/reporting/golden-cases.js";

describe("A3 golden cases", () => {
  it("covers report, conclusion, official letter, and tenant isolation", () => {
    const cases = parseA3GoldenCases();

    expect(cases).toHaveLength(3);
    expect(new Set(cases.map((goldenCase) => goldenCase.id)).size).toBe(cases.length);
    expect(cases.every((goldenCase) => goldenCase.suite === A3_GOLDEN_SUITE)).toBe(true);
    expect(cases.every((goldenCase) => goldenCase.expected.documentTypes.length === 3)).toBe(true);
    expect(cases.some((goldenCase) => goldenCase.tags.includes("tenant-isolation"))).toBe(true);
  });
});
