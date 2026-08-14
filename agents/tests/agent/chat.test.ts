import { afterAll, describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { A4GroundingError, runProjectChat } from "../../src/agent/index.js";
import { prisma } from "../../src/prisma.js";

type MockGenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 5,
    text: 5,
    reasoning: undefined,
  },
} satisfies MockGenerateResult["usage"];

afterAll(async () => {
  await prisma.$disconnect();
});

describe("runProjectChat", () => {
  it("executes an AI-selected tool and continues to a final answer", async () => {
    const toolCallResponse = {
      content: [
        {
          type: "tool-call",
          toolCallId: "call-work-items",
          toolName: "lookupWorkItems",
          input: JSON.stringify({ limit: 2 }),
        },
      ],
      finishReason: { unified: "tool-calls", raw: undefined },
      usage,
      warnings: [],
    } satisfies MockGenerateResult;
    const finalResponse = {
      content: [
        {
          type: "text",
          text: "Ажлын aggregate тоог шалгав.",
        },
      ],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    } satisfies MockGenerateResult;
    const structuredResponse = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            schemaVersion: 1,
            language: "mn",
            status: "ANSWERED",
            claims: [
              {
                text: "Atlas төсөл нийт 9 ажилтай.",
                sources: [
                  {
                    toolName: "lookupWorkItems",
                    sourceId: "lookupWorkItems:aggregate",
                    field: "total",
                  },
                ],
              },
            ],
          }),
        },
      ],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    } satisfies MockGenerateResult;
    const model = new MockLanguageModelV4({
      doGenerate: [toolCallResponse, finalResponse, structuredResponse],
    });
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: "Atlas төслийн ажлын тоог шалга.",
      },
    ];

    const result = await runProjectChat({
      context: {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      messages,
      model,
      requestId: "request-chat-test",
      maxSteps: 3,
      telemetryEnabled: false,
    });

    expect(result.text).toBe("Atlas төсөл нийт 9 ажилтай.");
    expect(result.answer.status).toBe("ANSWERED");
    expect(result.validation.valid).toBe(true);
    expect(result.validation.checkedSourceCount).toBe(1);
    expect(result.steps).toHaveLength(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.toolName).toBe("lookupWorkItems");
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(model.doGenerateCalls[0]?.toolChoice).toEqual({
      type: "required",
    });
    expect(model.doGenerateCalls[1]?.toolChoice).toEqual({
      type: "auto",
    });
    expect(JSON.stringify(model.doGenerateCalls[2]?.prompt)).toContain('\\"field\\":\\"total\\"');
  });

  it("rejects a numeric claim absent from its cited source", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "call-work-items",
              toolName: "lookupWorkItems",
              input: JSON.stringify({ limit: 2 }),
            },
          ],
          finishReason: {
            unified: "tool-calls",
            raw: undefined,
          },
          usage,
          warnings: [],
        } satisfies MockGenerateResult,
        {
          content: [
            {
              type: "text",
              text: "Ажлын aggregate тоог шалгав.",
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        } satisfies MockGenerateResult,
        {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                schemaVersion: 1,
                language: "mn",
                status: "ANSWERED",
                claims: [
                  {
                    text: "Atlas төсөл нийт 10 ажилтай.",
                    sources: [
                      {
                        toolName: "lookupWorkItems",
                        sourceId: "lookupWorkItems:aggregate",
                        field: "total",
                      },
                    ],
                  },
                ],
              }),
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        } satisfies MockGenerateResult,
      ],
    });

    await expect(
      runProjectChat({
        context: {
          tenantId: "tenant-demo",
          projectIds: ["project-atlas"],
        },
        messages: [
          {
            role: "user",
            content: "Atlas төслийн ажлын тоог шалга.",
          },
        ],
        model,
        telemetryEnabled: false,
      }),
    ).rejects.toBeInstanceOf(A4GroundingError);
  });

  it("falls back to deterministic read-only research when the model skips tools", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "text",
              text: "Tool ашиглаагүй хариулт.",
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        } satisfies MockGenerateResult,
        {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                schemaVersion: 1,
                language: "mn",
                status: "ANSWERED",
                claims: [
                  {
                    text: "ATLAS төсөл нийт 9 ажилтай.",
                    sources: [
                      {
                        toolName: "lookupWorkItems",
                        sourceId: "lookupWorkItems:aggregate",
                        field: "total",
                      },
                    ],
                  },
                ],
              }),
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        } satisfies MockGenerateResult,
      ],
    });

    const result = await runProjectChat({
      context: {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      messages: [
        {
          role: "user",
          content: "Atlas төслийн ажлын тоог шалга.",
        },
      ],
      model,
      telemetryEnabled: false,
    });

    expect(result.researchMode).toBe("DETERMINISTIC_FALLBACK");
    expect(result.toolCalls[0]?.toolName).toBe("lookupWorkItems");
    expect(result.validation.valid).toBe(true);
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("uses deterministic routing without a model research call", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              schemaVersion: 1,
              language: "mn",
              status: "ANSWERED",
              claims: [
                {
                  text: "ATLAS төсөл нийт 9 ажилтай.",
                  sources: [
                    {
                      toolName: "lookupWorkItems",
                      sourceId: "lookupWorkItems:aggregate",
                      field: "total",
                    },
                  ],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      } satisfies MockGenerateResult,
    });

    const result = await runProjectChat({
      context: {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      messages: [
        {
          role: "user",
          content: "Atlas төсөл нийт хэдэн ажилтай вэ?",
        },
      ],
      model,
      toolSelection: "deterministic",
      telemetryEnabled: false,
    });

    expect(result.researchMode).toBe("DETERMINISTIC");
    expect(result.research).toBeNull();
    expect(result.validation.valid).toBe(true);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("rejects an empty conversation before calling a model", async () => {
    const model = new MockLanguageModelV4();

    await expect(
      runProjectChat({
        context: {
          tenantId: "tenant-demo",
          projectIds: ["project-atlas"],
        },
        messages: [],
        model,
        telemetryEnabled: false,
      }),
    ).rejects.toThrow("At least one chat message is required");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("enforces the fifteen-step safety limit", async () => {
    const model = new MockLanguageModelV4();

    await expect(
      runProjectChat({
        context: {
          tenantId: "tenant-demo",
          projectIds: ["project-atlas"],
        },
        messages: [{ role: "user", content: "test" }],
        model,
        maxSteps: 16,
        telemetryEnabled: false,
      }),
    ).rejects.toThrow();
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
