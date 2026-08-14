import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { afterAll, describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { prisma } from "../../src/prisma.js";
import { runRecommendationAgent } from "../../src/recommendations/agent.js";
import { buildRecommendationFixture } from "./fixtures.js";

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

afterAll(async () => {
  await prisma.$disconnect();
});

describe("runRecommendationAgent", () => {
  it("runs both phases and persists the run, tool call, and trace id", async () => {
    const fixture = buildRecommendationFixture();
    const model = new MockLanguageModelV4({
      provider: "mock-provider",
      modelId: "mock-a2",
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "call-a2-work-items",
              toolName: "inspectWorkItems",
              input: JSON.stringify({ limit: 2 }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        },
        {
          content: [
            {
              type: "text",
              text: "Хугацаа хоцорсон ажлын нотолгоог шалгав.",
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        },
        {
          content: [
            {
              type: "text",
              text: JSON.stringify(fixture.report),
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        },
      ],
    });
    let runId: string | undefined;

    try {
      const result = await runRecommendationAgent({
        tenantId: fixture.data.tenantId,
        projectRef: fixture.data.projectId,
        asOf: fixture.data.asOf,
        model,
        requestId: "request-a2-integration",
        langfuseTraceId: "a".repeat(32),
        telemetryEnabled: false,
      });
      runId = result.runId;

      expect(result.validation.valid).toBe(true);
      expect(result.research.toolCallCount).toBe(1);
      expect(result.report).toEqual(fixture.report);
      expect(model.doGenerateCalls).toHaveLength(3);
      expect(model.doGenerateCalls[0]?.tools).toHaveLength(4);
      expect(model.doGenerateCalls[2]?.responseFormat?.type).toBe("json");

      const stored = await prisma.agentRun.findUnique({
        where: { id: result.runId },
        include: { toolCalls: true },
      });

      expect(stored).toMatchObject({
        status: "COMPLETED",
        tenantId: fixture.data.tenantId,
        projectId: fixture.data.projectId,
        provider: "mock-provider",
        modelId: "mock-a2",
        langfuseTraceId: "a".repeat(32),
      });
      expect(stored?.validation).toMatchObject({ valid: true });
      expect(stored?.toolCalls).toHaveLength(1);
      expect(stored?.toolCalls[0]).toMatchObject({
        toolCallId: "call-a2-work-items",
        toolName: "inspectWorkItems",
        status: "COMPLETED",
      });
    } finally {
      if (runId) {
        await prisma.agentRun.delete({ where: { id: runId } });
      }
    }
  });

  it("uses deterministic read-only research when requested", async () => {
    const fixture = buildRecommendationFixture();
    const model = new MockLanguageModelV4({
      provider: "mock-provider",
      modelId: "mock-a2-deterministic",
      doGenerate: {
        content: [
          {
            type: "text",
            text: JSON.stringify(fixture.report),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });

    const result = await runRecommendationAgent({
      tenantId: fixture.data.tenantId,
      projectRef: fixture.data.projectId,
      asOf: fixture.data.asOf,
      model,
      requestId: "request-a2-deterministic",
      toolSelection: "deterministic",
      telemetryEnabled: false,
      persist: false,
    });

    expect(result.validation.valid).toBe(true);
    expect(result.research.mode).toBe("DETERMINISTIC");
    expect(result.research.toolCallCount).toBe(4);
    expect(result.research.toolNames).toEqual([
      "inspectWorkItems",
      "inspectDependencies",
      "inspectProgressTrends",
      "inspectCostVariance",
    ]);
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
