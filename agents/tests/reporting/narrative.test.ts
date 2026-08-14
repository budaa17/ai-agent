import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import {
  ReportNarrativeGroundingError,
  assertReportNarrativeHasNoNumbers,
  generateReportNarrative,
} from "../../src/reporting/narrative.js";
import { buildProjectReportFixture } from "./fixtures.js";

const usage = {
  inputTokens: {
    total: 20,
    noCache: 20,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 10,
    text: 10,
    reasoning: undefined,
  },
} satisfies LanguageModelV4GenerateResult["usage"];

describe("A3 report narrative", () => {
  it("generates schema-constrained qualitative paragraphs", async () => {
    const fixture = buildProjectReportFixture();
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [
          {
            type: "text",
            text: JSON.stringify(fixture.narrative),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });
    const result = await generateReportNarrative({
      model,
      analysis: fixture.analysis,
      recommendations: fixture.report,
      telemetryEnabled: false,
    });

    expect(result.narrative).toEqual(fixture.narrative);
    expect(model.doGenerateCalls[0]?.responseFormat?.type).toBe("json");
  });

  it("rejects digits and number words from LLM prose", () => {
    const fixture = buildProjectReportFixture();

    expect(() =>
      assertReportNarrativeHasNoNumbers({
        ...fixture.narrative,
        riskNarrative: "Хоёр ажил эрсдэлтэй байна.",
      }),
    ).toThrow(ReportNarrativeGroundingError);
  });
});
