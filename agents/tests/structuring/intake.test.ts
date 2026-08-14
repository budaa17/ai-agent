import { randomUUID } from "node:crypto";
import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { RegistrationDraftStatus } from "@prisma/client";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/prisma.js";
import { registerProjectUpdateDraft } from "../../src/structuring/intake.js";
import {
  PROJECT_UPDATE_FIELDS,
  makeProjectUpdate,
  type ProjectUpdateExtraction,
} from "../../src/structuring/schema.js";

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

function modelDraft(update: ProjectUpdateExtraction) {
  return {
    update,
    confidence: {
      fields: PROJECT_UPDATE_FIELDS.filter((field) => {
        const value = update[field];
        return Array.isArray(value) ? value.length > 0 : value !== null;
      }).map((field) => ({
        field,
        score: 0.92,
        evidence: "AT-001 ажил 100 хувь дууссан",
      })),
    },
  };
}

describe("registerProjectUpdateDraft", () => {
  it("persists a reviewable draft and reuses its request id", async () => {
    const requestId = `request-a1-${randomUUID()}`;
    const expected = makeProjectUpdate({
      projectCode: "ATLAS",
      workItemCode: "AT-001",
      workItemName: "Шаардлага тодорхойлох",
      status: "COMPLETED",
      progressPercent: 100,
    });
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: JSON.stringify(modelDraft(expected)) }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });

    try {
      const first = await registerProjectUpdateDraft({
        tenantRef: "tenant-demo",
        projectRef: "project-atlas",
        sourceText: "AT-001 Шаардлага тодорхойлох ажил 100 хувь дууссан.",
        referenceDate: "2026-03-01",
        requestId,
        model,
        provider: "openai",
        modelId: "test-model",
        telemetryEnabled: false,
      });
      const second = await registerProjectUpdateDraft({
        tenantRef: "tenant-demo",
        projectRef: "project-atlas",
        sourceText: "AT-001 Шаардлага тодорхойлох ажил 100 хувь дууссан.",
        referenceDate: "2026-03-01",
        requestId,
        model,
        provider: "openai",
        modelId: "test-model",
        telemetryEnabled: false,
      });
      const stored = await prisma.registrationDraft.findUniqueOrThrow({
        where: { requestId },
      });

      expect(first.status).toBe(RegistrationDraftStatus.READY_FOR_REVIEW);
      expect(first.draft.confidence.level).toBe("HIGH");
      expect(first.projectId).toBe("project-atlas");
      expect(second.reused).toBe(true);
      expect(second.draft.update.workItemCode).toBe("AT-001");
      expect(model.doGenerateCalls).toHaveLength(1);
      expect(stored.sourceText).toContain("Шаардлага тодорхойлох");
      expect(stored.structuredData).toMatchObject({
        workItemCode: "AT-001",
        status: "COMPLETED",
      });
    } finally {
      await prisma.registrationDraft.deleteMany({ where: { requestId } });
    }
  });
});

afterAll(() => prisma.$disconnect());
