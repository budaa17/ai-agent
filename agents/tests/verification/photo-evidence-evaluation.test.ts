import { describe, expect, it } from "vitest";
import { buildBuildWatchOperationalSimulation } from "../../src/simulation/index.js";
import { evaluateBuildWatchPhotoEvidence } from "../../src/verification/index.js";

describe("BuildWatch v2.2 photo evidence release evaluation", () => {
  it("passes the 117-photo duplicate and acceptance gate", () => {
    const report = evaluateBuildWatchPhotoEvidence(buildBuildWatchOperationalSimulation());

    expect(report.pass).toBe(true);
    expect(report.caseCount).toBeGreaterThanOrEqual(60);
    expect(report.metrics.duplicatePrecision).toBeGreaterThanOrEqual(0.9);
    expect(report.metrics.duplicateRecall).toBeGreaterThanOrEqual(0.9);
    expect(report.metrics.acceptanceAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(report.metrics.exactQuantityViolationCount).toBe(0);
  });
});
