import { describe, expect, it, vi } from "vitest";
import { persistPlatformEvaluationRun } from "../../src/evaluation/platform-evaluation-history.js";

describe("platform evaluation history writer", () => {
  it("persists only bounded aggregate evidence", async () => {
    const create = vi.fn(async () => undefined);
    await persistPlatformEvaluationRun(
      { platformEvaluationRun: { create } },
      {
        suiteKey: "a3-golden",
        suiteVersion: "1",
        agentType: "A3_DOCUMENT",
        agentRelease: "prompt-v2+tools-v2",
        promptVersion: "prompt-v2",
        toolBundleVersion: "tools-v2",
        provider: "deterministic",
        modelId: "handlebars-v1",
        caseCount: 3,
        passedCount: 2,
        failedCount: 1,
        startedAt: new Date("2026-08-13T00:00:00.000Z"),
        completedAt: new Date("2026-08-13T00:00:01.000Z"),
        sourceRef: "ci-123",
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        caseCount: 3,
        passedCount: 2,
        failedCount: 1,
        skippedCount: 0,
      }),
    });
    expect(JSON.stringify(create.mock.calls)).not.toMatch(/prompt text|output|error/i);
  });

  it("rejects inconsistent totals before writing", async () => {
    const create = vi.fn(async () => undefined);
    await expect(
      persistPlatformEvaluationRun(
        { platformEvaluationRun: { create } },
        {
          suiteKey: "suite",
          suiteVersion: "1",
          agentType: "A3_DOCUMENT",
          agentRelease: "prompt+tools",
          promptVersion: "prompt",
          toolBundleVersion: "tools",
          provider: "deterministic",
          modelId: "model",
          caseCount: 3,
          passedCount: 3,
          failedCount: 1,
          startedAt: new Date("2026-08-13T00:00:00.000Z"),
          completedAt: new Date("2026-08-13T00:00:01.000Z"),
        },
      ),
    ).rejects.toThrow("must equal caseCount");
    expect(create).not.toHaveBeenCalled();
  });
});
