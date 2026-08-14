import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizedFetch } from "./client";
import { tenantBillingApi } from "./tenant-billing";

vi.mock("./client", () => ({ authorizedFetch: vi.fn() }));

const mockedAuthorizedFetch = vi.mocked(authorizedFetch);

describe("tenant billing transport", () => {
  beforeEach(() => {
    mockedAuthorizedFetch.mockReset();
  });

  it("sends the bodyless portal command as valid JSON", async () => {
    mockedAuthorizedFetch.mockResolvedValue(
      new Response(JSON.stringify({ url: "https://billing.example.test/portal" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(tenantBillingApi.portal()).resolves.toEqual({
      url: "https://billing.example.test/portal",
    });
    expect(mockedAuthorizedFetch).toHaveBeenCalledWith("/api/v1/billing/portal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  });
});
