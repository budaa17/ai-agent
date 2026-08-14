import { describe, expect, it } from "vitest";
import {
  overviewQueryFromSearchParams,
  overviewQueryToSearchParams,
} from "./platform-overview-filters";

describe("Control Tower URL filters", () => {
  it("retains preset, tenant and agent filters", () => {
    const query = overviewQueryFromSearchParams(
      new URLSearchParams("window=7d&tenantId=tenant-atlas&agentType=A1"),
    );

    expect(query).toEqual({ window: "7d", tenantId: "tenant-atlas", agentType: "A1" });
    expect(overviewQueryToSearchParams(query).toString()).toBe(
      "window=7d&tenantId=tenant-atlas&agentType=A1",
    );
  });

  it("retains a custom UTC range without adding a preset", () => {
    const query = overviewQueryFromSearchParams(
      new URLSearchParams(
        "from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-02T00%3A00%3A00.000Z&agentType=A4",
      ),
    );

    expect(query).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-02T00:00:00.000Z",
      agentType: "A4",
    });
    expect(query.window).toBeUndefined();
  });

  it("falls back safely when a hand-edited URL contains an invalid range", () => {
    expect(
      overviewQueryFromSearchParams(
        new URLSearchParams("from=invalid&to=2026-08-02T00%3A00%3A00.000Z"),
      ),
    ).toEqual({ window: "24h" });
  });
});
