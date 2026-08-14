import { describe, expect, it } from "vitest";
import {
  evaluateProjectMetrics,
  formatProjectMetricsMarkdown,
} from "../../src/reporting/metrics.js";
import { buildProjectReportFixture } from "./fixtures.js";

describe("project evaluation metrics", () => {
  it("calculates precision, recall, detection timing, and forecast error", () => {
    const fixture = buildProjectReportFixture();
    const metrics = evaluateProjectMetrics(fixture.analysis, fixture.answerKey);

    expect(metrics.issueDetection).toMatchObject({
      precision: 1,
      recall: 1,
      f1: 1,
      truePositiveCount: 5,
    });
    expect(metrics.meanDetectionLagDays).toBe(10);
    expect(metrics.meanEffectiveDateErrorDays).toBe(0);
    expect(metrics.forecastFinish).toBe("2026-05-09T00:00:00.000Z");
    expect(metrics.actualFinish).toBe("2026-05-12T00:00:00.000Z");
    expect(metrics.forecastErrorDays).toBe(3);
  });

  it("formats a markdown measurement table", () => {
    const fixture = buildProjectReportFixture();
    const markdown = formatProjectMetricsMarkdown([fixture.projectReport.metrics]);

    expect(markdown).toContain("| project-atlas | 100.00% | 100.00%");
    expect(markdown).toContain("| 10.00 | 0.00 | 3.00 |");
  });
});
