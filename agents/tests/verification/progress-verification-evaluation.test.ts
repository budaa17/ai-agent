import { describe, expect, it } from "vitest";
import { buildBuildWatchOperationalSimulation } from "../../src/simulation/index.js";
import { evaluateBuildWatchProgressVerification } from "../../src/verification/index.js";

describe("BuildWatch v2.2 progress verification release evaluation", () => {
  it("passes the simulation and adversarial completion gate", () => {
    const report = evaluateBuildWatchProgressVerification(buildBuildWatchOperationalSimulation());

    expect(report.pass).toBe(true);
    expect(report.caseCount).toBeGreaterThanOrEqual(60);
    expect(report.metrics.classificationAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(report.metrics.falseCompletedRate).toBeLessThan(0.03);
    expect(report.metrics.duplicatePrecision).toBeGreaterThanOrEqual(0.9);
    expect(report.metrics.duplicateRecall).toBeGreaterThanOrEqual(0.9);
    expect(report.metrics.unverifiableNoGuessRate).toBe(1);
    expect(report.metrics.deterministicReplayRate).toBe(1);
    expect(report.metrics.unapprovedForecastViolationCount).toBe(0);
    expect(report.metrics.approvedApplyProjectionPass).toBe(true);
  });
});
