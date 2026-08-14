import { describe, expect, it } from "vitest";
import {
  A4_GOLDEN_CASES,
  A4_GOLDEN_SUITE,
  parseA4GoldenCases,
} from "../../src/agent/golden-cases.js";
import { selectA4ToolNames } from "../../src/agent/research.js";

describe("A4 golden cases", () => {
  it("defines six valid Mongolian source-backed cases", () => {
    const cases = parseA4GoldenCases();

    expect(cases).toHaveLength(6);
    expect(new Set(cases.map((goldenCase) => goldenCase.id)).size).toBe(cases.length);
    expect(
      cases.every(
        (goldenCase) =>
          goldenCase.suite === A4_GOLDEN_SUITE &&
          goldenCase.locale === "mn" &&
          goldenCase.expected.requiredSources.length > 0,
      ),
    ).toBe(true);
  });

  it("keeps every required source inside its own tool set", () => {
    for (const goldenCase of A4_GOLDEN_CASES) {
      const tools = new Set(goldenCase.expected.requiredToolNames);

      for (const source of goldenCase.expected.requiredSources) {
        expect(tools.has(source.toolName)).toBe(true);
      }
    }
  });

  it("routes every golden question to its required read-only tool", () => {
    for (const goldenCase of A4_GOLDEN_CASES) {
      expect(
        selectA4ToolNames([
          {
            role: "user",
            content: goldenCase.inputText,
          },
        ]),
      ).toEqual(goldenCase.expected.requiredToolNames);
    }
  });
});
