import { describe, expect, it } from "vitest";
import {
  PROJECT_UPDATE_FIELDS,
  makeProjectUpdate,
  projectUpdateExtractionSchema,
  projectUpdateModelOutputSchema,
} from "../../src/structuring/schema.js";

describe("project update extraction schema", () => {
  it("accepts a complete, fixed-precision project update", () => {
    const update = makeProjectUpdate({
      projectCode: "ATLAS",
      workItemCode: "AT-003",
      status: "COMPLETED",
      progressPercent: 100,
      budgetMnt: "20000000.00",
      actualCostMnt: "27000000.00",
      issueTypes: ["BUDGET_OVERRUN"],
    });

    expect(projectUpdateExtractionSchema.parse(update)).toEqual(update);
  });

  it("rejects invalid percentages, dates, money, and extra fields", () => {
    expect(() => makeProjectUpdate({ progressPercent: 101 })).toThrow();
    expect(() => makeProjectUpdate({ plannedEndDate: "03/01/2026" })).toThrow();
    expect(() => makeProjectUpdate({ actualCostMnt: "27.5" })).toThrow();
    expect(() =>
      projectUpdateExtractionSchema.parse({
        ...makeProjectUpdate(),
        inventedField: true,
      }),
    ).toThrow();
  });

  it("requires confidence for every populated extraction field", () => {
    const update = makeProjectUpdate({
      workItemCode: "AT-001",
      status: "COMPLETED",
      progressPercent: 100,
    });
    const fields = PROJECT_UPDATE_FIELDS.filter((field) => {
      const value = update[field];
      return Array.isArray(value) ? value.length > 0 : value !== null;
    });

    expect(
      projectUpdateModelOutputSchema.parse({
        update,
        confidence: {
          fields: fields.map((field) => ({
            field,
            score: 0.9,
            evidence: "source",
          })),
        },
      }).update,
    ).toEqual(update);
    expect(() =>
      projectUpdateModelOutputSchema.parse({
        update,
        confidence: { fields: [] },
      }),
    ).toThrow("Confidence is required");
  });
});
