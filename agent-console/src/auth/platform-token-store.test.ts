import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenPair } from "./token-store";
import {
  getPlatformTokens,
  setPlatformTokens,
  subscribePlatformTokens,
} from "./platform-token-store";

const TOKENS: TokenPair = {
  tokenType: "Bearer",
  accessToken: "platform-access-token-value-that-is-long-enough",
  accessExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: "platform-refresh-token-value-that-is-long-enough",
  refreshExpiresAt: "2099-02-01T00:00:00.000Z",
};

describe("platform token store", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    setPlatformTokens(null);
  });

  it("uses a storage key separate from tenant authentication", () => {
    window.sessionStorage.setItem("buildwatch.auth.v1", "tenant-token-sentinel");

    setPlatformTokens(TOKENS);

    expect(getPlatformTokens()).toEqual(TOKENS);
    expect(window.sessionStorage.getItem("buildwatch.platform.auth.v1")).toContain(
      TOKENS.accessToken,
    );
    expect(window.sessionStorage.getItem("buildwatch.auth.v1")).toBe("tenant-token-sentinel");
  });

  it("clears only platform tokens and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePlatformTokens(listener);
    window.sessionStorage.setItem("buildwatch.auth.v1", "tenant-token-sentinel");

    setPlatformTokens(TOKENS);
    setPlatformTokens(null);
    unsubscribe();

    expect(listener).toHaveBeenNthCalledWith(1, TOKENS);
    expect(listener).toHaveBeenNthCalledWith(2, null);
    expect(window.sessionStorage.getItem("buildwatch.platform.auth.v1")).toBeNull();
    expect(window.sessionStorage.getItem("buildwatch.auth.v1")).toBe("tenant-token-sentinel");
  });
});
