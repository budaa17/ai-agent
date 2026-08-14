import { describe, expect, it } from "vitest";
import {
  LangfuseConfigurationError,
  resolveLangfuseConfig,
  startLangfuseTelemetry,
} from "../../src/telemetry/langfuse.js";

describe("Langfuse telemetry configuration", () => {
  it("stays disabled when no Langfuse keys are configured", async () => {
    const telemetry = startLangfuseTelemetry({});

    expect(telemetry.enabled).toBe(false);
    await expect(
      telemetry.runWithTrace("test", async (traceId) => traceId),
    ).resolves.toBeUndefined();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it("rejects a partially configured Langfuse account", () => {
    expect(() => resolveLangfuseConfig({ LANGFUSE_PUBLIC_KEY: "public-only" })).toThrow(
      LangfuseConfigurationError,
    );
  });

  it("resolves a complete Langfuse configuration", () => {
    expect(
      resolveLangfuseConfig({
        LANGFUSE_PUBLIC_KEY: "public",
        LANGFUSE_SECRET_KEY: "secret",
        LANGFUSE_BASEURL: "https://example.com",
      }),
    ).toEqual({
      publicKey: "public",
      secretKey: "secret",
      baseUrl: "https://example.com",
    });
  });
});
