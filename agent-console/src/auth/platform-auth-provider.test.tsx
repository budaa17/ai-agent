import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformApi } from "../api/platform-client";
import type { PlatformSession } from "../api/platform-schemas";
import type { TokenPair } from "./token-store";
import { PlatformAuthProvider, usePlatformAuth } from "./platform-auth-provider";
import { setPlatformTokens } from "./platform-token-store";

vi.mock("../api/platform-client", () => ({
  platformApi: {
    login: vi.fn(),
    logout: vi.fn(),
    session: vi.fn(),
  },
}));

const mockedPlatformApi = vi.mocked(platformApi);
const TOKENS: TokenPair = {
  tokenType: "Bearer",
  accessToken: "platform-access-token-value-that-is-long-enough",
  accessExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: "platform-refresh-token-value-that-is-long-enough",
  refreshExpiresAt: "2099-02-01T00:00:00.000Z",
};
const SESSION: PlatformSession = {
  schemaVersion: 1,
  principal: {
    principalKind: "PLATFORM",
    id: "platform-principal-1",
    email: "admin@buildwatch.test",
    displayName: "Atlas Platform Admin",
    role: "PLATFORM_SUPER_ADMIN",
  },
  permissions: ["PLATFORM_OVERVIEW_READ"],
};

function AuthProbe() {
  const auth = usePlatformAuth();
  return (
    <div>
      <span>
        {auth.loading ? "Loading" : (auth.session?.principal.displayName ?? "Signed out")}
      </span>
      <button type="button" onClick={() => void auth.logout()}>
        Logout platform
      </button>
    </div>
  );
}

function renderProvider(queryClient = new QueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <PlatformAuthProvider>
        <AuthProbe />
      </PlatformAuthProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("PlatformAuthProvider", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setPlatformTokens(null);
  });

  it("restores only a strict platform session from platform tokens", async () => {
    setPlatformTokens(TOKENS);
    mockedPlatformApi.session.mockResolvedValue(SESSION);

    renderProvider();

    expect(await screen.findByText("Atlas Platform Admin")).toBeInTheDocument();
    expect(mockedPlatformApi.session).toHaveBeenCalledOnce();
  });

  it("removes platform cache on logout while preserving tenant cache", async () => {
    const user = userEvent.setup();
    setPlatformTokens(TOKENS);
    mockedPlatformApi.session.mockResolvedValue(SESSION);
    mockedPlatformApi.logout.mockImplementation(async () => setPlatformTokens(null));
    const queryClient = new QueryClient();
    queryClient.setQueryData(["tenant", "workspace"], "keep");
    queryClient.setQueryData(["platform", "overview"], "remove");
    renderProvider(queryClient);
    await screen.findByText("Atlas Platform Admin");

    await user.click(screen.getByRole("button", { name: "Logout platform" }));

    await waitFor(() => expect(screen.getByText("Signed out")).toBeInTheDocument());
    expect(queryClient.getQueryData(["platform", "overview"])).toBeUndefined();
    expect(queryClient.getQueryData(["tenant", "workspace"])).toBe("keep");
  });
});
