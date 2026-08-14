import { describe, expect, it } from "vitest";
import {
  createRecommendationToolsContext,
  recommendationTools,
} from "../../src/recommendations/tools.js";

describe("A2 recommendation tools", () => {
  it("exposes only the dedicated read-only observation tools", () => {
    expect(Object.keys(recommendationTools)).toEqual([
      "inspectWorkItems",
      "inspectDependencies",
      "inspectProgressTrends",
      "inspectCostVariance",
    ]);
  });

  it("applies the same tenant and project scope to every tool", () => {
    const scope = {
      tenantId: "tenant-demo",
      projectIds: ["project-atlas"],
    };

    expect(createRecommendationToolsContext(scope)).toEqual({
      inspectWorkItems: scope,
      inspectDependencies: scope,
      inspectProgressTrends: scope,
      inspectCostVariance: scope,
    });
  });
});
