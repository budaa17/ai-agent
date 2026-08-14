import { describe, expect, it } from "vitest";
import {
  DEFAULT_A1_OPENAI_MODEL,
  parseA1EvaluationCliArguments,
  parseStructureCliArguments,
  resolveA1ModelRuntimeConfig,
  resolveA1StructureRuntimeConfig,
} from "../../src/structuring/config.js";

describe("A1 CLI configuration", () => {
  it("parses one-off structure arguments", () => {
    expect(
      parseStructureCliArguments([
        "--",
        "--text",
        "AT-001 ажил дууссан.",
        "--image",
        "update.png",
        "--tenant",
        "tenant-demo",
        "--project",
        "project-atlas",
        "--no-persist",
        "--reference-date=2026-03-01",
      ]),
    ).toEqual({
      help: false,
      text: "AT-001 ажил дууссан.",
      image: "update.png",
      tenantRef: "tenant-demo",
      projectRef: "project-atlas",
      persist: false,
      referenceDate: "2026-03-01",
    });
  });

  it("prevents ambiguous text sources", () => {
    expect(() =>
      parseStructureCliArguments(["--text", "AT-001 ажил дууссан.", "--file", "update.txt"]),
    ).toThrow("either --text or --file");
  });

  it("parses evaluation filters and rate-limit delay", () => {
    expect(
      parseA1EvaluationCliArguments([
        "--cases=a1-one,a1-two",
        "--limit",
        "2",
        "--delay-ms",
        "1500",
        "--retry-attempts",
        "2",
        "--output",
        "data/result.json",
        "--resume",
        "data/previous.json",
      ]),
    ).toEqual({
      help: false,
      caseIds: ["a1-one", "a1-two"],
      limit: 2,
      delayMs: 1500,
      retryAttempts: 2,
      output: "data/result.json",
      resume: "data/previous.json",
    });
  });

  it("uses the extraction-optimized OpenAI model by default", () => {
    expect(resolveA1ModelRuntimeConfig({ OPENAI_API_KEY: "test-key" }, { help: false })).toEqual({
      provider: "openai",
      apiKey: "test-key",
      modelId: DEFAULT_A1_OPENAI_MODEL,
    });
  });

  it("persists drafts by default in the configured tenant scope", () => {
    expect(
      resolveA1StructureRuntimeConfig(
        {
          OPENAI_API_KEY: "test-key",
          A1_TENANT_ID: "tenant-demo",
          A1_PROJECT: "project-atlas",
        },
        { help: false },
      ),
    ).toMatchObject({
      tenantRef: "tenant-demo",
      projectRef: "project-atlas",
      persist: true,
    });
  });
});
