import { describe, expect, it } from "vitest";
import { PlatformOverviewService } from "../../src/backend/platform-overview-service.js";
import {
  platformDemoStateFixtures,
  stubOverviewReadModel,
  type PlatformDemoStateName,
} from "./platform-demo-fixtures.js";

/**
 * Phase 7 demo fixture gate.
 *
 * Every state the Control Tower can render has to be reachable from data, not
 * only from a designer's imagination. These fixtures are the ones the demo and
 * the screenshots use, and this test proves each still produces its state.
 */

const AS_OF = new Date("2026-08-11T04:00:00.000Z");

function serviceFor(name: PlatformDemoStateName) {
  return new PlatformOverviewService(
    stubOverviewReadModel(platformDemoStateFixtures[name]),
    () => new Date(AS_OF),
  );
}

describe("platform demo states", () => {
  it("covers every documented demo state", () => {
    expect(Object.keys(platformDemoStateFixtures).sort()).toEqual([
      "CRITICAL",
      "DEGRADED",
      "EMPTY",
      "HEALTHY",
      "INSUFFICIENT_SAMPLE",
      "UNKNOWN_STALE",
    ]);
  });

  it("renders HEALTHY with no attention signal and a real completion figure", async () => {
    const response = await serviceFor("HEALTHY").overview({ window: "24h" });

    expect(response.platformStatus.state).toBe("HEALTHY");
    expect(response.partial).toBe(false);
    expect(response.attention.total).toBe(0);
    expect(response.kpis.agentCompletion.context.state).toBe("AVAILABLE");
    expect(response.kpis.agentCompletion.valuePercent).toBeGreaterThan(0);
  });

  it("renders DEGRADED from a confirmed delivery problem", async () => {
    const response = await serviceFor("DEGRADED").overview({ window: "24h" });

    expect(response.platformStatus.state).toBe("DEGRADED");
    expect(
      response.systemHealth.components.some((component) => component.state === "DEGRADED"),
    ).toBe(true);
    expect(response.attention.items.length).toBeGreaterThan(0);
  });

  it("renders CRITICAL when the database probe fails", async () => {
    const response = await serviceFor("CRITICAL").overview({ window: "24h" });

    expect(response.platformStatus.state).toBe("CRITICAL");
    expect(response.attention.items[0]).toMatchObject({
      ruleKey: "POSTGRES_UNAVAILABLE",
      severity: "CRITICAL",
    });
    expect(
      response.systemHealth.components.find((component) => component.component === "POSTGRES")
        ?.state,
    ).toBe("DOWN");
  });

  it("renders UNKNOWN with stale sources rather than inventing a value", async () => {
    const response = await serviceFor("UNKNOWN_STALE").overview({ window: "24h" });

    expect(response.partial).toBe(true);
    expect(response.problems.some((problem) => problem.code === "SOURCE_STALE")).toBe(true);
    expect(response.kpis.agentCompletion.context.state).toBe("UNKNOWN");
    expect(response.kpis.agentCompletion.valuePercent).toBeNull();
    expect(response.freshness.state).toBe("STALE");
  });

  it("renders EMPTY as no data rather than as a zero-valued success", async () => {
    const response = await serviceFor("EMPTY").overview({ window: "24h" });

    expect(response.partial).toBe(false);
    expect(response.kpis.agentCompletion.context.state).toBe("NO_DATA");
    expect(response.kpis.agentCompletion.valuePercent).toBeNull();
    expect(response.kpis.tenantHealth.context.state).toBe("NO_DATA");
    expect(response.tenantHealthPreview.items).toEqual([]);
    expect(response.attention.items).toEqual([]);
  });

  it("renders INSUFFICIENT_SAMPLE without publishing a misleading percentage", async () => {
    const response = await serviceFor("INSUFFICIENT_SAMPLE").overview({ window: "24h" });

    expect(response.kpis.agentCompletion.context.state).toBe("INSUFFICIENT_SAMPLE");
    expect(response.kpis.agentCompletion.valuePercent).toBeNull();
    expect(response.kpis.agentCompletion.context.sampleSize).toBeLessThan(
      response.kpis.agentCompletion.context.minimumSample,
    );
    expect(response.agentHealthPreview.items[0]?.completionPercent).toBeNull();
  });
});
