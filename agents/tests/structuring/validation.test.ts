import { describe, expect, it } from "vitest";
import { makeProjectUpdate } from "../../src/structuring/schema.js";
import { validateProjectUpdateLogic } from "../../src/structuring/validation.js";

describe("validateProjectUpdateLogic", () => {
  it("accepts a consistent completed update", () => {
    const validation = validateProjectUpdateLogic(
      makeProjectUpdate({
        status: "COMPLETED",
        progressPercent: 100,
        actualStartDate: "2026-02-01",
        actualEndDate: "2026-02-28",
      }),
      "2026-03-01",
    );

    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
  });

  it("finds date, completion, and deterministic classification errors", () => {
    const validation = validateProjectUpdateLogic(
      makeProjectUpdate({
        status: "COMPLETED",
        progressPercent: 80,
        plannedStartDate: "2026-03-05",
        plannedEndDate: "2026-02-20",
        budgetMnt: "20000000.00",
        actualCostMnt: "27000000.00",
      }),
      "2026-03-01",
    );

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "PLANNED_DATE_ORDER",
        "COMPLETED_PROGRESS_MISMATCH",
        "MISSING_BUDGET_OVERRUN",
      ]),
    );
  });

  it("detects overdue, stalled, dependency, and ledger classifications", () => {
    const validation = validateProjectUpdateLogic(
      makeProjectUpdate({
        status: "IN_PROGRESS",
        plannedEndDate: "2026-02-20",
        actualStartDate: "2026-02-10",
        daysWithoutProgress: 9,
        predecessorStatus: "BLOCKED",
        actualCostMnt: "72000000.00",
        ledgerTotalMnt: "70000000.00",
      }),
      "2026-03-01",
    );

    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "MISSING_OVERDUE_WORK_ITEM",
        "MISSING_STALLED_PROGRESS",
        "MISSING_DEPENDENCY_VIOLATION",
        "MISSING_LEDGER_MISMATCH",
      ]),
    );
  });
});
