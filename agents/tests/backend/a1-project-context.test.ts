import { describe, expect, it } from "vitest";
import { addA1ProjectContextValidation } from "../../src/backend/a1-project-context.js";
import { makeProjectUpdate } from "../../src/structuring/schema.js";
import { validateProjectUpdateLogic } from "../../src/structuring/validation.js";

function validate(overrides: Parameters<typeof makeProjectUpdate>[0]) {
  const update = makeProjectUpdate(overrides);
  return addA1ProjectContextValidation({
    update,
    validation: validateProjectUpdateLogic(update, "2026-08-10"),
    selectedProjectCode: "ATLAS",
    knownWorkItemCodes: ["AT-001", "AT-002"],
  });
}

describe("A1 project context validation", () => {
  it("selected project болон known work item-ийг зөвшөөрнө", () => {
    expect(
      validate({
        projectCode: "atlas",
        workItemCode: "at-002",
        predecessorWorkItemCode: "AT-001",
      }),
    ).toMatchObject({ valid: true, errorCount: 0 });
  });

  it("project scope, unknown work item, unknown predecessor-ийг хориглоно", () => {
    const result = validate({
      projectCode: "RIVER",
      workItemCode: "AT-999",
      predecessorWorkItemCode: "AT-998",
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "PROJECT_CODE_SCOPE_MISMATCH",
      "UNKNOWN_WORK_ITEM",
      "UNKNOWN_PREDECESSOR_WORK_ITEM",
    ]);
  });

  it("self dependency-ийг хориглоно", () => {
    expect(
      validate({ workItemCode: "AT-001", predecessorWorkItemCode: "at-001" }).issues,
    ).toEqual([
      expect.objectContaining({ code: "SELF_DEPENDENCY", severity: "ERROR" }),
    ]);
  });
});
