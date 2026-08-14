import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicPlans } from "./public-billing";

describe("public billing transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bypasses stale browser and edge caches for the public catalog", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            currency: "MNT",
            vatRateBasisPoints: 1_000,
            vatIncluded: false,
            plans: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchPublicPlans();

    expect(fetchMock).toHaveBeenCalledWith("/api/public/v1/plans", {
      method: "GET",
      cache: "no-store",
    });
  });
});
