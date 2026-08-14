import { describe, expect, it } from "vitest";
import {
  phase10A1DraftCorrectionRequestSchema,
  phase10ProjectCreateRequestSchema,
} from "../../src/backend/phase10-contracts.js";
import { makeProjectUpdate } from "../../src/structuring/schema.js";

const validRequest = {
  code: "ТЭНГЭР-01",
  name: "Тэнгэр цамхаг",
  plannedStart: "2026-08-09",
  plannedEnd: "2030-04-08",
  budgetMnt: "9000000",
};

describe("phase10ProjectCreateRequestSchema", () => {
  it.each(["SKY-TOWER-01", "ТЭСТ-2", "BUILD-ТӨСӨЛ_01", "ӨРГӨӨ.2026"])(
    "Монгол, англи болон холимог project code зөвшөөрнө: %s",
    (code) => {
      expect(phase10ProjectCreateRequestSchema.parse({ ...validRequest, code }).code).toBe(code);
    },
  );

  it.each(["-ТӨСӨЛ", "ТӨСӨЛ 2", "ТӨСӨЛ/2", "ТӨСӨЛ#2"])(
    "аюулгүй бус project code хориглоно: %s",
    (code) => {
      expect(phase10ProjectCreateRequestSchema.safeParse({ ...validRequest, code }).success).toBe(
        false,
      );
    },
  );
});

describe("phase10A1DraftCorrectionRequestSchema", () => {
  it("full structured correction болон optimistic version шаарддаг", () => {
    const parsed = phase10A1DraftCorrectionRequestSchema.parse({
      expectedRowVersion: 2,
      structuredData: makeProjectUpdate({ workItemCode: "BW-001", progressPercent: 40 }),
      reason: "Талбайн инженер эх зурагтай тулгаж зассан",
    });
    expect(parsed.expectedRowVersion).toBe(2);
    expect(parsed.structuredData.progressPercent).toBe(40);
  });

  it("partial structured payload болон богино reason-ийг хориглоно", () => {
    expect(
      phase10A1DraftCorrectionRequestSchema.safeParse({
        expectedRowVersion: 1,
        structuredData: { workItemCode: "BW-001" },
        reason: "ok",
      }).success,
    ).toBe(false);
  });
});
