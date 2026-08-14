import {
  evaluateOperationalForecast,
  renderOperationalForecastEvaluationMarkdown,
} from "../../src/forecasting/index.js";

describe("BuildWatch v2.2 operational forecast evaluation", () => {
  it("passes all Phase 5 answer-key thresholds", () => {
    const report = evaluateOperationalForecast();

    expect(report.caseCount).toBeGreaterThanOrEqual(24);
    expect(report.cases.every((item) => item.pass)).toBe(true);
    expect(report.metrics.finishMaeWorkingDays).toBeLessThanOrEqual(7);
    expect(report.metrics.criticalDelayRecall).toBeGreaterThanOrEqual(0.9);
    expect(report.metrics.averageEarlyWarningWorkingDays).toBeGreaterThanOrEqual(5);
    expect(report.metrics.falseAlertRate).toBeLessThanOrEqual(0.1);
    expect(report.metrics.sourceCoverage).toBe(1);
    expect(report.metrics.deterministicReplayRate).toBe(1);
    expect(report.metrics.baselineMutationCount).toBe(0);
    expect(report.pass).toBe(true);
  });

  it("renders an auditable Markdown report", () => {
    const markdown = renderOperationalForecastEvaluationMarkdown(evaluateOperationalForecast());

    expect(markdown).toContain("Phase 5 Forecast Evaluation");
    expect(markdown).toContain("Finish MAE");
    expect(markdown).toContain("Critical-delay recall");
    expect(markdown).toContain("Baseline mutations");
  });
});
