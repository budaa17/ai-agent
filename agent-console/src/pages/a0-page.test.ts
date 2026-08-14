import { describe, expect, it } from "vitest";
import { BuildWatchApiError } from "../api/client";
import { a0IntakeFailureMessage, buildGanttTimeline, ganttActivityRange } from "./a0-page";

describe("A0 Gantt activity dates", () => {
  it("ScheduleActivity-ийн plannedFinish талбарыг ашиглана", () => {
    expect(
      ganttActivityRange({
        plannedStart: "2026-08-10T00:00:00.000Z",
        plannedFinish: "2026-08-12T00:00:00.000Z",
      }),
    ).toEqual({
      start: Date.parse("2026-08-10T00:00:00.000Z"),
      end: Date.parse("2026-08-12T00:00:00.000Z"),
    });
  });

  it("WorkItem-ийн plannedEnd fallback-ийг дэмжинэ", () => {
    expect(
      ganttActivityRange({
        plannedStart: "2026-08-10T00:00:00.000Z",
        plannedEnd: "2026-08-15T00:00:00.000Z",
      }).end,
    ).toBe(Date.parse("2026-08-15T00:00:00.000Z"));
  });

  it("олон сарын schedule-д сар болон огнооны tick үүсгэнэ", () => {
    const timeline = buildGanttTimeline(
      Date.parse("2026-03-02T00:00:00.000Z"),
      Date.parse("2027-05-28T00:00:00.000Z"),
    );
    expect(timeline.months).toHaveLength(15);
    expect(timeline.months[0]?.label).toBe("2026 · 3 сар");
    expect(timeline.months.at(-1)?.label).toBe("2027 · 5 сар");
    expect(timeline.ticks[0]?.left).toBe(0);
    expect(timeline.ticks.at(-1)?.left).toBe(100);
    expect(timeline.ticks.slice(0, 3).map((tick) => tick.label)).toEqual(["3/2", "4/1", "5/1"]);
  });
});

describe("A0 intake validation feedback", () => {
  it("explains unsupported workbook sheets instead of exposing a bare 422", () => {
    const message = a0IntakeFailureMessage(
      new BuildWatchApiError({
        code: "VALIDATION_FAILED",
        status: 422,
        message: "Workbook does not contain a supported A0 sheet",
        details: { foundSheets: ["material_norm", "README"] },
      }),
    );

    expect(message).toContain("BuildWatch A0 загварт тохирохгүй");
    expect(message).toContain("Price_Catalog");
    expect(message).toContain("PDF/зураг");
  });
});
