import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  enumerateWorkingDates,
  isWorkingDay,
  workingDaysBetween,
} from "../../src/production-analysis/index.js";

const calendar = {
  workingWeekdays: [1, 2, 3, 4, 5, 6],
  holidays: ["2026-02-17"],
};

describe("production working calendar", () => {
  it("skips Sunday and configured holidays", () => {
    expect(isWorkingDay("2026-02-15", calendar)).toBe(false);
    expect(isWorkingDay("2026-02-17", calendar)).toBe(false);
    expect(isWorkingDay("2026-02-18", calendar)).toBe(true);
  });

  it("adds positive and negative working-day offsets", () => {
    expect(addWorkingDays("2026-02-14", 1, calendar)).toBe("2026-02-16");
    expect(addWorkingDays("2026-02-18", -1, calendar)).toBe("2026-02-16");
  });

  it("enumerates and counts the same working dates", () => {
    const dates = enumerateWorkingDates("2026-02-14", "2026-02-18", calendar);

    expect(dates).toEqual(["2026-02-14", "2026-02-16", "2026-02-18"]);
    expect(workingDaysBetween("2026-02-14", "2026-02-18", calendar)).toBe(3);
  });
});
