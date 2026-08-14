import { describe, expect, it } from "vitest";
import {
  parseReportCliArguments,
  resolveA3ModelRuntimeConfig,
  resolveReportRuntimeConfig,
} from "../../src/reporting/config.js";

describe("A3 report configuration", () => {
  it("parses offline report and output options", () => {
    expect(
      parseReportCliArguments([
        "--",
        "--project",
        "project-atlas",
        "--as-of=2026-03-01",
        "--analysis-only",
        "--narrative",
        "deterministic",
        "--output-dir",
        "data/reports/demo",
        "--no-pdf",
      ]),
    ).toEqual({
      help: false,
      projectRef: "project-atlas",
      asOf: "2026-03-01",
      analysisOnly: true,
      narrativeMode: "deterministic",
      outputDir: "data/reports/demo",
      noPdf: true,
    });
  });

  it("does not require an API key for deterministic configuration", () => {
    expect(resolveReportRuntimeConfig({}, { help: false })).toMatchObject({
      tenantId: "tenant-demo",
      projectRef: "project-atlas",
      asOf: "2026-03-01T00:00:00.000Z",
      narrativeMode: "deterministic",
      judge: false,
      noPdf: false,
    });
  });

  it("uses the A3-specific OpenAI model", () => {
    expect(
      resolveA3ModelRuntimeConfig(
        {
          OPENAI_API_KEY: "test-key",
          A3_OPENAI_MODEL: "gpt-a3",
        },
        { help: false },
      ),
    ).toEqual({
      provider: "openai",
      apiKey: "test-key",
      modelId: "gpt-a3",
    });
  });

  it("rejects conflicting recommendation inputs", () => {
    expect(() =>
      parseReportCliArguments(["--analysis-only", "--recommendations", "a2.json"]),
    ).toThrow("Use only one");
  });
});
