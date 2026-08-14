import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { PlatformSession } from "../api/platform-schemas";
import type { TokenPair } from "./token-store";
import { usePlatformAuth } from "./platform-auth-provider";
import { RequirePlatformAuth, RequirePlatformPermission } from "./platform-route-guards";

vi.mock("./platform-auth-provider", () => ({ usePlatformAuth: vi.fn() }));

const mockedUsePlatformAuth = vi.mocked(usePlatformAuth);
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
    displayName: "Platform Admin",
    role: "PLATFORM_SUPER_ADMIN",
  },
  permissions: ["PLATFORM_OVERVIEW_READ"],
};

function mockPlatformAuth(input: { authenticated: boolean; allowed?: boolean }) {
  mockedUsePlatformAuth.mockReturnValue({
    tokens: input.authenticated ? TOKENS : null,
    session: input.authenticated ? SESSION : null,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    hasPlatformPermission: vi.fn(() => input.allowed ?? false),
  });
}

describe("platform route guards", () => {
  it("does not treat an existing tenant login as platform authentication", () => {
    mockPlatformAuth({ authenticated: false });
    render(
      <MemoryRouter initialEntries={["/platform/tenants?health=critical"]}>
        <Routes>
          <Route element={<RequirePlatformAuth />}>
            <Route path="/platform/tenants" element={<div>Tenant health</div>} />
          </Route>
          <Route path="/platform/login" element={<div>Platform login</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Platform login")).toBeInTheDocument();
    expect(screen.queryByText("Tenant health")).not.toBeInTheDocument();
  });

  it("opens a protected route for an authenticated platform principal", () => {
    mockPlatformAuth({ authenticated: true });
    render(
      <MemoryRouter initialEntries={["/platform"]}>
        <Routes>
          <Route element={<RequirePlatformAuth />}>
            <Route path="/platform" element={<div>Control Tower</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Control Tower")).toBeInTheDocument();
  });

  it("denies a platform route when its explicit permission is missing", () => {
    mockPlatformAuth({ authenticated: true, allowed: false });
    render(
      <MemoryRouter initialEntries={["/platform/usage"]}>
        <Routes>
          <Route element={<RequirePlatformPermission permission="PLATFORM_USAGE_READ" />}>
            <Route path="/platform/usage" element={<div>Usage data</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Энэ хэсгийг харах эрх алга" })).toBeInTheDocument();
    expect(screen.queryByText("Usage data")).not.toBeInTheDocument();
  });
});
