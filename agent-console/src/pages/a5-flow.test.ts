import { describe, expect, it } from "vitest";
import {
  DAILY_REPORT_FLOW_STEPS,
  DAILY_REPORT_PRIMARY_TAP_TARGET,
  estimateDailyReportPrimaryTaps,
} from "./a5-page";

describe("A5 mobile daily-report UX contract", () => {
  it("дөрвөн шаттай бөгөөд зурагтай core flow 10 primary tap-аас хэтрэхгүй", () => {
    expect(DAILY_REPORT_FLOW_STEPS).toEqual(["Ажил", "Гүйцэтгэл", "Хүн/зураг", "Илгээх"]);
    expect(estimateDailyReportPrimaryTaps(true)).toBeLessThanOrEqual(
      DAILY_REPORT_PRIMARY_TAP_TARGET,
    );
    expect(DAILY_REPORT_PRIMARY_TAP_TARGET).toBe(10);
  });
});
