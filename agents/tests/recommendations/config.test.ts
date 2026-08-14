import { describe, expect, it } from "vitest";
import {
  parseRecommendationCliArguments,
  resolveRecommendationRuntimeConfig,
} from "../../src/recommendations/config.js";

describe("A2 CLI configuration", () => {
  it("parses project, date, model, and research options", () => {
    expect(
      parseRecommendationCliArguments([
        "--",
        "--tenant=tenant-demo",
        "--project",
        "project-atlas",
        "--as-of",
        "2026-03-01",
        "--model",
        "gpt-test",
        "--max-steps",
        "6",
        "--output",
        "data/a2.json",
        "--record-telemetry-content",
      ]),
    ).toEqual({
      help: false,
      tenantId: "tenant-demo",
      projectRef: "project-atlas",
      asOf: "2026-03-01",
      modelId: "gpt-test",
      maxSteps: 6,
      outputPath: "data/a2.json",
      recordTelemetryContent: true,
    });
  });

  it("uses A2 model and analysis-compatible defaults", () => {
    expect(
      resolveRecommendationRuntimeConfig(
        {
          OPENAI_API_KEY: "test-key",
          A2_OPENAI_MODEL: "gpt-a2",
        },
        { help: false },
      ),
    ).toEqual({
      provider: "openai",
      apiKey: "test-key",
      modelId: "gpt-a2",
      tenantId: "tenant-demo",
      projectRef: "project-atlas",
      asOf: "2026-03-01T00:00:00.000Z",
      maxSteps: 8,
      recordTelemetryContent: false,
    });
  });
});
