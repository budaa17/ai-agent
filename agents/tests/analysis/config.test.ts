import { describe, expect, it } from "vitest";
import { parseAnalyzeCliArguments, resolveAnalyzeCliConfig } from "../../src/analysis/config.js";

describe("analyze CLI config", () => {
  it("supports split and inline argument forms", () => {
    const arguments_ = parseAnalyzeCliArguments([
      "--tenant",
      "tenant-demo",
      "--project=ATLAS",
      "--as-of",
      "2026-03-01",
      "--output=result.json",
      "--no-answer-key",
    ]);
    const config = resolveAnalyzeCliConfig({}, arguments_);

    expect(config).toEqual({
      tenantId: "tenant-demo",
      projectRef: "ATLAS",
      asOf: "2026-03-01T00:00:00.000Z",
      outputPath: "result.json",
      answerKeyPath: undefined,
    });
  });

  it("uses deterministic demo defaults", () => {
    const config = resolveAnalyzeCliConfig({}, parseAnalyzeCliArguments([]));

    expect(config).toEqual({
      tenantId: "tenant-demo",
      projectRef: "project-atlas",
      asOf: "2026-03-01T00:00:00.000Z",
      outputPath: undefined,
      answerKeyPath: "data/answer-key.json",
    });
  });

  it("rejects conflicting answer-key flags", () => {
    expect(() =>
      parseAnalyzeCliArguments(["--answer-key", "expected.json", "--no-answer-key"]),
    ).toThrow("Use either --answer-key or --no-answer-key");
  });

  it("rejects unknown arguments and invalid dates", () => {
    expect(() => parseAnalyzeCliArguments(["--unknown"])).toThrow("Unknown analyze argument");
    expect(() =>
      resolveAnalyzeCliConfig({}, parseAnalyzeCliArguments(["--as-of", "not-a-date"])),
    ).toThrow();
  });
});
