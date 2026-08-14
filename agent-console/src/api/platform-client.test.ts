import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatformTokens } from "../auth/platform-token-store";
import { setTokens, type TokenPair } from "../auth/token-store";
import { platformOverviewFixture } from "../test/platform-overview-fixture";
import { authorizedFetch } from "./client";
import { platformApi, platformAuthorizedFetch } from "./platform-client";

const pair = (prefix: string): TokenPair => ({
  tokenType: "Bearer",
  accessToken: `${prefix}-access-token-${"x".repeat(32)}`,
  accessExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: `${prefix}-refresh-token-${"x".repeat(32)}`,
  refreshExpiresAt: "2099-02-01T00:00:00.000Z",
});

describe("platform API authorization boundary", () => {
  beforeEach(() => {
    setTokens(null);
    setPlatformTokens(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTokens(null);
    setPlatformTokens(null);
  });

  it("sends tenant and platform tokens only through their own clients", async () => {
    const tenantTokens = pair("tenant");
    const platformTokens = pair("platform");
    setTokens(tenantTokens);
    setPlatformTokens(platformTokens);
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        requests.push(request);
        return new Response(null, { status: 204 });
      }),
    );

    await authorizedFetch("http://localhost/api/v1/projects");
    await platformAuthorizedFetch("http://localhost/api/platform/v1/session");

    expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${tenantTokens.accessToken}`);
    expect(requests[1]?.headers.get("authorization")).toBe(`Bearer ${platformTokens.accessToken}`);
  });

  it("serializes overview filters once and strict-parses the v1 response", async () => {
    const platformTokens = pair("platform");
    setPlatformTokens(platformTokens);
    let request: Request | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request) => {
        request = input;
        return new Response(JSON.stringify(platformOverviewFixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const result = await platformApi.overview({
      window: "7d",
      tenantId: "tenant-atlas",
      agentType: "A1",
    });

    expect(result.schemaVersion).toBe("platform-overview.v1");
    expect(request).not.toBeNull();
    const captured = request as unknown as Request;
    const url = new URL(captured.url);
    expect(url.pathname).toBe("/api/platform/v1/overview");
    expect(url.searchParams.get("window")).toBe("7d");
    expect(url.searchParams.get("tenantId")).toBe("tenant-atlas");
    expect(url.searchParams.get("agentType")).toBe("A1");
    expect(captured.headers.get("authorization")).toBe(`Bearer ${platformTokens.accessToken}`);
  });
});
