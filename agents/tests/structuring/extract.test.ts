import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import {
  detectProjectUpdateLanguage,
  extractProjectUpdate,
  normalizeProjectUpdate,
} from "../../src/structuring/extract.js";
import {
  PROJECT_UPDATE_FIELDS,
  makeProjectUpdate,
  type ProjectUpdateExtraction,
} from "../../src/structuring/schema.js";
import { createPngFixture } from "./image-fixtures.js";

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
        score: 0.9,
        evidence: "test evidence",
      })),
    },
  };
}

describe("extractProjectUpdate", () => {
  it("parses a model response through the strict structured schema", async () => {
    const expected = makeProjectUpdate({
      projectCode: "atlas",
      workItemCode: "at-003",
      workItemName: "  Програмын лиценз худалдан авах  ",
      budgetMnt: "20000000.00",
      actualCostMnt: "27000000.00",
      issueTypes: ["BUDGET_OVERRUN"],
    });
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: JSON.stringify(modelDraft(expected)) }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });

    const result = await extractProjectUpdate({
      model,
      sourceText: "Лицензийн төсөв 20 сая, зардал 27 сая.",
      referenceDate: "2026-03-01",
      requestId: "request-a1-test",
      telemetryEnabled: false,
    });

    expect(result.update.projectCode).toBe("ATLAS");
    expect(result.update.workItemCode).toBe("AT-003");
    expect(result.update.workItemName).toBe("Програмын лиценз худалдан авах");
    expect(result.update.actualCostMnt).toBe("27000000.00");
    expect(result.confidence.level).toBe("HIGH");
    expect(result.validation.valid).toBe(true);
    expect(result.draft.requiresHumanReview).toBe(true);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]?.responseFormat?.type).toBe("json");
  });

  it("sends an image to the model and returns a reviewable draft", async () => {
    const expected = makeProjectUpdate({
      workItemCode: "AT-001",
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
    const image = createPngFixture();

    const result = await extractProjectUpdate({
      model,
      sourceImage: {
        data: image,
        mediaType: "image/png",
        fileName: "update.png",
        sha256: createHash("sha256").update(image).digest("hex"),
      },
      referenceDate: "2026-03-01",
      telemetryEnabled: false,
    });

    expect(result.update.workItemCode).toBe("AT-001");
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain("image/png");
  });

  it("does not relabel image foreign currency as MNT", async () => {
    const output = modelDraft(
      makeProjectUpdate({
        workItemCode: "UI-002",
        workItemName: "Add Progress Track",
        budgetMnt: "3000.00",
      }),
    );
    const budgetConfidence = output.confidence.fields.find(
      (confidence) => confidence.field === "budgetMnt",
    );

    if (!budgetConfidence) {
      throw new Error("Budget confidence fixture was not created");
    }

    budgetConfidence.evidence = "The image shows a budget of $3,000.";

    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: JSON.stringify(output) }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });
    const image = createPngFixture();

    const result = await extractProjectUpdate({
      model,
      sourceImage: {
        data: image,
        mediaType: "image/png",
        fileName: "foreign-budget.png",
        sha256: createHash("sha256").update(image).digest("hex"),
      },
      referenceDate: "2026-03-01",
      telemetryEnabled: false,
    });

    expect(result.update.budgetMnt).toBeNull();
    expect(result.confidence.fields.map((confidence) => confidence.field)).not.toContain(
      "budgetMnt",
    );
    expect(result.validation.warningCount).toBe(1);
    expect(result.validation.issues).toContainEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_FOREIGN_CURRENCY",
        fields: ["budgetMnt"],
      }),
    );
  });

  it("deduplicates and deterministically orders issue types", () => {
    const normalized = normalizeProjectUpdate(
      makeProjectUpdate({
        issueTypes: ["LEDGER_MISMATCH", "BUDGET_OVERRUN", "LEDGER_MISMATCH", "OVERDUE_WORK_ITEM"],
      }),
    );

    expect(normalized.issueTypes).toEqual([
      "OVERDUE_WORK_ITEM",
      "BUDGET_OVERRUN",
      "LEDGER_MISMATCH",
    ]);
  });

  it("does not accept a generic noun as a work-item name", () => {
    const normalized = normalizeProjectUpdate(
      makeProjectUpdate({
        workItemCode: "AT-001",
        workItemName: "ажил",
        status: "COMPLETED",
        progressPercent: 100,
      }),
    );

    expect(normalized.workItemName).toBeNull();
  });

  it("does not infer a project code from a work-item prefix", () => {
    const normalized = normalizeProjectUpdate(
      makeProjectUpdate({
        projectCode: "AT",
        workItemCode: "AT-001",
      }),
      "AT-001 Шаардлага тодорхойлох ажил дууссан.",
    );

    expect(normalized.projectCode).toBeNull();
    expect(
      normalizeProjectUpdate(
        makeProjectUpdate({
          projectCode: "AT",
          workItemCode: "AT-001",
        }),
        "AT төслийн AT-001 ажил дууссан.",
      ).projectCode,
    ).toBe("AT");
  });

  it.each([
    {
      source: "AT-014 Сүлжээний төхөөрөмжийн төсөв ₮45,000,000, зарцуулалт ₮42,750,000 байна.",
      workItemCode: "AT-014",
      modelName: "Сүлжээний төхөөрөмжийн төсөв",
      expectedName: "Сүлжээний төхөөрөмж",
    },
    {
      source:
        "RV-001 Талбайн хэмжилтийн бодит зардал 12.5 сая төгрөг болсон, төсөв нь 15 сая төгрөг.",
      workItemCode: "RV-001",
      modelName: "Талбайн хэмжилтийн",
      expectedName: "Талбайн хэмжилт",
    },
    {
      source: "AT-015 Нөөц сервер тохируулах ажил хараахан эхлээгүй, төлөвлөгдсөн хэвээр.",
      workItemCode: "AT-015",
      modelName: null,
      expectedName: "Нөөц сервер тохируулах",
    },
    {
      source: "AT-020 Мэдээлэл шилжүүлэх туршилтын төсөв 10,000,000 төгрөг.",
      workItemCode: "AT-020",
      modelName: "Мэдээлэл шилжүүлэх туршилтын",
      expectedName: "Мэдээлэл шилжүүлэх туршилт",
    },
  ])(
    "restores $workItemCode work-item name from explicit source grammar",
    ({ source, workItemCode, modelName, expectedName }) => {
      const normalized = normalizeProjectUpdate(
        makeProjectUpdate({
          workItemCode,
          workItemName: modelName,
        }),
        source,
      );

      expect(normalized.workItemName).toBe(expectedName);
    },
  );

  it("derives status only from unambiguous current progress", () => {
    expect(
      normalizeProjectUpdate(
        makeProjectUpdate({
          progressPercent: 55,
        }),
      ).status,
    ).toBe("IN_PROGRESS");
    expect(
      normalizeProjectUpdate(
        makeProjectUpdate({
          progressPercent: 100,
        }),
      ).status,
    ).toBe("COMPLETED");
    expect(
      normalizeProjectUpdate(
        makeProjectUpdate({
          progressPercent: 0,
        }),
      ).status,
    ).toBeNull();
    expect(
      normalizeProjectUpdate(
        makeProjectUpdate({
          status: "BLOCKED",
          progressPercent: 55,
        }),
      ).status,
    ).toBe("BLOCKED");
  });

  it("adds confidence for deterministically recovered fields", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              modelDraft(
                makeProjectUpdate({
                  workItemCode: "AT-015",
                  progressPercent: 55,
                }),
              ),
            ),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });

    const result = await extractProjectUpdate({
      model,
      sourceText: "AT-015 Нөөц сервер тохируулах ажил 55 хувьтай байна.",
      referenceDate: "2026-03-01",
      telemetryEnabled: false,
    });

    expect(result.update.workItemName).toBe("Нөөц сервер тохируулах");
    expect(result.update.status).toBe("IN_PROGRESS");
    expect(result.confidence.fields.map((confidence) => confidence.field)).toEqual(
      expect.arrayContaining(["workItemName", "status"]),
    );
  });

  it("does not count project codes as English prose", () => {
    expect(detectProjectUpdateLanguage("AT-001 ажил 100 хувьтай дууссан.")).toBe("mn");
    expect(
      detectProjectUpdateLanguage("ATLAS project-ийн Data cleanup ажил үргэлжилж байна."),
    ).toBe("mixed");
    expect(detectProjectUpdateLanguage("Work item AT-001 is complete.")).toBe("en");
  });
});
