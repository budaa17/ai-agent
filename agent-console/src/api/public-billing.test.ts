import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicPlans } from "./public-billing";

describe("public billing transport", () => {
  afterEach(() => {
    vi.useRealTimers();
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

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/v1/plans",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("abandons a stalled connection and retries the catalog request", async () => {
    vi.useFakeTimers();
    const catalog = {
      currency: "MNT",
      vatRateBasisPoints: 1_000,
      vatIncluded: false,
      plans: [],
    };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(catalog), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchPublicPlans();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(750);

    await expect(result).resolves.toEqual(catalog);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
