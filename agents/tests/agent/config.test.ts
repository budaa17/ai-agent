import { describe, expect, it } from "vitest";
import { parseChatCliArguments, resolveChatRuntimeConfig } from "../../src/agent/config.js";
import {
  DEFAULT_OPENAI_MODEL,
  createChatModel,
  createOpenAIChatModel,
} from "../../src/agent/model.js";

describe("chat configuration", () => {
  it("parses pnpm separators and CLI overrides", () => {
    expect(
      parseChatCliArguments([
        "--",
        "--tenant=tenant-demo",
        "--projects",
        "project-atlas,project-river",
        "--max-steps",
        "8",
        "--record-telemetry-content",
      ]),
    ).toEqual({
      help: false,
      tenantId: "tenant-demo",
      projectIds: ["project-atlas", "project-river"],
      maxSteps: 8,
      recordTelemetryContent: true,
    });
  });

  it("loads safe demo defaults from the environment", () => {
    const result = resolveChatRuntimeConfig({ OPENAI_API_KEY: "test-openai-key" }, { help: false });

    expect(result).toEqual({
      provider: "openai",
      apiKey: "test-openai-key",
      modelId: DEFAULT_OPENAI_MODEL,
      tenantId: "tenant-demo",
      projectIds: ["project-atlas"],
      maxSteps: 15,
      recordTelemetryContent: false,
    });
    expect(() => createChatModel(result)).not.toThrow();
  });

  it("supports an explicit OpenAI model override", () => {
    const result = resolveChatRuntimeConfig(
      {
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_MODEL: "gpt-test",
      },
      { help: false, modelId: "gpt-cli" },
    );

    expect(result.modelId).toBe("gpt-cli");
  });

  it("requires the OpenAI API key", () => {
    expect(() => resolveChatRuntimeConfig({}, { help: false })).toThrow(
      "OPENAI_API_KEY is required",
    );
    expect(() => createOpenAIChatModel({ apiKey: "", modelId: DEFAULT_OPENAI_MODEL })).toThrow(
      "OPENAI_API_KEY is required",
    );
  });
});
