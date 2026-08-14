import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { judgeProjectReport, reportJudgeSchema } from "../../src/reporting/judge.js";
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

describe("LLM-as-judge", () => {
  it("returns rubric scores with reasons at temperature zero", async () => {
    const fixture = buildProjectReportFixture();
    const judge = reportJudgeSchema.parse({
      schemaVersion: 1,
      accuracy: { score: 5, reason: "Баримттай зөрөөгүй." },
      groundedness: {
        score: 5,
        reason: "Эх сурвалжуудтай холбоотой.",
      },
      clarity: { score: 4, reason: "Найруулга ойлгомжтой." },
      actionability: {
        score: 4,
        reason: "Арга хэмжээ тодорхой.",
      },
      mongolianLanguageQuality: {
        score: 5,
        reason: "Монгол хэлний найруулга сайн.",
      },
      verdict: "PASS",
      summary: "Тайлан шаардлага хангасан.",
    });
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: JSON.stringify(judge) }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });
    const result = await judgeProjectReport({
      model,
      report: fixture.projectReport,
      telemetryEnabled: false,
    });

    expect(result.judge).toEqual(judge);
    expect(result.averageScore).toBe(4.6);
    expect(model.doGenerateCalls[0]?.temperature).toBe(0);
  });
});
